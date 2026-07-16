// @vitest-environment node

import "dotenv/config";

import { spawn } from "node:child_process";

import { Client, type ClientBase } from "pg";
import { describe, expect, it } from "vitest";

import {
  assertExactPhase4TestDatabase,
  PHASE4_REHEARSAL_DATABASE,
  readPhase4TestDatabaseUrls,
} from "../../scripts/phase-4/lib/test-database";
import { withDatabaseName } from "../../scripts/phase-3/lib/test-database";

const RUNTIME_ROLE = process.env.APP_DATABASE_USER ?? "";
const ROLE_IDENTIFIER = `"${RUNTIME_ROLE}"`;
const integrationEnabled =
  process.env.PHASE4_RUNTIME_PERMISSION_INTEGRATION === "1";
const isolatedDescribe = integrationEnabled
  ? describe.sequential
  : describe.skip;

interface DatabaseFingerprint {
  readonly core_rows: number;
  readonly workflow_rows: number;
  readonly sequence_last_value: string;
  readonly sequence_is_called: boolean;
}

interface PermissionSnapshot {
  readonly core_select: boolean;
  readonly core_insert: boolean;
  readonly core_update: boolean;
  readonly core_delete: boolean;
  readonly core_truncate: boolean;
  readonly core_references: boolean;
  readonly core_trigger: boolean;
  readonly workflow_select: boolean;
  readonly workflow_insert: boolean;
  readonly workflow_update: boolean;
  readonly workflow_delete: boolean;
  readonly workflow_truncate: boolean;
  readonly workflow_references: boolean;
  readonly workflow_trigger: boolean;
  readonly sequence_usage: boolean;
  readonly sequence_select: boolean;
  readonly sequence_update: boolean;
  readonly role_superuser: boolean;
  readonly role_bypassrls: boolean;
  readonly owns_core: boolean;
  readonly owns_workflow: boolean;
  readonly owns_sequence: boolean;
}

isolatedDescribe(
  "Phase 4 runtime permission reconciliation on an isolated database",
  () => {
    it("reconciles twice without data, sequence, or RLS changes", async () => {
      const urls = readPhase4TestDatabaseUrls(process.env);
      assertExactPhase4TestDatabase(urls.migrationUrl);
      if (!/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/u.test(RUNTIME_ROLE)) {
        throw new Error("APP_DATABASE_USER is invalid for rehearsal.");
      }
      const maintenance = new Client({
        connectionString: withDatabaseName(urls.migrationUrl, "postgres"),
        application_name: "ueb-core-phase4-runtime-permission-maintenance",
      });
      let owner: Client | undefined;
      await maintenance.connect();
      try {
        await resetIsolatedDatabase(maintenance);
        await deployMigrations(urls.migrationUrl);
        owner = new Client({
          connectionString: urls.migrationUrl,
          application_name: "ueb-core-phase4-runtime-permission-test",
        });
        await owner.connect();
        await grantBaseRuntimeAccess(owner);
        await activelyBlockPhase4Writes(owner);

        const before = await readFingerprint(owner);
        const blocked = await readPermissions(owner);
        expect(blocked).toMatchObject({
          core_select: true,
          core_insert: false,
          workflow_select: true,
          workflow_insert: true,
          sequence_usage: false,
        });

        const first = await runReconciliationCommand(urls.migrationUrl);
        const afterFirst = await readPermissions(owner);
        expect(first).toEqual({
          TARGET_DATABASE: PHASE4_REHEARSAL_DATABASE,
          RUNTIME_ROLE_PRESENT: "YES",
          RUNTIME_NON_SUPERUSER: "YES",
          RUNTIME_NOBYPASSRLS: "YES",
          RUNTIME_NON_OWNER: "YES",
          CORE_SELECT: "YES",
          CORE_INSERT: "YES",
          CORE_UPDATE: "NO",
          CORE_DELETE: "NO",
          CORE_TRUNCATE: "NO",
          WORKFLOW_SELECT: "YES",
          WORKFLOW_INSERT: "YES",
          WORKFLOW_UPDATE: "NO",
          WORKFLOW_DELETE: "NO",
          WORKFLOW_TRUNCATE: "NO",
          SEQUENCE_NAME: "public.ueb_core_data_stt_seq",
          SEQUENCE_USAGE: "YES",
          SEQUENCE_SELECT: "NO",
          SEQUENCE_UPDATE: "NO",
          PERMISSION_RECONCILIATION: "PASS",
        });
        expect(afterFirst).toEqual({
          core_select: true,
          core_insert: true,
          core_update: false,
          core_delete: false,
          core_truncate: false,
          core_references: false,
          core_trigger: false,
          workflow_select: true,
          workflow_insert: true,
          workflow_update: false,
          workflow_delete: false,
          workflow_truncate: false,
          workflow_references: false,
          workflow_trigger: false,
          sequence_usage: true,
          sequence_select: false,
          sequence_update: false,
          role_superuser: false,
          role_bypassrls: false,
          owns_core: false,
          owns_workflow: false,
          owns_sequence: false,
        });

        const second = await runReconciliationCommand(urls.migrationUrl);
        expect(second).toEqual(first);
        expect(await readPermissions(owner)).toEqual(afterFirst);
        expect(await readNoContextVisibility(owner)).toEqual({
          core_rows: 0,
          workflow_rows: 0,
        });
        expect(await readFingerprint(owner)).toEqual(before);
      } finally {
        await owner?.end().catch(() => undefined);
        await cleanupIsolatedDatabase(maintenance).catch(() => undefined);
        await maintenance.end().catch(() => undefined);
      }
    }, 120_000);
  },
);

