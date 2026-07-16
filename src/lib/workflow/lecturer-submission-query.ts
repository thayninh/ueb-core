import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { requireLecturerIdentity } from "@/lib/auth/authorization";

import { withWorkflowTransaction, type WorkflowTransaction } from "./context";
import {
  resolveStoredSubmissionEvents,
  type StoredSubmissionEvent,
} from "./submission-query";

import type {
  ResolvedSubmission,
  RowSubmissionPayload,
  SubmissionState,
  SubmissionType,
} from "./types";

export const LECTURER_SUBMISSION_PAGE_SIZE = 20;

const submissionIdSchema = z.uuid();
const recordUidSchema = z.uuid();
const submissionStateSchema = z.enum(["PENDING", "REJECTED", "APPROVED"]);
const submissionTypeSchema = z.enum([
  "CONFIRM_UNCHANGED",
  "UPDATE_EXISTING",
  "CREATE_NEW",
]);

export interface LecturerSubmissionListQuery {
  readonly page?: number;
  readonly search?: string;
  readonly state?: SubmissionState;
  readonly submissionType?: SubmissionType;
}

export interface LecturerSubmissionSummaryDto {
  readonly submissionId: string;
  readonly submissionType: SubmissionType;
  readonly recordUid: string;
  readonly state: SubmissionState;
  readonly submittedAt: Date;
  readonly terminalAt: Date | null;
  readonly resultStt: number | null;
  readonly resultVersionNo: number | null;
  readonly rejectionReason: string | null;
  readonly baseStt: number | null;
  readonly baseVersionNo: number | null;
}

export interface LecturerSubmissionListPage {
  readonly submissions: readonly LecturerSubmissionSummaryDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalSubmissions: number;
  readonly totalPages: number;
  readonly search: string;
  readonly state: SubmissionState | null;
  readonly submissionType: SubmissionType | null;
}

export interface LecturerSubmissionDetailDto extends LecturerSubmissionSummaryDto {
  readonly parentSubmissionId: string | null;
  readonly payload: RowSubmissionPayload;
  readonly rejectionReason: string | null;
}

export interface PendingSubmissionByRecordDto {
  readonly submissionId: string;
  readonly submissionType: SubmissionType;
  readonly recordUid: string;
  readonly submittedAt: Date;
}

