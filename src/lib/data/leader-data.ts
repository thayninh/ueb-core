import "server-only";

import { BusinessRole } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth/authorization";
import type { UebCoreDataDto } from "@/lib/data/dto";
import {
  getLatestCoreRowsForAssignedLeaderUnits,
  getLatestCoreRowsForLeader,
  LATEST_CORE_DATA_PAGE_SIZE,
} from "@/lib/data/latest-core-data";
import { getPrismaClient } from "@/lib/server/prisma";

export async function getLeaderData(): Promise<UebCoreDataDto[]> {
  return [...(await getLatestCoreRowsForAssignedLeaderUnits())];
}

export const LEADER_DATA_PAGE_SIZE = LATEST_CORE_DATA_PAGE_SIZE;

export interface LeaderUnitDto {
  readonly id: string;
  readonly displayName: string;
  readonly sourceValue: string;
}

export interface LeaderDataPage {
  readonly rows: readonly UebCoreDataDto[];
  readonly unit: LeaderUnitDto;
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
  readonly totalRows: number;
  readonly totalPages: number;
}

export interface LeaderDataQuery {
  readonly unitId: string;
  readonly search?: string;
  readonly page?: number;
}

export async function getLeaderUnits(): Promise<readonly LeaderUnitDto[]> {
  const principal = await requireRole(BusinessRole.FACULTY_LEADER);
  if (principal.activeUnitIds.length === 0) return [];

  return getPrismaClient().organizationUnit.findMany({
    where: { id: { in: [...principal.activeUnitIds] }, isActive: true },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, sourceValue: true },
  });
}

export async function getLeaderDataPage(
  input: LeaderDataQuery,
): Promise<LeaderDataPage> {
  return getLatestCoreRowsForLeader(input);
}
