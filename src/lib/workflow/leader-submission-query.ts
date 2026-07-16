import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import { BusinessRole, Prisma } from "@/generated/prisma/client";
import { requireAnyRole } from "@/lib/auth/authorization";

import { withWorkflowTransaction, type WorkflowTransaction } from "./context";
import { diffSubmittedRow, type WorkflowFieldDiff } from "./diff";
import { WorkflowError } from "./errors";
import {
  findLatestCoreRow,
  findSubmissionEvents,
  resolveStoredSubmissionEvents,
  type LatestWorkflowCoreRow,
  type StoredSubmissionEvent,
} from "./submission-query";

import type { Principal } from "@/lib/auth/principal";
import type {
  ResolvedSubmission,
  RowSubmissionPayload,
  SubmissionState,
  SubmissionType,
} from "./types";

export const LEADER_SUBMISSION_PAGE_SIZE = 20;

const submissionIdSchema = z.uuid();
const submissionTypeSchema = z.enum([
  "CONFIRM_UNCHANGED",
  "UPDATE_EXISTING",
  "CREATE_NEW",
]);

export interface LeaderSubmissionUnitDto {
  readonly id: string;
  readonly displayName: string;
}

export interface LeaderSubmissionQueueQuery {
  readonly page?: number;
  readonly search?: string;
  readonly unitId?: string;
  readonly submissionType?: SubmissionType;
}

export interface LeaderSubmissionSummaryDto {
  readonly submissionId: string;
  readonly submissionType: SubmissionType;
  readonly recordUid: string;
  readonly state: SubmissionState;
  readonly approvalUnit: string;
  readonly lecturerName: string | null;
  readonly lecturerCode: string | null;
  readonly lecturerEmail: string | null;
  readonly courseCode: string | null;
  readonly courseName: string | null;
  readonly submittedAt: Date;
  readonly terminalAt: Date | null;
  readonly resultStt: number | null;
  readonly resultVersionNo: number | null;
  readonly baseStt: number | null;
  readonly baseVersionNo: number | null;
  readonly currentStt: number | null;
  readonly currentVersionNo: number | null;
  readonly stale: boolean;
}

export interface LeaderSubmissionQueuePage {
  readonly submissions: readonly LeaderSubmissionSummaryDto[];
  readonly units: readonly LeaderSubmissionUnitDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalSubmissions: number;
  readonly totalPages: number;
  readonly search: string;
  readonly unitId: string | null;
  readonly submissionType: SubmissionType | null;
}

export interface LeaderSubmissionDetailDto extends LeaderSubmissionSummaryDto {
  readonly parentSubmissionId: string | null;
  readonly payload: RowSubmissionPayload;
  readonly rejectionReason: string | null;
  readonly diff: readonly WorkflowFieldDiff[];
}

