// @vitest-environment node

import "dotenv/config";

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  clearStaleStagingRestoreLockWithClient,
  cleanupStagingRestoreWithClient,
  createStagingRestoreDatabase,
} from "../../scripts/phase-6/lib/staging-backup";
import {
  bootstrapStagingDatabase,
  ensureRestrictedStagingOwnerRole,
  withTemporaryOwnerSetRole,
} from "../../scripts/phase-6/lib/staging-database";
import {
  STAGING_OWNER_ROLE,
  withDatabaseName,
} from "../../scripts/phase-6/lib/staging-contracts";
import { readSourceMigrationLedger } from "../../scripts/phase-6/lib/migration-ledger";

const SOURCE_MIGRATION_LEDGER = await readSourceMigrationLedger();

const DATABASE = "ueb_core_staging_test_ownership_18";
const WRONG_OWNER_DATABASE = "ueb_core_staging_test_wrong_owner_18";
const RESTORE_DATABASE = "ueb_core_staging_restore_ownership_18";
const CLEANUP_DATABASE = "ueb_core_staging_restore_cleanup_18";
const CLEANUP_WRONG_OWNER_DATABASE = "ueb_core_staging_restore_wrong_owner_18";
const CLEANUP_ACTIVE_RESTORE_DATABASE =
  "ueb_core_staging_restore_active_job_18";
const CLEANUP_ACTIVE_CONNECTION_DATABASE =
  "ueb_core_staging_restore_active_db_18";
