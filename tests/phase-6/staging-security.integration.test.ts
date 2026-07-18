// @vitest-environment node

import "dotenv/config";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bootstrapStagingRole,
  grantStagingProvisioningPermissions,
  grantStagingRuntimePermissions,
  verifyStagingSecurity,
} from "../../scripts/phase-6/lib/staging-database";
import {
  STAGING_OWNER_ROLE,
  STAGING_PROVISIONING_ROLE,
  STAGING_RUNTIME_ROLE,
  withDatabaseName,
} from "../../scripts/phase-6/lib/staging-contracts";

const execFileAsync = promisify(execFile);
const TEST_DATABASE = "ueb_core_staging_test_security_01";
const ROLE_ADMIN = "ueb_core_phase6_role_admin_test";
const OWNER_CREDENTIAL = "phase6-owner-integration-credential-2026-x";
const RUNTIME_CREDENTIAL = "phase6-runtime-integration-credential-2026-x";
const PROVISIONER_CREDENTIAL =
  "phase6-provisioner-integration-credential-2026-x";
const ROLE_ADMIN_CREDENTIAL = "phase6-role-admin-integration-credential-2026-x";
const integrationEnabled = process.env.PHASE6_STAGING_INTEGRATION === "1";
const isolatedDescribe = integrationEnabled
  ? describe.sequential
  : describe.skip;

let maintenance: Client | undefined;
let ownerUrl = "";
let runtimeUrl = "";
let provisionerUrl = "";
let roleAdminUrl = "";

isolatedDescribe("Phase 6 ACL and RLS on an isolated local database", () => {
  beforeAll(async () => {
    const sourceUrl = readIsolatedLocalSourceUrl();
    const maintenanceUrl = withDatabaseName(sourceUrl, "postgres");
    maintenance = new Client({
      connectionString: maintenanceUrl,
      application_name: "ueb-core-phase6-test-maintenance",
    });
    await maintenance.connect();
    await cleanupTestDatabaseAndRoles();
    await createLoginRole(
      maintenance,
      STAGING_OWNER_ROLE,
      OWNER_CREDENTIAL,
      false,
    );
    await createLoginRole(maintenance, ROLE_ADMIN, ROLE_ADMIN_CREDENTIAL, true);
    await maintenance.query(
      `CREATE DATABASE "${TEST_DATABASE}" OWNER "${STAGING_OWNER_ROLE}"`,
    );
    ownerUrl = roleUrl(sourceUrl, STAGING_OWNER_ROLE, OWNER_CREDENTIAL);
    runtimeUrl = roleUrl(sourceUrl, STAGING_RUNTIME_ROLE, RUNTIME_CREDENTIAL);
    provisionerUrl = roleUrl(
      sourceUrl,
      STAGING_PROVISIONING_ROLE,
      PROVISIONER_CREDENTIAL,
    );
    roleAdminUrl = roleUrl(sourceUrl, ROLE_ADMIN, ROLE_ADMIN_CREDENTIAL);
    await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: ownerUrl,
        DATABASE_URL: ownerUrl,
      },
    });
    const environment = stagingEnvironment();
    await bootstrapStagingRole({
      environment,
      role: "runtime",
      allowTest: true,
    });
    await bootstrapStagingRole({
      environment,
      role: "provisioner",
      allowTest: true,
    });
    await grantStagingRuntimePermissions({ environment, allowTest: true });
    await grantStagingProvisioningPermissions({
      environment,
      allowTest: true,
    });
  }, 120_000);

  afterAll(async () => {
    if (maintenance) {
      await cleanupTestDatabaseAndRoles().catch(() => undefined);
      await maintenance.end().catch(() => undefined);
    }
  }, 120_000);

  it("blocks runtime and provisioner mutations outside the exact contract", async () => {
    const runtime = await connect(runtimeUrl, "runtime-negative-acl");
    const provisioner = await connect(
      provisionerUrl,
      "provisioner-negative-acl",
    );
    try {
      for (const client of [runtime, provisioner]) {
        await expect(
          client.query("UPDATE ueb_core_data SET origin = origin"),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          client.query("DELETE FROM workflow_event"),
        ).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await Promise.all([runtime.end(), provisioner.end()]);
    }
  });

  it("proves no-context RLS default deny and exact role separation", async () => {
    await expect(
      verifyStagingSecurity({
        environment: stagingEnvironment(),
        allowTest: true,
      }),
    ).resolves.toMatchObject({
      targetDatabase: TEST_DATABASE,
      databaseOwnerRole: STAGING_OWNER_ROLE,
      runtimeRole: STAGING_RUNTIME_ROLE,
      provisioningRole: STAGING_PROVISIONING_ROLE,
      roleSeparation: true,
      rlsDefaultDeny: true,
      coreAcl: "PASS",
      workflowAcl: "PASS",
      rlsHelperAcl: "PASS",
      provisionerExcessPrivilegeCount: 0,
      securityVerify: "PASS",
    });
  });

  it("rejects persistent bootstrap SET ROLE membership to the owner", async () => {
    await maintenance!.query(
      `GRANT "${STAGING_OWNER_ROLE}" TO "${ROLE_ADMIN}" WITH INHERIT FALSE, SET TRUE`,
    );
    try {
      await expect(
        verifyStagingSecurity({
          environment: stagingEnvironment(),
          allowTest: true,
        }),
      ).rejects.toThrow("retains SET ROLE capability");
    } finally {
      await maintenance!.query(
        `REVOKE "${STAGING_OWNER_ROLE}" FROM "${ROLE_ADMIN}"`,
      );
    }
  });
});