export async function getLeaderSubmissionQueue(
  input: LeaderSubmissionQueueQuery = {},
): Promise<LeaderSubmissionQueuePage> {
  const principal = await requireDecisionPrincipal();
  const requestedPage = normalizePage(input.page);
  const search = normalizeSearch(input.search);
  const submissionType = input.submissionType
    ? submissionTypeSchema.parse(input.submissionType)
    : null;

  return withWorkflowTransaction(principal, async (transaction) => {
    const units = await loadDecisionUnits(transaction, principal);
    const selectedUnit = input.unitId
      ? units.find(({ id }) => id === input.unitId)
      : null;
    if (input.unitId && !selectedUnit) {
      throw new WorkflowError("WORKFLOW_SCOPE_DENIED");
    }

    const typeFilter = submissionType
      ? Prisma.sql`AND "submitted"."submission_type" = ${submissionType}::"public"."workflow_submission_type"`
      : Prisma.empty;
    const unitFilter = selectedUnit
      ? Prisma.sql`AND "submitted"."approval_unit" = ${selectedUnit.sourceValue}`
      : Prisma.empty;
    const searchFilter = search ? buildSearchFilter(search) : Prisma.empty;
    const pendingFilter = Prisma.sql`
      "submitted"."event_type" = 'SUBMITTED'::"public"."workflow_event_type"
      AND NOT EXISTS (
        SELECT 1
        FROM "public"."workflow_event" AS "terminal"
        WHERE "terminal"."submission_id" = "submitted"."submission_id"
          AND "terminal"."event_type" IN (
            'REJECTED'::"public"."workflow_event_type",
            'APPROVED'::"public"."workflow_event_type"
          )
      )
      ${typeFilter}
      ${unitFilter}
      ${searchFilter}
    `;

    const countRows = await transaction.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`
        SELECT count(*)::integer AS "count"
        FROM "public"."workflow_event" AS "submitted"
        WHERE ${pendingFilter}
      `,
    );
    const totalSubmissions = countRows[0]?.count ?? 0;
    const totalPages = Math.max(
      1,
      Math.ceil(totalSubmissions / LEADER_SUBMISSION_PAGE_SIZE),
    );
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * LEADER_SUBMISSION_PAGE_SIZE;
    const ids = await transaction.$queryRaw<Array<{ submissionId: string }>>(
      Prisma.sql`
        SELECT "submitted"."submission_id"::text AS "submissionId"
        FROM "public"."workflow_event" AS "submitted"
        WHERE ${pendingFilter}
        ORDER BY "submitted"."created_at" ASC, "submitted"."submission_id" ASC
        LIMIT ${LEADER_SUBMISSION_PAGE_SIZE}
        OFFSET ${offset}
      `,
    );
    const resolved = await loadResolvedSubmissions(
      transaction,
      ids.map(({ submissionId }) => submissionId),
    );
    const byId = new Map(
      resolved.map((submission) => [submission.submissionId, submission]),
    );
    const submissions = await Promise.all(
      ids.map(async ({ submissionId }) => {
        const submission = byId.get(submissionId);
        if (!submission || submission.state !== "PENDING") invalidStoredEvent();
        const current = await findLatestCoreRow(
          transaction,
          submission.recordUid,
        );
        return toSummary(submission, current);
      }),
    );

    return {
      submissions,
      units: units.map(({ id, displayName }) => ({ id, displayName })),
      page,
      pageSize: LEADER_SUBMISSION_PAGE_SIZE,
      totalSubmissions,
      totalPages,
      search,
      unitId: selectedUnit?.id ?? null,
      submissionType,
    };
  });
}

export async function getLeaderSubmissionDetail(
  submissionId: string,
): Promise<LeaderSubmissionDetailDto> {
  const validatedId = submissionIdSchema.parse(submissionId);
  const principal = await requireDecisionPrincipal();
  const detail = await withWorkflowTransaction(
    principal,
    async (transaction) => {
      const rows = await findSubmissionEvents(transaction, validatedId);
      if (rows.length === 0) return null;
      const submission = resolveStoredSubmissionEvents(rows);
      const current = await findLatestCoreRow(
        transaction,
        submission.recordUid,
      );
      const terminal = submission.terminalEvent;
      return {
        ...toSummary(submission, current),
        parentSubmissionId: submission.parentSubmissionId,
        payload: submission.submittedEvent.payload,
        rejectionReason:
          terminal?.eventType === "REJECTED" ? terminal.reason : null,
        diff: diffSubmittedRow({
          currentRow: current,
          submittedPayload: submission.submittedEvent.payload,
          submissionType: submission.submissionType,
        }),
      };
    },
  );

  if (!detail) notFound();
  return detail;
}

async function requireDecisionPrincipal(): Promise<Principal> {
  return requireAnyRole([BusinessRole.FACULTY_LEADER, BusinessRole.ADMIN]);
}

async function loadDecisionUnits(
  transaction: WorkflowTransaction,
  principal: Principal,
): Promise<Array<LeaderSubmissionUnitDto & { readonly sourceValue: string }>> {
  const admin = principal.roles.includes(BusinessRole.ADMIN);

  return transaction.organizationUnit.findMany({
    where: {
      isActive: true,
      ...(admin
        ? {}
        : {
            scopeAssignments: {
              some: {
                userId: principal.userId,
                revokedAt: null,
              },
            },
          }),
    },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: { id: true, displayName: true, sourceValue: true },
  });
}

