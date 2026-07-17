// @vitest-environment node

import "dotenv/config";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaClient } from "../../src/generated/prisma/client";
import { disableUserAndRevokeSessions } from "../../src/lib/auth/account-lifecycle";
import { setUserRole } from "../../src/lib/auth/admin-user-management";
import { provisionUser } from "../../src/lib/auth/provision-user-core";
import {
  bootstrapProvisioningRole,
  reconcileProvisioningPermissions,
} from "../../scripts/phase-5/lib/provisioning-role";

const TEST_DATABASE = "ueb_core_uat_provisioning_test";
const APP_ROLE = "ueb_core_phase5_app_test";
const PROVISIONER_ROLE = "ueb_core_phase5_provisioner_test";
const APP_PASSWORD = "phase5-app-test-password-not-a-secret-2026";
const PROVISIONER_PASSWORD =
  "phase5-provisioner-test-password-not-a-secret-2026";
const ADMIN_ID = "20000000-0000-4000-8000-000000000002";
const LECTURER_UID = "10000000-0000-4000-8000-000000000001";
const RECORD_UID = "30000000-0000-4000-8000-000000000003";
const integrationEnabled =
  process.env.PHASE5_PROVISIONING_ROLE_INTEGRATION === "1";
const isolatedDescribe = integrationEnabled
  ? describe.sequential
  : describe.skip;

let maintenance: Client;
let owner: Client;
let app: Client;
let provisioner: Client;
let provisionerPool: Pool;
let provisionerPrisma: PrismaClient;
let ownerUrl: string;
let maintenanceUrl: string;

