import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma, WorkflowEventType } from "@/generated/prisma/client";
import { requireLecturerIdentity } from "@/lib/auth/authorization";

import {
  calculateRowSubmissionChecksum,
  verifyRowSubmissionChecksum,
} from "./checksum";
import { withWorkflowTransaction, type WorkflowTransaction } from "./context";
import { WorkflowError } from "./errors";
import {
  CORE_DISPLAY_FIELD_NAMES,
  SUBMISSION_EDITABLE_FIELD_NAMES,
} from "./field-policy";
import { lockRecord, lockSubmission } from "./locks";
import {
  buildConfirmUnchangedPayload,
  buildCreateNewPayload,
  buildUpdateExistingPayload,
  confirmUnchangedInputSchema,
  createNewInputSchema,
  rowSubmissionPayloadSchema,
  updateExistingInputSchema,
  type ConfirmUnchangedInput,
  type CreateNewInput,
  type UpdateExistingInput,
} from "./payload-schema";
import {
  findLatestCoreRow,
  findLatestCoreRowsForLecturer,
  findPendingSubmissionId,
  findSubmittedEvent,
  findSubmissionEvents,
  isActiveApprovalUnit,
  type LatestWorkflowCoreRow,
  type StoredSubmittedEvent,
} from "./submission-query";

import type { LecturerPrincipal } from "@/lib/auth/principal";
import type {
  CreateNewServerDerivedFields,
  CoreBusinessRow,
  EditableBusinessFields,
  RowSubmissionPayload,
  SubmissionType,
} from "./types";

const SERIALIZABLE_SUBMIT_MAX_ATTEMPTS = 3;

export interface SubmittedRowDto {
  readonly submissionId: string;
  readonly submissionType: SubmissionType;
  readonly recordUid: string;
  readonly state: "PENDING";
  readonly submittedAt: Date;
  readonly baseStt: number | null;
  readonly baseVersionNo: number | null;
}

type ParsedInput =
  | {
      readonly submissionType: "CONFIRM_UNCHANGED";
      readonly input: ConfirmUnchangedInput;
    }
  | {
      readonly submissionType: "UPDATE_EXISTING";
      readonly input: UpdateExistingInput;
    }
  | {
      readonly submissionType: "CREATE_NEW";
      readonly input: CreateNewInput;
    };

interface RejectedParent {
  readonly recordUid: string;
  readonly submissionType: SubmissionType;
}

export async function submitUnchangedRow(
  input: unknown,
): Promise<SubmittedRowDto> {
  return submit({
    submissionType: "CONFIRM_UNCHANGED",
    input: parseInput(confirmUnchangedInputSchema, input),
  });
}

export async function submitUpdatedRow(
  input: unknown,
): Promise<SubmittedRowDto> {
  return submit({
    submissionType: "UPDATE_EXISTING",
    input: parseInput(updateExistingInputSchema, input),
  });
}

export async function submitNewRow(input: unknown): Promise<SubmittedRowDto> {
  return submit({
    submissionType: "CREATE_NEW",
    input: parseInput(createNewInputSchema, input),
  });
}

function parseInput<Output>(
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: Output } | { success: false };
  },
  input: unknown,
): Output {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new WorkflowError("WORKFLOW_INVALID_PAYLOAD");
  }
  return result.data;
}