export async function getLecturerSubmissions(
  input: LecturerSubmissionListQuery = {},
): Promise<LecturerSubmissionListPage> {
  const principal = await requireLecturerIdentity();
  const requestedPage = normalizePage(input.page);
  const search = normalizeSearch(input.search);
  const state = input.state ? submissionStateSchema.parse(input.state) : null;
  const submissionType = input.submissionType
    ? submissionTypeSchema.parse(input.submissionType)
    : null;

  return withWorkflowTransaction(principal, async (transaction) => {
    const stateFilter = buildStateFilter(state);
    const typeFilter = submissionType
      ? Prisma.sql`AND "submitted"."submission_type" = ${submissionType}::"public"."workflow_submission_type"`
      : Prisma.empty;
    const searchFilter = search
      ? Prisma.sql`AND (
          "submitted"."submission_id"::text ILIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'
          OR "submitted"."record_uid"::text ILIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'
        )`
      : Prisma.empty;
    const where = Prisma.sql`
      "submitted"."event_type" = 'SUBMITTED'::"public"."workflow_event_type"
      AND "submitted"."lecturer_uid" = ${principal.lecturerUid}::uuid
      ${typeFilter}
      ${searchFilter}
      ${stateFilter}
    `;

    const countRows = await transaction.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`
        SELECT count(*)::integer AS "count"
        FROM "public"."workflow_event" AS "submitted"
        WHERE ${where}
      `,
    );
    const totalSubmissions = countRows[0]?.count ?? 0;
    const totalPages = Math.max(
      1,
      Math.ceil(totalSubmissions / LECTURER_SUBMISSION_PAGE_SIZE),
    );
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * LECTURER_SUBMISSION_PAGE_SIZE;
    const ids = await transaction.$queryRaw<Array<{ submissionId: string }>>(
      Prisma.sql`
        SELECT "submitted"."submission_id"::text AS "submissionId"
        FROM "public"."workflow_event" AS "submitted"
        WHERE ${where}
        ORDER BY "submitted"."created_at" DESC, "submitted"."event_id" DESC
        LIMIT ${LECTURER_SUBMISSION_PAGE_SIZE}
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

    return {
      submissions: ids.map(({ submissionId }) =>
        toSummary(requireResolved(byId, submissionId)),
      ),
      page,
      pageSize: LECTURER_SUBMISSION_PAGE_SIZE,
      totalSubmissions,
      totalPages,
      search,
      state,
      submissionType,
    };
  });
}

export async function getLecturerSubmissionDetail(
  submissionId: string,
): Promise<LecturerSubmissionDetailDto> {
  const validatedId = submissionIdSchema.parse(submissionId);
  const principal = await requireLecturerIdentity();

  const detail = await withWorkflowTransaction(
    principal,
    async (transaction) => {
      const resolved = await loadResolvedSubmissions(transaction, [
        validatedId,
      ]);
      const submission = resolved[0];
      if (!submission || submission.lecturerUid !== principal.lecturerUid) {
        return null;
      }
      const terminal = submission.terminalEvent;
      return {
        ...toSummary(submission),
        parentSubmissionId: submission.parentSubmissionId,
        payload: submission.submittedEvent.payload,
        rejectionReason:
          terminal?.eventType === "REJECTED" ? terminal.reason : null,
      };
    },
  );

  if (!detail) notFound();
  return detail;
}

export async function getPendingSubmissionsForLecturerRecords(
  recordUids: readonly string[],
): Promise<readonly PendingSubmissionByRecordDto[]> {
  const validatedIds = z.array(recordUidSchema).parse(recordUids);
  if (validatedIds.length === 0) return [];
  const principal = await requireLecturerIdentity();

  return withWorkflowTransaction(principal, async (transaction) => {
    const rows = await transaction.$queryRaw<PendingSubmissionByRecordDto[]>(
      Prisma.sql`
        SELECT
          "submitted"."submission_id"::text AS "submissionId",
          "submitted"."submission_type"::text AS "submissionType",
          "submitted"."record_uid"::text AS "recordUid",
          "submitted"."created_at" AS "submittedAt"
        FROM "public"."workflow_event" AS "submitted"
        WHERE "submitted"."event_type" = 'SUBMITTED'::"public"."workflow_event_type"
          AND "submitted"."lecturer_uid" = ${principal.lecturerUid}::uuid
          AND "submitted"."record_uid" IN (${Prisma.join(validatedIds.map((id) => Prisma.sql`${id}::uuid`))})
          AND NOT EXISTS (
            SELECT 1
            FROM "public"."workflow_event" AS "terminal"
            WHERE "terminal"."submission_id" = "submitted"."submission_id"
              AND "terminal"."event_type" IN (
                'REJECTED'::"public"."workflow_event_type",
                'APPROVED'::"public"."workflow_event_type"
              )
          )
        ORDER BY "submitted"."created_at" DESC, "submitted"."event_id" DESC
      `,
    );
    return rows.map((row) => ({
      ...row,
      submissionType: submissionTypeSchema.parse(row.submissionType),
    }));
  });
}

function buildStateFilter(state: SubmissionState | null): Prisma.Sql {
  if (state === "PENDING") {
    return Prisma.sql`AND NOT EXISTS (
      SELECT 1 FROM "public"."workflow_event" AS "terminal"
      WHERE "terminal"."submission_id" = "submitted"."submission_id"
        AND "terminal"."event_type" IN (
          'REJECTED'::"public"."workflow_event_type",
          'APPROVED'::"public"."workflow_event_type"
        )
    )`;
  }
  if (state === "REJECTED" || state === "APPROVED") {
    return Prisma.sql`AND EXISTS (
      SELECT 1 FROM "public"."workflow_event" AS "terminal"
      WHERE "terminal"."submission_id" = "submitted"."submission_id"
        AND "terminal"."event_type" = ${state}::"public"."workflow_event_type"
    )`;
  }
  return Prisma.empty;
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
): LecturerSubmissionSummaryDto {
  return {
    submissionId: submission.submissionId,
    submissionType: submission.submissionType,
    recordUid: submission.recordUid,
    state: submission.state,
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
    rejectionReason:
      submission.terminalEvent?.eventType === "REJECTED"
        ? submission.terminalEvent.reason
        : null,
    baseStt: submission.submittedEvent.baseStt,
    baseVersionNo: submission.submittedEvent.baseVersionNo,
  };
}

function requireResolved(
  submissions: ReadonlyMap<string, ResolvedSubmission>,
  submissionId: string,
): ResolvedSubmission {
  const submission = submissions.get(submissionId);
  if (!submission) invalidEvent();
  return submission;
}

function invalidEvent(): never {
  throw new Error("Stored workflow event violates the Phase 4 contract.");
}

function normalizePage(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value ?? 1) : 1;
}

function normalizeSearch(value: string | undefined): string {
  return value?.trim().slice(0, 100) ?? "";
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
