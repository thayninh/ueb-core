import "dotenv/config";

import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { Client } from "pg";

import {
  grantAuthRuntimePermissions,
  parseAuthPermissionEnvironment,
} from "./grant-auth-runtime-permissions";
import {
  assertExactPhase3TestDatabase,
  PHASE3_E2E_DATABASE,
  PHASE3_REHEARSAL_DATABASE,
  readPhase3TestDatabaseUrls,
  withDatabaseName,
} from "./lib/test-database";
import { parsePhase3FixtureEnvironment } from "./lib/test-fixtures";

const CONFIRMATION_FLAG = "--confirm-full-phase3-rehearsal";
const EXPECTED_CORE_ROWS = 2_497;
const REHEARSAL_APP_URL = "http://127.0.0.1:3104";

type SourceContract = {
  source_filename: string;
  source_sha256: string;
  sheet_name: string;
};

type Fingerprint = {
  row_count: number;
  import_run_count: number;
  minimum_checksum: string | null;
  maximum_checksum: string | null;
};

export async function runFullPhase3Rehearsal(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const urls = readPhase3TestDatabaseUrls(environment);
  const fixture = parsePhase3FixtureEnvironment(environment);
  const contract = JSON.parse(
    await readFile("config/phase-2/source-contract.json", "utf8"),
  ) as SourceContract;
  const sourcePath = `data/input/${contract.source_filename}`;
  const source = new Client({
    connectionString: urls.sourceMigrationUrl,
    application_name: "ueb-core-full-rehearsal-source-read-only",
  });
  const maintenance = new Client({
    connectionString: withDatabaseName(urls.sourceMigrationUrl, "postgres"),
    application_name: "ueb-core-full-rehearsal-maintenance",
  });
  let rehearsalCreated = false;

  await source.connect();
  await maintenance.connect();
  try {
    await source.query("BEGIN READ ONLY");
    const acceptanceBefore = await readFingerprint(source);
    assertAcceptanceFingerprint(acceptanceBefore);

    await resetDatabase(
      maintenance,
      urls.rehearsalMigrationUrl,
      PHASE3_REHEARSAL_DATABASE,
    );
    rehearsalCreated = true;
    await buildDatabaseFromSource({
      migrationUrl: urls.rehearsalMigrationUrl,
      runtimeUrl: urls.rehearsalRuntimeUrl,
      sourcePath,
      contract,
    });

    await bootstrapRehearsalAdmin(urls, fixture.PHASE3_FIXTURE_PASSWORD);
    await runCommand("./node_modules/.bin/vitest", ["run"], process.env);
    await runCommand(
      "./node_modules/.bin/vitest",
      ["run", "tests/phase-3/core-read-rls.integration.test.ts"],
      {
        ...process.env,
        PHASE3_ISOLATED_INTEGRATION: "1",
      },
    );

    await resetDatabase(maintenance, urls.e2eMigrationUrl, PHASE3_E2E_DATABASE);
    await buildDatabaseFromSource({
      migrationUrl: urls.e2eMigrationUrl,
      runtimeUrl: urls.e2eRuntimeUrl,
      sourcePath,
      contract,
    });
    await runCommand(
      "./node_modules/.bin/playwright",
      ["test", "--config=playwright.phase-3.config.ts"],
      process.env,
    );

    await assertHealthAndReady(urls.rehearsalRuntimeUrl);
    const acceptanceAfter = await readFingerprint(source);
    if (JSON.stringify(acceptanceAfter) !== JSON.stringify(acceptanceBefore)) {
      throw new Error(
        "Acceptance database fingerprint changed during rehearsal.",
      );
    }
    await source.query("COMMIT");

    console.log(
      JSON.stringify({
        status: "SUCCESS",
        rehearsalDatabase: PHASE3_REHEARSAL_DATABASE,
        e2eDatabase: PHASE3_E2E_DATABASE,
        importedRowsPerDatabase: EXPECTED_CORE_ROWS,
        acceptanceMode: "READ_ONLY",
        health: "PASS",
        ready: "PASS",
      }),
    );
  } catch (error) {
    await source.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    let dropFailure: unknown;
    if (rehearsalCreated) {
      try {
        await dropDatabase(
          maintenance,
          urls.rehearsalMigrationUrl,
          PHASE3_REHEARSAL_DATABASE,
        );
      } catch (error) {
        dropFailure = error;
      }
    }
    await maintenance.end().catch(() => undefined);
    await source.end().catch(() => undefined);
    if (dropFailure) throw dropFailure;
  }
}

