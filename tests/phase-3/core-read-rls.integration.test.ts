// @vitest-environment node

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { Client, Pool, type PoolClient, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const EXPECTED_CORE_ROW_COUNT = 2_497;

type SourceLecturer = { lecturer_uid: string; row_count: number };
type SourceUnit = { approval_unit: string; row_count: number };
type TestIdentity = {
  userId: string;
  roleId: string;
  profileId: string;
};

const migrationUrl = requireDatabaseUrl(
  process.env.MIGRATION_DATABASE_URL,
  "MIGRATION_DATABASE_URL",
);
const runtimeUrl = requireDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");

const fixtureOwner = new Client({
  connectionString: migrationUrl,
  application_name: "ueb-core-rls-fixture-owner",
});
const runtimePool = new Pool({
  connectionString: runtimeUrl,
  application_name: "ueb-core-rls-runtime-test",
  max: 2,
});

const createdUserIds: string[] = [];
const createdUnitIds: string[] = [];

let lecturerA: SourceLecturer;
let lecturerB: SourceLecturer;
let unitA: SourceUnit;
let unitB: SourceUnit;
let lecturerUser: TestIdentity;
let singleUnitLeader: TestIdentity;
let multiUnitLeader: TestIdentity;
let unassignedLeader: TestIdentity;
let adminUser: TestIdentity;
let disabledUser: TestIdentity;
let revokedRoleUser: TestIdentity;

describe.sequential("Phase 3 core read RLS with the runtime role", () => {
  beforeAll(async () => {
    expect(databaseName(migrationUrl)).toBe(databaseName(runtimeUrl));
    expect(databaseUser(migrationUrl)).not.toBe(databaseUser(runtimeUrl));

    await fixtureOwner.connect();
    await assertRestrictedRuntimeRole();

    const lecturers = await fixtureOwner.query<SourceLecturer>(`
      SELECT lecturer_uid::text, count(*)::int AS row_count
      FROM public.ueb_core_data
      GROUP BY lecturer_uid
      ORDER BY lecturer_uid
      LIMIT 2
    `);
    const units = await fixtureOwner.query<SourceUnit>(`
      SELECT approval_unit, count(*)::int AS row_count
      FROM public.ueb_core_data
      WHERE approval_unit IS NOT NULL
      GROUP BY approval_unit
      ORDER BY approval_unit
      LIMIT 2
    `);

    if (lecturers.rows.length !== 2 || units.rows.length !== 2) {
      throw new Error(
        "RLS integration tests require at least two lecturers and two approval units.",
      );
    }
    [lecturerA, lecturerB] = lecturers.rows as [SourceLecturer, SourceLecturer];
    [unitA, unitB] = units.rows as [SourceUnit, SourceUnit];

    const unitAId = await ensureOrganizationUnit(unitA.approval_unit);
    const unitBId = await ensureOrganizationUnit(unitB.approval_unit);

    lecturerUser = await createIdentity("ACTIVE", "LECTURER", {
      lecturerUid: lecturerA.lecturer_uid,
    });
    singleUnitLeader = await createIdentity("ACTIVE", "FACULTY_LEADER");
    multiUnitLeader = await createIdentity("ACTIVE", "FACULTY_LEADER");
    unassignedLeader = await createIdentity("ACTIVE", "FACULTY_LEADER");
    adminUser = await createIdentity("ACTIVE", "ADMIN");
    disabledUser = await createIdentity("ACTIVE", "ADMIN");
    revokedRoleUser = await createIdentity("ACTIVE", "ADMIN");

    await assignUnit(singleUnitLeader.userId, unitAId);
    await assignUnit(multiUnitLeader.userId, unitAId);
    await assignUnit(multiUnitLeader.userId, unitBId);
  }, 30_000);

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await fixtureOwner
        .query(
          `DELETE FROM public.unit_scope_assignment WHERE user_id = ANY($1::uuid[])`,
          [createdUserIds],
        )
        .catch(() => undefined);
      await fixtureOwner
        .query(
          `DELETE FROM public.role_assignment WHERE user_id = ANY($1::uuid[])`,
          [createdUserIds],
        )
        .catch(() => undefined);
      await fixtureOwner
        .query(
          `DELETE FROM public.access_profile WHERE user_id = ANY($1::uuid[])`,
          [createdUserIds],
        )
        .catch(() => undefined);
      await fixtureOwner
        .query(`DELETE FROM public.auth_user WHERE id = ANY($1::uuid[])`, [
          createdUserIds,
        ])
        .catch(() => undefined);
    }
    if (createdUnitIds.length > 0) {
      await fixtureOwner
        .query(
          `DELETE FROM public.organization_unit WHERE id = ANY($1::uuid[])`,
          [createdUnitIds],
        )
        .catch(() => undefined);
    }
    await runtimePool.end().catch(() => undefined);
    await fixtureOwner.end().catch(() => undefined);
  }, 30_000);

  it("returns zero rows when the runtime transaction has no user context", async () => {
    await expect(runtimeCount()).resolves.toBe(0);
  });

  it("limits a lecturer to their own lecturer_uid and hides lecturer B", async () => {
    await expect(runtimeCount(lecturerUser.userId)).resolves.toBe(
      lecturerA.row_count,
    );
    await expect(
      runtimeCount(lecturerUser.userId, {
        text: `SELECT count(*)::int AS count FROM public.ueb_core_data WHERE lecturer_uid = $1::uuid`,
        values: [lecturerB.lecturer_uid],
      }),
    ).resolves.toBe(0);
  });

  it("limits a faculty leader to exactly one assigned unit", async () => {
    await expect(runtimeCount(singleUnitLeader.userId)).resolves.toBe(
      unitA.row_count,
    );
    await expect(
      runtimeCount(singleUnitLeader.userId, {
        text: `SELECT count(*)::int AS count FROM public.ueb_core_data WHERE approval_unit = $1`,
        values: [unitB.approval_unit],
      }),
    ).resolves.toBe(0);
  });

  it("combines all active assignments for a multi-unit leader", async () => {
    await expect(runtimeCount(multiUnitLeader.userId)).resolves.toBe(
      unitA.row_count + unitB.row_count,
    );
  });

  it("returns zero rows for a leader without a unit assignment", async () => {
    await expect(runtimeCount(unassignedLeader.userId)).resolves.toBe(0);
  });

  it("allows an active ADMIN to see all 2,497 core rows", async () => {
    await expect(runtimeCount(adminUser.userId)).resolves.toBe(
      EXPECTED_CORE_ROW_COUNT,
    );
  });

  it("removes access immediately when an active user is disabled", async () => {
    await expect(runtimeCount(disabledUser.userId)).resolves.toBe(
      EXPECTED_CORE_ROW_COUNT,
    );
    await fixtureOwner.query(
      `UPDATE public.access_profile SET status = 'DISABLED' WHERE user_id = $1::uuid`,
      [disabledUser.userId],
    );
    await expect(runtimeCount(disabledUser.userId)).resolves.toBe(0);
  });

  it("removes access immediately when a role is revoked", async () => {
    await expect(runtimeCount(revokedRoleUser.userId)).resolves.toBe(
      EXPECTED_CORE_ROW_COUNT,
    );
    await fixtureOwner.query(
      `
        UPDATE public.role_assignment
        SET revoked_by = $1::uuid, revoked_at = clock_timestamp()
        WHERE id = $2::uuid
      `,
      [revokedRoleUser.userId, revokedRoleUser.roleId],
    );
    await expect(runtimeCount(revokedRoleUser.userId)).resolves.toBe(0);
  });
});

