import "dotenv/config";

import { spawn } from "node:child_process";

import { Client } from "pg";

import {
  grantAuthRuntimePermissions,
  parseAuthPermissionEnvironment,
} from "../phase-3/grant-auth-runtime-permissions";
import { withDatabaseName } from "../phase-3/lib/test-database";
import {
  assertExactPhase4TestDatabase,
  PHASE4_REHEARSAL_DATABASE,
  readPhase4TestDatabaseUrls,
  type Phase4TestDatabaseUrls,
} from "./lib/test-database";

export async function preparePhase4LatestReadModelTestDatabase(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<Phase4TestDatabaseUrls> {
  const urls = readPhase4TestDatabaseUrls(environment);
  const maintenance = new Client({
    connectionString: withDatabaseName(urls.migrationUrl, "postgres"),
    application_name: "ueb-core-phase4-read-model-test-preparation",
  });

  await maintenance.connect();
  try {
    await resetDatabase(maintenance, urls.migrationUrl);
  } finally {
    await maintenance.end().catch(() => undefined);
  }

  await deployMigrations(urls.migrationUrl);
  await grantAuthRuntimePermissions(
    parseAuthPermissionEnvironment({
      MIGRATION_DATABASE_URL: urls.migrationUrl,
      DATABASE_URL: urls.runtimeUrl,
    }),
  );
  return urls;
}

export async function dropPhase4LatestReadModelTestDatabase(
  urls: Phase4TestDatabaseUrls,
): Promise<void> {
  assertExactPhase4TestDatabase(urls.migrationUrl);
  const maintenance = new Client({
    connectionString: withDatabaseName(urls.migrationUrl, "postgres"),
    application_name: "ueb-core-phase4-read-model-test-cleanup",
  });
  await maintenance.connect();
  try {
    await maintenance.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [PHASE4_REHEARSAL_DATABASE],
    );
    await maintenance.query(
      `DROP DATABASE IF EXISTS "${PHASE4_REHEARSAL_DATABASE}"`,
    );
  } finally {
    await maintenance.end().catch(() => undefined);
  }
}

async function resetDatabase(
  maintenance: Client,
  databaseUrl: string,
): Promise<void> {
  assertExactPhase4TestDatabase(databaseUrl);
  await maintenance.query(
    `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()
    `,
    [PHASE4_REHEARSAL_DATABASE],
  );
  await maintenance.query(
    `DROP DATABASE IF EXISTS "${PHASE4_REHEARSAL_DATABASE}"`,
  );
  await maintenance.query(`CREATE DATABASE "${PHASE4_REHEARSAL_DATABASE}"`);
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
      else reject(new Error(`prisma migrate deploy exited with ${code}.`));
    });
  });
}
