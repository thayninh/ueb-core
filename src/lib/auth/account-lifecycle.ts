import "server-only";

import {
  AccessProfileStatus,
  BusinessRole,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { appendAuthAuditEvent } from "@/lib/auth/audit";
import { getPrismaClient } from "@/lib/server/prisma";

export interface DisableUserInput {
  readonly actorUserId: string;
  readonly targetUserId: string;
}

export interface DisableUserResult {
  readonly status: "DISABLED" | "ALREADY_DISABLED";
  readonly revokedSessionCount: number;
}

export async function disableUserAndRevokeSessions(
  input: DisableUserInput,
  prisma: PrismaClient = getPrismaClient(),
): Promise<DisableUserResult> {
  return prisma.$transaction(
    async (transaction) => {
      const actorAdminRole = await transaction.roleAssignment.findFirst({
        where: {
          userId: input.actorUserId,
          role: BusinessRole.ADMIN,
          revokedAt: null,
          user: {
            accessProfile: { status: AccessProfileStatus.ACTIVE },
          },
        },
        select: { id: true },
      });
      if (!actorAdminRole) {
        throw new Error("Disabling a user requires an active ADMIN actor.");
      }

      const targetProfile = await transaction.accessProfile.findUnique({
        where: { userId: input.targetUserId },
        select: { status: true },
      });
      if (!targetProfile)
        throw new Error("Target access profile was not found.");

      const status =
        targetProfile.status === AccessProfileStatus.DISABLED
          ? "ALREADY_DISABLED"
          : "DISABLED";
      if (status === "DISABLED") {
        await transaction.accessProfile.update({
          where: { userId: input.targetUserId },
          data: { status: AccessProfileStatus.DISABLED },
        });
      }
      const revokedSessions = await transaction.auth_session.deleteMany({
        where: { userId: input.targetUserId },
      });

      if (status === "DISABLED" || revokedSessions.count > 0) {
        await appendAuthAuditEvent(transaction, {
          eventType: "USER_DISABLED",
          outcome: "SUCCESS",
          actorUserId: input.actorUserId,
          targetUserId: input.targetUserId,
          metadata: {
            previousStatus: targetProfile.status,
            revocationType: "DISABLE_ACCOUNT",
            revokedSessionCount: revokedSessions.count,
          },
        });
      }

      return { status, revokedSessionCount: revokedSessions.count };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
