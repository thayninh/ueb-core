// @vitest-environment node

import "dotenv/config";

import { Client, Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AccessProfileStatus, BusinessRole } from "@/generated/prisma/client";
import type { Principal } from "@/lib/auth/principal";
import {
  dropPhase4LatestReadModelTestDatabase,
  preparePhase4LatestReadModelTestDatabase,
} from "../../scripts/phase-4/prepare-latest-read-model-test-database";
import type { Phase4TestDatabaseUrls } from "../../scripts/phase-4/lib/test-database";

const integrationEnabled = process.env.PHASE4_ISOLATED_INTEGRATION === "1";

const auth = vi.hoisted(() => ({
  principal: null as Principal | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/authorization", () => ({
  requireAuthenticated: async () => requirePrincipal(),
  requireAdmin: async () => requireRole(BusinessRole.ADMIN),
  requireLecturerIdentity: async () => {
    const principal = requireRole(BusinessRole.LECTURER);
    if (!principal.lecturerUid) throw new Error("FORBIDDEN");
    return principal as Principal & { lecturerUid: string };
  },
  requireRole: async (role: BusinessRole) => requireRole(role),
  requireUnitScope: async (unitId: string) => {
    const principal = requireRole(BusinessRole.FACULTY_LEADER);
    if (!principal.activeUnitIds.includes(unitId)) throw new Error("FORBIDDEN");
    return principal;
  },
}));

const ids = {
  lecturerA: "10000000-0000-4000-8000-000000000001",
  lecturerB: "10000000-0000-4000-8000-000000000002",
  lecturerC: "10000000-0000-4000-8000-000000000003",
  recordA1: "20000000-0000-4000-8000-000000000001",
  recordA2: "20000000-0000-4000-8000-000000000002",
  recordA3: "20000000-0000-4000-8000-000000000003",
  recordB1: "20000000-0000-4000-8000-000000000004",
  lecturerAUser: "30000000-0000-4000-8000-000000000001",
  lecturerBUser: "30000000-0000-4000-8000-000000000002",
  leaderAUser: "30000000-0000-4000-8000-000000000003",
  multiLeaderUser: "30000000-0000-4000-8000-000000000004",
  noScopeLeaderUser: "30000000-0000-4000-8000-000000000005",
  adminUser: "30000000-0000-4000-8000-000000000006",
  disabledAdminUser: "30000000-0000-4000-8000-000000000007",
  revokedAdminUser: "30000000-0000-4000-8000-000000000008",
  unitA: "40000000-0000-4000-8000-000000000001",
  unitB: "40000000-0000-4000-8000-000000000002",
  importRun: "80000000-0000-4000-8000-000000000001",
} as const;

const UNIT_A = "Unit A";
const UNIT_B = "Unit B";

type LatestModule = typeof import("@/lib/data/latest-core-data");
type PrismaModule = typeof import("@/lib/server/prisma");
type PostgresModule = typeof import("@/lib/server/postgres");

let latest: LatestModule;
let prismaModule: PrismaModule;
let postgresModule: PostgresModule;
let urls: Phase4TestDatabaseUrls;
let runtimePool: Pool;