async function assertRestrictedRuntimeRole(): Promise<void> {
  const result = await runtimePool.query<{
    runtime_user: string;
    table_owner: string;
    rolbypassrls: boolean;
    rolsuper: boolean;
  }>(`
    SELECT
      current_user AS runtime_user,
      table_row.tableowner AS table_owner,
      role_row.rolbypassrls,
      role_row.rolsuper
    FROM pg_catalog.pg_roles AS role_row
    CROSS JOIN pg_catalog.pg_tables AS table_row
    WHERE role_row.rolname = current_user
      AND table_row.schemaname = 'public'
      AND table_row.tablename = 'ueb_core_data'
  `);
  const identity = result.rows[0];

  expect(identity?.runtime_user).toBe(databaseUser(runtimeUrl));
  expect(identity?.runtime_user).not.toBe(databaseUser(migrationUrl));
  expect(identity?.runtime_user).not.toBe(identity?.table_owner);
  expect(identity?.rolbypassrls).toBe(false);
  expect(identity?.rolsuper).toBe(false);
}

async function createIdentity(
  status: "ACTIVE" | "DISABLED",
  role: "LECTURER" | "FACULTY_LEADER" | "ADMIN",
  options: { lecturerUid?: string } = {},
): Promise<TestIdentity> {
  const identity = {
    userId: randomUUID(),
    profileId: randomUUID(),
    roleId: randomUUID(),
  };
  createdUserIds.push(identity.userId);
  const runMarker = identity.userId.slice(0, 12);

  await fixtureOwner.query(
    `
      INSERT INTO public.auth_user
        (id, name, email, "emailVerified", "updatedAt")
      VALUES ($1::uuid, 'RLS Test Identity', $2, false, clock_timestamp())
    `,
    [identity.userId, `rls-${runMarker}@example.invalid`],
  );
  await fixtureOwner.query(
    `
      INSERT INTO public.access_profile
        (id, user_id, lecturer_uid, status, updated_at, created_by)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::public.access_profile_status, clock_timestamp(), $2::uuid)
    `,
    [identity.profileId, identity.userId, options.lecturerUid ?? null, status],
  );
  await fixtureOwner.query(
    `
      INSERT INTO public.role_assignment (id, user_id, role, granted_by)
      VALUES ($1::uuid, $2::uuid, $3::public.business_role, $2::uuid)
    `,
    [identity.roleId, identity.userId, role],
  );

  return identity;
}