const CLEANUP_DROP_FAILURE_DATABASE = "ueb_core_staging_restore_drop_fail_18";
const CLEANUP_REVOKE_FAILURE_DATABASE =
  "ueb_core_staging_restore_revoke_fail_18";
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
      await expect(databaseExists(DATABASE)).resolves.toBe(false);
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
      await expect(databaseExists(DATABASE)).resolves.toBe(false);
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
      migrationCount: SOURCE_MIGRATION_LEDGER.count,
      migrationLedgerFingerprint: SOURCE_MIGRATION_LEDGER.fingerprint,
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

  it("creates a restore target with the exact owner and revokes temporary SET", async () => {
    const bootstrap = await connectBootstrap();
    try {
      const report = await createStagingRestoreDatabase({
        client: bootstrap,
        bootstrapRole: BOOTSTRAP,
        targetDatabase: RESTORE_DATABASE,
      });
      expect(report).toEqual({
        databaseOwner: STAGING_OWNER_ROLE,
        restoreBootstrapCanSetOwnerRoleBeforeCreate: true,
        temporaryMembershipRevoked: true,
        restoreBootstrapCanSetOwnerRoleAfter: false,
      });
      await expect(canBootstrapSetOwner(bootstrap)).resolves.toBe(false);
      await expect(
        createStagingRestoreDatabase({
          client: bootstrap,
          bootstrapRole: BOOTSTRAP,
          targetDatabase: RESTORE_DATABASE,
        }),
      ).rejects.toBeDefined();
      await expect(canBootstrapSetOwner(bootstrap)).resolves.toBe(false);
    } finally {
      await bootstrap.end();
    }
  });

  it("clears only an exact stale lock for an absent target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ueb-core-restore-lock-"));
    const backupPath = join(directory, "staging.dump");
    const lockPath = `${backupPath}.restore-lock`;
    try {
      await writeFile(backupPath, "test-only", { mode: 0o600 });
      await writeFile(lockPath, `${RESTORE_DATABASE}\n`, { mode: 0o600 });
      await expect(
        clearStaleStagingRestoreLockWithClient({
          client: admin,
          targetDatabase: RESTORE_DATABASE,
          backupPath,
        }),
      ).rejects.toThrow("target or restore activity exists");
      await admin.query(`DROP DATABASE "${RESTORE_DATABASE}"`);
      const activeRestore = new Client({
        connectionString: withDatabaseName(sourceUrl, "postgres"),
        application_name: "ueb-core-phase6-restore-create",
      });
      await activeRestore.connect();
      try {
        await expect(
          clearStaleStagingRestoreLockWithClient({
            client: admin,
            targetDatabase: RESTORE_DATABASE,
            backupPath,
          }),
        ).rejects.toThrow("target or restore activity exists");
      } finally {
        await activeRestore.end();
      }
      await clearStaleStagingRestoreLockWithClient({
        client: admin,
        targetDatabase: RESTORE_DATABASE,
        backupPath,
      });
      await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reproduces restricted-role DROP failure for another role's database", async () => {
    await createRestoreTarget(CLEANUP_DATABASE);
    const bootstrap = await connectBootstrap();
    try {
      await expect(
        bootstrap.query(`DROP DATABASE "${CLEANUP_DATABASE}"`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(databaseExists(CLEANUP_DATABASE)).resolves.toBe(true);
    } finally {
      await bootstrap.end();
    }
  });

  it("drops an exact owned target with temporary SET ROLE and clears its lock last", async () => {
    const artifacts = await createCleanupArtifacts(CLEANUP_DATABASE);
    const bootstrap = await connectBootstrap();
    try {
      await admin.query(
        `GRANT "${STAGING_OWNER_ROLE}" TO "${BOOTSTRAP}" WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
      );
      await expect(canBootstrapSetOwner(bootstrap)).resolves.toBe(false);
      await expect(
        cleanupStagingRestoreWithClient({
          client: bootstrap,
          bootstrapRole: BOOTSTRAP,
          targetDatabase: CLEANUP_DATABASE,
          backupPath: artifacts.backupPath,
        }),
      ).resolves.toEqual({
        cleanupCanSetOwnerRoleBeforeDrop: true,
        temporaryMembershipRevoked: true,
        cleanupCanSetOwnerRoleAfter: false,
        activeRestoreProcess: false,
        activeConnectionCount: 0,
        targetExistsAfter: false,
        restoreLockCleared: true,
      });
      await expect(databaseExists(CLEANUP_DATABASE)).resolves.toBe(false);
      await expect(canBootstrapSetOwner(bootstrap)).resolves.toBe(false);
      await expect(readFile(artifacts.lockPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await bootstrap.end();
      await rm(artifacts.directory, { recursive: true, force: true });
    }
  });

  it("blocks cleanup when the restore target owner is unexpected", async () => {
    await admin.query(
      `CREATE DATABASE "${CLEANUP_WRONG_OWNER_DATABASE}" OWNER "${BOOTSTRAP}"`,
    );
    const artifacts = await createCleanupArtifacts(
      CLEANUP_WRONG_OWNER_DATABASE,
    );
    const bootstrap = await connectBootstrap();
    try {
      await expect(
        cleanupStagingRestoreWithClient({
          client: bootstrap,
          bootstrapRole: BOOTSTRAP,
          targetDatabase: CLEANUP_WRONG_OWNER_DATABASE,
          backupPath: artifacts.backupPath,
        }),
      ).rejects.toThrow("unexpected owner");
      await expect(databaseExists(CLEANUP_WRONG_OWNER_DATABASE)).resolves.toBe(
        true,
      );
      await expect(readFile(artifacts.lockPath, "utf8")).resolves.toContain(
        CLEANUP_WRONG_OWNER_DATABASE,
      );
    } finally {
      await bootstrap.end();
      await rm(artifacts.directory, { recursive: true, force: true });
    }
  });

  it("blocks cleanup while an active restore process exists", async () => {
    await createRestoreTarget(CLEANUP_ACTIVE_RESTORE_DATABASE);
    const artifacts = await createCleanupArtifacts(
      CLEANUP_ACTIVE_RESTORE_DATABASE,
    );
    const activeRestore = new Client({
      connectionString: withDatabaseName(sourceUrl, "postgres"),
      application_name: "ueb-core-phase6-restore-create",
    });
    const bootstrap = await connectBootstrap();
    try {
      await activeRestore.connect();
      await expect(
        cleanupStagingRestoreWithClient({
          client: bootstrap,
          bootstrapRole: BOOTSTRAP,
          targetDatabase: CLEANUP_ACTIVE_RESTORE_DATABASE,
          backupPath: artifacts.backupPath,
        }),
      ).rejects.toThrow("active restore work or database connections");
      await expect(
        databaseExists(CLEANUP_ACTIVE_RESTORE_DATABASE),
      ).resolves.toBe(true);
    } finally {
      await activeRestore.end().catch(() => undefined);
      await bootstrap.end();
      await rm(artifacts.directory, { recursive: true, force: true });
    }
  });

  it("blocks cleanup instead of terminating an active target connection", async () => {
    await createRestoreTarget(CLEANUP_ACTIVE_CONNECTION_DATABASE);
    const artifacts = await createCleanupArtifacts(
      CLEANUP_ACTIVE_CONNECTION_DATABASE,
    );
    const activeConnection = new Client({
      connectionString: roleUrl(
        CLEANUP_ACTIVE_CONNECTION_DATABASE,
        STAGING_OWNER_ROLE,
        OWNER_PASSWORD,
      ),
      application_name: "ueb-core-phase6-cleanup-active-connection-test",
    });
    const bootstrap = await connectBootstrap();
    try {
      await activeConnection.connect();
      await expect(
        cleanupStagingRestoreWithClient({
          client: bootstrap,
          bootstrapRole: BOOTSTRAP,
          targetDatabase: CLEANUP_ACTIVE_CONNECTION_DATABASE,
          backupPath: artifacts.backupPath,
        }),
      ).rejects.toThrow("active restore work or database connections");
      await expect(
        databaseExists(CLEANUP_ACTIVE_CONNECTION_DATABASE),
      ).resolves.toBe(true);
    } finally {
      await activeConnection.end().catch(() => undefined);
      await bootstrap.end();
      await rm(artifacts.directory, { recursive: true, force: true });
    }
  });

  it("revokes temporary membership and preserves target/lock when DROP fails", async () => {
    await createRestoreTarget(CLEANUP_DROP_FAILURE_DATABASE);
    const artifacts = await createCleanupArtifacts(
      CLEANUP_DROP_FAILURE_DATABASE,
    );
    const bootstrap = await connectBootstrap();
    const failingClient = queryInterceptClient(bootstrap, (statement) => {
      if (statement.startsWith("DROP DATABASE ")) {
        throw new Error("injected-drop-failure");
      }
    });
    try {
      await expect(
        cleanupStagingRestoreWithClient({
          client: failingClient,
          bootstrapRole: BOOTSTRAP,
          targetDatabase: CLEANUP_DROP_FAILURE_DATABASE,
          backupPath: artifacts.backupPath,
        }),
      ).rejects.toThrow("injected-drop-failure");
      await expect(canBootstrapSetOwner(bootstrap)).resolves.toBe(false);
      await expect(databaseExists(CLEANUP_DROP_FAILURE_DATABASE)).resolves.toBe(
        true,
      );
      await expect(readFile(artifacts.lockPath, "utf8")).resolves.toContain(
        CLEANUP_DROP_FAILURE_DATABASE,
      );
    } finally {
      await bootstrap.end();
      await rm(artifacts.directory, { recursive: true, force: true });
    }
  });

  it("preserves the lock and hard-fails if revoke fails after DROP", async () => {
    await createRestoreTarget(CLEANUP_REVOKE_FAILURE_DATABASE);
    const artifacts = await createCleanupArtifacts(
      CLEANUP_REVOKE_FAILURE_DATABASE,
    );
    const bootstrap = await connectBootstrap();
    let revokeCount = 0;
    const failingClient = queryInterceptClient(bootstrap, (statement) => {
      if (statement.startsWith("REVOKE ") && ++revokeCount === 2) {
        throw new Error("injected-revoke-failure");
      }
    });
    try {
      await expect(
        cleanupStagingRestoreWithClient({
          client: failingClient,
          bootstrapRole: BOOTSTRAP,
          targetDatabase: CLEANUP_REVOKE_FAILURE_DATABASE,
          backupPath: artifacts.backupPath,
        }),
      ).rejects.toThrow("owner-access residue may remain");
      await expect(
        databaseExists(CLEANUP_REVOKE_FAILURE_DATABASE),
      ).resolves.toBe(false);
      await expect(canBootstrapSetOwner(bootstrap)).resolves.toBe(true);
      await expect(readFile(artifacts.lockPath, "utf8")).resolves.toContain(
        CLEANUP_REVOKE_FAILURE_DATABASE,
      );
    } finally {
      await admin.query(
        `REVOKE "${STAGING_OWNER_ROLE}" FROM "${BOOTSTRAP}" CASCADE`,
      );
      await bootstrap.end();
      await rm(artifacts.directory, { recursive: true, force: true });
    }
  });

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

async function createRestoreTarget(database: string): Promise<void> {
  const bootstrap = await connectBootstrap();
  try {
    await createStagingRestoreDatabase({
      client: bootstrap,
      bootstrapRole: BOOTSTRAP,
      targetDatabase: database,
    });
  } finally {
    await bootstrap.end();
  }
}

async function createCleanupArtifacts(targetDatabase: string): Promise<{
  readonly directory: string;
  readonly backupPath: string;
  readonly lockPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "ueb-core-cleanup-lock-"));
  const backupPath = join(directory, "staging.dump");
  const lockPath = `${backupPath}.restore-lock`;
  await writeFile(backupPath, "test-only", { mode: 0o600 });
  await writeFile(lockPath, `${targetDatabase}\n`, { mode: 0o600 });
  return { directory, backupPath, lockPath };
}

async function databaseExists(database: string): Promise<boolean> {
  return (
    (
      await admin.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
        [database],
      )
    ).rows[0]?.exists ?? false
  );
}

function queryInterceptClient(
  client: Client,
  intercept: (statement: string) => void,
): Client {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") {
        return (statement: string, values?: readonly unknown[]) => {
          intercept(statement);
          return target.query(statement, values as never[] | undefined);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function roleUrl(database: string, role: string, password: string): string {
  const url = new URL(sourceUrl);
  url.pathname = `/${database}`;
  url.username = role;
  url.password = password;
  return url.toString();
}

async function cleanup(): Promise<void> {
  for (const database of [
    DATABASE,
    WRONG_OWNER_DATABASE,
    RESTORE_DATABASE,
    CLEANUP_DATABASE,
    CLEANUP_WRONG_OWNER_DATABASE,
    CLEANUP_ACTIVE_RESTORE_DATABASE,
    CLEANUP_ACTIVE_CONNECTION_DATABASE,
    CLEANUP_DROP_FAILURE_DATABASE,
    CLEANUP_REVOKE_FAILURE_DATABASE,
  ]) {
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