describe.skipIf(!integrationEnabled)(
  "Phase 4 latest core data read model",
  () => {
    beforeAll(async () => {
      urls = await preparePhase4LatestReadModelTestDatabase(process.env);
      await seedFixtures(urls.migrationUrl);
      process.env.DATABASE_URL = urls.runtimeUrl;
      vi.resetModules();
      latest = await import("@/lib/data/latest-core-data");
      prismaModule = await import("@/lib/server/prisma");
      postgresModule = await import("@/lib/server/postgres");
      runtimePool = new Pool({ connectionString: urls.runtimeUrl });
    }, 60_000);

    beforeEach(() => {
      auth.principal = lecturerAPrincipal();
    });

    afterAll(async () => {
      if (!integrationEnabled || !urls) return;
      await prismaModule
        ?.getPrismaClient()
        .$disconnect()
        .catch(() => undefined);
      await postgresModule
        ?.getPostgresPool()
        .end()
        .catch(() => undefined);
      await runtimePool?.end().catch(() => undefined);
      await dropPhase4LatestReadModelTestDatabase(urls);
    }, 30_000);

    it("1. selects A1 version 2 instead of version 1", async () => {
      const rows = await latest.getLatestCoreRowsForLecturer();
      expect(
        rows.find(({ recordUid }) => recordUid === ids.recordA1)?.versionNo,
      ).toBe(2);
    });

    it("2. keeps A2 version 1 in the current result", async () => {
      const rows = await latest.getLatestCoreRowsForLecturer();
      expect(
        rows.find(({ recordUid }) => recordUid === ids.recordA2)?.versionNo,
      ).toBe(1);
    });

    it("3. returns exactly two logical rows for lecturer A", async () => {
      expect(await latest.getLatestCoreRowsForLecturer()).toHaveLength(2);
    });

    it("4. breaks a corrupt same-version tie with the greater STT", async () => {
      auth.principal = adminPrincipal();
      const row = await latest.getLatestCoreRowByRecordUid(ids.recordA3);
      expect(row.stt).toBe(1006);
    });

    it("5. returns A1 history in version and STT descending order", async () => {
      const history = await latest.getCoreRowVersionHistory(ids.recordA1);
      expect(history.map(({ versionNo, stt }) => [versionNo, stt])).toEqual([
        [2, 1002],
        [1, 1001],
      ]);
    });

    it("6. never returns a duplicate record UID", async () => {
      const rows = await latest.getLatestCoreRowsForLecturer();
      expect(new Set(rows.map(({ recordUid }) => recordUid)).size).toBe(
        rows.length,
      );
    });

    it("7. lets lecturer A see only A1 and A2", async () => {
      const rows = await latest.getLatestCoreRowsForLecturer();
      expect(rows.map(({ recordUid }) => recordUid).sort()).toEqual(
        [ids.recordA1, ids.recordA2].sort(),
      );
    });

    it("8. does not expose B1 in lecturer A's list", async () => {
      const rows = await latest.getLatestCoreRowsForLecturer();
      expect(rows.some(({ recordUid }) => recordUid === ids.recordB1)).toBe(
        false,
      );
    });

    it("9. maps direct access to an out-of-scope record to not found", async () => {
      await expect(
        latest.getLatestCoreRowByRecordUid(ids.recordB1),
      ).rejects.toThrow(/404|not found/i);
    });

    it("10. accepts no lecturer UID from the client", () => {
      expect(latest.getLatestCoreRowsForLecturer).toHaveLength(0);
    });

    it("11. lets the Unit A leader see only A latest rows", async () => {
      auth.principal = leaderAPrincipal();
      const page = await latest.getLatestCoreRowsForLeader({
        unitId: ids.unitA,
      });
      expect(page.rows.map(({ recordUid }) => recordUid).sort()).toEqual(
        [ids.recordA1, ids.recordA2].sort(),
      );
    });

    it("12. does not expose Unit B rows to the Unit A leader", async () => {
      auth.principal = leaderAPrincipal();
      const page = await latest.getLatestCoreRowsForLeader({
        unitId: ids.unitA,
      });
      expect(
        page.rows.some(({ recordUid }) => recordUid === ids.recordB1),
      ).toBe(false);
    });

    it("13. rejects an out-of-scope unit filter before querying data", async () => {
      auth.principal = leaderAPrincipal();
      await expect(
        latest.getLatestCoreRowsForLeader({ unitId: ids.unitB }),
      ).rejects.toThrow("FORBIDDEN");
    });

    it("14. lets a multi-unit leader see the union of assigned units", async () => {
      auth.principal = multiLeaderPrincipal();
      const rows = await latest.getLatestCoreRowsForAssignedLeaderUnits();
      expect(rows.map(({ recordUid }) => recordUid).sort()).toEqual(
        [ids.recordA1, ids.recordA2, ids.recordB1].sort(),
      );
    });

    it("15. returns no rows for a leader with no active unit scope", async () => {
      auth.principal = noScopeLeaderPrincipal();
      expect(await latest.getLatestCoreRowsForAssignedLeaderUnits()).toEqual(
        [],
      );
    });

    it("16. lets admin see every latest logical record", async () => {
      auth.principal = adminPrincipal();
      const page = await latest.getLatestCoreRowsForAdmin();
      expect(page.rows).toHaveLength(4);
    });

    it("17. counts logical latest rows rather than history rows", async () => {
      auth.principal = adminPrincipal();
      const page = await latest.getLatestCoreRowsForAdmin();
      expect(page.totalRows).toBe(4);
      expect(await physicalCoreRowCount()).toBe(6);
    });

    it("18. returns zero core rows without transaction-local RLS context", async () => {
      const result = await runtimePool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.ueb_core_data",
      );
      expect(result.rows[0]?.count).toBe(0);
    });

    it("19. returns zero rows for a disabled principal", async () => {
      auth.principal = disabledAdminPrincipal();
      expect((await latest.getLatestCoreRowsForAdmin()).totalRows).toBe(0);
    });

    it("20. returns zero rows after the only role assignment is revoked", async () => {
      auth.principal = revokedAdminPrincipal();
      expect((await latest.getLatestCoreRowsForAdmin()).totalRows).toBe(0);
    });

    it("21. confirms the application runtime role cannot bypass RLS", async () => {
      const result = await runtimePool.query<{ rolbypassrls: boolean }>(
        "SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user",
      );
      expect(result.rows[0]?.rolbypassrls).toBe(false);
    });

    it("22. returns all 20 approved business fields", async () => {
      const [row] = await latest.getLatestCoreRowsForLecturer();
      expect(row).toBeDefined();
      expect(BUSINESS_DTO_FIELDS.every((field) => field in row!)).toBe(true);
      expect(BUSINESS_DTO_FIELDS).toHaveLength(20);
    });

    it("23. excludes the source checksum from the DTO", async () => {
      const [row] = await latest.getLatestCoreRowsForLecturer();
      expect(row).not.toHaveProperty("sourceRowChecksum");
    });

    it("24. excludes session, account and password data from the DTO", async () => {
      const [row] = await latest.getLatestCoreRowsForLecturer();
      expect(row).not.toHaveProperty("sessionId");
      expect(row).not.toHaveProperty("accountId");
      expect(row).not.toHaveProperty("password");
    });

    it("25. applies search to latest rows and reports the filtered count", async () => {
      auth.principal = adminPrincipal();
      const page = await latest.getLatestCoreRowsForAdmin({
        search: "A1 version 2",
      });
      expect(page.totalRows).toBe(1);
      expect(page.rows[0]?.recordUid).toBe(ids.recordA1);
    });
  },
);

