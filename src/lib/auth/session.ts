import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AccessProfileStatus, Prisma } from "@/generated/prisma/client";
import { appendAuthAuditEvent } from "@/lib/auth/audit";
import { getAuth } from "@/lib/auth/server";
import { getPrismaClient } from "@/lib/server/prisma";

export interface ActiveSessionDto {
  readonly userId: string;
  readonly mustChangePassword: boolean;
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

    const profile = await enforceActiveProfile(session.user.id);
    return profile
      ? {
          userId: session.user.id,
          mustChangePassword: profile.mustChangePassword,
        }
      : null;
  },
);

export async function requireActiveSession(): Promise<ActiveSessionDto> {
  const session = await getActiveSession();
  if (!session) redirect("/sign-in?reauth=1");
  return session;
}

export async function requireBusinessSession(): Promise<ActiveSessionDto> {
  const session = await requireActiveSession();
  if (session.mustChangePassword) redirect("/change-password");
  return session;
}

async function enforceActiveProfile(
  userId: string,
): Promise<{ readonly mustChangePassword: boolean } | null> {
  const prisma = getPrismaClient();

  return prisma.$transaction(
    async (transaction) => {
      const profile = await transaction.accessProfile.findUnique({
        where: { userId },
        select: { status: true, mustChangePassword: true },
      });
      if (profile?.status === AccessProfileStatus.ACTIVE) {
        return { mustChangePassword: profile.mustChangePassword };
      }

      const revokedSessions = await transaction.auth_session.deleteMany({
        where: { userId },
      });
      if (revokedSessions.count > 0) {
        await appendAuthAuditEvent(transaction, {
          eventType: "SESSION_REVOKED",
          outcome: "SUCCESS",
          targetUserId: userId,
          metadata: {
            profileStatus: profile?.status ?? "MISSING_ACCESS_PROFILE",
            revocationType: "INELIGIBLE_PROFILE",
            revokedSessionCount: revokedSessions.count,
          },
        });
      }
      return null;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
