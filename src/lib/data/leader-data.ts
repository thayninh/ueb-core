import "server-only";

import { BusinessRole, type Prisma } from "@/generated/prisma/client";
import {
  requireRole,
  requireUnitScope,
} from "@/lib/auth/authorization";
import { withCoreDataRlsContext } from "@/lib/auth/dal";
import {
  UEB_CORE_DATA_DTO_SELECT,
  type UebCoreDataDto,
} from "@/lib/data/dto";
import { getPrismaClient } from "@/lib/server/prisma";

export async function getLeaderData(): Promise<UebCoreDataDto[]> {
  const principal = await requireRole(BusinessRole.FACULTY_LEADER);
  if (principal.activeUnitIds.length === 0) return [];

  return withCoreDataRlsContext(principal, async (transaction) => {
    const units = await transaction.organizationUnit.findMany({
      where: {
        id: { in: [...principal.activeUnitIds] },
        isActive: true,
      },
      select: { sourceValue: true },
    });
    const activeUnitSourceValues = units.map(({ sourceValue }) => sourceValue);
    if (activeUnitSourceValues.length === 0) return [];

    return transaction.uebCoreData.findMany({
      where: { approvalUnit: { in: activeUnitSourceValues } },
      orderBy: { stt: "asc" },
      select: UEB_CORE_DATA_DTO_SELECT,
    });
  });
}

export const LEADER_DATA_PAGE_SIZE = 25;

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
  const principal = await requireUnitScope(input.unitId);
  const search = normalizeSearch(input.search);
  const requestedPage = normalizePage(input.page);

  return withCoreDataRlsContext(principal, async (transaction) => {
    const unit = await transaction.organizationUnit.findFirst({
      where: { id: input.unitId, isActive: true },
      select: { id: true, displayName: true, sourceValue: true },
    });
    if (!unit) throw new Error("Assigned organization unit was not found.");

    const where = buildLeaderWhere(unit.sourceValue, search);
    const totalRows = await transaction.uebCoreData.count({ where });
    const totalPages = Math.max(
      1,
      Math.ceil(totalRows / LEADER_DATA_PAGE_SIZE),
    );
    const page = Math.min(requestedPage, totalPages);
    const rows = await transaction.uebCoreData.findMany({
      where,
      orderBy: { stt: "asc" },
      skip: (page - 1) * LEADER_DATA_PAGE_SIZE,
      take: LEADER_DATA_PAGE_SIZE,
      select: UEB_CORE_DATA_DTO_SELECT,
    });

    return {
      rows,
      unit,
      search,
      page,
      pageSize: LEADER_DATA_PAGE_SIZE,
      totalRows,
      totalPages,
    };
  });
}

function normalizeSearch(value: string | undefined): string {
  return value?.trim().slice(0, 100) ?? "";
}

function normalizePage(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value ?? 1) : 1;
}

function buildLeaderWhere(
  sourceValue: string,
  search: string,
): Prisma.UebCoreDataWhereInput {
  if (!search) return { approvalUnit: sourceValue };

  const searchableFields = [
    "donViPhuTrachHocPhan",
    "boMonPhuTrachHocPhan",
    "maHocPhan",
    "tenHocPhan",
    "tenGiangVien",
    "maSoCanBo",
    "emailTaiKhoanVnu",
    "boMon",
    "donVi",
    "core123",
    "tc1TroGiang",
    "tc2ShChuyenMon",
    "tc3TongHop",
    "tc31NganhTotNghiepPhuHop",
    "tc32BienSoanDeCuongGiaoTrinh",
    "tc33ChuNhiemDeTaiNckhLienQuan",
    "tc34BaiBaoLienQuan",
    "tc4GiangThu",
  ] as const;
  const numericSearch = /^-?\d+$/u.test(search) ? Number(search) : null;
  const numericFilters: Prisma.UebCoreDataWhereInput[] = [];
  if (numericSearch !== null && Number.isSafeInteger(numericSearch)) {
    numericFilters.push({ stt: numericSearch }, { khoiKienThuc: numericSearch });
  }

  return {
    approvalUnit: sourceValue,
    OR: [
      ...searchableFields.map((field) => ({
        [field]: { contains: search, mode: "insensitive" as const },
      })),
      ...numericFilters,
    ],
  };
}