const BUSINESS_DTO_FIELDS = [
  "stt",
  "donViPhuTrachHocPhan",
  "boMonPhuTrachHocPhan",
  "khoiKienThuc",
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

function requirePrincipal(): Principal {
  if (!auth.principal) throw new Error("UNAUTHENTICATED");
  return auth.principal;
}

function requireRole(role: BusinessRole): Principal {
  const principal = requirePrincipal();
  if (!principal.roles.includes(role)) throw new Error("FORBIDDEN");
  return principal;
}

function principal(
  userId: string,
  roles: readonly BusinessRole[],
  lecturerUid: string | null = null,
  activeUnitIds: readonly string[] = [],
  status: AccessProfileStatus = AccessProfileStatus.ACTIVE,
): Principal {
  return { userId, roles, lecturerUid, activeUnitIds, status };
}

function lecturerAPrincipal(): Principal {
  return principal(ids.lecturerAUser, [BusinessRole.LECTURER], ids.lecturerA);
}

function leaderAPrincipal(): Principal {
  return principal(ids.leaderAUser, [BusinessRole.FACULTY_LEADER], null, [
    ids.unitA,
  ]);
}

function multiLeaderPrincipal(): Principal {
  return principal(ids.multiLeaderUser, [BusinessRole.FACULTY_LEADER], null, [
    ids.unitA,
    ids.unitB,
  ]);
}

function noScopeLeaderPrincipal(): Principal {
  return principal(ids.noScopeLeaderUser, [BusinessRole.FACULTY_LEADER]);
}

function adminPrincipal(): Principal {
  return principal(ids.adminUser, [BusinessRole.ADMIN]);
}

function disabledAdminPrincipal(): Principal {
  return principal(
    ids.disabledAdminUser,
    [BusinessRole.ADMIN],
    null,
    [],
    AccessProfileStatus.DISABLED,
  );
}

function revokedAdminPrincipal(): Principal {
  return principal(ids.revokedAdminUser, [BusinessRole.ADMIN]);
}

async function physicalCoreRowCount(): Promise<number> {
  const owner = new Client({ connectionString: urls.migrationUrl });
  await owner.connect();
  try {
    const result = await owner.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.ueb_core_data",
    );
    return result.rows[0]?.count ?? 0;
  } finally {
    await owner.end();
  }
}

