import "server-only";

import {
  Prisma,
  WorkflowEventType,
  type WorkflowSubmissionType,
} from "@/generated/prisma/client";

import type { WorkflowTransaction } from "./context";
import { rowSubmissionPayloadSchema } from "./payload-schema";
import { resolveSubmission } from "./state-machine";

import type {
  ApprovedWorkflowEvent,
  CoreBusinessRow,
  RejectedWorkflowEvent,
  ResolvedSubmission,
  SubmittedWorkflowEvent,
  WorkflowEvent,
} from "./types";

export interface LatestWorkflowCoreRow extends CoreBusinessRow {
  readonly recordUid: string;
  readonly lecturerUid: string;
  readonly versionNo: number;
  readonly approvalUnit: string | null;
}

export interface StoredSubmittedEvent {
  readonly eventId: string;
  readonly submissionId: string;
  readonly parentSubmissionId: string | null;
  readonly submissionType: WorkflowSubmissionType;
  readonly recordUid: string;
  readonly lecturerUid: string;
  readonly approvalUnit: string;
  readonly baseStt: number | null;
  readonly baseVersionNo: number | null;
  readonly payload: Prisma.JsonValue;
  readonly payloadChecksum: string;
  readonly actorUserId: string;
  readonly createdAt: Date;
}

export interface StoredSubmissionEvent {
  readonly eventId: string;
  readonly submissionId: string;
  readonly parentSubmissionId: string | null;
  readonly eventType: WorkflowEventType;
  readonly submissionType: WorkflowSubmissionType | null;
  readonly recordUid: string | null;
  readonly lecturerUid: string;
  readonly approvalUnit: string | null;
  readonly baseStt: number | null;
  readonly baseVersionNo: number | null;
  readonly payload: Prisma.JsonValue | null;
  readonly payloadChecksum: string | null;
  readonly actorUserId: string | null;
  readonly reason: string | null;
  readonly resultStt: number | null;
  readonly resultVersionNo: number | null;
  readonly createdAt: Date;
}

const CORE_BUSINESS_PROJECTION = Prisma.sql`
  "stt",
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
  "record_uid"::text AS "recordUid",
  "lecturer_uid"::text AS "lecturerUid",
  "version_no" AS "versionNo",
  "approval_unit" AS "approvalUnit"
`;

