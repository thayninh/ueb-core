import "server-only";

import { z } from "zod";

import {
  BusinessRole,
  Prisma,
  WorkflowEventType,
} from "@/generated/prisma/client";
import { requireAnyRole } from "@/lib/auth/authorization";

import { verifyRowSubmissionChecksum } from "./checksum";
import { withWorkflowTransaction } from "./context";
import { assertCurrentDecisionScope } from "./decision-authorization";
import { WorkflowError } from "./errors";
import { lockRecord, lockSubmission } from "./locks";
import { assertSubmissionCanBeApproved } from "./state-machine";
import {
  findLatestCoreRow,
  findSubmissionEvents,
  resolveStoredSubmissionEvents,
} from "./submission-query";

import type { SubmissionType } from "./types";

export const approveSubmissionInputSchema = z
  .object({ submissionId: z.uuid() })
  .strict();

export type ApproveSubmissionInput = z.infer<
  typeof approveSubmissionInputSchema
>;

export interface ApprovedSubmissionDto {
  readonly submissionId: string;
  readonly submissionType: SubmissionType;
  readonly recordUid: string;
  readonly state: "APPROVED";
  readonly resultStt: number;
  readonly resultVersionNo: number;
  readonly approvedAt: Date;
}

interface InsertedCoreResult {
  readonly stt: number;
  readonly versionNo: number;
}

