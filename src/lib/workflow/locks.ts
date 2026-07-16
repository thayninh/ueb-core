import "server-only";

import { Prisma } from "@/generated/prisma/client";

import type { WorkflowTransaction } from "./context";

const WORKFLOW_LOCK_NAMESPACE = "ueb-core:phase-4:row-workflow";

export type WorkflowLockKind = "submission" | "record";

export function workflowLockResource(
  kind: WorkflowLockKind,
  identifier: string,
): string {
  return `${WORKFLOW_LOCK_NAMESPACE}:${kind}:${identifier}`;
}

async function lockResource(
  transaction: WorkflowTransaction,
  kind: WorkflowLockKind,
  identifier: string,
): Promise<void> {
  const resource = workflowLockResource(kind, identifier);
  await transaction.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${resource}, 0))::text AS "lockResult"`,
  );
}

export function lockSubmission(
  transaction: WorkflowTransaction,
  submissionId: string,
): Promise<void> {
  return lockResource(transaction, "submission", submissionId);
}

export function lockRecord(
  transaction: WorkflowTransaction,
  recordUid: string,
): Promise<void> {
  return lockResource(transaction, "record", recordUid);
}
