import "dotenv/config";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { Client } from "pg";

import {
  grantAuthRuntimePermissions,
  parseAuthPermissionEnvironment,
} from "./grant-auth-runtime-permissions";
import { createOrganizationUnitKey } from "../../src/lib/auth/provisioning-policy";
import {
  assertExactPhase3TestDatabase,
  PHASE3_E2E_DATABASE,
  PHASE3_REHEARSAL_DATABASE,
  readPhase3TestDatabaseUrls,
  withDatabaseName,
} from "./lib/test-database";

const CONFIRMATION_FLAG = "--confirm-reset-phase3-test-databases";
const EXPECTED_CORE_ROW_COUNT = 2_497;
const COPY_TABLES = ["import_run", "ueb_core_data", "workflow_event"] as const;

type SourceFingerprint = {
  row_count: number;
  minimum_stt: string | null;
  maximum_stt: string | null;
  minimum_checksum: string | null;
  maximum_checksum: string | null;
};

export async function preparePhase3TestDatabases(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const urls = readPhase3TestDatabaseUrls(environment);
  const source = new Client({
    connectionString: urls.sourceMigrationUrl,
    application_name: "ueb-core-phase3-test-source-read-only",
  });
  const maintenance = new Client({
    connectionString: withDatabaseName(urls.sourceMigrationUrl, "postgres"),
    application_name: "ueb-core-phase3-test-database-preparation",
  });

  await source.connect();
  await maintenance.connect();
  try {
    await source.query("BEGIN READ ONLY");
    const sourceBefore = await readSourceFingerprint(source);
    if (sourceBefore.row_count !== EXPECTED_CORE_ROW_COUNT) {
      throw new Error(
        `Phase 3 test preparation requires exactly ${EXPECTED_CORE_ROW_COUNT} source rows.`,
      );
    }

    await resetTestDatabase(
      maintenance,
      urls.rehearsalMigrationUrl,
      PHASE3_REHEARSAL_DATABASE,
    );
    await resetTestDatabase(
      maintenance,
      urls.e2eMigrationUrl,
      PHASE3_E2E_DATABASE,
    );

    for (const target of [
      {
        name: PHASE3_REHEARSAL_DATABASE,
        migrationUrl: urls.rehearsalMigrationUrl,
        runtimeUrl: urls.rehearsalRuntimeUrl,
      },
      {
        name: PHASE3_E2E_DATABASE,
        migrationUrl: urls.e2eMigrationUrl,
        runtimeUrl: urls.e2eRuntimeUrl,
      },
    ] as const) {
      await deployMigrations(target.migrationUrl);
      await cloneCoreData(source, target.migrationUrl);
      await seedOrganizationUnits(target.migrationUrl);
      await grantAuthRuntimePermissions(
        parseAuthPermissionEnvironment({
          MIGRATION_DATABASE_URL: target.migrationUrl,
          DATABASE_URL: target.runtimeUrl,
        }),
      );
      await assertTargetRowCount(target.migrationUrl);
    }

    const sourceAfter = await readSourceFingerprint(source);
    if (JSON.stringify(sourceAfter) !== JSON.stringify(sourceBefore)) {
      throw new Error(
        "The acceptance source fingerprint changed unexpectedly.",
      );
    }
    await source.query("COMMIT");

    console.log(
      JSON.stringify({
        status: "SUCCESS",
        databases: [PHASE3_REHEARSAL_DATABASE, PHASE3_E2E_DATABASE],
        coreRowCount: EXPECTED_CORE_ROW_COUNT,
        sourceMode: "READ_ONLY_TRANSACTION",
      }),
    );
  } catch (error) {
    await source.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await maintenance.end().catch(() => undefined);
    await source.end().catch(() => undefined);
  }
}

async function resetTestDatabase(
  maintenance: Client,
  databaseUrl: string,
  databaseName: typeof PHASE3_REHEARSAL_DATABASE | typeof PHASE3_E2E_DATABASE,
): Promise<void> {
  assertExactPhase3TestDatabase(databaseUrl, databaseName);
  await maintenance.query(
    `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()
    `,
    [databaseName],
  );
  await maintenance.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await maintenance.query(`CREATE DATABASE "${databaseName}"`);
}

