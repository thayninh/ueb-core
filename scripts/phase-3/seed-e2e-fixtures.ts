import "dotenv/config";

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { hashPassword } from "better-auth/crypto";
import { Client } from "pg";

import {
  PHASE3_E2E_DATABASE,
  assertExactPhase3TestDatabase,
  readPhase3TestDatabaseUrls,
} from "./lib/test-database";
import { parsePhase3FixtureEnvironment } from "./lib/test-fixtures";

type LecturerFixture = { lecturer_uid: string };
type UnitFixture = { id: string; source_value: string };
type FixtureRole = "LECTURER" | "FACULTY_LEADER" | "ADMIN";

export async function seedE2eFixtures(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const urls = readPhase3TestDatabaseUrls({
    MIGRATION_DATABASE_URL:
      environment.PHASE3_SOURCE_MIGRATION_DATABASE_URL ??
      environment.MIGRATION_DATABASE_URL,
    DATABASE_URL:
      environment.PHASE3_SOURCE_DATABASE_URL ?? environment.DATABASE_URL,
  });
  const fixture = parsePhase3FixtureEnvironment(environment);
  assertExactPhase3TestDatabase(urls.e2eMigrationUrl, PHASE3_E2E_DATABASE);

  const client = new Client({
    connectionString: urls.e2eMigrationUrl,
    application_name: "ueb-core-phase3-e2e-fixtures",
  });
  await client.connect();
  try {
    const existing = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.auth_user",
    );
    if (existing.rows[0]?.count !== 0) {
      throw new Error(
        "E2E fixtures require a freshly prepared Phase 3 E2E database.",
      );
    }

    const lecturers = await client.query<LecturerFixture>(`
      SELECT lecturer_uid::text
      FROM public.ueb_core_data
      GROUP BY lecturer_uid
      ORDER BY lecturer_uid
      LIMIT 2
    `);
    const units = await client.query<UnitFixture>(`
      SELECT id::text, source_value
      FROM public.organization_unit
      WHERE is_active = true
      ORDER BY source_value
      LIMIT 2
    `);
    if (lecturers.rows.length !== 2 || units.rows.length !== 2) {
      throw new Error("E2E fixtures require two lecturers and two units.");
    }

    const passwordHash = await hashPassword(fixture.PHASE3_FIXTURE_PASSWORD);
    await client.query("BEGIN");
    const adminId = await createFixtureUser(client, passwordHash, {
      email: fixture.PHASE3_FIXTURE_ADMIN_EMAIL,
      name: "Phase 3 Administrator",
      role: "ADMIN",
      status: "ACTIVE",
    });
    await createFixtureUser(client, passwordHash, {
      email: fixture.PHASE3_FIXTURE_LECTURER_A_EMAIL,
      name: "Phase 3 Lecturer A",
      lecturerUid: lecturers.rows[0]?.lecturer_uid,
      role: "LECTURER",
      status: "ACTIVE",
    });
    await createFixtureUser(client, passwordHash, {
      email: fixture.PHASE3_FIXTURE_LECTURER_B_EMAIL,
      name: "Phase 3 Lecturer B",
      lecturerUid: lecturers.rows[1]?.lecturer_uid,
      role: "LECTURER",
      status: "ACTIVE",
    });
    const leaderAId = await createFixtureUser(client, passwordHash, {
      email: fixture.PHASE3_FIXTURE_LEADER_A_EMAIL,
      name: "Phase 3 Leader A",
      role: "FACULTY_LEADER",
      status: "ACTIVE",
    });
    const leaderMultiId = await createFixtureUser(client, passwordHash, {
      email: fixture.PHASE3_FIXTURE_LEADER_MULTI_UNIT_EMAIL,
      name: "Phase 3 Multi-unit Leader",
      role: "FACULTY_LEADER",
      status: "ACTIVE",
    });
    await createFixtureUser(client, passwordHash, {
      email: fixture.PHASE3_FIXTURE_DISABLED_USER_EMAIL,
      name: "Phase 3 Disabled User",
      role: "ADMIN",
      status: "DISABLED",
    });

    await assignUnit(client, leaderAId, units.rows[0]!.id, adminId);
    await assignUnit(client, leaderMultiId, units.rows[0]!.id, adminId);
    await assignUnit(client, leaderMultiId, units.rows[1]!.id, adminId);
    await client.query("COMMIT");

    console.log(
      JSON.stringify({
        status: "SUCCESS",
        database: PHASE3_E2E_DATABASE,
        fixtureUsers: 6,
        fixtureEmails: "ENVIRONMENT_ONLY",
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function createFixtureUser(
  client: Client,
  passwordHash: string,
  input: {
    email: string;
    name: string;
    role: FixtureRole;
    status: "ACTIVE" | "DISABLED";
    lecturerUid?: string;
  },
): Promise<string> {
  const userId = randomUUID();
  await client.query(
    `
      INSERT INTO public.auth_user
        (id, name, email, "emailVerified", "updatedAt")
      VALUES ($1::uuid, $2, $3, false, clock_timestamp())
    `,
    [userId, input.name, input.email],
  );
  await client.query(
    `
      INSERT INTO public.auth_account
        ("accountId", "providerId", "userId", password, "updatedAt")
      VALUES ($1::text, 'credential', $1::uuid, $2, clock_timestamp())
    `,
    [userId, passwordHash],
  );
  await client.query(
    `
      INSERT INTO public.access_profile
        (id, user_id, lecturer_uid, status, updated_at, created_by)
      VALUES ($4::uuid, $1::uuid, $2::uuid, $3::public.access_profile_status, clock_timestamp(), $1::uuid)
    `,
    [userId, input.lecturerUid ?? null, input.status, randomUUID()],
  );
  await client.query(
    `
      INSERT INTO public.role_assignment (id, user_id, role, granted_by)
      VALUES ($3::uuid, $1::uuid, $2::public.business_role, $1::uuid)
    `,
    [userId, input.role, randomUUID()],
  );
  return userId;
}

async function assignUnit(
  client: Client,
  userId: string,
  unitId: string,
  adminId: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO public.unit_scope_assignment
        (id, user_id, organization_unit_id, granted_by)
      VALUES ($4::uuid, $1::uuid, $2::uuid, $3::uuid)
    `,
    [userId, unitId, adminId, randomUUID()],
  );
}

async function main(): Promise<void> {
  await seedE2eFixtures(process.env);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main().catch((error) => {
    console.error(
      JSON.stringify({
        status: "ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Phase 3 E2E fixture setup failed safely.",
      }),
    );
    process.exitCode = 1;
  });
}
