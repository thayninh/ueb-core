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

const CATALOG_COMMAND = "exec pg_restore --list";
const RESTORE_COMMAND =
  'exec pg_restore --exit-on-error --no-owner --username "$POSTGRES_USER" --dbname "$TARGET_DATABASE"';
const REQUIRED_CATALOG_ENTRIES = [
  "TABLE DATA public ueb_core_data",
  "TABLE DATA public import_run",
  "TABLE DATA public _prisma_migrations",
] as const;

interface VerificationReport {
  readonly coreRows: number;
  readonly workflowEvents: number;
  readonly importRuns: number;
  readonly migrationsApplied: number;
  readonly migrationsPending: number;
  readonly maxStt: number;
  readonly nextStt: number;
}

export async function runRestoreRehearsal(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly backupPath: string;
  readonly targetDatabase: string;
}): Promise<{
  readonly checksum: string;
  readonly report: VerificationReport;
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
    const report = await verifyRestoredDatabase(restored, context.runtimeRole);
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

async function verifyRestoredDatabase(
  client: Client,
  runtimeRole: string,
): Promise<VerificationReport> {
  const counts = (
    await client.query<{
      core_rows: number;
      workflow_events: number;
      import_runs: number;
      migrations_applied: number;
      migrations_pending: number;
      max_stt: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM public.ueb_core_data) AS core_rows,
        (SELECT count(*)::integer FROM public.workflow_event) AS workflow_events,
        (SELECT count(*)::integer FROM public.import_run) AS import_runs,
        (
          SELECT count(*)::integer
          FROM public._prisma_migrations
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ) AS migrations_applied,
        (
          SELECT count(*)::integer
          FROM public._prisma_migrations
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
        ) AS migrations_pending,
        (SELECT max(stt)::integer FROM public.ueb_core_data) AS max_stt
    `)
  ).rows[0];
  if (!counts) throw new SafePhase5DatabaseError("Restore counts are missing.");

  const sequence = (
    await client.query<{
      sequence_name: string;
      increment_by: string;
    }>(`
      SELECT
        sequence_relation.relname AS sequence_name,
        sequence_definition.seqincrement::text AS increment_by
      FROM pg_class AS table_relation
      INNER JOIN pg_namespace AS table_namespace
        ON table_namespace.oid = table_relation.relnamespace
      INNER JOIN pg_attribute AS table_column
        ON table_column.attrelid = table_relation.oid
       AND table_column.attname = 'stt'
       AND table_column.attnum > 0
       AND NOT table_column.attisdropped
      INNER JOIN pg_depend AS dependency
        ON dependency.refobjid = table_relation.oid
       AND dependency.refobjsubid = table_column.attnum
       AND dependency.classid = 'pg_class'::regclass
       AND dependency.deptype IN ('a', 'i')
      INNER JOIN pg_class AS sequence_relation
        ON sequence_relation.oid = dependency.objid
       AND sequence_relation.relkind = 'S'
      INNER JOIN pg_sequence AS sequence_definition
        ON sequence_definition.seqrelid = sequence_relation.oid
      WHERE table_namespace.nspname = 'public'
        AND table_relation.relname = 'ueb_core_data'
    `)
  ).rows;
  if (sequence.length !== 1 || !sequence[0]) {
    throw new SafePhase5DatabaseError("STT sequence resolution failed.");
  }
  const state = (
    await client.query<{ last_value: string; is_called: boolean }>(
      `SELECT last_value::text, is_called FROM public.${quoteIdentifier(sequence[0].sequence_name)}`,
    )
  ).rows[0];
  if (!state)
    throw new SafePhase5DatabaseError("STT sequence state is missing.");
  const nextStt =
    Number(state.last_value) +
    (state.is_called ? Number(sequence[0].increment_by) : 0);

  await assertRlsDefaultDeny(client, runtimeRole);
  const report = {
    coreRows: counts.core_rows,
    workflowEvents: counts.workflow_events,
    importRuns: counts.import_runs,
    migrationsApplied: counts.migrations_applied,
    migrationsPending: counts.migrations_pending,
    maxStt: counts.max_stt,
    nextStt,
  };
  if (
    report.coreRows !== 2497 ||
    report.workflowEvents !== 0 ||
    report.importRuns !== 1 ||
    report.migrationsApplied !== 7 ||
    report.migrationsPending !== 0 ||
    report.maxStt !== 2569 ||
    report.nextStt !== 2570
  ) {
    throw new SafePhase5DatabaseError("Post-restore baseline mismatch.");
  }
  return report;
}

async function assertRlsDefaultDeny(
  client: ClientBase,
  runtimeRole: string,
): Promise<void> {
  const rls = await client.query<{ table_name: string; rls_enabled: boolean }>(`
    SELECT relname AS table_name, relrowsecurity AS rls_enabled
    FROM pg_class
    WHERE oid IN (
      'public.ueb_core_data'::regclass,
      'public.workflow_event'::regclass
    )
    ORDER BY relname
  `);
  if (rls.rows.length !== 2 || rls.rows.some((row) => !row.rls_enabled)) {
    throw new SafePhase5DatabaseError("RLS catalog verification failed.");
  }
  const role = (
    await client.query<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      "SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
      [runtimeRole],
    )
  ).rows[0];
  if (!role?.rolcanlogin || role.rolsuper || role.rolbypassrls) {
    throw new SafePhase5DatabaseError("Runtime role violates RLS contract.");
  }

  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(runtimeRole)}`);
    const denied = (
      await client.query<{ core_rows: number; workflow_events: number }>(`
        SELECT
          (SELECT count(*)::integer FROM public.ueb_core_data) AS core_rows,
          (SELECT count(*)::integer FROM public.workflow_event) AS workflow_events
      `)
    ).rows[0];
    if (!denied || denied.core_rows !== 0 || denied.workflow_events !== 0) {
      throw new SafePhase5DatabaseError(
        "RLS default-deny verification failed.",
      );
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
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
