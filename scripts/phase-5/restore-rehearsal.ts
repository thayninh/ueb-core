import "dotenv/config";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { Client, type ClientBase } from "pg";

import {
  ACCEPTANCE_DATABASE,
  assertBackupPath,
  assertMigrationRoleOwnsSource,
  DISPOSABLE_DATABASE_MARKER,
  parseRestoreCommand,
  quoteIdentifier,
  readOwnerDatabaseContext,
  SafePhase5DatabaseError,
  withDatabaseName,
} from "./lib/database-guards";
import { runDockerToolFromFile } from "./lib/postgres-tools";
import { type UatBaselineReport, verifyUatBaseline } from "./lib/uat-database";

const CATALOG_COMMAND = "exec pg_restore --list";
const RESTORE_COMMAND =
  'exec pg_restore --exit-on-error --no-owner --username "$POSTGRES_USER" --dbname "$TARGET_DATABASE"';
const REQUIRED_CATALOG_ENTRIES = [
  "TABLE DATA public ueb_core_data",
  "TABLE DATA public import_run",
  "TABLE DATA public _prisma_migrations",
] as const;

export async function runRestoreRehearsal(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly backupPath: string;
  readonly targetDatabase: string;
}): Promise<{
  readonly checksum: string;
  readonly report: UatBaselineReport;
}> {
  const context = readOwnerDatabaseContext(
    input.environment,
    ACCEPTANCE_DATABASE,
  );
  const backupPath = assertBackupPath(input.backupPath);
  const artifact = await lstat(backupPath);
  if (!artifact.isFile() || artifact.isSymbolicLink()) {
    throw new SafePhase5DatabaseError("Backup artifact is not a regular file.");
  }
  const checksum = await sha256File(backupPath);
  const recordedChecksum = (
    await readFile(`${backupPath}.sha256`, "utf8")
  ).trim();
  if (
    !/^[a-f0-9]{64}$/u.test(recordedChecksum) ||
    recordedChecksum !== checksum
  ) {
    throw new SafePhase5DatabaseError("Backup checksum validation failed.");
  }
  const catalog = (
    await runDockerToolFromFile({
      shellCommand: CATALOG_COMMAND,
      inputPath: backupPath,
      captureOutput: true,
    })
  ).toString("utf8");
  if (!REQUIRED_CATALOG_ENTRIES.every((entry) => catalog.includes(entry))) {
    throw new SafePhase5DatabaseError("Backup catalog validation failed.");
  }

  const maintenance = new Client({
    connectionString: withDatabaseName(context.migrationUrl, "postgres"),
    application_name: "ueb-core-phase5-restore-guard",
  });
  await maintenance.connect();
  try {
    await assertMigrationRoleOwnsSource(maintenance, context);
    const existing = await maintenance.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [input.targetDatabase],
    );
    if (existing.rowCount !== 0) {
      throw new SafePhase5DatabaseError(
        "Restore target already exists; cleanup must be explicit.",
      );
    }
    await maintenance.query(
      `CREATE DATABASE ${quoteIdentifier(input.targetDatabase)} OWNER ${quoteIdentifier(context.ownerUser)} TEMPLATE template0`,
    );
    await markDisposableDatabase(maintenance, input.targetDatabase);
  } finally {
    await maintenance.end().catch(() => undefined);
  }

  await runDockerToolFromFile({
    shellCommand: RESTORE_COMMAND,
    inputPath: backupPath,
    targetDatabase: input.targetDatabase,
  });

  const restored = new Client({
    connectionString: withDatabaseName(
      context.migrationUrl,
      input.targetDatabase,
    ),
    application_name: "ueb-core-phase5-post-restore-verification",
  });
  try {
    await restored.connect();
    const report = await verifyUatBaseline(restored, context.runtimeRole);
    await restored.end();

    const markerClient = new Client({
      connectionString: withDatabaseName(context.migrationUrl, "postgres"),
      application_name: "ueb-core-phase5-restore-marker",
    });
    try {
      await markerClient.connect();
      await markDisposableDatabase(markerClient, input.targetDatabase);
    } finally {
      await markerClient.end().catch(() => undefined);
    }
    return { checksum, report };
  } finally {
    await restored.end().catch(() => undefined);
  }
}

async function markDisposableDatabase(
  client: ClientBase,
  targetDatabase: string,
): Promise<void> {
  await client.query(
    `COMMENT ON DATABASE ${quoteIdentifier(targetDatabase)} IS '${DISPOSABLE_DATABASE_MARKER}'`,
  );
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function main(): Promise<void> {
  let targetGuard: "PASS" | "FAIL" = "FAIL";
  let checksumStatus: "PASS" | "FAIL" = "FAIL";
  let catalogStatus: "PASS" | "FAIL" = "FAIL";
  let restoreStatus: "PASS" | "FAIL" = "FAIL";
  try {
    const command = parseRestoreCommand(process.argv.slice(2));
    targetGuard = "PASS";
    const result = await runRestoreRehearsal({
      environment: process.env,
      backupPath: command.backupPath,
      targetDatabase: command.targetDatabase,
    });
    checksumStatus = "PASS";
    catalogStatus = "PASS";
    restoreStatus = "PASS";
    console.log(
      [
        `RESTORE_TARGET_GUARD=${targetGuard}`,
        `BACKUP_CHECKSUM=${result.checksum}`,
        `BACKUP_CHECKSUM_STATUS=${checksumStatus}`,
        `BACKUP_CATALOG_STATUS=${catalogStatus}`,
        `RESTORE_STATUS=${restoreStatus}`,
        "POST_RESTORE_VERIFY=PASS",
        `CORE_ROW_COUNT=${result.report.coreRows}`,
        `WORKFLOW_EVENT_COUNT=${result.report.workflowEvents}`,
        `IMPORT_RUN_COUNT=${result.report.importRuns}`,
        `MIGRATIONS_APPLIED=${result.report.migrationsApplied}`,
        `MIGRATIONS_PENDING=${result.report.migrationsPending}`,
        `MAX_STT=${result.report.maxStt}`,
        `NEXT_STT=${result.report.nextStt}`,
        "RLS_DEFAULT_DENY=PASS",
      ].join("\n"),
    );
  } catch {
    console.error(
      [
        `RESTORE_TARGET_GUARD=${targetGuard}`,
        `BACKUP_CHECKSUM_STATUS=${checksumStatus}`,
        `BACKUP_CATALOG_STATUS=${catalogStatus}`,
        `RESTORE_STATUS=${restoreStatus}`,
        "POST_RESTORE_VERIFY=FAIL",
      ].join("\n"),
    );
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
