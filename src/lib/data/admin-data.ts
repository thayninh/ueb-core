import "server-only";

import {
  AccessProfileStatus,
  type BusinessRole,
  Prisma,
} from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/auth/authorization";
import { withCoreDataRlsContext } from "@/lib/auth/dal";
import type { UebCoreDataDto } from "@/lib/data/dto";
import { getAllLatestCoreRowsForAdmin } from "@/lib/data/latest-core-data";
import { getPrismaClient } from "@/lib/server/prisma";

export async function getAdminData(): Promise<UebCoreDataDto[]> {
  return [...(await getAllLatestCoreRowsForAdmin())];
}

export interface AdminUserDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly createdAt: Date;
  readonly status: AccessProfileStatus | "MISSING_PROFILE";
  readonly lecturerUid: string | null;
  readonly roles: readonly BusinessRole[];
  readonly units: readonly {
    id: string;
    displayName: string;
    sourceValue: string;
  }[];
  readonly sessionCount: number;
}

export interface AdminUserManagementDto {
  readonly users: readonly AdminUserDto[];
  readonly units: readonly {
    id: string;
    displayName: string;
    sourceValue: string;
  }[];
  readonly lecturerCandidates: readonly {
    lecturerUid: string;
    lecturerName: string | null;
    email: string | null;
  }[];
}

export async function getAdminUserManagement(): Promise<AdminUserManagementDto> {
  const principal = await requireAdmin();
  const prisma = getPrismaClient();
  const [users, units, lecturerCandidates] = await Promise.all([
    prisma.auth_user.findMany({
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        accessProfile: {
          select: { status: true, lecturerUid: true },
        },
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
          orderBy: { organizationUnit: { displayName: "asc" } },
          select: {
            organizationUnit: {
              select: { id: true, displayName: true, sourceValue: true },
            },
          },
        },
        _count: { select: { auth_sessions: true } },
      },
    }),
    prisma.organizationUnit.findMany({
      where: { isActive: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, sourceValue: true },
    }),
    withCoreDataRlsContext(principal, (transaction) =>
      transaction.$queryRaw<
        Array<{
          lecturerUid: string;
          lecturerName: string | null;
          email: string | null;
        }>
      >(Prisma.sql`
        SELECT
          "lecturer_uid"::text AS "lecturerUid",
          min("ten_giang_vien") AS "lecturerName",
          min("email_tai_khoan_vnu") AS "email"
        FROM "public"."ueb_core_data"
        GROUP BY "lecturer_uid"
        ORDER BY min("ten_giang_vien") NULLS LAST, "lecturer_uid"::text
      `),
    ),
  ]);

  return {
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      status: user.accessProfile?.status ?? "MISSING_PROFILE",
      lecturerUid: user.accessProfile?.lecturerUid ?? null,
      roles: user.roleAssignments.map(({ role }) => role),
      units: user.unitScopeAssignments.map(
        ({ organizationUnit }) => organizationUnit,
      ),
      sessionCount: user._count.auth_sessions,
    })),
    units,
    lecturerCandidates,
  };
}