async function ensureOrganizationUnit(sourceValue: string): Promise<string> {
  const existing = await fixtureOwner.query<{ id: string }>(
    `SELECT id::text FROM public.organization_unit WHERE source_value = $1`,
    [sourceValue],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const id = randomUUID();
  createdUnitIds.push(id);
  await fixtureOwner.query(
    `
      INSERT INTO public.organization_unit
        (id, unit_key, source_value, display_name)
      VALUES ($1::uuid, $2, $3, $3)
    `,
    [id, `rls-test-${id.slice(0, 12)}`, sourceValue],
  );
  return id;
}

async function assignUnit(userId: string, unitId: string): Promise<void> {
  await fixtureOwner.query(
    `
      INSERT INTO public.unit_scope_assignment
        (id, user_id, organization_unit_id, granted_by)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $2::uuid)
    `,
    [randomUUID(), userId, unitId],
  );
}

async function runtimeCount(
  userId?: string,
  query: { text: string; values: readonly unknown[] } = {
    text: `SELECT count(*)::int AS count FROM public.ueb_core_data`,
    values: [],
  },
): Promise<number> {
  const connection = await runtimePool.connect();
  try {
    await connection.query("BEGIN");
    if (userId) {
      await connection.query(
        `SELECT set_config('app.current_user_id', $1, true)`,
        [userId],
      );
    }
    const result = await queryWithValues<{ count: number }>(connection, query);
    await connection.query("COMMIT");
    return result.rows[0]?.count ?? -1;
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

function queryWithValues<Row extends QueryResultRow>(
  connection: PoolClient,
  query: { text: string; values: readonly unknown[] },
) {
  return connection.query<Row>(query.text, [...query.values]);
}

function requireDatabaseUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for RLS integration tests.`);
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${name} must be a PostgreSQL URL.`);
  }
  return value;
}

function databaseUser(value: string): string {
  return decodeURIComponent(new URL(value).username);
}

function databaseName(value: string): string {
  return decodeURIComponent(new URL(value).pathname.slice(1));
}
