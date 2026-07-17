import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import { BusinessRole, Prisma } from "@/generated/prisma/client";
import {
  requireAdmin,
  requireAuthenticated,
  requireLecturerIdentity,
  requireRole,
  requireUnitScope,
} from "@/lib/auth/authorization";
import { withCoreDataRlsContext } from "@/lib/auth/dal";
import type {
  CoreRowVersionDto,
  LatestCoreRowDto,
} from "@/lib/data/dto";

export const LATEST_CORE_DATA_PAGE_SIZE = 25;

export interface LatestCoreRowsQuery {
  readonly search?: string;
  readonly page?: number;
}

export interface LatestCoreRowsPage {
  readonly rows: readonly LatestCoreRowDto[];
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
  readonly totalRows: number;
  readonly totalPages: number;
}

export interface LatestCoreRowsForLeaderQuery extends LatestCoreRowsQuery {
  readonly unitId: string;
}

export interface LatestCoreRowsForLeaderPage extends LatestCoreRowsPage {
  readonly unit: {
    readonly id: string;
    readonly displayName: string;
    readonly sourceValue: string;
  };
}

const recordUidSchema = z.uuid();

const DTO_PROJECTION = Prisma.sql`
  "stt",
  "don_vi_phu_trach_hoc_phan" AS "donViPhuTrachHocPhan",
  "bo_mon_phu_trach_hoc_phan" AS "boMonPhuTrachHocPhan",
  "khoi_kien_thuc" AS "khoiKienThuc",
  "ma_hoc_phan" AS "maHocPhan",
  "ten_hoc_phan" AS "tenHocPhan",
  "ten_giang_vien" AS "tenGiangVien",
  "ma_so_can_bo" AS "maSoCanBo",
  "email_tai_khoan_vnu" AS "emailTaiKhoanVnu",
  "bo_mon" AS "boMon",
  "don_vi" AS "donVi",
  "core_1_2_3" AS "core123",
  "tc1_tro_giang" AS "tc1TroGiang",
  "tc2_sh_chuyen_mon" AS "tc2ShChuyenMon",
  "tc3_tong_hop" AS "tc3TongHop",
  "tc3_1_nganh_tot_nghiep_phu_hop" AS "tc31NganhTotNghiepPhuHop",
  "tc3_2_bien_soan_de_cuong_giao_trinh" AS "tc32BienSoanDeCuongGiaoTrinh",
  "tc3_3_chu_nhiem_de_tai_nckh_lien_quan" AS "tc33ChuNhiemDeTaiNckhLienQuan",
  "tc3_4_bai_bao_lien_quan" AS "tc34BaiBaoLienQuan",
  "tc4_giang_thu" AS "tc4GiangThu",
  "record_uid"::text AS "recordUid",
  "snapshot_id"::text AS "snapshotId",
  "version_no" AS "versionNo",
  "identity_status" AS "identityStatus",
  "approval_unit" AS "approvalUnit",
  "origin",
  "approved_at" AS "approvedAt",
  "created_at" AS "createdAt"
`;

const SEARCHABLE_TEXT = Prisma.sql`
  concat_ws(
    ' ',
    "don_vi_phu_trach_hoc_phan",
    "bo_mon_phu_trach_hoc_phan",
    "ma_hoc_phan",
    "ten_hoc_phan",
    "ten_giang_vien",
    "ma_so_can_bo",
    "email_tai_khoan_vnu",
    "bo_mon",
    "don_vi",
    "core_1_2_3",
    "tc1_tro_giang",
    "tc2_sh_chuyen_mon",
    "tc3_tong_hop",
    "tc3_1_nganh_tot_nghiep_phu_hop",
    "tc3_2_bien_soan_de_cuong_giao_trinh",
    "tc3_3_chu_nhiem_de_tai_nckh_lien_quan",
    "tc3_4_bai_bao_lien_quan",
    "tc4_giang_thu"
  )
`;

type CoreDataTransaction = Parameters<
  Parameters<typeof withCoreDataRlsContext>[1]
>[0];

export async function getLatestCoreRowsForLecturer(): Promise<
  readonly LatestCoreRowDto[]
> {
  const principal = await requireLecturerIdentity();

  return withCoreDataRlsContext(principal, (transaction) =>
    queryLatestRows(
      transaction,
      Prisma.sql`"lecturer_uid" = ${principal.lecturerUid}::uuid`,
    ),
  );
}

export async function getLatestCoreRowByRecordUid(
  recordUid: string,
): Promise<LatestCoreRowDto> {
  const validatedRecordUid = recordUidSchema.parse(recordUid);
  const principal = await requireAuthenticated();
  const row = await withCoreDataRlsContext(principal, (transaction) =>
    queryLatestRowByRecordUid(transaction, validatedRecordUid),
  );

  if (!row) notFound();
  return row;
}

export async function getLatestCoreRowsForLeader(
  input: LatestCoreRowsForLeaderQuery,
): Promise<LatestCoreRowsForLeaderPage> {
  const principal = await requireUnitScope(input.unitId);
  const search = normalizeSearch(input.search);
  const requestedPage = normalizePage(input.page);

  return withCoreDataRlsContext(principal, async (transaction) => {
    const unit = await transaction.organizationUnit.findFirst({
      where: { id: input.unitId, isActive: true },
      select: { id: true, displayName: true, sourceValue: true },
    });
    if (!unit) notFound();

    const page = await queryLatestRowsPage(
      transaction,
      Prisma.sql`"approval_unit" = ${unit.sourceValue}`,
      search,
      requestedPage,
    );
    return { ...page, unit };
  });
}

