import "dotenv/config";

import { pathToFileURL } from "node:url";

import { Client } from "pg";

import {
  ACCEPTANCE_DATABASE,
  assertMigrationRoleOwnsSource,
  assertUatDatabase,
  parseBootstrapUatCommand,
  quoteIdentifier,
  readOwnerDatabaseContext,
  SafePhase5DatabaseError,
  UAT_DATABASE_MARKER,
  withDatabaseName,
} from "./lib/database-guards";
import { runDockerToolFromFile } from "./lib/postgres-tools";
import {
  assertCanonicalFingerprintsMatch,
  assertUatCatalog,
  assertUatTargetDoesNotExist,
  readCanonicalFingerprint,
  validateUatBackupArtifact,
  verifyUatBaseline,
} from "./lib/uat-database";

const CATALOG_COMMAND = "exec pg_restore --list";
const RESTORE_COMMAND =
  'exec pg_restore --exit-on-error --no-owner --username "$POSTGRES_USER" --dbname "$TARGET_DATABASE"';

export async function bootstrapUatDatabase(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly backupPath: string;
  readonly targetDatabase: string;
  readonly expectedSourceDatabase: string;
}) {
  assertUatDatabase(input.targetDatabase);
  if (input.expectedSourceDatabase !== ACCEPTANCE_DATABASE) {
    throw new SafePhase5DatabaseError(
      "UAT bootstrap source must be the canonical acceptance database.",
    );
  }
  const context = readOwnerDatabaseContext(
    input.environment,
    input.expectedSourceDatabase,
  );
  const artifact = await validateUatBackupArtifact(input.backupPath);
  const catalog = (
    await runDockerToolFromFile({
      shellCommand: CATALOG_COMMAND,
      inputPath: artifact.backupPath,
      captureOutput: true,
    })
  ).toString("utf8");
  assertUatCatalog(catalog);

  const canonical = new Client({
    connectionString: context.migrationUrl,
    application_name: "ueb-core-phase5-uat-canonical-fingerprint",
  });
  const maintenance = new Client({
    connectionString: withDatabaseName(context.migrationUrl, "postgres"),
    application_name: "ueb-core-phase5-uat-bootstrap-guard",
  });
  await canonical.connect();
  try {
    await assertMigrationRoleOwnsSource(canonical, context);
    const fingerprintBefore = await readCanonicalFingerprint(canonical);

    await maintenance.connect();
    try {
      await assertMigrationRoleOwnsSource(maintenance, context);
      const existing = await maintenance.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [input.targetDatabase],
      );
      assertUatTargetDoesNotExist(existing.rowCount !== 0);
      await maintenance.query(
        `CREATE DATABASE ${quoteIdentifier(input.targetDatabase)} OWNER ${quoteIdentifier(context.ownerUser)} TEMPLATE template0`,
      );
      await maintenance.query(
        `COMMENT ON DATABASE ${quoteIdentifier(input.targetDatabase)} IS '${UAT_DATABASE_MARKER}'`,
      );
    } finally {
      await maintenance.end().catch(() => undefined);
    }

    await runDockerToolFromFile({
      shellCommand: RESTORE_COMMAND,
      inputPath: artifact.backupPath,
      targetDatabase: input.targetDatabase,
    });

    const restored = new Client({
      connectionString: withDatabaseName(
        context.migrationUrl,
        input.targetDatabase,
      ),
      application_name: "ueb-core-phase5-uat-post-restore-verification",
    });
    try {
      await restored.connect();
      const report = await verifyUatBaseline(restored, context.runtimeRole);
      const fingerprintAfter = await readCanonicalFingerprint(canonical);
      assertCanonicalFingerprintsMatch(fingerprintBefore, fingerprintAfter);
      return {
        checksum: artifact.checksum,
        report,
        fingerprintBefore: fingerprintBefore.sha256,
        fingerprintAfter: fingerprintAfter.sha256,
      };
    } finally {
      await restored.end().catch(() => undefined);
    }
  } finally {
    await canonical.end().catch(() => undefined);
    await maintenance.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  try {
    const command = parseBootstrapUatCommand(process.argv.slice(2));
    const result = await bootstrapUatDatabase({
      environment: process.env,
      ...command,
    });
    console.log(
      [
        "UAT_BOOTSTRAP_GUARD=PASS",
        `TARGET_DATABASE=${command.targetDatabase}`,
        `BACKUP_CHECKSUM=${result.checksum}`,
        "BACKUP_CHECKSUM_STATUS=PASS",
        "BACKUP_CATALOG_STATUS=PASS",
        "RESTORE_STATUS=PASS",
        "POST_RESTORE_VERIFY=PASS",
        `CORE_ROW_COUNT=${result.report.coreRows}`,
        `WORKFLOW_EVENT_COUNT=${result.report.workflowEvents}`,
        `IMPORT_RUN_COUNT=${result.report.importRuns}`,
        `MIGRATIONS_APPLIED=${result.report.migrationsApplied}`,
        `MIGRATIONS_PENDING=${result.report.migrationsPending}`,
        `MAX_STT=${result.report.maxStt}`,
        `NEXT_STT=${result.report.nextStt}`,
        `AUTH_USER_COUNT=${result.report.authUsers}`,
        `ACTIVE_SESSION_COUNT=${result.report.activeSessions}`,
        `CANONICAL_FINGERPRINT_BEFORE=${result.fingerprintBefore}`,
        `CANONICAL_FINGERPRINT_AFTER=${result.fingerprintAfter}`,
        "CANONICAL_DATABASE_MUTATIONS=0",
        "CANONICAL_PROTECTION=PASS",
      ].join("\n"),
    );
  } catch (error) {
    console.error(
      [
        "UAT_BOOTSTRAP_GUARD=FAIL",
        "RESTORE_STATUS=FAIL",
        "POST_RESTORE_VERIFY=FAIL",
        "CANONICAL_PROTECTION=FAIL",
        `ERROR=${
          error instanceof SafePhase5DatabaseError
            ? error.message
            : "UAT bootstrap failed safely."
        }`,
      ].join("\n"),
    );
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