async function loadResolvedSubmissions(
  transaction: WorkflowTransaction,
  submissionIds: readonly string[],
): Promise<ResolvedSubmission[]> {
  if (submissionIds.length === 0) return [];
  const events = await transaction.workflowEvent.findMany({
    where: { submissionId: { in: [...submissionIds] } },
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
  const grouped = new Map<string, StoredSubmissionEvent[]>();
  for (const event of events) {
    const group = grouped.get(event.submissionId) ?? [];
    group.push(event);
    grouped.set(event.submissionId, group);
  }
  return submissionIds.flatMap((id) => {
    const group = grouped.get(id);
    return group ? [resolveStoredSubmissionEvents(group)] : [];
  });
}

function toSummary(
  submission: ResolvedSubmission,
  current: LatestWorkflowCoreRow | null,
): LeaderSubmissionSummaryDto {
  const payload = submission.submittedEvent.payload;
  return {
    submissionId: submission.submissionId,
    submissionType: submission.submissionType,
    recordUid: submission.recordUid,
    state: submission.state,
    approvalUnit: submission.approvalUnit,
    lecturerName: payload.ten_giang_vien,
    lecturerCode: payload.ma_so_can_bo,
    lecturerEmail: payload.email_tai_khoan_vnu,
    courseCode: payload.ma_hoc_phan,
    courseName: payload.ten_hoc_phan,
    submittedAt: submission.submittedEvent.createdAt,
    terminalAt: submission.terminalEvent?.createdAt ?? null,
    resultStt:
      submission.terminalEvent?.eventType === "APPROVED"
        ? submission.terminalEvent.resultStt
        : null,
    resultVersionNo:
      submission.terminalEvent?.eventType === "APPROVED"
        ? submission.terminalEvent.resultVersionNo
        : null,
    baseStt: submission.submittedEvent.baseStt,
    baseVersionNo: submission.submittedEvent.baseVersionNo,
    currentStt: current?.stt ?? null,
    currentVersionNo: current?.versionNo ?? null,
    stale: isStale(submission, current),
  };
}

function isStale(
  submission: ResolvedSubmission,
  current: LatestWorkflowCoreRow | null,
): boolean {
  if (submission.submissionType === "CREATE_NEW") return current !== null;
  return (
    current === null ||
    current.stt !== submission.submittedEvent.baseStt ||
    current.versionNo !== submission.submittedEvent.baseVersionNo
  );
}

function buildSearchFilter(search: string): Prisma.Sql {
  const pattern = `%${escapeLike(search)}%`;
  return Prisma.sql`AND (
    "submitted"."submission_id"::text ILIKE ${pattern} ESCAPE '\\'
    OR "submitted"."record_uid"::text ILIKE ${pattern} ESCAPE '\\'
    OR coalesce("submitted"."payload" ->> 'ten_giang_vien', '') ILIKE ${pattern} ESCAPE '\\'
    OR coalesce("submitted"."payload" ->> 'ma_so_can_bo', '') ILIKE ${pattern} ESCAPE '\\'
    OR coalesce("submitted"."payload" ->> 'email_tai_khoan_vnu', '') ILIKE ${pattern} ESCAPE '\\'
    OR coalesce("submitted"."payload" ->> 'ma_hoc_phan', '') ILIKE ${pattern} ESCAPE '\\'
    OR coalesce("submitted"."payload" ->> 'ten_hoc_phan', '') ILIKE ${pattern} ESCAPE '\\'
  )`;
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function normalizePage(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value ?? 1) : 1;
}

function normalizeSearch(value: string | undefined): string {
  return value?.trim().slice(0, 100) ?? "";
}

function invalidStoredEvent(): never {
  throw new Error("Stored workflow event violates the Phase 4 contract.");
}
