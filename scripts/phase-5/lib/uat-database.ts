import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";

import type { ClientBase } from "pg";

import {
  assertExternalUatBackupPath,
  quoteIdentifier,
  SafePhase5DatabaseError,
} from "./database-guards";

export const ACCEPTED_UAT_BACKUP_CHECKSUM =
  "db79596e75ad234ffc514ab97fed66d40ced4a7ad06aa62caf5d374ac2d5d9b8";

export const REQUIRED_UAT_CATALOG_ENTRIES = [
  "TABLE DATA public ueb_core_data",
  "TABLE DATA public import_run",
  "TABLE DATA public _prisma_migrations",
] as const;

export interface UatBaselineReport {
  readonly coreRows: number;
  readonly workflowEvents: number;
  readonly importRuns: number;
  readonly migrationsApplied: number;
  readonly migrationsPending: number;
  readonly maxStt: number;
  readonly nextStt: number;
  readonly authUsers: number;
  readonly activeSessions: number;
}

export interface CanonicalFingerprint {
  readonly databaseName: string;
  readonly coreRows: number;
  readonly workflowEvents: number;
  readonly importRuns: number;
  readonly migrationsApplied: number;
  readonly migrationsPending: number;
  readonly maxStt: number;
  readonly sequenceLastValue: number;
  readonly sequenceIsCalled: boolean;
  readonly sha256: string;
}

interface SequenceIdentity {
  readonly sequence_name: string;
  readonly increment_by: string;
}

interface SequenceState {
  readonly last_value: string;
  readonly is_called: boolean;
}

export async function validateUatBackupArtifact(
  backupPath: string,
  cwd = process.cwd(),
): Promise<{ readonly backupPath: string; readonly checksum: string }> {
  const guardedPath = assertExternalUatBackupPath(backupPath, cwd);
  const artifact = await lstat(guardedPath).catch(() => undefined);
  if (!artifact?.isFile() || artifact.isSymbolicLink()) {
    throw new SafePhase5DatabaseError(
      "UAT backup artifact is missing or is not a regular file.",
    );
  }
  const resolvedPath = await realpath(guardedPath);
  assertExternalUatBackupPath(resolvedPath, cwd);

  const checksumPath = `${guardedPath}.sha256`;
  const checksumArtifact = await lstat(checksumPath).catch(() => undefined);
  if (!checksumArtifact?.isFile() || checksumArtifact.isSymbolicLink()) {
    throw new SafePhase5DatabaseError(
      "UAT backup checksum sidecar is missing or unsafe.",
    );
  }
  const checksum = await sha256File(guardedPath);
  const recordedChecksum = (await readFile(checksumPath, "utf8")).trim();
  if (
    !/^[a-f0-9]{64}$/u.test(recordedChecksum) ||
    recordedChecksum !== checksum ||
    checksum !== ACCEPTED_UAT_BACKUP_CHECKSUM
  ) {
    throw new SafePhase5DatabaseError(
      "UAT backup checksum does not match the accepted artifact.",
    );
  }
  return { backupPath: guardedPath, checksum };
}

export function assertUatCatalog(catalog: string): void {
  if (!REQUIRED_UAT_CATALOG_ENTRIES.every((entry) => catalog.includes(entry))) {
    throw new SafePhase5DatabaseError("UAT backup catalog validation failed.");
  }
}

export function assertUatTargetDoesNotExist(targetExists: boolean): void {
  if (targetExists) {
    throw new SafePhase5DatabaseError(
      "UAT target already exists; cleanup must be explicit.",
    );
  }
}

