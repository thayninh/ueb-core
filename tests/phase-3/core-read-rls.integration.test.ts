// @vitest-environment node

import "dotenv/config";

import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";

import { PrismaPg } from "@prisma/adapter-pg";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { Client, Pool, type PoolClient, type QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { disableUserAndRevokeSessions } from "@/lib/auth/account-lifecycle";
import { appendAuthAuditEvent } from "@/lib/auth/audit";
import { createBetterAuthOptions } from "@/lib/auth/options";
import {
  provisionUser,
  type ProvisionUserResult,
} from "@/lib/auth/provision-user-core";
import {
  PHASE3_REHEARSAL_DATABASE,
  assertExactPhase3TestDatabase,
  readPhase3TestDatabaseUrls,
} from "../../scripts/phase-3/lib/test-database";

vi.mock("server-only", () => ({}));

const EXPECTED_CORE_ROW_COUNT = 2_497;
const TEST_PASSWORD = "phase3-integration-password";
const AUDIT_SECRET = "i".repeat(32);
const integrationEnabled = process.env.PHASE3_ISOLATED_INTEGRATION === "1";
const isolatedDescribe = integrationEnabled
  ? describe.sequential
  : describe.skip;

type SourceLecturer = { lecturer_uid: string; row_count: number };
type SourceUnit = { id: string; source_value: string; row_count: number };
type TestIdentity = { userId: string; roleId: string };

let owner: Client;
let runtimePool: Pool;
let runtimePrisma: PrismaClient;
let auth: ReturnType<typeof betterAuth>;
let adminUserId: string;
let bootstrapFirst: ProvisionUserResult;
let bootstrapSecond: ProvisionUserResult;
let bootstrapFirstExpectedStatus: ProvisionUserResult["status"];
let lecturerA: SourceLecturer;
let lecturerB: SourceLecturer;
let unitA: SourceUnit;
let unitB: SourceUnit;
let lecturerUser: TestIdentity;
let lecturerBUser: TestIdentity;
let singleUnitLeader: TestIdentity;
let multiUnitLeader: TestIdentity;
let unassignedLeader: TestIdentity;
let revokedRoleUser: TestIdentity;
let disableTarget: TestIdentity;

isolatedDescribe("Phase 3 isolated authentication and RBAC integration", () => {
  beforeAll(async () => {
    const urls = readPhase3TestDatabaseUrls(process.env);
    assertExactPhase3TestDatabase(
      urls.rehearsalMigrationUrl,
      PHASE3_REHEARSAL_DATABASE,
    );
    owner = new Client({
      connectionString: urls.rehearsalMigrationUrl,
      application_name: "ueb-core-phase3-isolated-owner-test",
    });
    runtimePool = new Pool({
      connectionString: urls.rehearsalRuntimeUrl,
      application_name: "ueb-core-phase3-isolated-runtime-test",
      max: 4,
    });
    runtimePrisma = new PrismaClient({
      adapter: new PrismaPg(runtimePool, { disposeExternalPool: false }),
    });
    await owner.connect();
    await assertRestrictedRuntimeRole(urls.rehearsalRuntimeUrl);

    const bootstrap = {
      email: "phase3-bootstrap@localhost.test",
      name: "Phase 3 Bootstrap Administrator",
      temporaryPassword: TEST_PASSWORD,
      roles: ["ADMIN" as const],
    };
    bootstrapFirstExpectedStatus = (await runtimePrisma.auth_user.findUnique({
      where: { email: bootstrap.email },
      select: { id: true },
    }))
      ? "EXISTING"
      : "CREATED";
    bootstrapFirst = await provisionUser(bootstrap, {
      auditHmacSecret: AUDIT_SECRET,
      bootstrapInitialAdmin: true,
      prisma: runtimePrisma,
    });
    bootstrapSecond = await provisionUser(bootstrap, {
      auditHmacSecret: AUDIT_SECRET,
      bootstrapInitialAdmin: true,
      prisma: runtimePrisma,
    });
    adminUserId = bootstrapFirst.userId;

    const lecturers = await owner.query<SourceLecturer>(`
      SELECT lecturer_uid::text, count(*)::int AS row_count
      FROM public.ueb_core_data
      GROUP BY lecturer_uid
      ORDER BY lecturer_uid
      LIMIT 2
    `);
    const units = await owner.query<SourceUnit>(`
      SELECT
        organization_unit.id::text,
        organization_unit.source_value,
        count(core.stt)::int AS row_count
      FROM public.organization_unit
      JOIN public.ueb_core_data AS core
        ON core.approval_unit = organization_unit.source_value
      GROUP BY organization_unit.id, organization_unit.source_value
      ORDER BY organization_unit.source_value
      LIMIT 2
    `);
    if (lecturers.rows.length !== 2 || units.rows.length !== 2) {
      throw new Error("Isolated integration requires two lecturers and units.");
    }
    [lecturerA, lecturerB] = lecturers.rows as [SourceLecturer, SourceLecturer];
    [unitA, unitB] = units.rows as [SourceUnit, SourceUnit];

    const passwordHash = await hashPassword(TEST_PASSWORD);
    lecturerUser = await createIdentity("ACTIVE", "LECTURER", passwordHash, {
      lecturerUid: lecturerA.lecturer_uid,
      email: "phase3-integration-lecturer-a@example.invalid",
    });
    lecturerBUser = await createIdentity("ACTIVE", "LECTURER", passwordHash, {
      lecturerUid: lecturerB.lecturer_uid,
      email: "phase3-integration-lecturer-b@example.invalid",
    });
    singleUnitLeader = await createIdentity(
      "ACTIVE",
      "FACULTY_LEADER",
      passwordHash,
    );
    multiUnitLeader = await createIdentity(
      "ACTIVE",
      "FACULTY_LEADER",
      passwordHash,
    );
    unassignedLeader = await createIdentity(
      "ACTIVE",
      "FACULTY_LEADER",
      passwordHash,
    );
    revokedRoleUser = await createIdentity("ACTIVE", "ADMIN", passwordHash);
    disableTarget = await createIdentity("ACTIVE", "ADMIN", passwordHash, {
      email: "phase3-integration-disabled@example.invalid",
    });
    await assignUnit(singleUnitLeader.userId, unitA.id);
    await assignUnit(multiUnitLeader.userId, unitA.id);
    await assignUnit(multiUnitLeader.userId, unitB.id);

    auth = betterAuth(
      createBetterAuthOptions({
        database: prismaAdapter(runtimePrisma, { provider: "postgresql" }),
        environment: {
          baseUrl: "http://localhost:3000",
          secret: "s".repeat(32),
          trustedOrigins: ["http://localhost:3000"],
        },
        isUserSessionEligible: async (userId) => {
          const profile = await runtimePrisma.accessProfile.findUnique({
            where: { userId },
            select: { status: true },
          });
          return profile?.status === "ACTIVE";
        },
        onLoginSuccess: async (session) => {
          await appendAuthAuditEvent(runtimePrisma, {
            eventType: "AUTH_LOGIN_SUCCESS",
            outcome: "SUCCESS",
            actorUserId: session.userId,
            targetUserId: session.userId,
            sessionId: session.id,
            metadata: { authenticationType: "EMAIL_PASSWORD" },
          });
        },
        onLogout: async (session) => {
          await appendAuthAuditEvent(runtimePrisma, {
            eventType: "AUTH_LOGOUT",
            outcome: "SUCCESS",
            actorUserId: session.userId,
            targetUserId: session.userId,
            sessionId: session.id,
            metadata: { authenticationType: "DATABASE_SESSION" },
          });
        },
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await runtimePrisma?.$disconnect().catch(() => undefined);
    await runtimePool?.end().catch(() => undefined);
    await owner?.end().catch(() => undefined);
  });

  it("replays every migration cleanly on the rehearsal database", async () => {
    const migrationDirectories = (await readdir("prisma/migrations")).filter(
      (entry) => /^\d+_/u.test(entry),
    );
    const applied = await owner.query<{
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>(`
      SELECT migration_name, finished_at, rolled_back_at
      FROM public._prisma_migrations
      ORDER BY migration_name
    `);
    expect(applied.rows).toHaveLength(migrationDirectories.length);
    expect(
      applied.rows.every((row) => row.finished_at && !row.rolled_back_at),
    ).toBe(true);
  });

  it("bootstraps the initial administrator idempotently", () => {
    expect(bootstrapFirst.status).toBe(bootstrapFirstExpectedStatus);
    expect(bootstrapSecond.status).toBe("EXISTING");
    expect(bootstrapSecond.userId).toBe(bootstrapFirst.userId);
  });

  it("creates a database session for valid credentials", async () => {
    const response = await signIn(
      "phase3-integration-lecturer-a@example.invalid",
      TEST_PASSWORD,
    );
    expect(response.ok).toBe(true);
    const cookie = readSessionCookie(response);
    expect(cookie).toContain("better-auth.session_token=");
    expect(await sessionCount(lecturerUser.userId)).toBeGreaterThan(0);
  });

  it("does not create a session for a wrong password", async () => {
    const before = await sessionCount(lecturerBUser.userId);
    const response = await signIn(
      "phase3-integration-lecturer-b@example.invalid",
      "wrong-password-value",
    );
    expect(response.ok).toBe(false);
    expect(await sessionCount(lecturerBUser.userId)).toBe(before);
  });

  it("revokes the database session on logout", async () => {
    const response = await signIn(
      "phase3-integration-lecturer-b@example.invalid",
      TEST_PASSWORD,
    );
    const cookie = readSessionCookie(response);
    expect(await sessionCount(lecturerBUser.userId)).toBeGreaterThan(0);
    const logout = await auth.handler(authRequest("/sign-out", {}, { cookie }));
    expect(logout.ok).toBe(true);
    expect(await sessionCount(lecturerBUser.userId)).toBe(0);
  });

  it("revokes old sessions and blocks login after disabling a user", async () => {
    const login = await signIn(
      "phase3-integration-disabled@example.invalid",
      TEST_PASSWORD,
    );
    const cookie = readSessionCookie(login);
    expect(await sessionCount(disableTarget.userId)).toBeGreaterThan(0);

    await disableUserAndRevokeSessions(
      { actorUserId: adminUserId, targetUserId: disableTarget.userId },
      runtimePrisma,
    );
    expect(await sessionCount(disableTarget.userId)).toBe(0);
    const sessionResponse = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session", {
        headers: { cookie },
      }),
    );
    expect(await sessionResponse.json()).toBeNull();
    expect(
      (
        await signIn(
          "phase3-integration-disabled@example.invalid",
          TEST_PASSWORD,
        )
      ).ok,
    ).toBe(false);
  });

  it("returns zero rows without an RLS request context", async () => {
    await expect(runtimeCount()).resolves.toBe(0);
  });

  it("limits lecturer A to its identity and hides lecturer B", async () => {
    await expect(runtimeCount(lecturerUser.userId)).resolves.toBe(
      lecturerA.row_count,
    );
    await expect(
      runtimeCount(lecturerUser.userId, {
        text: "SELECT count(*)::int AS count FROM public.ueb_core_data WHERE lecturer_uid = $1::uuid",
        values: [lecturerB.lecturer_uid],
      }),
    ).resolves.toBe(0);
  });

  it("limits leaders to active assigned units including multiple units", async () => {
    await expect(runtimeCount(singleUnitLeader.userId)).resolves.toBe(
      unitA.row_count,
    );
    await expect(runtimeCount(multiUnitLeader.userId)).resolves.toBe(
      unitA.row_count + unitB.row_count,
    );
    await expect(runtimeCount(unassignedLeader.userId)).resolves.toBe(0);
  });

  it("allows ADMIN to read exactly 2,497 rows", async () => {
    await expect(runtimeCount(adminUserId)).resolves.toBe(
      EXPECTED_CORE_ROW_COUNT,
    );
  });

  it("removes RLS access immediately after role revocation", async () => {
    await expect(runtimeCount(revokedRoleUser.userId)).resolves.toBe(
      EXPECTED_CORE_ROW_COUNT,
    );
    await owner.query(
      `
        UPDATE public.role_assignment
        SET revoked_by = $1::uuid, revoked_at = clock_timestamp()
        WHERE id = $2::uuid
      `,
      [adminUserId, revokedRoleUser.roleId],
    );
    await expect(runtimeCount(revokedRoleUser.userId)).resolves.toBe(0);
  });

  it("denies runtime UPDATE and DELETE on core data", async () => {
    const before = await owner.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.ueb_core_data",
    );
    await expect(
      runtimePool.query(
        "UPDATE public.ueb_core_data SET ten_giang_vien = ten_giang_vien WHERE false",
      ),
    ).rejects.toThrow(/permission denied/u);
    await expect(
      runtimePool.query("DELETE FROM public.ueb_core_data WHERE false"),
    ).rejects.toThrow(/permission denied/u);
    const after = await owner.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.ueb_core_data",
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("blocks audit UPDATE, DELETE, and TRUNCATE even for the owner", async () => {
    const auditId = randomUUID();
    await owner.query(
      `
        INSERT INTO public.auth_audit_event
          (id, event_type, outcome, metadata)
        VALUES ($1::uuid, 'AUTH_LOGIN_FAILED', 'FAILED', '{}'::jsonb)
      `,
      [auditId],
    );
    await expect(
      owner.query(
        "UPDATE public.auth_audit_event SET outcome = outcome WHERE id = $1::uuid",
        [auditId],
      ),
    ).rejects.toThrow(/append-only/u);
    await expect(
      owner.query("DELETE FROM public.auth_audit_event WHERE id = $1::uuid", [
        auditId,
      ]),
    ).rejects.toThrow(/append-only/u);
    await expect(
      owner.query("TRUNCATE TABLE public.auth_audit_event"),
    ).rejects.toThrow(/append-only/u);
  });
});

async function assertRestrictedRuntimeRole(runtimeUrl: string): Promise<void> {
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
  expect(identity?.runtime_user).toBe(
    decodeURIComponent(new URL(runtimeUrl).username),
  );
  expect(identity?.runtime_user).not.toBe(identity?.table_owner);
  expect(identity?.rolbypassrls).toBe(false);
  expect(identity?.rolsuper).toBe(false);
}

async function createIdentity(
  status: "ACTIVE" | "DISABLED",
  role: "LECTURER" | "FACULTY_LEADER" | "ADMIN",
  passwordHash: string,
  options: { lecturerUid?: string; email?: string } = {},
): Promise<TestIdentity> {
  const identity = { userId: randomUUID(), roleId: randomUUID() };
  const email =
    options.email ?? `phase3-${identity.userId.slice(0, 12)}@example.invalid`;
  await owner.query("BEGIN");
  try {
    await owner.query(
      `
        INSERT INTO public.auth_user
          (id, name, email, "emailVerified", "updatedAt")
        VALUES ($1::uuid, 'Phase 3 Test Identity', $2, false, clock_timestamp())
      `,
      [identity.userId, email],
    );
    await owner.query(
      `
        INSERT INTO public.auth_account
          ("accountId", "providerId", "userId", password, "updatedAt")
        VALUES ($1::text, 'credential', $1::uuid, $2, clock_timestamp())
      `,
      [identity.userId, passwordHash],
    );
    await owner.query(
      `
        INSERT INTO public.access_profile
          (id, user_id, lecturer_uid, status, updated_at, created_by)
        VALUES ($4::uuid, $1::uuid, $2::uuid, $3::public.access_profile_status, clock_timestamp(), $1::uuid)
      `,
      [identity.userId, options.lecturerUid ?? null, status, randomUUID()],
    );
    await owner.query(
      `
        INSERT INTO public.role_assignment (id, user_id, role, granted_by)
        VALUES ($1::uuid, $2::uuid, $3::public.business_role, $2::uuid)
      `,
      [identity.roleId, identity.userId, role],
    );
    await owner.query("COMMIT");
    return identity;
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function assignUnit(userId: string, unitId: string): Promise<void> {
  await owner.query(
    `
      INSERT INTO public.unit_scope_assignment
        (id, user_id, organization_unit_id, granted_by)
      VALUES ($4::uuid, $1::uuid, $2::uuid, $3::uuid)
    `,
    [userId, unitId, adminUserId, randomUUID()],
  );
}

async function signIn(email: string, password: string): Promise<Response> {
  return auth.handler(authRequest("/sign-in/email", { email, password }));
}

function authRequest(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost:3000/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function readSessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const tokenCookie = setCookie
    .split(/,(?=\s*better-auth\.)/u)
    .find((entry) => entry.includes("better-auth.session_token="));
  if (!tokenCookie) throw new Error("Better Auth session cookie was not set.");
  return tokenCookie.split(";", 1)[0]!;
}

async function sessionCount(userId: string): Promise<number> {
  return runtimePrisma.auth_session.count({ where: { userId } });
}

async function runtimeCount(
  userId?: string,
  query: { text: string; values: readonly unknown[] } = {
    text: "SELECT count(*)::int AS count FROM public.ueb_core_data",
    values: [],
  },
): Promise<number> {
  const connection = await runtimePool.connect();
  try {
    await connection.query("BEGIN");
    if (userId) {
      await connection.query(
        "SELECT set_config('app.current_user_id', $1, true)",
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