async function submit(request: ParsedInput): Promise<SubmittedRowDto> {
  const principal = await requireLecturerIdentity();

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withWorkflowTransaction(
        principal,
        async (transaction) => {
          await lockSubmission(transaction, request.input.submissionId);

          const existing = await findSubmittedEvent(
            transaction,
            request.input.submissionId,
          );
          if (existing) {
            assertIdempotentRetry(existing, request, principal);
            return toDto(existing);
          }

          const parent = await validateRejectedParent(
            transaction,
            request.input.parentSubmissionId ?? null,
            request.input.submissionId,
            principal,
          );

          const recordUid = resolveRecordUid(request, parent);
          await lockRecord(transaction, recordUid);

          if (request.submissionType === "CREATE_NEW") {
            return insertCreateNew(
              transaction,
              principal,
              request.input,
              recordUid,
              parent,
            );
          }

          return insertExisting(
            transaction,
            principal,
            request,
            recordUid,
            parent,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const canRetry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < SERIALIZABLE_SUBMIT_MAX_ATTEMPTS;

      if (!canRetry) throw error;
    }
  }
}

function resolveRecordUid(
  request: ParsedInput,
  parent: RejectedParent | null,
): string {
  if (request.submissionType !== "CREATE_NEW") {
    if (parent && parent.recordUid !== request.input.recordUid) {
      throw new WorkflowError("WORKFLOW_INVALID_STATE");
    }
    return request.input.recordUid;
  }

  if (parent) {
    if (parent.submissionType !== "CREATE_NEW") {
      throw new WorkflowError("WORKFLOW_INVALID_STATE");
    }
    return parent.recordUid;
  }
  return randomUUID();
}

async function insertExisting(
  transaction: WorkflowTransaction,
  principal: LecturerPrincipal,
  request: Exclude<ParsedInput, { submissionType: "CREATE_NEW" }>,
  recordUid: string,
  parent: RejectedParent | null,
): Promise<SubmittedRowDto> {
  const latest = await findLatestCoreRow(transaction, recordUid);
  if (!latest) {
    throw new WorkflowError("WORKFLOW_RECORD_NOT_FOUND");
  }
  if (latest.lecturerUid !== principal.lecturerUid) {
    throw new WorkflowError("WORKFLOW_NOT_OWNER");
  }
  if (
    latest.stt !== request.input.baseStt ||
    latest.versionNo !== request.input.baseVersionNo
  ) {
    throw new WorkflowError("WORKFLOW_STALE_BASE");
  }
  await assertNoOtherPending(
    transaction,
    recordUid,
    request.input.submissionId,
  );

  const approvalUnit = await resolveExistingApprovalUnit(transaction, latest);
  const currentRow = toCoreBusinessRow(latest);
  const payload =
    request.submissionType === "CONFIRM_UNCHANGED"
      ? buildConfirmUnchangedPayload(currentRow)
      : buildUpdateExistingPayload(currentRow, request.input.editableFields);

  return insertSubmittedEvent(transaction, principal, {
    submissionId: request.input.submissionId,
    submissionType: request.submissionType,
    parentSubmissionId: parent
      ? (request.input.parentSubmissionId ?? null)
      : null,
    recordUid,
    approvalUnit,
    baseStt: request.input.baseStt,
    baseVersionNo: request.input.baseVersionNo,
    payload,
  });
}

function toCoreBusinessRow(latest: LatestWorkflowCoreRow): CoreBusinessRow {
  return Object.fromEntries(
    CORE_DISPLAY_FIELD_NAMES.map((field) => [field, latest[field]]),
  ) as unknown as CoreBusinessRow;
}

async function insertCreateNew(
  transaction: WorkflowTransaction,
  principal: LecturerPrincipal,
  input: CreateNewInput,
  recordUid: string,
  parent: RejectedParent | null,
): Promise<SubmittedRowDto> {
  await assertNoOtherPending(transaction, recordUid, input.submissionId);
  if (parent && (await findLatestCoreRow(transaction, recordUid))) {
    throw new WorkflowError("WORKFLOW_STALE_BASE");
  }

  const latestRows = await findLatestCoreRowsForLecturer(
    transaction,
    principal.lecturerUid,
  );
  const { approvalUnit, serverDerivedFields } = await resolveCreateNewContext(
    transaction,
    latestRows,
  );
  const payload = buildCreateNewPayload(
    serverDerivedFields,
    input.editableFields,
  );

  return insertSubmittedEvent(transaction, principal, {
    submissionId: input.submissionId,
    submissionType: "CREATE_NEW",
    parentSubmissionId: parent ? (input.parentSubmissionId ?? null) : null,
    recordUid,
    approvalUnit,
    baseStt: null,
    baseVersionNo: null,
    payload,
  });
}

async function resolveExistingApprovalUnit(
  transaction: WorkflowTransaction,
  latest: LatestWorkflowCoreRow,
): Promise<string> {
  if (
    !latest.approvalUnit ||
    !(await isActiveApprovalUnit(transaction, latest.approvalUnit))
  ) {
    throw new WorkflowError("WORKFLOW_UNIT_UNRESOLVED");
  }
  return latest.approvalUnit;
}

async function resolveCreateNewContext(
  transaction: WorkflowTransaction,
  latestRows: readonly LatestWorkflowCoreRow[],
): Promise<{
  approvalUnit: string;
  serverDerivedFields: CreateNewServerDerivedFields;
}> {
  if (latestRows.length === 0) {
    throw new WorkflowError("WORKFLOW_UNIT_UNRESOLVED");
  }

  if (latestRows.some(({ approvalUnit }) => approvalUnit === null)) {
    throw new WorkflowError("WORKFLOW_UNIT_UNRESOLVED");
  }
  const units = new Set(latestRows.map(({ approvalUnit }) => approvalUnit));
  if (units.size !== 1) {
    throw new WorkflowError("WORKFLOW_UNIT_UNRESOLVED");
  }
  const approvalUnit = [...units][0]!;
  if (!(await isActiveApprovalUnit(transaction, approvalUnit))) {
    throw new WorkflowError("WORKFLOW_UNIT_UNRESOLVED");
  }

  const fieldNames = [
    "ten_giang_vien",
    "ma_so_can_bo",
    "email_tai_khoan_vnu",
    "bo_mon",
    "don_vi",
  ] as const;
  const serverDerivedFields = Object.fromEntries(
    fieldNames.map((field) => {
      const values = new Set(
        latestRows.map((row) => JSON.stringify(row[field])),
      );
      if (values.size !== 1) {
        throw new WorkflowError("WORKFLOW_UNIT_UNRESOLVED");
      }
      return [field, latestRows[0]![field]];
    }),
  ) as unknown as CreateNewServerDerivedFields;

  return { approvalUnit, serverDerivedFields };
}

async function validateRejectedParent(
  transaction: WorkflowTransaction,
  parentSubmissionId: string | null,
  currentSubmissionId: string,
  principal: LecturerPrincipal,
): Promise<RejectedParent | null> {
  if (!parentSubmissionId) return null;
  if (parentSubmissionId === currentSubmissionId) {
    throw new WorkflowError("WORKFLOW_INVALID_STATE");
  }

  const events = await findSubmissionEvents(transaction, parentSubmissionId);
  if (events.length === 0) {
    throw new WorkflowError("WORKFLOW_SUBMISSION_NOT_FOUND");
  }
  const submitted = events.filter(
    (event) => event.eventType === WorkflowEventType.SUBMITTED,
  );
  const rejected = events.filter(
    (event) => event.eventType === WorkflowEventType.REJECTED,
  );
  const approved = events.filter(
    (event) => event.eventType === WorkflowEventType.APPROVED,
  );
  if (
    submitted.length !== 1 ||
    rejected.length !== 1 ||
    approved.length !== 0 ||
    events.length !== 2
  ) {
    throw new WorkflowError("WORKFLOW_INVALID_STATE");
  }

  const submittedEvent = submitted[0]!;
  if (
    submittedEvent.lecturerUid !== principal.lecturerUid ||
    !submittedEvent.recordUid ||
    !submittedEvent.submissionType
  ) {
    throw new WorkflowError("WORKFLOW_NOT_OWNER");
  }
  return {
    recordUid: submittedEvent.recordUid,
    submissionType: submittedEvent.submissionType,
  };
}

async function assertNoOtherPending(
  transaction: WorkflowTransaction,
  recordUid: string,
  submissionId: string,
): Promise<void> {
  if (await findPendingSubmissionId(transaction, recordUid, submissionId)) {
    throw new WorkflowError("WORKFLOW_ALREADY_PENDING");
  }
}

function assertIdempotentRetry(
  stored: StoredSubmittedEvent,
  request: ParsedInput,
  principal: LecturerPrincipal,
): void {
  const parentSubmissionId = request.input.parentSubmissionId ?? null;
  const commonMatches =
    stored.actorUserId === principal.userId &&
    stored.lecturerUid === principal.lecturerUid &&
    stored.submissionType === request.submissionType &&
    stored.parentSubmissionId === parentSubmissionId;

  if (
    !commonMatches ||
    !verifyRowSubmissionChecksum(stored.payload, stored.payloadChecksum)
  ) {
    throw new WorkflowError("WORKFLOW_PAYLOAD_MISMATCH");
  }

  if (request.submissionType !== "CREATE_NEW") {
    if (
      stored.recordUid !== request.input.recordUid ||
      stored.baseStt !== request.input.baseStt ||
      stored.baseVersionNo !== request.input.baseVersionNo
    ) {
      throw new WorkflowError("WORKFLOW_PAYLOAD_MISMATCH");
    }
  } else if (stored.baseStt !== null || stored.baseVersionNo !== null) {
    throw new WorkflowError("WORKFLOW_PAYLOAD_MISMATCH");
  }

  if (request.submissionType !== "CONFIRM_UNCHANGED") {
    const storedPayload = parseStoredPayload(stored.payload);
    if (!editableFieldsEqual(storedPayload, request.input.editableFields)) {
      throw new WorkflowError("WORKFLOW_PAYLOAD_MISMATCH");
    }
  }
}

function parseStoredPayload(payload: unknown): RowSubmissionPayload {
  const result = rowSubmissionPayloadSchema.safeParse(payload);
  if (!result.success) {
    throw new WorkflowError("WORKFLOW_PAYLOAD_MISMATCH");
  }
  return result.data;
}

function editableFieldsEqual(
  storedPayload: RowSubmissionPayload,
  editableFields: EditableBusinessFields,
): boolean {
  return SUBMISSION_EDITABLE_FIELD_NAMES.every(
    (field) => storedPayload[field] === editableFields[field],
  );
}

async function insertSubmittedEvent(
  transaction: WorkflowTransaction,
  principal: LecturerPrincipal,
  input: {
    readonly submissionId: string;
    readonly submissionType: SubmissionType;
    readonly parentSubmissionId: string | null;
    readonly recordUid: string;
    readonly approvalUnit: string;
    readonly baseStt: number | null;
    readonly baseVersionNo: number | null;
    readonly payload: RowSubmissionPayload;
  },
): Promise<SubmittedRowDto> {
  const event = await transaction.workflowEvent.create({
    data: {
      eventType: WorkflowEventType.SUBMITTED,
      submissionType: input.submissionType,
      submissionId: input.submissionId,
      parentSubmissionId: input.parentSubmissionId,
      recordUid: input.recordUid,
      lecturerUid: principal.lecturerUid,
      approvalUnit: input.approvalUnit,
      baseStt: input.baseStt,
      baseVersionNo: input.baseVersionNo,
      payload: input.payload as Prisma.InputJsonObject,
      payloadChecksum: calculateRowSubmissionChecksum(input.payload),
      actorUserId: principal.userId,
      reason: null,
      resultStt: null,
      resultVersionNo: null,
    },
    select: {
      submissionId: true,
      submissionType: true,
      recordUid: true,
      createdAt: true,
      baseStt: true,
      baseVersionNo: true,
    },
  });

  if (!event.submissionType || !event.recordUid) {
    throw new WorkflowError("WORKFLOW_INVALID_STATE");
  }
  return {
    submissionId: event.submissionId,
    submissionType: event.submissionType,
    recordUid: event.recordUid,
    state: "PENDING",
    submittedAt: event.createdAt,
    baseStt: event.baseStt,
    baseVersionNo: event.baseVersionNo,
  };
}

function toDto(event: StoredSubmittedEvent): SubmittedRowDto {
  return {
    submissionId: event.submissionId,
    submissionType: event.submissionType,
    recordUid: event.recordUid,
    state: "PENDING",
    submittedAt: event.createdAt,
    baseStt: event.baseStt,
    baseVersionNo: event.baseVersionNo,
  };
}