export async function getLatestCoreRowsForAdmin(
  input: LatestCoreRowsQuery = {},
): Promise<LatestCoreRowsPage> {
  const principal = await requireAdmin();

  return withCoreDataRlsContext(
    principal,
    (transaction) =>
      queryLatestRowsPage(
        transaction,
        Prisma.sql`TRUE`,
        normalizeSearch(input.search),
        normalizePage(input.page),
      ),
    { readOnly: true },
  );
}

export async function getCoreRowVersionHistory(
  recordUid: string,
): Promise<readonly CoreRowVersionDto[]> {
  const validatedRecordUid = recordUidSchema.parse(recordUid);
  const principal = await requireAuthenticated();

  return withCoreDataRlsContext(principal, (transaction) =>
    transaction.$queryRaw<CoreRowVersionDto[]>(Prisma.sql`
      SELECT ${DTO_PROJECTION}
      FROM "public"."ueb_core_data"
      WHERE "record_uid" = ${validatedRecordUid}::uuid
      ORDER BY "version_no" DESC, "stt" DESC
    `),
  );
}

/** Backward-compatible unpaginated leader portal query. */
export async function getLatestCoreRowsForAssignedLeaderUnits(): Promise<
  readonly LatestCoreRowDto[]
> {
  const principal = await requireRole(BusinessRole.FACULTY_LEADER);
  if (principal.activeUnitIds.length === 0) return [];

  return withCoreDataRlsContext(principal, async (transaction) => {
    const units = await transaction.organizationUnit.findMany({
      where: { id: { in: [...principal.activeUnitIds] }, isActive: true },
      select: { sourceValue: true },
    });
    if (units.length === 0) return [];
    const sourceValues = units.map(({ sourceValue }) => sourceValue);

    return queryLatestRows(
      transaction,
      Prisma.sql`"approval_unit" IN (${Prisma.join(sourceValues)})`,
    );
  });
}

/** Backward-compatible unpaginated admin portal query. */
export async function getAllLatestCoreRowsForAdmin(): Promise<
  readonly LatestCoreRowDto[]
> {
  const principal = await requireAdmin();
  return withCoreDataRlsContext(
    principal,
    (transaction) => queryLatestRows(transaction, Prisma.sql`TRUE`),
    { readOnly: true },
  );
}

function latestRowsCte(scope: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH "ranked_core_rows" AS (
      SELECT
        "core".*,
        row_number() OVER (
          PARTITION BY "core"."record_uid"
          ORDER BY "core"."version_no" DESC, "core"."stt" DESC
        ) AS "row_rank"
      FROM "public"."ueb_core_data" AS "core"
      WHERE ${scope}
    ),
    "latest_core_rows" AS (
      SELECT *
      FROM "ranked_core_rows"
      WHERE "row_rank" = 1
    )
  `;
}

async function queryLatestRows(
  transaction: CoreDataTransaction,
  scope: Prisma.Sql,
): Promise<LatestCoreRowDto[]> {
  return transaction.$queryRaw<LatestCoreRowDto[]>(Prisma.sql`
    ${latestRowsCte(scope)}
    SELECT ${DTO_PROJECTION}
    FROM "latest_core_rows"
    ORDER BY "stt" ASC, "record_uid" ASC
  `);
}

async function queryLatestRowByRecordUid(
  transaction: CoreDataTransaction,
  recordUid: string,
): Promise<LatestCoreRowDto | null> {
  const rows = await queryLatestRows(
    transaction,
    Prisma.sql`"record_uid" = ${recordUid}::uuid`,
  );
  return rows[0] ?? null;
}

async function queryLatestRowsPage(
  transaction: CoreDataTransaction,
  scope: Prisma.Sql,
  search: string,
  requestedPage: number,
): Promise<LatestCoreRowsPage> {
  const searchFilter = buildSearchFilter(search);
  const countRows = await transaction.$queryRaw<Array<{ totalRows: number }>>(
    Prisma.sql`
      ${latestRowsCte(scope)}
      SELECT count(*)::integer AS "totalRows"
      FROM "latest_core_rows"
      WHERE ${searchFilter}
    `,
  );
  const totalRows = countRows[0]?.totalRows ?? 0;
  const totalPages = Math.max(
    1,
    Math.ceil(totalRows / LATEST_CORE_DATA_PAGE_SIZE),
  );
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * LATEST_CORE_DATA_PAGE_SIZE;
  const rows = await transaction.$queryRaw<LatestCoreRowDto[]>(Prisma.sql`
    ${latestRowsCte(scope)}
    SELECT ${DTO_PROJECTION}
    FROM "latest_core_rows"
    WHERE ${searchFilter}
    ORDER BY "stt" ASC, "record_uid" ASC
    LIMIT ${LATEST_CORE_DATA_PAGE_SIZE}
    OFFSET ${offset}
  `);

  return {
    rows,
    search,
    page,
    pageSize: LATEST_CORE_DATA_PAGE_SIZE,
    totalRows,
    totalPages,
  };
}

function buildSearchFilter(search: string): Prisma.Sql {
  if (!search) return Prisma.sql`TRUE`;

  const numericSearch = /^-?\d+$/u.test(search) ? Number(search) : null;
  const textFilter = Prisma.sql`${SEARCHABLE_TEXT} ILIKE ${`%${escapeLike(search)}%`} ESCAPE '\\'`;
  if (numericSearch === null || !Number.isSafeInteger(numericSearch)) {
    return textFilter;
  }

  return Prisma.sql`(
    ${textFilter}
    OR "stt" = ${numericSearch}
    OR "khoi_kien_thuc" = ${numericSearch}
  )`;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function normalizeSearch(value: string | undefined): string {
  return value?.trim().slice(0, 100) ?? "";
}

function normalizePage(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value ?? 1) : 1;
}