export async function verifyUatBaseline(
  client: ClientBase,
  runtimeRole: string,
): Promise<UatBaselineReport> {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    const report = await readBaselineReport(client);
    assertExpectedBaseline(report);
    await assertUatRuntimeContract(client, runtimeRole);
    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export function assertExpectedBaseline(report: UatBaselineReport): void {
  if (
    report.coreRows !== 2497 ||
    report.workflowEvents !== 0 ||
    report.importRuns !== 1 ||
    report.migrationsApplied !== 7 ||
    report.migrationsPending !== 0 ||
    report.maxStt !== 2569 ||
    report.nextStt !== 2570
  ) {
    throw new SafePhase5DatabaseError("UAT baseline verification failed.");
  }
}

export async function readCanonicalFingerprint(
  client: ClientBase,
): Promise<CanonicalFingerprint> {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    const counts = (
      await client.query<{
        database_name: string;
        core_rows: number;
        workflow_events: number;
        import_runs: number;
        migrations_applied: number;
        migrations_pending: number;
        max_stt: number;
      }>(`
        SELECT
          current_database() AS database_name,
          (SELECT count(*)::integer FROM public.ueb_core_data) AS core_rows,
          (SELECT count(*)::integer FROM public.workflow_event) AS workflow_events,
          (SELECT count(*)::integer FROM public.import_run) AS import_runs,
          (
            SELECT count(*)::integer FROM public._prisma_migrations
            WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
          ) AS migrations_applied,
          (
            SELECT count(*)::integer FROM public._prisma_migrations
            WHERE finished_at IS NULL AND rolled_back_at IS NULL
          ) AS migrations_pending,
          (SELECT max(stt)::integer FROM public.ueb_core_data) AS max_stt
      `)
    ).rows[0];
    if (!counts) {
      throw new SafePhase5DatabaseError(
        "Canonical fingerprint metadata is missing.",
      );
    }
    const sequence = await readSequence(client);
    const state = await readSequenceState(client, sequence.sequence_name);
    const metadata = {
      databaseName: counts.database_name,
      coreRows: counts.core_rows,
      workflowEvents: counts.workflow_events,
      importRuns: counts.import_runs,
      migrationsApplied: counts.migrations_applied,
      migrationsPending: counts.migrations_pending,
      maxStt: counts.max_stt,
      sequenceLastValue: Number(state.last_value),
      sequenceIsCalled: state.is_called,
    };
    const fingerprint = {
      ...metadata,
      sha256: createHash("sha256")
        .update(JSON.stringify(metadata))
        .digest("hex"),
    };
    await client.query("COMMIT");
    return fingerprint;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export function assertCanonicalFingerprintsMatch(
  before: CanonicalFingerprint,
  after: CanonicalFingerprint,
): void {
  if (
    before.databaseName !== "ueb_core" ||
    after.databaseName !== "ueb_core" ||
    before.sha256 !== after.sha256
  ) {
    throw new SafePhase5DatabaseError(
      "Canonical database fingerprint changed during UAT bootstrap.",
    );
  }
}

export function resolveSingleActiveAdmin(
  candidates: readonly { readonly user_id: string }[],
): string {
  const candidate = candidates[0];
  if (
    candidates.length !== 1 ||
    !candidate ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      candidate.user_id,
    )
  ) {
    throw new SafePhase5DatabaseError(
      "UAT must contain exactly one active ADMIN candidate.",
    );
  }
  return candidate.user_id;
}

async function readBaselineReport(
  client: ClientBase,
): Promise<UatBaselineReport> {
  const counts = (
    await client.query<{
      core_rows: number;
      workflow_events: number;
      import_runs: number;
      migrations_applied: number;
      migrations_pending: number;
      max_stt: number;
      auth_users: number;
      active_sessions: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM public.ueb_core_data) AS core_rows,
        (SELECT count(*)::integer FROM public.workflow_event) AS workflow_events,
        (SELECT count(*)::integer FROM public.import_run) AS import_runs,
        (
          SELECT count(*)::integer FROM public._prisma_migrations
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ) AS migrations_applied,
        (
          SELECT count(*)::integer FROM public._prisma_migrations
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
        ) AS migrations_pending,
        (SELECT max(stt)::integer FROM public.ueb_core_data) AS max_stt,
        (SELECT count(*)::integer FROM public.auth_user) AS auth_users,
        (
          SELECT count(*)::integer FROM public.auth_session
          WHERE expires_at > clock_timestamp()
        ) AS active_sessions
    `)
  ).rows[0];
  if (!counts) {
    throw new SafePhase5DatabaseError("UAT baseline counts are missing.");
  }
  const sequence = await readSequence(client);
  const state = await readSequenceState(client, sequence.sequence_name);
  return {
    coreRows: counts.core_rows,
    workflowEvents: counts.workflow_events,
    importRuns: counts.import_runs,
    migrationsApplied: counts.migrations_applied,
    migrationsPending: counts.migrations_pending,
    maxStt: counts.max_stt,
    nextStt:
      Number(state.last_value) +
      (state.is_called ? Number(sequence.increment_by) : 0),
    authUsers: counts.auth_users,
    activeSessions: counts.active_sessions,
  };
}

async function readSequence(client: ClientBase): Promise<SequenceIdentity> {
  const rows = (
    await client.query<SequenceIdentity>(`
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
  if (rows.length !== 1 || !rows[0]) {
    throw new SafePhase5DatabaseError("STT sequence resolution failed.");
  }
  return rows[0];
}

async function readSequenceState(
  client: ClientBase,
  sequenceName: string,
): Promise<SequenceState> {
  const state = (
    await client.query<SequenceState>(
      `SELECT last_value::text, is_called FROM public.${quoteIdentifier(sequenceName)}`,
    )
  ).rows[0];
  if (!state) {
    throw new SafePhase5DatabaseError("STT sequence state is missing.");
  }
  return state;
}

async function assertUatRuntimeContract(
  client: ClientBase,
  runtimeRole: string,
): Promise<void> {
  const context = (
    await client.query<{
      current_user: string;
      database_owner: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `
      SELECT
        current_user,
        pg_get_userbyid(database_row.datdba) AS database_owner,
        role_row.rolcanlogin,
        role_row.rolsuper,
        role_row.rolbypassrls
      FROM pg_database AS database_row
      INNER JOIN pg_roles AS role_row ON role_row.rolname = $1
      WHERE database_row.datname = current_database()
    `,
      [runtimeRole],
    )
  ).rows[0];
  if (
    !context ||
    context.current_user !== context.database_owner ||
    runtimeRole === context.current_user ||
    !context.rolcanlogin ||
    context.rolsuper ||
    context.rolbypassrls
  ) {
    throw new SafePhase5DatabaseError("UAT runtime role contract failed.");
  }

  const privileges = (
    await client.query<{
      table_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
      can_references: boolean;
      can_trigger: boolean;
    }>(
      `
      SELECT
        table_name,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'SELECT') AS can_select,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'INSERT') AS can_insert,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'UPDATE') AS can_update,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'DELETE') AS can_delete,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'TRUNCATE') AS can_truncate,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'REFERENCES') AS can_references,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'TRIGGER') AS can_trigger
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($2::text[])
      ORDER BY table_name
    `,
      [runtimeRole, ["ueb_core_data", "workflow_event"]],
    )
  ).rows;
  if (
    privileges.length !== 2 ||
    privileges.some(
      (row) =>
        !row.can_select ||
        !row.can_insert ||
        row.can_update ||
        row.can_delete ||
        row.can_truncate ||
        row.can_references ||
        row.can_trigger,
    )
  ) {
    throw new SafePhase5DatabaseError("UAT runtime table ACL failed.");
  }

  const sequence = await readSequence(client);
  const sequencePrivileges = (
    await client.query<{
      can_use: boolean;
      can_select: boolean;
      can_update: boolean;
    }>(
      `
      SELECT
        has_sequence_privilege($1, format('public.%I', $2), 'USAGE') AS can_use,
        has_sequence_privilege($1, format('public.%I', $2), 'SELECT') AS can_select,
        has_sequence_privilege($1, format('public.%I', $2), 'UPDATE') AS can_update
    `,
      [runtimeRole, sequence.sequence_name],
    )
  ).rows[0];
  if (
    !sequencePrivileges?.can_use ||
    sequencePrivileges.can_select ||
    sequencePrivileges.can_update
  ) {
    throw new SafePhase5DatabaseError("UAT runtime sequence ACL failed.");
  }

  const rls = (
    await client.query<{ rls_enabled: boolean }>(`
      SELECT relrowsecurity AS rls_enabled
      FROM pg_class
      WHERE oid IN ('public.ueb_core_data'::regclass, 'public.workflow_event'::regclass)
    `)
  ).rows;
  if (rls.length !== 2 || rls.some((row) => !row.rls_enabled)) {
    throw new SafePhase5DatabaseError("UAT RLS catalog verification failed.");
  }
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
      "UAT RLS default-deny verification failed.",
    );
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
