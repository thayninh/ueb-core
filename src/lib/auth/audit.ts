import { createHmac } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";

export const AUTH_AUDIT_EVENT_TYPES = [
  "AUTH_LOGIN_SUCCESS",
  "AUTH_LOGIN_FAILED",
  "AUTH_LOGOUT",
  "USER_CREATED",
  "USER_ENABLED",
  "USER_DISABLED",
  "PASSWORD_SET_BY_ADMIN",
  "AUTH_PASSWORD_CHANGE_REQUIRED",
  "AUTH_REQUIRED_PASSWORD_CHANGED",
  "ROLE_GRANTED",
  "ROLE_REVOKED",
  "UNIT_SCOPE_GRANTED",
  "UNIT_SCOPE_REVOKED",
  "LECTURER_MAPPING_ASSIGNED",
  "LECTURER_MAPPING_REMOVED",
  "SESSION_REVOKED",
  "PROVISIONING_BATCH_RECONCILED",
] as const;

export type AuthAuditEventType = (typeof AUTH_AUDIT_EVENT_TYPES)[number];
export type AuthAuditOutcome = "SUCCESS" | "FAILED";
export type AuthAuditMetadata = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface Phase5ProvisioningAuditContext {
  readonly approvalBatchId: string;
  readonly inputChecksum: string;
  readonly operation: "APPLY" | "ROLLBACK";
}

const MINIMUM_AUDIT_SECRET_LENGTH = 32;

export function readAuditHmacSecret(explicitSecret?: string): string {
  const secret = explicitSecret ?? process.env.AUDIT_HMAC_SECRET;
  if (
    !secret ||
    secret.length < MINIMUM_AUDIT_SECRET_LENGTH ||
    secret.trim() !== secret ||
    secret.toLowerCase().includes("replace_with")
  ) {
    throw new Error("A non-placeholder AUDIT_HMAC_SECRET is required.");
  }
  return secret;
}

export function hashAuditIdentifier(
  identifier: string,
  explicitSecret?: string,
): string {
  const normalized = identifier.trim().toLowerCase();
  return createHmac("sha256", readAuditHmacSecret(explicitSecret))
    .update(normalized, "utf8")
    .digest("hex");
}

export async function appendAuthAuditEvent(
  transaction: Pick<Prisma.TransactionClient, "authAuditEvent">,
  event: {
    readonly eventType: AuthAuditEventType;
    readonly outcome: AuthAuditOutcome;
    readonly actorUserId?: string | null;
    readonly targetUserId?: string | null;
    readonly sessionId?: string | null;
    readonly identifierHash?: string | null;
    readonly metadata: AuthAuditMetadata;
  },
): Promise<void> {
  await transaction.authAuditEvent.create({
    data: {
      eventType: event.eventType,
      outcome: event.outcome,
      actorUserId: event.actorUserId,
      targetUserId: event.targetUserId,
      sessionId: event.sessionId,
      identifierHash: event.identifierHash,
      metadata: event.metadata,
    },
  });
}

export function withPhase5ProvisioningAuditContext(
  metadata: AuthAuditMetadata,
  context?: Phase5ProvisioningAuditContext,
): AuthAuditMetadata {
  if (!context) return metadata;
  return {
    ...metadata,
    phase5ApprovalBatchId: context.approvalBatchId,
    phase5InputChecksum: context.inputChecksum,
    phase5Operation: context.operation,
  };
}