async function buildDatabaseFromSource(input: {
  migrationUrl: string;
  runtimeUrl: string;
  sourcePath: string;
  contract: SourceContract;
}): Promise<void> {
  await runCommand("./node_modules/.bin/prisma", ["migrate", "deploy"], {
    ...process.env,
    MIGRATION_DATABASE_URL: input.migrationUrl,
  });
  await runCommand(
    "./node_modules/.bin/tsx",
    [
      "scripts/phase-2/import-source.ts",
      "--file",
      input.sourcePath,
      "--sheet",
      input.contract.sheet_name,
      "--confirm-sha",
      input.contract.source_sha256,
    ],
    { ...process.env, MIGRATION_DATABASE_URL: input.migrationUrl },
  );
  await runCommand(
    "./node_modules/.bin/tsx",
    ["scripts/phase-3/seed-organization-units.ts"],
    {
      ...process.env,
      MIGRATION_DATABASE_URL: input.migrationUrl,
      DATABASE_URL: input.runtimeUrl,
    },
  );
  await grantAuthRuntimePermissions(
    parseAuthPermissionEnvironment({
      MIGRATION_DATABASE_URL: input.migrationUrl,
      DATABASE_URL: input.runtimeUrl,
    }),
  );
  await assertImportedDatabase(input.migrationUrl);
}

async function bootstrapRehearsalAdmin(
  urls: ReturnType<typeof readPhase3TestDatabaseUrls>,
  password: string,
): Promise<void> {
  await runCommand(
    "./node_modules/.bin/tsx",
    ["scripts/phase-3/bootstrap-admin.ts", "--confirm-local-bootstrap"],
    {
      ...process.env,
      MIGRATION_DATABASE_URL: urls.rehearsalMigrationUrl,
      DATABASE_URL: urls.rehearsalRuntimeUrl,
      BOOTSTRAP_ADMIN_EMAIL: "phase3-bootstrap@localhost.test",
      BOOTSTRAP_ADMIN_PASSWORD: password,
      BOOTSTRAP_ADMIN_NAME: "Phase 3 Bootstrap Administrator",
    },
  );
}

async function assertHealthAndReady(runtimeUrl: string): Promise<void> {
  const server = spawn("./node_modules/.bin/next", ["dev", "--port", "3104"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: runtimeUrl,
      BETTER_AUTH_URL: REHEARSAL_APP_URL,
      AUTH_TRUSTED_ORIGINS: REHEARSAL_APP_URL,
    },
    stdio: "inherit",
  });
  try {
    await waitForEndpoint(`${REHEARSAL_APP_URL}/api/health`);
    const health = await fetch(`${REHEARSAL_APP_URL}/api/health`);
    const ready = await fetch(`${REHEARSAL_APP_URL}/api/ready`);
    if (health.status !== 200 || ready.status !== 200) {
      throw new Error("Health or readiness endpoint did not return HTTP 200.");
    }
  } finally {
    await stopChild(server);
  }
}

async function waitForEndpoint(url: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the rehearsal application server.");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function assertImportedDatabase(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{
      core_count: number;
      import_run_count: number;
      unit_count: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.ueb_core_data) AS core_count,
        (SELECT count(*)::int FROM public.import_run) AS import_run_count,
        (SELECT count(*)::int FROM public.organization_unit) AS unit_count
    `);
    const row = result.rows[0];
    if (
      row?.core_count !== EXPECTED_CORE_ROWS ||
      row.import_run_count !== 1 ||
      row.unit_count <= 0
    ) {
      throw new Error("Rehearsal import or organization-unit seed mismatch.");
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function readFingerprint(client: Client): Promise<Fingerprint> {
  const result = await client.query<Fingerprint>(`
    SELECT
      (SELECT count(*)::int FROM public.ueb_core_data) AS row_count,
      (SELECT count(*)::int FROM public.import_run) AS import_run_count,
      (SELECT min(source_row_checksum) FROM public.ueb_core_data) AS minimum_checksum,
      (SELECT max(source_row_checksum) FROM public.ueb_core_data) AS maximum_checksum
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Could not fingerprint acceptance database.");
  return row;
}

function assertAcceptanceFingerprint(fingerprint: Fingerprint): void {
  if (
    fingerprint.row_count !== EXPECTED_CORE_ROWS ||
    fingerprint.import_run_count !== 1
  ) {
    throw new Error("Acceptance database does not match the Phase 2 baseline.");
  }
}

async function resetDatabase(
  maintenance: Client,
  databaseUrl: string,
  databaseName: typeof PHASE3_REHEARSAL_DATABASE | typeof PHASE3_E2E_DATABASE,
): Promise<void> {
  assertExactPhase3TestDatabase(databaseUrl, databaseName);
  await terminateDatabaseConnections(maintenance, databaseName);
  await maintenance.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await maintenance.query(`CREATE DATABASE "${databaseName}"`);
}

async function dropDatabase(
  maintenance: Client,
  databaseUrl: string,
  databaseName: typeof PHASE3_REHEARSAL_DATABASE,
): Promise<void> {
  assertExactPhase3TestDatabase(databaseUrl, databaseName);
  await terminateDatabaseConnections(maintenance, databaseName);
  await maintenance.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
}

async function terminateDatabaseConnections(
  maintenance: Client,
  databaseName: string,
): Promise<void> {
  await maintenance.query(
    `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()
    `,
    [databaseName],
  );
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
  await runFullPhase3Rehearsal(process.env);
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
            : "Full Phase 3 rehearsal failed safely.",
      }),
    );
    process.exitCode = 1;
  });
}
