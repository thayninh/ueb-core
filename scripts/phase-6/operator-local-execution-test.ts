import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { Client } from "pg";

import {
  bootstrapStagingDatabase,
  bootstrapStagingRole,
  ensureRestrictedStagingOwnerRole,
  fingerprintStaging,
  grantStagingProvisioningPermissions,
  grantStagingRuntimePermissions,
  verifyStagingSecurity,
} from "./lib/staging-database";
import {
  SafePhase6StagingError,
  STAGING_MIGRATION_COUNT,
  STAGING_OWNER_ROLE,
  STAGING_PROVISIONING_ROLE,
  STAGING_RUNTIME_ROLE,
  withDatabaseName,
} from "./lib/staging-contracts";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  let stage = "AUTHORIZATION";
  if (process.env.PHASE6_OPERATOR_LOCAL_TEST !== "1") {
    fail("Explicit local operator test confirmation is required.");
    return;
  }
  const sourceUrl = readIsolatedAdminUrl(process.env);
  const suffix = randomBytes(6).toString("hex");
  const database = `ueb_core_staging_test_operator_${suffix}`;
  const restoreDatabase = `ueb_core_staging_test_restore_${suffix}`;
  const roleAdmin = `ueb_core_phase6_test_admin_${suffix}`;
  const ownerPassword = randomBytes(36).toString("base64url");
  const runtimePassword = randomBytes(36).toString("base64url");
  const provisionerPassword = randomBytes(36).toString("base64url");
  const roleAdminPassword = randomBytes(36).toString("base64url");
  const maintenance = new Client({
    connectionString: withDatabaseName(sourceUrl, "postgres"),
    application_name: "ueb-core-phase6-operator-local-test",
  });
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "ueb-core-phase6-operator-"),
  );
  let resourcesCreated = false;
  let executionPassed = false;
  let cleanupPassed = false;
  try {
    stage = "CONNECT_ADMIN";
    await maintenance.connect();
    await assertLocalAdmin(maintenance);
    stage = "CREATE_DISPOSABLE_RESOURCES";
    await assertResourcesAbsent(
      maintenance,
      [database, restoreDatabase],
      [
        STAGING_OWNER_ROLE,
        STAGING_RUNTIME_ROLE,
        STAGING_PROVISIONING_ROLE,
        roleAdmin,
      ],
    );
    await createRole(
      maintenance,
      roleAdmin,
      roleAdminPassword,
      "CREATEDB CREATEROLE",
    );
    resourcesCreated = true;

    const ownerUrl = roleUrl(
      sourceUrl,
      database,
      STAGING_OWNER_ROLE,
      ownerPassword,
    );
    const runtimeUrl = roleUrl(
      sourceUrl,
      database,
      STAGING_RUNTIME_ROLE,
      runtimePassword,
    );
    const provisionerUrl = roleUrl(
      sourceUrl,
      database,
      STAGING_PROVISIONING_ROLE,
      provisionerPassword,
    );
    const roleAdminUrl = roleUrl(
      sourceUrl,
      database,
      roleAdmin,
      roleAdminPassword,
    );
    const environment = {
      PHASE6_STAGING_INTEGRATION: "1",
      PHASE6_TEST_DATABASE_HOST: process.env.PHASE6_TEST_DATABASE_HOST,
      PHASE6_TEST_DATABASE_PORT: process.env.PHASE6_TEST_DATABASE_PORT,
      STAGING_EXPECTED_DATABASE: database,
      STAGING_MIGRATION_OWNER_ROLE: STAGING_OWNER_ROLE,
      STAGING_MIGRATION_OWNER_PASSWORD: ownerPassword,
      STAGING_BOOTSTRAP_DATABASE_URL: roleAdminUrl,
      MIGRATION_DATABASE_URL: ownerUrl,
      APP_DATABASE_USER: STAGING_RUNTIME_ROLE,
      DATABASE_URL: runtimeUrl,
      PHASE6_PROVISIONING_USER: STAGING_PROVISIONING_ROLE,
      PHASE6_PROVISIONING_DATABASE_URL: provisionerUrl,
      STAGING_AUTHORIZED_BOOTSTRAP_ROLE: roleAdmin,
      STAGING_ROLE_ADMIN_DATABASE_URL: roleAdminUrl,
      STAGING_RUNTIME_PASSWORD: runtimePassword,
      STAGING_PROVISIONING_PASSWORD: provisionerPassword,
    };

    stage = "PRECREATE_OWNER_AS_BOOTSTRAP";
    const bootstrapMaintenance = new Client({
      connectionString: withDatabaseName(roleAdminUrl, "postgres"),
      application_name: "ueb-core-phase6-operator-owner-precondition",
    });
    try {
      await bootstrapMaintenance.connect();
      await ensureRestrictedStagingOwnerRole(
        bootstrapMaintenance,
        ownerPassword,
      );
    } finally {
      await bootstrapMaintenance.end().catch(() => undefined);
    }

    stage = "DATABASE_BOOTSTRAP";
    const bootstrap = await bootstrapStagingDatabase({
      environment,
      expectedDatabase: database,
      allowTest: true,
    });
    if (
      bootstrap.databaseOwner !== STAGING_OWNER_ROLE ||
      !bootstrap.bootstrapCanSetOwnerRoleBeforeCreate ||
      !bootstrap.temporaryMembershipRevoked ||
      bootstrap.bootstrapCanSetOwnerRoleAfter ||
      bootstrap.migrationCount !== STAGING_MIGRATION_COUNT
    ) {
      throw new SafePhase6StagingError(
        "Local PostgreSQL 18 ownership bootstrap evidence is invalid.",
      );
    }
    stage = "ROLE_BOOTSTRAP";
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
    stage = "ACL_RECONCILIATION";
    await grantStagingRuntimePermissions({ environment, allowTest: true });
    await grantStagingProvisioningPermissions({
      environment: { ...environment, DATABASE_URL: provisionerUrl },
      allowTest: true,
    });
    stage = "SECURITY_AND_FINGERPRINT";
    await verifyStagingSecurity({ environment, allowTest: true });
    const fingerprint = await fingerprintStaging({
      environment,
      allowTest: true,
    });
    if (
      fingerprint.migrationCount !== STAGING_MIGRATION_COUNT ||
      fingerprint.failedMigrationCount !== 0
    ) {
      throw new SafePhase6StagingError(
        "Local operator migration fingerprint is invalid.",
      );
    }

    stage = "BACKUP";
    const backupPath = join(temporaryDirectory, "operator-test.dump");
    await execFileAsync(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        backupPath,
      ],
      { env: postgresEnvironment(ownerUrl) },
    );
    await execFileAsync("pg_restore", ["--list", backupPath]);
    stage = "RESTORE_CREATE";
    await maintenance.query(
      `CREATE DATABASE "${restoreDatabase}" OWNER "${STAGING_OWNER_ROLE}"`,
    );
    const restoreUrl = roleUrl(
      sourceUrl,
      restoreDatabase,
      STAGING_OWNER_ROLE,
      ownerPassword,
    );
    stage = "RESTORE_APPLY";
    try {
      await execFileAsync(
        "pg_restore",
        [
          "--clean",
          "--if-exists",
          "--no-owner",
          "--no-privileges",
          "--exit-on-error",
          "--dbname",
          restoreDatabase,
          backupPath,
        ],
        { env: postgresEnvironment(restoreUrl) },
      );
    } catch (error) {
      const stderr =
        typeof error === "object" && error && "stderr" in error
          ? String(error.stderr)
          : "";
      console.log(`RESTORE_ERROR_CLASS=${classifyRestoreError(stderr)}`);
      throw new SafePhase6StagingError(
        "Local operator restore command failed safely.",
      );
    }
    stage = "RESTORE_VERIFY";
    const restored = new Client({
      connectionString: restoreUrl,
      application_name: "ueb-core-phase6-operator-restore-verify",
    });
    try {
      await restored.connect();
      const migrationCount = (
        await restored.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM public._prisma_migrations
           WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
        )
      ).rows[0]?.count;
      if (migrationCount !== STAGING_MIGRATION_COUNT) {
        throw new SafePhase6StagingError(
          "Local operator restore verification is invalid.",
        );
      }
    } finally {
      await restored.end().catch(() => undefined);
    }

    console.log("OPERATOR_COMMANDS=PASS");
    console.log("DATABASE_OWNER=ueb_core_staging_owner");
    console.log("BOOTSTRAP_CAN_SET_OWNER_ROLE=YES");
    console.log("BOOTSTRAP_OWNER_MEMBERSHIP_RETAINED=NO");
    console.log("BOOTSTRAP_CAN_SET_OWNER_ROLE_AFTER=NO");
    console.log(`MIGRATION_COUNT=${STAGING_MIGRATION_COUNT}`);
    console.log("ROLE_ACL_RLS=PASS");
    console.log("FINGERPRINT=PASS");
    console.log("BACKUP_RESTORE=PASS");
    executionPassed = true;
  } catch (error) {
    console.log(`OPERATOR_LOCAL_STAGE=${stage}`);
    fail(
      error instanceof SafePhase6StagingError
        ? error.message
        : "Local operator execution validation failed safely.",
    );
  } finally {
    try {
      if (resourcesCreated) {
        await cleanup(
          maintenance,
          [database, restoreDatabase],
          [
            STAGING_RUNTIME_ROLE,
            STAGING_PROVISIONING_ROLE,
            STAGING_OWNER_ROLE,
            roleAdmin,
          ],
        );
      }
      cleanupPassed = true;
    } catch {
      process.exitCode = 1;
    }
    await maintenance.end().catch(() => undefined);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  if (executionPassed && cleanupPassed) {
    console.log("DISPOSABLE_RESOURCE_CLEANUP=PASS");
    console.log("OPERATOR_LOCAL_EXECUTION_TEST=PASS");
  } else if (executionPassed) {
    fail("Local operator disposable-resource cleanup failed.");
  }
}

function readIsolatedAdminUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const value =
    environment.PHASE6_TEST_ADMIN_DATABASE_URL ??
    environment.MIGRATION_DATABASE_URL;
  if (!value || environment.PHASE6_STAGING_INTEGRATION !== "1") {
    throw new SafePhase6StagingError(
      "Local operator test database input is missing.",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafePhase6StagingError(
      "Local operator test database input is invalid.",
    );
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  const expectedHost = environment.PHASE6_TEST_DATABASE_HOST;
  const expectedPort = environment.PHASE6_TEST_DATABASE_PORT;
  const localHostRewrite =
    environment.PHASE6_TEST_DATABASE_HOST_OVERRIDE === "1" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
    url.port === "55432" &&
    expectedHost === "db" &&
    expectedPort === "5432";
  if (localHostRewrite) {
    url.hostname = expectedHost;
    url.port = expectedPort;
  }
  if (
    !url.username ||
    !url.password ||
    url.hostname !== expectedHost ||
    url.port !== expectedPort ||
    database.startsWith("ueb_core_staging") ||
    database.startsWith("ueb_core_uat")
  ) {
    throw new SafePhase6StagingError(
      "Local operator test database input is not isolated.",
    );
  }
  return url.toString();
}

async function assertLocalAdmin(client: Client): Promise<void> {
  const attributes = (
    await client.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(
      `SELECT rolsuper, rolcreatedb, rolcreaterole
       FROM pg_roles WHERE rolname = current_user`,
    )
  ).rows[0];
  if (
    !attributes ||
    (!attributes.rolsuper &&
      (!attributes.rolcreatedb || !attributes.rolcreaterole))
  ) {
    throw new SafePhase6StagingError(
      "Local operator test admin lacks disposable-resource privileges.",
    );
  }
}

async function assertResourcesAbsent(
  client: Client,
  databases: readonly string[],
  roles: readonly string[],
): Promise<void> {
  const [databaseRows, roleRows] = await Promise.all([
    client.query("SELECT datname FROM pg_database WHERE datname = ANY($1)", [
      databases,
    ]),
    client.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1)", [
      roles,
    ]),
  ]);
  if (databaseRows.rowCount !== 0 || roleRows.rowCount !== 0) {
    throw new SafePhase6StagingError(
      "Local operator disposable resources are not clean.",
    );
  }
}

