import "server-only";

import {
  AccessProfileStatus,
  BusinessRole,
  Prisma,
  WorkflowEventType,
} from "@/generated/prisma/client";
import { requireAnyRole } from "@/lib/auth/authorization";

import { withWorkflowTransaction, type WorkflowTransaction } from "./context";
import { WorkflowError } from "./errors";
import { lockRecord, lockSubmission } from "./locks";
import { rejectSubmissionInputSchema } from "./reject-policy";
import { assertSubmissionCanBeRejected } from "./state-machine";
import {
  findSubmissionEvents,
  resolveStoredSubmissionEvents,
} from "./submission-query";

import type { Principal } from "@/lib/auth/principal";
import type { SubmissionType } from "./types";

export { rejectSubmissionInputSchema } from "./reject-policy";
export type { RejectSubmissionInput } from "./reject-policy";

export interface RejectedSubmissionDto {
  readonly submissionId: string;
  readonly submissionType: SubmissionType;
  readonly recordUid: string;
  readonly state: "REJECTED";
  readonly reason: string;
  readonly rejectedAt: Date;
}

export async function rejectSubmission(
  input: unknown,
): Promise<RejectedSubmissionDto> {
  const parsed = rejectSubmissionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowError("WORKFLOW_INVALID_PAYLOAD");
  }
  const principal = await requireAnyRole([
    BusinessRole.FACULTY_LEADER,
    BusinessRole.ADMIN,
  ]);

  return withWorkflowTransaction(principal, async (transaction) => {
    await lockSubmission(transaction, parsed.data.submissionId);

    const initialRows = await findSubmissionEvents(
      transaction,
      parsed.data.submissionId,
    );
    if (initialRows.length === 0) {
      throw new WorkflowError("WORKFLOW_SUBMISSION_NOT_FOUND");
    }
    const initial = resolveStoredSubmissionEvents(initialRows);
    await lockRecord(transaction, initial.recordUid);

    const rows = await findSubmissionEvents(
      transaction,
      parsed.data.submissionId,
    );
    if (rows.length === 0) {
      throw new WorkflowError("WORKFLOW_SUBMISSION_NOT_FOUND");
    }
    const resolved = resolveStoredSubmissionEvents(rows);
    assertSubmissionCanBeRejected(resolved);
    await assertCurrentDecisionScope(
      transaction,
      principal,
      resolved.approvalUnit,
    );

    const event = await transaction.workflowEvent.create({
      data: {
        eventType: WorkflowEventType.REJECTED,
        submissionId: resolved.submissionId,
        parentSubmissionId: null,
        submissionType: resolved.submissionType,
        recordUid: resolved.recordUid,
        lecturerUid: resolved.lecturerUid,
        approvalUnit: resolved.approvalUnit,
        baseStt: resolved.submittedEvent.baseStt,
        baseVersionNo: resolved.submittedEvent.baseVersionNo,
        payload: Prisma.DbNull,
        payloadChecksum: null,
        actorUserId: principal.userId,
        reason: parsed.data.reason,
        resultStt: null,
        resultVersionNo: null,
      },
      select: {
        submissionId: true,
        submissionType: true,
        recordUid: true,
        reason: true,
        createdAt: true,
      },
    });
    if (!event.submissionType || !event.recordUid || !event.reason) {
      throw new WorkflowError("WORKFLOW_INVALID_STATE");
    }

    return {
      submissionId: event.submissionId,
      submissionType: event.submissionType,
      recordUid: event.recordUid,
      state: "REJECTED",
      reason: event.reason,
      rejectedAt: event.createdAt,
    };
  });
}

async function assertCurrentDecisionScope(
  transaction: WorkflowTransaction,
  principal: Principal,
  approvalUnit: string,
): Promise<void> {
  const profile = await transaction.accessProfile.findUnique({
    where: { userId: principal.userId },
    select: {
      status: true,
      user: {
        select: {
          roleAssignments: {
            where: { revokedAt: null },
            select: { role: true },
          },
          unitScopeAssignments: {
            where: {
              revokedAt: null,
              organizationUnit: {
                isActive: true,
                sourceValue: approvalUnit,
              },
            },
            select: { id: true },
          },
        },
      },
    },
  });
  if (!profile || profile.status !== AccessProfileStatus.ACTIVE) {
    throw new WorkflowError("WORKFLOW_SCOPE_DENIED");
  }
  const roles = new Set(profile.user.roleAssignments.map(({ role }) => role));
  if (roles.has(BusinessRole.ADMIN)) return;
  if (
    !roles.has(BusinessRole.FACULTY_LEADER) ||
    profile.user.unitScopeAssignments.length === 0
  ) {
    throw new WorkflowError("WORKFLOW_SCOPE_DENIED");
  }
}
