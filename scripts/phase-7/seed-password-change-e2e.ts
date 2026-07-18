import "dotenv/config";

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { hashPassword } from "better-auth/crypto";
import { Client } from "pg";

import {
  assertExactPhase3TestDatabase,
  PHASE3_E2E_DATABASE,
  readPhase3TestDatabaseUrls,
} from "../phase-3/lib/test-database";
export async function seedPasswordChangeE2e(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const urls = readPhase3TestDatabaseUrls({
    MIGRATION_DATABASE_URL:
      environment.PHASE3_SOURCE_MIGRATION_DATABASE_URL ??
      environment.MIGRATION_DATABASE_URL,
    DATABASE_URL:
      environment.PHASE3_SOURCE_DATABASE_URL ?? environment.DATABASE_URL,
  });
  assertExactPhase3TestDatabase(urls.e2eMigrationUrl, PHASE3_E2E_DATABASE);
  const initialPassword = environment.PHASE7_E2E_INITIAL_PASSWORD;
  const lecturerEmail = environment.PHASE7_E2E_LECTURER_EMAIL;
  const leaderEmail = environment.PHASE7_E2E_LEADER_EMAIL;
  if (
    !initialPassword ||
    initialPassword.length < 12 ||
    !lecturerEmail ||
    !leaderEmail
  ) {
    throw new Error("Complete local Phase 7 E2E identity input is required.");
  }
  const passwordHash = await hashPassword(initialPassword);
  const client = new Client({
    connectionString: urls.e2eMigrationUrl,
    application_name: "ueb-core-phase7-password-change-e2e-seed",
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.auth_user",
    );
    if (existing.rows[0]?.count !== 0) {
      throw new Error("Phase 7 E2E requires a freshly prepared test database.");
    }
    const lecturer = await client.query<{ lecturer_uid: string }>(
      `
        SELECT lecturer_uid::text
        FROM public.ueb_core_data
        WHERE lecturer_uid IS NOT NULL
        ORDER BY lecturer_uid
        LIMIT 1
      `,
    );
    const unit = await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM public.organization_unit
        WHERE is_active = true
        ORDER BY source_value
        LIMIT 1
      `,
    );
    if (!lecturer.rows[0] || !unit.rows[0]) {
      throw new Error("Phase 7 E2E source fixtures are unavailable.");
    }
    const lecturerId = randomUUID();
    const leaderId = randomUUID();
    await client.query(
      `
        INSERT INTO public.auth_user
          (id, name, email, "emailVerified", "updatedAt")
        VALUES
          ($1::uuid, 'Phase 7 local test lecturer', $2, false, clock_timestamp()),
          ($3::uuid, 'Phase 7 local test leader', $4, false, clock_timestamp())
      `,
      [lecturerId, lecturerEmail, leaderId, leaderEmail],
    );
    await client.query(
      `
        INSERT INTO public.auth_account
          ("accountId", "providerId", "userId", password, "updatedAt")
        VALUES
          ($1::text, 'credential', $1::uuid, $3, clock_timestamp()),
          ($2::text, 'credential', $2::uuid, $3, clock_timestamp())
      `,
      [lecturerId, leaderId, passwordHash],
    );
    await client.query(
      `
        INSERT INTO public.access_profile
          (id, user_id, lecturer_uid, status, must_change_password, updated_at, created_by)
        VALUES
          ($3::uuid, $1::uuid, $5::uuid, 'ACTIVE', true, clock_timestamp(), $1::uuid),
          ($4::uuid, $2::uuid, NULL, 'ACTIVE', true, clock_timestamp(), $2::uuid)
      `,
      [
        lecturerId,
        leaderId,
        randomUUID(),
        randomUUID(),
        lecturer.rows[0].lecturer_uid,
      ],
    );
    await client.query(
      `
        INSERT INTO public.role_assignment (id, user_id, role, granted_by)
        VALUES
          ($3::uuid, $1::uuid, 'LECTURER', $1::uuid),
          ($4::uuid, $2::uuid, 'FACULTY_LEADER', $2::uuid)
      `,
      [lecturerId, leaderId, randomUUID(), randomUUID()],
    );
    await client.query(
      `
        INSERT INTO public.unit_scope_assignment
          (id, user_id, organization_unit_id, granted_by)
        VALUES ($3::uuid, $1::uuid, $2::uuid, $1::uuid)
      `,
      [leaderId, unit.rows[0].id, randomUUID()],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await seedPasswordChangeE2e(process.env).catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Phase 7 local E2E fixture setup failed safely.",
    );
    process.exitCode = 1;
  });
}
