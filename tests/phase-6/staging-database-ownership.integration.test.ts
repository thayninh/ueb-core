// @vitest-environment node

import "dotenv/config";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bootstrapStagingDatabase,
  ensureRestrictedStagingOwnerRole,
  withTemporaryOwnerSetRole,
} from "../../scripts/phase-6/lib/staging-database";
import {
  STAGING_MIGRATION_COUNT,
  STAGING_OWNER_ROLE,
  withDatabaseName,
} from "../../scripts/phase-6/lib/staging-contracts";

const DATABASE = "ueb_core_staging_test_ownership_18";
const WRONG_OWNER_DATABASE = "ueb_core_staging_test_wrong_owner_18";
const BOOTSTRAP = "ueb_core_phase6_ownership_bootstrap_18";
const BOOTSTRAP_PASSWORD = "phase6-bootstrap-pg18-integration-credential";
const OWNER_PASSWORD = "phase6-owner-pg18-integration-credential";
const enabled = process.env.PHASE6_STAGING_INTEGRATION === "1";
const isolatedDescribe = enabled ? describe.sequential : describe.skip;

let admin: Client;
let sourceUrl: string;

isolatedDescribe("PostgreSQL 18 staging database ownership", () => {
  beforeAll(async () => {
    sourceUrl = readIsolatedSourceUrl();
    admin = new Client({
      connectionString: withDatabaseName(sourceUrl, "postgres"),
      application_name: "ueb-core-phase6-pg18-ownership-admin",
    });
    await admin.connect();
    const version = (
      await admin.query<{ version: number }>(
        "SELECT current_setting('server_version_num')::integer AS version",
      )
    ).rows[0]?.version;
    if (!version || version < 180000) {
      throw new Error(
        "PostgreSQL 18 or newer is required for this regression.",
      );
    }
    await cleanup();
    await createBootstrapRole();
  });

  afterAll(async () => {
    if (admin) {
      await cleanup().catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  it("reproduces CREATE DATABASE OWNER failure without SET ROLE", async () => {
    const bootstrap = await connectBootstrap();
    try {
      await ensureRestrictedStagingOwnerRole(bootstrap, OWNER_PASSWORD);
      await bootstrap.query(
        `REVOKE "${STAGING_OWNER_ROLE}" FROM "${BOOTSTRAP}"`,
      );
      await expect(
        bootstrap.query(
          `CREATE DATABASE "${DATABASE}" OWNER "${STAGING_OWNER_ROLE}"`,
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await bootstrap.end();
    }
  });

  it("revokes temporary SET membership when the protected operation fails", async () => {
    const bootstrap = await connectBootstrap();
    try {
      await expect(
        withTemporaryOwnerSetRole({
          client: bootstrap,
          bootstrapRole: BOOTSTRAP,
          ownerRole: STAGING_OWNER_ROLE,
          operation: async () => {
            throw new Error("injected-create-failure");
          },
        }),
      ).rejects.toThrow("injected-create-failure");
      await expect(canBootstrapSetOwner(bootstrap)).resolves.toBe(false);
    } finally {
      await bootstrap.end();
    }
  });

  it("creates the database with the exact owner, revokes SET and then migrates", async () => {
    const databaseUrl = roleUrl(DATABASE, BOOTSTRAP, BOOTSTRAP_PASSWORD);
    const ownerUrl = roleUrl(DATABASE, STAGING_OWNER_ROLE, OWNER_PASSWORD);
    const report = await bootstrapStagingDatabase({
      environment: {
        PHASE6_STAGING_INTEGRATION: "1",
        PHASE6_TEST_DATABASE_HOST: new URL(sourceUrl).hostname,
        PHASE6_TEST_DATABASE_PORT: new URL(sourceUrl).port,
        STAGING_AUTHORIZED_BOOTSTRAP_ROLE: BOOTSTRAP,
        STAGING_MIGRATION_OWNER_PASSWORD: OWNER_PASSWORD,
        STAGING_BOOTSTRAP_DATABASE_URL: databaseUrl,
        MIGRATION_DATABASE_URL: ownerUrl,
      },
      expectedDatabase: DATABASE,
      allowTest: true,
    });
    expect(report).toEqual({
      migrationCount: STAGING_MIGRATION_COUNT,
      databaseOwner: STAGING_OWNER_ROLE,
      bootstrapCanSetOwnerRoleBeforeCreate: true,
      temporaryMembershipRevoked: true,
      bootstrapCanSetOwnerRoleAfter: false,
    });
    const owner = (
      await admin.query<{ owner: string }>(
        `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1`,
        [DATABASE],
      )
    ).rows[0]?.owner;
    expect(owner).toBe(STAGING_OWNER_ROLE);
    const bootstrap = await connectBootstrap();
    try {
      await expect(canBootstrapSetOwner(bootstrap)).resolves.toBe(false);
    } finally {
      await bootstrap.end();
    }
  }, 120_000);

  it("fails safely when an existing target has the wrong owner", async () => {
    await admin.query(
      `CREATE DATABASE "${WRONG_OWNER_DATABASE}" OWNER "${BOOTSTRAP}"`,
    );
    await expect(
      bootstrapStagingDatabase({
        environment: {
          PHASE6_STAGING_INTEGRATION: "1",
          PHASE6_TEST_DATABASE_HOST: new URL(sourceUrl).hostname,
          PHASE6_TEST_DATABASE_PORT: new URL(sourceUrl).port,
          STAGING_AUTHORIZED_BOOTSTRAP_ROLE: BOOTSTRAP,
          STAGING_MIGRATION_OWNER_PASSWORD: OWNER_PASSWORD,
          STAGING_BOOTSTRAP_DATABASE_URL: roleUrl(
            WRONG_OWNER_DATABASE,
            BOOTSTRAP,
            BOOTSTRAP_PASSWORD,
          ),
          MIGRATION_DATABASE_URL: roleUrl(
            WRONG_OWNER_DATABASE,
            STAGING_OWNER_ROLE,
            OWNER_PASSWORD,
          ),
        },
        expectedDatabase: WRONG_OWNER_DATABASE,
        allowTest: true,
      }),
    ).rejects.toThrow("bootstrap refuses existing databases");
  });
});

function readIsolatedSourceUrl(): string {
  const value = process.env.MIGRATION_DATABASE_URL;
  if (!value) throw new Error("Local integration database URL is missing.");
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    url.port !== "55432" ||
    database.startsWith("ueb_core_staging") ||
    database.startsWith("ueb_core_uat")
  ) {
    throw new Error(
      "Phase 6 ownership regression requires the isolated endpoint.",
    );
  }
  return url.toString();
}

async function createBootstrapRole(): Promise<void> {
  const quoted = (
    await admin.query<{ role: string; password: string }>(
      "SELECT quote_ident($1) AS role, quote_literal($2) AS password",
      [BOOTSTRAP, BOOTSTRAP_PASSWORD],
    )
  ).rows[0]!;
  await admin.query(
    `CREATE ROLE ${quoted.role} WITH LOGIN PASSWORD ${quoted.password} NOINHERIT NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
}

async function connectBootstrap(): Promise<Client> {
  const client = new Client({
    connectionString: withDatabaseName(
      roleUrl(DATABASE, BOOTSTRAP, BOOTSTRAP_PASSWORD),
      "postgres",
    ),
    application_name: "ueb-core-phase6-pg18-ownership-bootstrap",
  });
  await client.connect();
  return client;
}

async function canBootstrapSetOwner(client: Client): Promise<boolean> {
  return (
    (
      await client.query<{ can_set: boolean }>(
        "SELECT pg_has_role($1, $2, 'SET') AS can_set",
        [BOOTSTRAP, STAGING_OWNER_ROLE],
      )
    ).rows[0]?.can_set ?? false
  );
}

function roleUrl(database: string, role: string, password: string): string {
  const url = new URL(sourceUrl);
  url.pathname = `/${database}`;
  url.username = role;
  url.password = password;
  return url.toString();
}

async function cleanup(): Promise<void> {
  for (const database of [DATABASE, WRONG_OWNER_DATABASE]) {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE pid <> pg_backend_pid() AND datname = $1`,
      [database],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
  }
  await admin.query(`DROP ROLE IF EXISTS "${STAGING_OWNER_ROLE}"`);
  await admin.query(`DROP ROLE IF EXISTS "${BOOTSTRAP}"`);
}
