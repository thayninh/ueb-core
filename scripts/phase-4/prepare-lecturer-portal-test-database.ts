import "dotenv/config";

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { Client } from "pg";

import {
  grantAuthRuntimePermissions,
  parseAuthPermissionEnvironment,
} from "../phase-3/grant-auth-runtime-permissions";
import { withDatabaseName } from "../phase-3/lib/test-database";
import {
  assertExactPhase4LecturerPortalDatabase,
  PHASE4_LECTURER_PORTAL_DATABASE,
  readPhase4LecturerPortalDatabaseUrls,
  type Phase4LecturerPortalDatabaseUrls,
} from "./lib/lecturer-portal-test-database";

export async function preparePhase4LecturerPortalTestDatabase(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<Phase4LecturerPortalDatabaseUrls> {
  const urls = readPhase4LecturerPortalDatabaseUrls(environment);
  const maintenance = new Client({
    connectionString: withDatabaseName(urls.migrationUrl, "postgres"),
    application_name: "ueb-core-phase4-lecturer-portal-test-preparation",
  });
  await maintenance.connect();
  try {
    await dropConnectionsAndDatabase(maintenance);
    await maintenance.query(
      'CREATE DATABASE "' + PHASE4_LECTURER_PORTAL_DATABASE + '"',
    );
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
    await dropPhase4LecturerPortalTestDatabase(urls).catch(() => undefined);
    throw error;
  }
}

export async function dropPhase4LecturerPortalTestDatabase(
  urls: Phase4LecturerPortalDatabaseUrls,
): Promise<void> {
  assertExactPhase4LecturerPortalDatabase(urls.migrationUrl);
  const maintenance = new Client({
    connectionString: withDatabaseName(urls.migrationUrl, "postgres"),
    application_name: "ueb-core-phase4-lecturer-portal-test-cleanup",
  });
  await maintenance.connect();
  try {
    await dropConnectionsAndDatabase(maintenance);
  } finally {
    await maintenance.end().catch(() => undefined);
  }
}

async function dropConnectionsAndDatabase(maintenance: Client): Promise<void> {
  await maintenance.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [PHASE4_LECTURER_PORTAL_DATABASE],
  );
  await maintenance.query(
    'DROP DATABASE IF EXISTS "' + PHASE4_LECTURER_PORTAL_DATABASE + '"',
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
      else reject(new Error("prisma migrate deploy failed for isolated DB."));
    });
  });
}

async function main(): Promise<void> {
  if (!process.argv.includes("--confirm-reset-phase4-lecturer-portal")) {
    throw new Error(
      "Explicit --confirm-reset-phase4-lecturer-portal is required.",
    );
  }
  await preparePhase4LecturerPortalTestDatabase(process.env);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Phase 4 lecturer portal database preparation failed safely.",
    );
    process.exitCode = 1;
  });
}