async function resetIsolatedDatabase(maintenance: Client): Promise<void> {
  await terminateDatabaseConnections(maintenance);
  await maintenance.query(
    `DROP DATABASE IF EXISTS "${PHASE4_REHEARSAL_DATABASE}"`,
  );
  await maintenance.query(`CREATE DATABASE "${PHASE4_REHEARSAL_DATABASE}"`);
}

async function cleanupIsolatedDatabase(maintenance: Client): Promise<void> {
  await terminateDatabaseConnections(maintenance);
  await maintenance.query(
    `DROP DATABASE IF EXISTS "${PHASE4_REHEARSAL_DATABASE}"`,
  );
}

async function terminateDatabaseConnections(
  maintenance: Client,
): Promise<void> {
  await maintenance.query(
    `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname = $1
    `,
    [PHASE4_REHEARSAL_DATABASE],
  );
}

function deployMigrations(migrationUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("./node_modules/.bin/prisma", ["migrate", "deploy"], {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATION_DATABASE_URL: migrationUrl },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Isolated Phase 4 migration deploy failed."));
    });
  });
}

function runReconciliationCommand(
  migrationUrl: string,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "phase4:grant-runtime-permissions",
        "--",
        "--confirm-runtime-grants",
        `--expected-database=${PHASE4_REHEARSAL_DATABASE}`,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: migrationUrl,
          APP_DATABASE_USER: RUNTIME_ROLE,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let standardOutput = "";
    let standardError = "";
    child.stdout.on("data", (chunk: Buffer) => {
      standardOutput += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      standardError += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Runtime permission command failed safely: ${standardError}`,
          ),
        );
        return;
      }
      resolve(parseMachineOutput(standardOutput));
    });
  });
}

function parseMachineOutput(output: string): Record<string, string> {
  return Object.fromEntries(
    output
      .split("\n")
      .filter((line) => /^[A-Z][A-Z0-9_]*=/u.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

async function grantBaseRuntimeAccess(owner: ClientBase): Promise<void> {
  await owner.query(
    `GRANT CONNECT ON DATABASE "${PHASE4_REHEARSAL_DATABASE}" TO ${ROLE_IDENTIFIER}`,
  );
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${ROLE_IDENTIFIER}`);
  await owner.query(
    `GRANT SELECT ON TABLE public.ueb_core_data TO ${ROLE_IDENTIFIER}`,
  );
  await owner.query(
    `GRANT SELECT, INSERT ON TABLE public.workflow_event TO ${ROLE_IDENTIFIER}`,
  );
  await owner.query(
    `GRANT SELECT ON TABLE public.access_profile, public.role_assignment, public.organization_unit, public.unit_scope_assignment TO ${ROLE_IDENTIFIER}`,
  );
}

async function activelyBlockPhase4Writes(owner: ClientBase): Promise<void> {
  await owner.query(
    `REVOKE INSERT ON TABLE public.ueb_core_data FROM ${ROLE_IDENTIFIER}`,
  );
  await owner.query(
    `REVOKE USAGE ON SEQUENCE public.ueb_core_data_stt_seq FROM ${ROLE_IDENTIFIER}`,
  );
}

async function readFingerprint(
  owner: ClientBase,
): Promise<DatabaseFingerprint> {
  const result = await owner.query<DatabaseFingerprint>(`
    SELECT
      (SELECT count(*)::int FROM public.ueb_core_data) AS core_rows,
      (SELECT count(*)::int FROM public.workflow_event) AS workflow_rows,
      sequence.last_value::bigint::text AS sequence_last_value,
      sequence.is_called AS sequence_is_called
    FROM public.ueb_core_data_stt_seq AS sequence
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Could not fingerprint isolated database.");
  return row;
}

async function readPermissions(owner: ClientBase): Promise<PermissionSnapshot> {
  const result = await owner.query<PermissionSnapshot>(
    `
      SELECT
        has_table_privilege($1, 'public.ueb_core_data', 'SELECT') AS core_select,
        has_table_privilege($1, 'public.ueb_core_data', 'INSERT') AS core_insert,
        has_table_privilege($1, 'public.ueb_core_data', 'UPDATE') AS core_update,
        has_table_privilege($1, 'public.ueb_core_data', 'DELETE') AS core_delete,
        has_table_privilege($1, 'public.ueb_core_data', 'TRUNCATE') AS core_truncate,
        has_table_privilege($1, 'public.ueb_core_data', 'REFERENCES') AS core_references,
        has_table_privilege($1, 'public.ueb_core_data', 'TRIGGER') AS core_trigger,
        has_table_privilege($1, 'public.workflow_event', 'SELECT') AS workflow_select,
        has_table_privilege($1, 'public.workflow_event', 'INSERT') AS workflow_insert,
        has_table_privilege($1, 'public.workflow_event', 'UPDATE') AS workflow_update,
        has_table_privilege($1, 'public.workflow_event', 'DELETE') AS workflow_delete,
        has_table_privilege($1, 'public.workflow_event', 'TRUNCATE') AS workflow_truncate,
        has_table_privilege($1, 'public.workflow_event', 'REFERENCES') AS workflow_references,
        has_table_privilege($1, 'public.workflow_event', 'TRIGGER') AS workflow_trigger,
        has_sequence_privilege($1, 'public.ueb_core_data_stt_seq', 'USAGE') AS sequence_usage,
        has_sequence_privilege($1, 'public.ueb_core_data_stt_seq', 'SELECT') AS sequence_select,
        has_sequence_privilege($1, 'public.ueb_core_data_stt_seq', 'UPDATE') AS sequence_update,
        role.rolsuper AS role_superuser,
        role.rolbypassrls AS role_bypassrls,
        core.relowner = role.oid AS owns_core,
        workflow.relowner = role.oid AS owns_workflow,
        sequence.relowner = role.oid AS owns_sequence
      FROM pg_roles AS role
      CROSS JOIN pg_class AS core
      CROSS JOIN pg_class AS workflow
      CROSS JOIN pg_class AS sequence
      WHERE role.rolname = $1
        AND core.oid = 'public.ueb_core_data'::regclass
        AND workflow.oid = 'public.workflow_event'::regclass
        AND sequence.oid = 'public.ueb_core_data_stt_seq'::regclass
    `,
    [RUNTIME_ROLE],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Could not inspect isolated runtime privileges.");
  return row;
}

async function readNoContextVisibility(
  owner: Client,
): Promise<{ core_rows: number; workflow_rows: number }> {
  await owner.query("BEGIN READ ONLY");
  try {
    await owner.query(`SET LOCAL ROLE ${ROLE_IDENTIFIER}`);
    const result = await owner.query<{
      core_rows: number;
      workflow_rows: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.ueb_core_data) AS core_rows,
        (SELECT count(*)::int FROM public.workflow_event) AS workflow_rows
    `);
    await owner.query("COMMIT");
    const row = result.rows[0];
    if (!row) throw new Error("Could not verify isolated RLS visibility.");
    return row;
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
