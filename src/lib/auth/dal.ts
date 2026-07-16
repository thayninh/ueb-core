import "server-only";

import { cache } from "react";

import {
  AccessProfileStatus,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { getActiveSession } from "@/lib/auth/session";
import type { Principal } from "@/lib/auth/principal";
import { getPrismaClient } from "@/lib/server/prisma";

export const getCurrentPrincipal = cache(
  async (): Promise<Principal | null> => {
    const session = await getActiveSession();
    if (!session) return null;

    const profile = await getPrismaClient().accessProfile.findUnique({
      where: { userId: session.userId },
      select: {
        userId: true,
        lecturerUid: true,
        status: true,
        user: {
          select: {
            roleAssignments: {
              where: { revokedAt: null },
              orderBy: { role: "asc" },
              select: { role: true },
            },
            unitScopeAssignments: {
              where: {
                revokedAt: null,
                organizationUnit: { isActive: true },
              },
              orderBy: { organizationUnitId: "asc" },
              select: { organizationUnitId: true },
            },
          },
        },
      },
    });

    if (!profile || profile.status !== AccessProfileStatus.ACTIVE) return null;

    return Object.freeze({
      userId: profile.userId,
      roles: Object.freeze(
        profile.user.roleAssignments.map(({ role }) => role),
      ),
      lecturerUid: profile.lecturerUid,
      activeUnitIds: Object.freeze(
        profile.user.unitScopeAssignments.map(
          ({ organizationUnitId }) => organizationUnitId,
        ),
      ),
      status: profile.status,
    });
  },
);

type CoreDataTransaction = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

/**
 * Installs the PostgreSQL RLS identity only for the lifetime of one transaction.
 * Never replace this with a session-global SET on a pooled connection.
 */
export async function withCoreDataRlsContext<T>(
  principal: Pick<Principal, "userId">,
  query: (transaction: CoreDataTransaction) => Promise<T>,
  options: Readonly<{
    isolationLevel?: Prisma.TransactionIsolationLevel;
  }> = {},
): Promise<T> {
  return getPrismaClient().$transaction(
    async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT set_config('app.current_user_id', ${principal.userId}, true)`,
      );
      return query(transaction);
    },
    options.isolationLevel
      ? { isolationLevel: options.isolationLevel }
      : undefined,
  );
}
