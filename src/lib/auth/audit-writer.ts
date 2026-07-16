import "server-only";

import { appendAuthAuditEvent, hashAuditIdentifier } from "@/lib/auth/audit";
import { getPrismaClient } from "@/lib/server/prisma";

export interface AuditedSession {
  readonly id: string;
  readonly userId: string;
}

export async function recordLoginSuccess(
  session: AuditedSession,
): Promise<void> {
  await appendAuthAuditEvent(getPrismaClient(), {
    eventType: "AUTH_LOGIN_SUCCESS",
    outcome: "SUCCESS",
    actorUserId: session.userId,
    targetUserId: session.userId,
    sessionId: session.id,
    metadata: { authenticationType: "EMAIL_PASSWORD" },
  });
}

export async function recordLoginFailure(email: string | null): Promise<void> {
  await appendAuthAuditEvent(getPrismaClient(), {
    eventType: "AUTH_LOGIN_FAILED",
    outcome: "FAILED",
    identifierHash: email ? hashAuditIdentifier(email) : null,
    metadata: { authenticationType: "EMAIL_PASSWORD" },
  });
}

export async function recordLogout(session: AuditedSession): Promise<void> {
  await appendAuthAuditEvent(getPrismaClient(), {
    eventType: "AUTH_LOGOUT",
    outcome: "SUCCESS",
    actorUserId: session.userId,
    targetUserId: session.userId,
    sessionId: session.id,
    metadata: { authenticationType: "DATABASE_SESSION" },
  });
}