isolatedDescribe("Phase 5 provisioning role on an isolated database", () => {
  beforeAll(async () => {
    const sourceUrl = readLocalOwnerUrl();
    maintenanceUrl = withDatabase(sourceUrl, "postgres");
    ownerUrl = withDatabase(sourceUrl, TEST_DATABASE);
    maintenance = new Client({
      connectionString: maintenanceUrl,
      application_name: "ueb-core-phase5-provisioning-test-maintenance",
    });
    await maintenance.connect();
    await resetTestDatabaseAndRoles();
    await deployMigrations(ownerUrl);
    owner = new Client({
      connectionString: ownerUrl,
      application_name: "ueb-core-phase5-provisioning-test-owner",
    });
    await owner.connect();
    await createAppRole();
    await bootstrapProvisioningRole({
      migrationUrl: ownerUrl,
      expectedDatabase: TEST_DATABASE,
      appRuntimeRole: APP_ROLE,
      roleName: PROVISIONER_ROLE,
      password: PROVISIONER_PASSWORD,
    });
    const report = await reconcileProvisioningPermissions({
      migrationUrl: ownerUrl,
      expectedDatabase: TEST_DATABASE,
      appRuntimeRole: APP_ROLE,
      roleName: PROVISIONER_ROLE,
    });
    expect(report).toMatchObject({
      requiredTableCount: 9,
      excessPrivilegeCount: 0,
      appRuntimeWritePrivilegeCount: 0,
      nonOwner: true,
      nonSuperuser: true,
      noInherit: true,
      noBypassRls: true,
      noCreateDatabase: true,
      noCreateRole: true,
      noCreateSchema: true,
      noTemporaryTables: true,
      noReplication: true,
      noRoleMemberships: true,
      ownsNoObjects: true,
      coreMutationBlocked: true,
      workflowMutationBlocked: true,
    });
    await seedAdminAndCoreSource();
    app = await connectAs(APP_ROLE, APP_PASSWORD, "app");
    provisioner = await connectAs(
      PROVISIONER_ROLE,
      PROVISIONER_PASSWORD,
      "provisioner",
    );
    provisionerPool = new Pool({
      connectionString: roleUrl(PROVISIONER_ROLE, PROVISIONER_PASSWORD),
      max: 3,
    });
    provisionerPrisma = new PrismaClient({
      adapter: new PrismaPg(provisionerPool, { disposeExternalPool: false }),
    });
  }, 120_000);

  afterAll(async () => {
    await provisionerPrisma?.$disconnect().catch(() => undefined);
    await provisionerPool?.end().catch(() => undefined);
    await provisioner?.end().catch(() => undefined);
    await app?.end().catch(() => undefined);
    await owner?.end().catch(() => undefined);
    if (maintenance) {
      await cleanupTestDatabaseAndRoles().catch(() => undefined);
      await maintenance.end().catch(() => undefined);
    }
  }, 120_000);

  it("denies shared app INSERT on every managed provisioning table", async () => {
    const result = await owner.query<{
      table_name: string;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
    }>(
      `SELECT table_name,
         has_table_privilege($1, format('public.%I', table_name), 'INSERT') AS can_insert,
         has_table_privilege($1, format('public.%I', table_name), 'UPDATE') AS can_update,
         has_table_privilege($1, format('public.%I', table_name), 'DELETE') AS can_delete,
         has_table_privilege($1, format('public.%I', table_name), 'TRUNCATE') AS can_truncate
       FROM unnest($2::text[]) AS managed(table_name)`,
      [
        APP_ROLE,
        [
          "auth_user",
          "auth_account",
          "access_profile",
          "role_assignment",
          "organization_unit",
          "unit_scope_assignment",
        ],
      ],
    );
    expect(result.rows).toHaveLength(6);
    expect(result.rows).toEqual(
      expect.arrayContaining(
        result.rows.map((row) => ({
          table_name: row.table_name,
          can_insert: false,
          can_update: false,
          can_delete: false,
          can_truncate: false,
        })),
      ),
    );
    await expect(
      app.query(`INSERT INTO public.access_profile DEFAULT VALUES`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      app.query(`INSERT INTO public.role_assignment DEFAULT VALUES`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("applies and rolls back through existing audited services", async () => {
    const created = await provisionUser(
      {
        actorUserId: ADMIN_ID,
        email: "phase5-role-test@example.invalid",
        temporaryPassword: "Temporary-password-only-for-isolated-test-1!",
        roles: ["LECTURER"],
        lecturerUid: LECTURER_UID,
      },
      {
        auditHmacSecret: "a".repeat(32),
        phase5AuditContext: {
          approvalBatchId: "phase5-provisioning-role-integration",
          inputChecksum: "b".repeat(64),
          operation: "APPLY",
        },
        prisma: provisionerPrisma,
      },
    );
    expect(created.status).toBe("CREATED");
    expect(
      await owner.query(
        `SELECT 1 FROM auth_audit_event WHERE target_user_id = $1 AND event_type = 'USER_CREATED'`,
        [created.userId],
      ),
    ).toMatchObject({ rowCount: 1 });
    await owner.query(
      `INSERT INTO auth_session
       (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
       VALUES ($1, now() + interval '1 hour', $2, now(), now(), $3)`,
      [randomUUID(), randomUUID(), created.userId],
    );

    const rollbackContext = {
      approvalBatchId: "phase5-provisioning-role-integration",
      inputChecksum: "b".repeat(64),
      operation: "ROLLBACK" as const,
    };
    await setUserRole(
      {
        actorUserId: ADMIN_ID,
        targetUserId: created.userId,
        role: "LECTURER",
        enabled: false,
        phase5AuditContext: rollbackContext,
      },
      provisionerPrisma,
    );
    const disabled = await disableUserAndRevokeSessions(
      {
        actorUserId: ADMIN_ID,
        targetUserId: created.userId,
        phase5AuditContext: rollbackContext,
      },
      provisionerPrisma,
    );
    expect(disabled).toMatchObject({
      status: "DISABLED",
      revokedSessionCount: 1,
    });
    const state = (
      await owner.query<{
        status: string;
        active_roles: number;
        sessions: number;
        rollback_audits: number;
      }>(
        `SELECT profile.status::text,
           (SELECT count(*)::integer FROM role_assignment WHERE user_id = $1 AND revoked_at IS NULL) AS active_roles,
           (SELECT count(*)::integer FROM auth_session WHERE "userId" = $1) AS sessions,
           (SELECT count(*)::integer FROM auth_audit_event
             WHERE target_user_id = $1 AND metadata->>'phase5Operation' = 'ROLLBACK') AS rollback_audits
         FROM access_profile profile WHERE profile.user_id = $1`,
        [created.userId],
      )
    ).rows[0];
    expect(state).toMatchObject({
      status: "DISABLED",
      active_roles: 0,
      sessions: 0,
    });
    expect(state!.rollback_audits).toBeGreaterThan(0);
  }, 60_000);

  it("blocks core/workflow mutation, DDL, role administration, and bypass", async () => {
    await expect(
      provisioner.query(`SELECT count(*)::integer AS count FROM ueb_core_data`),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      provisioner.query(`UPDATE ueb_core_data SET origin = origin`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      provisioner.query(`DELETE FROM workflow_event`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      provisioner.query(`CREATE SCHEMA phase5_forbidden`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      provisioner.query(`CREATE TABLE public.phase5_forbidden (id integer)`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      provisioner.query(`CREATE TEMP TABLE phase5_forbidden (id integer)`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      provisioner.query(`CREATE DATABASE phase5_forbidden`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      provisioner.query(`CREATE ROLE phase5_forbidden`),
    ).rejects.toMatchObject({ code: "42501" });
    const role = (
      await owner.query<{
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolreplication: boolean;
        rolbypassrls: boolean;
      }>(
        `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
         FROM pg_roles WHERE rolname = $1`,
        [PROVISIONER_ROLE],
      )
    ).rows[0];
    expect(role).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
    });
  });
});

function readLocalOwnerUrl(): string {
  const raw = process.env.MIGRATION_DATABASE_URL;
  if (!raw) throw new Error("MIGRATION_DATABASE_URL is required.");
  const url = new URL(raw);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.port !== "55432" ||
    !url.username ||
    !url.password
  ) {
    throw new Error("Integration test requires the local owner URL.");
  }
  return url.toString();
}

function withDatabase(connectionUrl: string, databaseName: string): string {
  const url = new URL(connectionUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function roleUrl(role: string, password: string): string {
  const url = new URL(ownerUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

async function connectAs(
  role: string,
  password: string,
  suffix: string,
): Promise<Client> {
  const client = new Client({
    connectionString: roleUrl(role, password),
    application_name: `ueb-core-phase5-provisioning-test-${suffix}`,
  });
  await client.connect();
  return client;
}

async function resetTestDatabaseAndRoles(): Promise<void> {
  await terminateTestConnections();
  await maintenance.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE}"`);
  await maintenance.query(`DROP ROLE IF EXISTS "${PROVISIONER_ROLE}"`);
  await maintenance.query(`DROP ROLE IF EXISTS "${APP_ROLE}"`);
  await maintenance.query(`CREATE DATABASE "${TEST_DATABASE}"`);
}

async function cleanupTestDatabaseAndRoles(): Promise<void> {
  await terminateTestConnections();
  await maintenance.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE}"`);
  await maintenance.query(`DROP ROLE IF EXISTS "${PROVISIONER_ROLE}"`);
  await maintenance.query(`DROP ROLE IF EXISTS "${APP_ROLE}"`);
}

async function terminateTestConnections(): Promise<void> {
  await maintenance.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE pid <> pg_backend_pid() AND datname = $1`,
    [TEST_DATABASE],
  );
}

function deployMigrations(connectionUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("./node_modules/.bin/prisma", ["migrate", "deploy"], {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATION_DATABASE_URL: connectionUrl },
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Isolated Phase 5 migration deploy failed."));
    });
  });
}

async function createAppRole(): Promise<void> {
  await maintenance.query(
    `CREATE ROLE "${APP_ROLE}" WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
       NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${APP_PASSWORD}'`,
  );
  await owner.query(
    `GRANT CONNECT ON DATABASE "${TEST_DATABASE}" TO "${APP_ROLE}"`,
  );
  await owner.query(`GRANT USAGE ON SCHEMA public TO "${APP_ROLE}"`);
  await owner.query(
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${APP_ROLE}"`,
  );
}

async function seedAdminAndCoreSource(): Promise<void> {
  await owner.query(
    `INSERT INTO auth_user
       (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Phase 5 test admin', 'phase5-admin@example.invalid', true, now(), now())`,
    [ADMIN_ID],
  );
  await owner.query(
    `INSERT INTO access_profile
       (id, user_id, lecturer_uid, status, created_at, updated_at, created_by)
     VALUES ($1, $2, NULL, 'ACTIVE', now(), now(), $2)`,
    [randomUUID(), ADMIN_ID],
  );
  await owner.query(
    `INSERT INTO role_assignment (id, user_id, role, granted_by)
     VALUES ($1, $2, 'ADMIN', $2)`,
    [randomUUID(), ADMIN_ID],
  );
  await owner.query(
    `INSERT INTO ueb_core_data
       (stt, khoi_kien_thuc, email_tai_khoan_vnu, lecturer_uid, record_uid,
        version_no, origin)
     VALUES (1, 1, 'phase5-role-test@example.invalid', $1, $2, 1, 'LEGACY_IMPORT')`,
    [LECTURER_UID, RECORD_UID],
  );
}