async function createRole(
  client: Client,
  role: string,
  password: string,
  capabilities: string,
): Promise<void> {
  const quoted = (
    await client.query<{ role: string; password: string }>(
      "SELECT quote_ident($1) AS role, quote_literal($2) AS password",
      [role, password],
    )
  ).rows[0];
  if (!quoted) throw new SafePhase6StagingError("Local role quoting failed.");
  await client.query(
    `CREATE ROLE ${quoted.role} WITH LOGIN PASSWORD ${quoted.password} NOINHERIT NOSUPERUSER ${capabilities} NOREPLICATION NOBYPASSRLS`,
  );
}

function roleUrl(
  sourceUrl: string,
  database: string,
  role: string,
  password: string,
): string {
  const url = new URL(sourceUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

function postgresEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
}

function classifyRestoreError(stderr: string): string {
  if (/schema "public" already exists/iu.test(stderr)) return "PUBLIC_EXISTS";
  if (/cannot drop schema public/iu.test(stderr)) return "PUBLIC_DROP_BLOCKED";
  if (/permission denied/iu.test(stderr)) return "PERMISSION_DENIED";
  if (/must be member of role/iu.test(stderr)) return "ROLE_MEMBERSHIP";
  if (/role .* does not exist/iu.test(stderr)) return "ROLE_MISSING";
  if (/unrecognized configuration parameter/iu.test(stderr)) {
    return "SERVER_VERSION_MISMATCH";
  }
  return "UNCLASSIFIED";
}

async function cleanup(
  client: Client,
  databases: readonly string[],
  roles: readonly string[],
): Promise<void> {
  for (const database of databases) {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE pid <> pg_backend_pid() AND datname = $1`,
      [database],
    );
    await client.query(`DROP DATABASE IF EXISTS "${database}"`);
  }
  for (const role of roles) {
    await client.query(`DROP ROLE IF EXISTS "${role}"`);
  }
}

function fail(message: string): void {
  console.error(message);
  console.log("OPERATOR_LOCAL_EXECUTION_TEST=FAIL");
  process.exitCode = 1;
}

await main();