async function deployMigrations(migrationUrl: string): Promise<void> {
  await runCommand("./node_modules/.bin/prisma", ["migrate", "deploy"], {
    ...process.env,
    MIGRATION_DATABASE_URL: migrationUrl,
  });
}

async function cloneCoreData(source: Client, targetUrl: string): Promise<void> {
  const target = new Client({
    connectionString: targetUrl,
    application_name: "ueb-core-phase3-test-data-clone",
  });
  await target.connect();
  try {
    await target.query("BEGIN");
    for (const table of COPY_TABLES) {
      const rows = await source.query<{ row: Record<string, unknown> }>(
        `SELECT row_to_json(source_row) AS row FROM public."${table}" AS source_row`,
      );
      if (rows.rows.length === 0) continue;
      const overriding =
        table === "ueb_core_data" ? " OVERRIDING SYSTEM VALUE" : "";
      await target.query(
        `
          INSERT INTO public."${table}"${overriding}
          SELECT *
          FROM jsonb_populate_recordset(
            NULL::public."${table}",
            $1::jsonb
          )
        `,
        [JSON.stringify(rows.rows.map(({ row }) => row))],
      );
    }
    await target.query(`
      SELECT setval(
        'public.ueb_core_data_stt_seq',
        (SELECT max(stt) FROM public.ueb_core_data),
        true
      )
    `);
    await target.query("COMMIT");
  } catch (error) {
    await target.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await target.end().catch(() => undefined);
  }
}

async function seedOrganizationUnits(targetUrl: string): Promise<void> {
  const target = new Client({ connectionString: targetUrl });
  await target.connect();
  try {
    const units = await target.query<{ approval_unit: string }>(`
      SELECT DISTINCT approval_unit
      FROM public.ueb_core_data
      WHERE approval_unit IS NOT NULL
      ORDER BY approval_unit
    `);
    await target.query("BEGIN");
    for (const { approval_unit: sourceValue } of units.rows) {
      await target.query(
        `
          INSERT INTO public.organization_unit
            (id, unit_key, source_value, display_name)
          VALUES ($1::uuid, $2, $3, $3)
          ON CONFLICT (source_value) DO NOTHING
        `,
        [randomUUID(), createOrganizationUnitKey(sourceValue), sourceValue],
      );
    }
    await target.query("COMMIT");
  } catch (error) {
    await target.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await target.end().catch(() => undefined);
  }
}

async function assertTargetRowCount(targetUrl: string): Promise<void> {
  const target = new Client({ connectionString: targetUrl });
  await target.connect();
  try {
    const result = await target.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.ueb_core_data",
    );
    if (result.rows[0]?.count !== EXPECTED_CORE_ROW_COUNT) {
      throw new Error("Phase 3 test database clone row count mismatch.");
    }
  } finally {
    await target.end().catch(() => undefined);
  }
}

async function readSourceFingerprint(
  source: Client,
): Promise<SourceFingerprint> {
  const result = await source.query<SourceFingerprint>(`
    SELECT
      count(*)::int AS row_count,
      min(stt)::text AS minimum_stt,
      max(stt)::text AS maximum_stt,
      min(source_row_checksum) AS minimum_checksum,
      max(source_row_checksum) AS maximum_checksum
    FROM public.ueb_core_data
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Could not fingerprint acceptance source data.");
  return row;
}

function runCommand(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function main(): Promise<void> {
  if (!process.argv.includes(CONFIRMATION_FLAG)) {
    throw new Error(`Explicit confirmation is required: ${CONFIRMATION_FLAG}`);
  }
  await preparePhase3TestDatabases(process.env);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main().catch((error) => {
    console.error(
      JSON.stringify({
        status: "ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Phase 3 test database preparation failed safely.",
      }),
    );
    process.exitCode = 1;
  });
}
