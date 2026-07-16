import "dotenv/config";

import { spawn } from "node:child_process";

import { Client } from "pg";

import {
  grantAuthRuntimePermissions,
  parseAuthPermissionEnvironment,
} from "../phase-3/grant-auth-runtime-permissions";
import {
  databaseName,
  databaseUser,
  readPhase3TestDatabaseUrls,
  withDatabaseName,
} from "../phase-3/lib/test-database";

const DATABASE_NAME = "ueb_core_phase4_resubmission_query";
const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export interface ResubmissionQueryTestDatabaseUrls {
  readonly migrationUrl: string;
  readonly runtimeUrl: string;
}

export async function prepareResubmissionQueryTestDatabase(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<ResubmissionQueryTestDatabaseUrls> {
  const urls = readUrls(environment);
  const maintenance = new Client({
    connectionString: withDatabaseName(urls.migrationUrl, "postgres"),
    application_name: "ueb-core-phase4-resubmission-query-preparation",
  });
  await maintenance.connect();
  try {
    await resetDatabase(maintenance);
  } finally {
    await maintenance.end().catch(() => undefined);
  }

  try {
    await deployMigrations(urls.migrationUrl);
    await grantAuthRuntimePermissions(
      parseAuthPermissionEnvironment({
        MIGRATION_DATABASE_URL: urls.migrationUrl,
        DATABASE_URL: urls.runtimeUrl,
      }),
    );
    return urls;
  } catch (error) {
    await dropResubmissionQueryTestDatabase(urls).catch(() => undefined);
    throw error;
  }
}

export async function dropResubmissionQueryTestDatabase(
  urls: ResubmissionQueryTestDatabaseUrls,
): Promise<void> {
  assertExactDatabase(urls.migrationUrl);
  const maintenance = new Client({
    connectionString: withDatabaseName(urls.migrationUrl, "postgres"),
    application_name: "ueb-core-phase4-resubmission-query-cleanup",
  });
  await maintenance.connect();
  try {
    await terminateConnections(maintenance);
    await maintenance.query(`DROP DATABASE IF EXISTS "${DATABASE_NAME}"`);
  } finally {
    await maintenance.end().catch(() => undefined);
  }
}

function readUrls(
  environment: Readonly<Record<string, string | undefined>>,
): ResubmissionQueryTestDatabaseUrls {
  const source = readPhase3TestDatabaseUrls(environment);
  const migrationUrl = withDatabaseName(
    source.sourceMigrationUrl,
    DATABASE_NAME,
  );
  const runtimeUrl = withDatabaseName(source.sourceRuntimeUrl, DATABASE_NAME);
  assertExactDatabase(migrationUrl);
  assertExactDatabase(runtimeUrl);
  if (databaseUser(migrationUrl) === databaseUser(runtimeUrl)) {
    throw new Error("Resubmission query test roles must be different.");
  }
  return { migrationUrl, runtimeUrl };
}

function assertExactDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (
    !LOCAL_HOSTS.has(url.hostname) ||
    !url.username ||
    databaseName(databaseUrl) !== DATABASE_NAME
  ) {
    throw new Error(
      `Refusing mutation outside the exact local ${DATABASE_NAME} database.`,
    );
  }
}

async function resetDatabase(maintenance: Client): Promise<void> {
  await terminateConnections(maintenance);
  await maintenance.query(`DROP DATABASE IF EXISTS "${DATABASE_NAME}"`);
  await maintenance.query(`CREATE DATABASE "${DATABASE_NAME}"`);
}

async function terminateConnections(maintenance: Client): Promise<void> {
  await maintenance.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [DATABASE_NAME],
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
      else reject(new Error("Resubmission query migration deploy failed."));
    });
  });
}