async function seedFixtures(migrationUrl: string): Promise<void> {
  const client = new Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO import_run (
          id, source_filename, source_sha256, source_sheet,
          source_contract_version, source_row_count, source_min_stt,
          source_max_stt, canonical_dataset_sha256, report, imported_at
        ) VALUES ($1::uuid, 'phase4-fixture.xlsx', $2, 'fixture', 'phase4-test', 6,
          1001, 1006, $3, '{}'::jsonb, now())
      `,
      [ids.importRun, "a".repeat(64), "b".repeat(64)],
    );
    await seedIdentityFixtures(client);

    // The production contract rejects this corruption. The isolated test drops
    // only this index so the read model's mandatory deterministic tie-break can
    // be exercised without changing any repository migration.
    await client.query(
      'DROP INDEX "ueb_core_data_lecturer_uid_version_no_record_uid_key"',
    );
    await seedCoreRow(
      client,
      1001,
      ids.lecturerA,
      ids.recordA1,
      1,
      UNIT_A,
      "A1 version 1",
    );
    await seedCoreRow(
      client,
      1002,
      ids.lecturerA,
      ids.recordA1,
      2,
      UNIT_A,
      "A1 version 2",
    );
    await seedCoreRow(
      client,
      1003,
      ids.lecturerA,
      ids.recordA2,
      1,
      UNIT_A,
      "A2 version 1",
    );
    await seedCoreRow(
      client,
      1004,
      ids.lecturerB,
      ids.recordB1,
      1,
      UNIT_B,
      "B1 version 1",
    );
    await seedCoreRow(
      client,
      1005,
      ids.lecturerC,
      ids.recordA3,
      1,
      "Tie Unit",
      "A3 lower STT",
    );
    await seedCoreRow(
      client,
      1006,
      ids.lecturerC,
      ids.recordA3,
      1,
      "Tie Unit",
      "A3 greater STT",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function seedIdentityFixtures(client: Client): Promise<void> {
  const users = [
    ids.lecturerAUser,
    ids.lecturerBUser,
    ids.leaderAUser,
    ids.multiLeaderUser,
    ids.noScopeLeaderUser,
    ids.adminUser,
    ids.disabledAdminUser,
    ids.revokedAdminUser,
  ];
  for (const [index, userId] of users.entries()) {
    await client.query(
      `INSERT INTO auth_user (id, name, email, "emailVerified", "updatedAt")
       VALUES ($1::uuid, $2, $3, true, now())`,
      [userId, `Fixture user ${index}`, `fixture-${index}@example.test`],
    );
  }
  await client.query(
    `INSERT INTO organization_unit (id, unit_key, source_value, display_name)
     VALUES ($1::uuid, 'unit-a', $2, $2), ($3::uuid, 'unit-b', $4, $4)`,
    [ids.unitA, UNIT_A, ids.unitB, UNIT_B],
  );

  const profiles = [
    [ids.lecturerAUser, ids.lecturerA, "ACTIVE"],
    [ids.lecturerBUser, ids.lecturerB, "ACTIVE"],
    [ids.leaderAUser, null, "ACTIVE"],
    [ids.multiLeaderUser, null, "ACTIVE"],
    [ids.noScopeLeaderUser, null, "ACTIVE"],
    [ids.adminUser, null, "ACTIVE"],
    [ids.disabledAdminUser, null, "DISABLED"],
    [ids.revokedAdminUser, null, "ACTIVE"],
  ] as const;
  for (const [index, [userId, lecturerUid, status]] of profiles.entries()) {
    await client.query(
      `INSERT INTO access_profile
        (id, user_id, lecturer_uid, status, updated_at, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::access_profile_status, now(), $5::uuid)`,
      [
        `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        userId,
        lecturerUid,
        status,
        ids.adminUser,
      ],
    );
  }

  const roles = [
    [ids.lecturerAUser, "LECTURER", false],
    [ids.lecturerBUser, "LECTURER", false],
    [ids.leaderAUser, "FACULTY_LEADER", false],
    [ids.multiLeaderUser, "FACULTY_LEADER", false],
    [ids.noScopeLeaderUser, "FACULTY_LEADER", false],
    [ids.adminUser, "ADMIN", false],
    [ids.disabledAdminUser, "ADMIN", false],
    [ids.revokedAdminUser, "ADMIN", true],
  ] as const;
  for (const [index, [userId, role, revoked]] of roles.entries()) {
    await client.query(
      `INSERT INTO role_assignment
        (id, user_id, role, granted_by, revoked_by, revoked_at)
       VALUES ($1::uuid, $2::uuid, $3::business_role, $4::uuid,
         CASE WHEN $5 THEN $4::uuid ELSE NULL END,
         CASE WHEN $5 THEN now() ELSE NULL END)`,
      [
        `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        userId,
        role,
        ids.adminUser,
        revoked,
      ],
    );
  }

  const scopes = [
    [ids.leaderAUser, ids.unitA],
    [ids.multiLeaderUser, ids.unitA],
    [ids.multiLeaderUser, ids.unitB],
  ] as const;
  for (const [index, [userId, unitId]] of scopes.entries()) {
    await client.query(
      `INSERT INTO unit_scope_assignment
        (id, user_id, organization_unit_id, granted_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
      [
        `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        userId,
        unitId,
        ids.adminUser,
      ],
    );
  }
}

async function seedCoreRow(
  client: Client,
  stt: number,
  lecturerUid: string,
  recordUid: string,
  versionNo: number,
  approvalUnit: string,
  label: string,
): Promise<void> {
  const snapshotId = `90000000-0000-4000-8000-${String(stt).padStart(12, "0")}`;
  await client.query(
    `
      INSERT INTO ueb_core_data (
        stt, don_vi_phu_trach_hoc_phan, bo_mon_phu_trach_hoc_phan,
        khoi_kien_thuc, ma_hoc_phan, ten_hoc_phan, ten_giang_vien,
        ma_so_can_bo, email_tai_khoan_vnu, bo_mon, don_vi, core_1_2_3,
        tc1_tro_giang, tc2_sh_chuyen_mon, tc3_tong_hop,
        tc3_1_nganh_tot_nghiep_phu_hop,
        tc3_2_bien_soan_de_cuong_giao_trinh,
        tc3_3_chu_nhiem_de_tai_nckh_lien_quan,
        tc3_4_bai_bao_lien_quan, tc4_giang_thu,
        lecturer_uid, record_uid, snapshot_id, version_no, identity_status,
        source_row_number, source_row_checksum, source_import_run_id,
        approval_unit, origin, approved_at
      ) OVERRIDING SYSTEM VALUE VALUES (
        $1, $6, $6, 1, $6, $6, $6, $6, $6, $6, $6, $6, $6, $6, $6,
        $6, $6, $6, $6, $6,
        $2::uuid, $3::uuid, $7::uuid, $4, 'RESOLVED', $1, $8,
        $9::uuid, $5, 'LEGACY_IMPORT', now()
      )
    `,
    [
      stt,
      lecturerUid,
      recordUid,
      versionNo,
      approvalUnit,
      label,
      snapshotId,
      stt.toString(16).padStart(64, "0"),
      ids.importRun,
    ],
  );
}
