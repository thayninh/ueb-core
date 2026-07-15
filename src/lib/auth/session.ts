import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AccessProfileStatus, Prisma } from "@/generated/prisma/client";
import { getAuth } from "@/lib/auth/server";
import { getPrismaClient } from "@/lib/server/prisma";

export interface ActiveSessionDto {
  readonly userId: string;
}

export const getActiveSession = cache(
  async (): Promise<ActiveSessionDto | null> => {
    const session = await getAuth().api.getSession({
      headers: await headers(),
      query: {
        disableCookieCache: true,
      },
    });
    if (!session) return null;

    const isActive = await enforceActiveProfile(session.user.id);
    return isActive ? { userId: session.user.id } : null;
  },
);

export async function requireActiveSession(): Promise<ActiveSessionDto> {
  const session = await getActiveSession();
  if (!session) redirect("/sign-in?reauth=1");
  return session;
}

async function enforceActiveProfile(userId: string): Promise<boolean> {
  const prisma = getPrismaClient();

  return prisma.$transaction(
    async (transaction) => {
      const profile = await transaction.accessProfile.findUnique({
        where: { userId },
        select: { status: true },
      });
      if (profile?.status === AccessProfileStatus.ACTIVE) return true;

      const revokedSessions = await transaction.auth_session.deleteMany({
        where: { userId },
      });
      if (revokedSessions.count > 0) {
        await transaction.authAuditEvent.create({
          data: {
            eventType: "INELIGIBLE_USER_SESSIONS_REVOKED",
            outcome: "SUCCESS",
            targetUserId: userId,
            metadata: {
              version: 1,
              reason: profile?.status ?? "MISSING_ACCESS_PROFILE",
              revokedSessionCount: revokedSessions.count,
            },
          },
        });
      }
      return false;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