export async function approveSubmission(
  input: unknown,
): Promise<ApprovedSubmissionDto> {
  const parsed = approveSubmissionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowError("WORKFLOW_INVALID_PAYLOAD");
  }
  const principal = await requireAnyRole([
    BusinessRole.FACULTY_LEADER,
    BusinessRole.ADMIN,
  ]);

  return withWorkflowTransaction(
    principal,
    async (transaction) => {
      await lockSubmission(transaction, parsed.data.submissionId);

      const rows = await findSubmissionEvents(
        transaction,
        parsed.data.submissionId,
      );
      if (rows.length === 0) {
        throw new WorkflowError("WORKFLOW_SUBMISSION_NOT_FOUND");
      }
      const resolved = resolveStoredSubmissionEvents(rows);
      assertSubmissionCanBeApproved(resolved);
      await assertCurrentDecisionScope(
        transaction,
        principal,
        resolved.approvalUnit,
      );

      await lockRecord(transaction, resolved.recordUid);

      const lockedRows = await findSubmissionEvents(
        transaction,
        parsed.data.submissionId,
      );
      if (lockedRows.length === 0) {
        throw new WorkflowError("WORKFLOW_SUBMISSION_NOT_FOUND");
      }
      const locked = resolveStoredSubmissionEvents(lockedRows);
      assertSubmissionCanBeApproved(locked);
      if (
        !verifyRowSubmissionChecksum(
          locked.submittedEvent.payload,
          locked.submittedEvent.payloadChecksum,
        )
      ) {
        throw new WorkflowError("WORKFLOW_PAYLOAD_MISMATCH");
      }

      const current = await findLatestCoreRow(transaction, locked.recordUid);
      const versionNo = nextVersion(locked, current);
      const core = await insertApprovedCoreRow(transaction, {
        submissionId: locked.submissionId,
        recordUid: locked.recordUid,
        lecturerUid: locked.lecturerUid,
        approvalUnit: locked.approvalUnit,
        approvedBy: principal.userId,
        versionNo,
        payload: locked.submittedEvent.payload,
      });

      const event = await transaction.workflowEvent.create({
        data: {
          eventType: WorkflowEventType.APPROVED,
          submissionId: locked.submissionId,
          parentSubmissionId: null,
          submissionType: locked.submissionType,
          recordUid: locked.recordUid,
          lecturerUid: locked.lecturerUid,
          approvalUnit: locked.approvalUnit,
          baseStt: locked.submittedEvent.baseStt,
          baseVersionNo: locked.submittedEvent.baseVersionNo,
          payload: Prisma.DbNull,
          payloadChecksum: null,
          actorUserId: principal.userId,
          reason: null,
          resultStt: core.stt,
          resultVersionNo: core.versionNo,
        },
        select: {
          submissionId: true,
          submissionType: true,
          recordUid: true,
          resultStt: true,
          resultVersionNo: true,
          createdAt: true,
        },
      });
      if (
        !event.submissionType ||
        !event.recordUid ||
        event.resultStt === null ||
        event.resultVersionNo === null
      ) {
        throw new WorkflowError("WORKFLOW_INVALID_STATE");
      }

      return {
        submissionId: event.submissionId,
        submissionType: event.submissionType,
        recordUid: event.recordUid,
        state: "APPROVED",
        resultStt: event.resultStt,
        resultVersionNo: event.resultVersionNo,
        approvedAt: event.createdAt,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function nextVersion(
  submission: ReturnType<typeof resolveStoredSubmissionEvents>,
  current: Awaited<ReturnType<typeof findLatestCoreRow>>,
): number {
  if (submission.submissionType === "CREATE_NEW") {
    if (
      current !== null ||
      submission.submittedEvent.baseStt !== null ||
      submission.submittedEvent.baseVersionNo !== null
    ) {
      throw new WorkflowError("WORKFLOW_STALE_BASE");
    }
    return 1;
  }

  if (
    current === null ||
    current.stt !== submission.submittedEvent.baseStt ||
    current.versionNo !== submission.submittedEvent.baseVersionNo ||
    current.lecturerUid !== submission.lecturerUid ||
    current.approvalUnit !== submission.approvalUnit
  ) {
    throw new WorkflowError("WORKFLOW_STALE_BASE");
  }
  return current.versionNo + 1;
}

async function insertApprovedCoreRow(
  transaction: Parameters<Parameters<typeof withWorkflowTransaction>[1]>[0],
  input: {
    readonly submissionId: string;
    readonly recordUid: string;
    readonly lecturerUid: string;
    readonly approvalUnit: string;
    readonly approvedBy: string;
    readonly versionNo: number;
    readonly payload: ReturnType<
      typeof resolveStoredSubmissionEvents
    >["submittedEvent"]["payload"];
  },
): Promise<InsertedCoreResult> {
  const row = input.payload;
  const inserted = await transaction.$queryRaw<InsertedCoreResult[]>(Prisma.sql`
    INSERT INTO "public"."ueb_core_data" (
      "don_vi_phu_trach_hoc_phan",
      "bo_mon_phu_trach_hoc_phan",
      "khoi_kien_thuc",
      "ma_hoc_phan",
      "ten_hoc_phan",
      "ten_giang_vien",
      "ma_so_can_bo",
      "email_tai_khoan_vnu",
      "bo_mon",
      "don_vi",
      "core_1_2_3",
      "tc1_tro_giang",
      "tc2_sh_chuyen_mon",
      "tc3_tong_hop",
      "tc3_1_nganh_tot_nghiep_phu_hop",
      "tc3_2_bien_soan_de_cuong_giao_trinh",
      "tc3_3_chu_nhiem_de_tai_nckh_lien_quan",
      "tc3_4_bai_bao_lien_quan",
      "tc4_giang_thu",
      "lecturer_uid",
      "record_uid",
      "version_no",
      "source_submission_id",
      "approval_unit",
      "origin",
      "approved_by"
    ) VALUES (
      ${row.don_vi_phu_trach_hoc_phan},
      ${row.bo_mon_phu_trach_hoc_phan},
      ${row.khoi_kien_thuc},
      ${row.ma_hoc_phan},
      ${row.ten_hoc_phan},
      ${row.ten_giang_vien},
      ${row.ma_so_can_bo},
      ${row.email_tai_khoan_vnu},
      ${row.bo_mon},
      ${row.don_vi},
      ${row.core_1_2_3},
      ${row.tc1_tro_giang},
      ${row.tc2_sh_chuyen_mon},
      ${row.tc3_tong_hop},
      ${row.tc3_1_nganh_tot_nghiep_phu_hop},
      ${row.tc3_2_bien_soan_de_cuong_giao_trinh},
      ${row.tc3_3_chu_nhiem_de_tai_nckh_lien_quan},
      ${row.tc3_4_bai_bao_lien_quan},
      ${row.tc4_giang_thu},
      ${input.lecturerUid}::uuid,
      ${input.recordUid}::uuid,
      ${input.versionNo},
      ${input.submissionId}::uuid,
      ${input.approvalUnit},
      'APPROVED_SUBMISSION',
      ${input.approvedBy}::uuid
    )
    RETURNING "stt", "version_no" AS "versionNo"
  `);
  const result = inserted[0];
  if (!result || inserted.length !== 1) {
    throw new WorkflowError("WORKFLOW_INVALID_STATE");
  }
  return result;
}