function stagingEnvironment(): Record<string, string> {
  return {
    STAGING_EXPECTED_DATABASE: TEST_DATABASE,
    STAGING_MIGRATION_OWNER_ROLE: STAGING_OWNER_ROLE,
    MIGRATION_DATABASE_URL: ownerUrl,
    APP_DATABASE_USER: STAGING_RUNTIME_ROLE,
    DATABASE_URL: runtimeUrl,
    PHASE6_PROVISIONING_USER: STAGING_PROVISIONING_ROLE,
    PHASE6_PROVISIONING_DATABASE_URL: provisionerUrl,
    STAGING_AUTHORIZED_BOOTSTRAP_ROLE: ROLE_ADMIN,
    STAGING_ROLE_ADMIN_DATABASE_URL: roleAdminUrl,
    STAGING_RUNTIME_PASSWORD: RUNTIME_CREDENTIAL,
    STAGING_PROVISIONING_PASSWORD: PROVISIONER_CREDENTIAL,
  };
}

function readIsolatedLocalSourceUrl(): string {
  const value = process.env.MIGRATION_DATABASE_URL;
  if (!value) throw new Error("Local test database URL is missing.");
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    url.port !== "55432" ||
    database.startsWith("ueb_core_uat_") ||
    database.startsWith("ueb_core_staging_")
  ) {
    throw new Error(
      "Phase 6 integration requires the isolated local endpoint.",
    );
  }
  url.pathname = `/${TEST_DATABASE}`;
  return url.toString();
}

function roleUrl(sourceUrl: string, role: string, credential: string): string {
  const url = new URL(sourceUrl);
  url.username = role;
  url.password = credential;
  url.pathname = `/${TEST_DATABASE}`;
  return url.toString();
}

async function createLoginRole(
  client: Client,
  role: string,
  credential: string,
  createRole: boolean,
): Promise<void> {
  const quoted = (
    await client.query<{ role: string; credential: string }>(
      "SELECT quote_ident($1) AS role, quote_literal($2) AS credential",
      [role, credential],
    )
  ).rows[0];
  if (!quoted) throw new Error("Test role quoting failed.");
  await client.query(
    `CREATE ROLE ${quoted.role} WITH LOGIN PASSWORD ${quoted.credential} NOINHERIT NOSUPERUSER NOCREATEDB ${createRole ? "CREATEROLE" : "NOCREATEROLE"} NOREPLICATION NOBYPASSRLS`,
  );
}

async function connect(url: string, applicationName: string): Promise<Client> {
  const client = new Client({
    connectionString: url,
    application_name: `ueb-core-phase6-${applicationName}`,
  });
  await client.connect();
  return client;
}

async function cleanupTestDatabaseAndRoles(): Promise<void> {
  if (!maintenance) return;
  await maintenance.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE pid <> pg_backend_pid() AND datname = $1`,
    [TEST_DATABASE],
  );
  await maintenance.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE}"`);
  for (const role of [
    STAGING_RUNTIME_ROLE,
    STAGING_PROVISIONING_ROLE,
    STAGING_OWNER_ROLE,
    ROLE_ADMIN,
  ]) {
    await maintenance.query(`DROP ROLE IF EXISTS "${role}"`);
  }
}
