import "server-only";

import { cache } from "react";

import { AccessProfileStatus } from "@/generated/prisma/client";
import { getActiveSession } from "@/lib/auth/session";
import type { Principal } from "@/lib/auth/principal";
import { getPrismaClient } from "@/lib/server/prisma";

export { withCoreDataRlsContext } from "@/lib/auth/rls-context";

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