function latestCoreRowsCte(scope: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH "ranked_workflow_core_rows" AS (
      SELECT
        "core".*,
        row_number() OVER (
          PARTITION BY "core"."record_uid"
          ORDER BY "core"."version_no" DESC, "core"."stt" DESC
        ) AS "row_rank"
      FROM "public"."ueb_core_data" AS "core"
      WHERE ${scope}
    )
  `;
}

export async function findSubmittedEvent(
  transaction: WorkflowTransaction,
  submissionId: string,
): Promise<StoredSubmittedEvent | null> {
  const event = await transaction.workflowEvent.findFirst({
    where: {
      submissionId,
      eventType: WorkflowEventType.SUBMITTED,
    },
    select: {
      eventId: true,
      submissionId: true,
      parentSubmissionId: true,
      submissionType: true,
      recordUid: true,
      lecturerUid: true,
      approvalUnit: true,
      baseStt: true,
      baseVersionNo: true,
      payload: true,
      payloadChecksum: true,
      actorUserId: true,
      createdAt: true,
    },
  });

  if (
    !event?.submissionType ||
    !event.recordUid ||
    !event.approvalUnit ||
    event.payload === null ||
    !event.payloadChecksum ||
    !event.actorUserId
  ) {
    return null;
  }

  return event as StoredSubmittedEvent;
}

export function findSubmissionEvents(
  transaction: WorkflowTransaction,
  submissionId: string,
): Promise<StoredSubmissionEvent[]> {
  return transaction.workflowEvent.findMany({
    where: { submissionId },
    orderBy: [{ createdAt: "asc" }, { eventId: "asc" }],
    select: {
      eventId: true,
      submissionId: true,
      parentSubmissionId: true,
      eventType: true,
      submissionType: true,
      recordUid: true,
      lecturerUid: true,
      approvalUnit: true,
      baseStt: true,
      baseVersionNo: true,
      payload: true,
      payloadChecksum: true,
      actorUserId: true,
      reason: true,
      resultStt: true,
      resultVersionNo: true,
      createdAt: true,
    },
  });
}

/**
 * Converts persisted rows to the shared immutable-event state machine input.
 * Query modules must not derive workflow state independently.
 */
export function resolveStoredSubmissionEvents(
  rows: readonly StoredSubmissionEvent[],
): ResolvedSubmission {
  return resolveSubmission(rows.map(toWorkflowEvent));
}

function toWorkflowEvent(row: StoredSubmissionEvent): WorkflowEvent {
  const common = {
    eventId: row.eventId,
    submissionId: row.submissionId,
    recordUid: requireStoredString(row.recordUid),
    lecturerUid: row.lecturerUid,
    approvalUnit: requireStoredString(row.approvalUnit),
    actorUserId: requireStoredString(row.actorUserId),
    createdAt: row.createdAt,
  };

  if (row.eventType === WorkflowEventType.SUBMITTED) {
    if (!row.submissionType) invalidStoredEvent();
    const base = {
      ...common,
      eventType: "SUBMITTED" as const,
      submissionType: row.submissionType,
      parentSubmissionId: row.parentSubmissionId,
      payload: rowSubmissionPayloadSchema.parse(row.payload),
      payloadChecksum: requireStoredString(row.payloadChecksum),
    };
    if (row.submissionType === "CREATE_NEW") {
      if (row.baseStt !== null || row.baseVersionNo !== null) {
        invalidStoredEvent();
      }
      return {
        ...base,
        submissionType: "CREATE_NEW",
        baseStt: null,
        baseVersionNo: null,
      };
    }
    if (row.baseStt === null || row.baseVersionNo === null) {
      invalidStoredEvent();
    }
    return {
      ...base,
      submissionType: row.submissionType,
      baseStt: row.baseStt,
      baseVersionNo: row.baseVersionNo,
    } as SubmittedWorkflowEvent;
  }

  if (row.eventType === WorkflowEventType.REJECTED) {
    if (!row.reason) invalidStoredEvent();
    return {
      ...common,
      eventType: "REJECTED",
      reason: row.reason,
    } satisfies RejectedWorkflowEvent;
  }

  if (row.resultStt === null || row.resultVersionNo === null) {
    invalidStoredEvent();
  }
  return {
    ...common,
    eventType: "APPROVED",
    resultStt: row.resultStt,
    resultVersionNo: row.resultVersionNo,
  } satisfies ApprovedWorkflowEvent;
}

function requireStoredString(value: string | null): string {
  if (!value) invalidStoredEvent();
  return value;
}

function invalidStoredEvent(): never {
  throw new Error("Stored workflow event violates the Phase 4 contract.");
}

export async function findPendingSubmissionId(
  transaction: WorkflowTransaction,
  recordUid: string,
  excludedSubmissionId: string,
): Promise<string | null> {
  const rows = await transaction.$queryRaw<Array<{ submissionId: string }>>(
    Prisma.sql`
      SELECT "submitted"."submission_id"::text AS "submissionId"
      FROM "public"."workflow_event" AS "submitted"
      WHERE "submitted"."record_uid" = ${recordUid}::uuid
        AND "submitted"."event_type" = 'SUBMITTED'::"public"."workflow_event_type"
        AND "submitted"."submission_id" <> ${excludedSubmissionId}::uuid
        AND NOT EXISTS (
          SELECT 1
          FROM "public"."workflow_event" AS "terminal"
          WHERE "terminal"."submission_id" = "submitted"."submission_id"
            AND "terminal"."event_type" IN (
              'APPROVED'::"public"."workflow_event_type",
              'REJECTED'::"public"."workflow_event_type"
            )
        )
      ORDER BY "submitted"."created_at" ASC, "submitted"."event_id" ASC
      FETCH FIRST 1 ROW ONLY
    `,
  );
  return rows[0]?.submissionId ?? null;
}

export async function findLatestCoreRow(
  transaction: WorkflowTransaction,
  recordUid: string,
): Promise<LatestWorkflowCoreRow | null> {
  const rows = await transaction.$queryRaw<LatestWorkflowCoreRow[]>(Prisma.sql`
    ${latestCoreRowsCte(Prisma.sql`"record_uid" = ${recordUid}::uuid`)}
    SELECT ${CORE_BUSINESS_PROJECTION}
    FROM "ranked_workflow_core_rows"
    WHERE "row_rank" = 1
  `);
  return rows[0] ?? null;
}

export function findLatestCoreRowsForLecturer(
  transaction: WorkflowTransaction,
  lecturerUid: string,
): Promise<LatestWorkflowCoreRow[]> {
  return transaction.$queryRaw<LatestWorkflowCoreRow[]>(Prisma.sql`
    ${latestCoreRowsCte(Prisma.sql`"lecturer_uid" = ${lecturerUid}::uuid`)}
    SELECT ${CORE_BUSINESS_PROJECTION}
    FROM "ranked_workflow_core_rows"
    WHERE "row_rank" = 1
    ORDER BY "record_uid" ASC
  `);
}

export async function isActiveApprovalUnit(
  transaction: WorkflowTransaction,
  approvalUnit: string,
): Promise<boolean> {
  const count = await transaction.organizationUnit.count({
    where: { sourceValue: approvalUnit, isActive: true },
  });
  return count === 1;
}
