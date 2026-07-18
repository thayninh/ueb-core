import "dotenv/config";

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { Client } from "pg";

import { withDatabaseName } from "../phase-3/lib/test-database";

const SHADOW_DATABASE = "ueb_core_phase7_migration_diff";
const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

async function run(): Promise<void> {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required.");
  const parsed = new URL(migrationUrl);
  if (
    !LOCAL_HOSTS.has(parsed.hostname) ||
    !["postgres:", "postgresql:"].includes(parsed.protocol)
  ) {
    throw new Error("Migration diff is restricted to local PostgreSQL.");
  }

  const maintenance = new Client({
    connectionString: withDatabaseName(migrationUrl, "postgres"),
    application_name: "ueb-core-phase7-migration-diff-setup",
  });
  await maintenance.connect();
  try {
    await dropShadowDatabase(maintenance);
    await maintenance.query(`CREATE DATABASE "${SHADOW_DATABASE}"`);
    await runPrismaDiff(withDatabaseName(migrationUrl, SHADOW_DATABASE));
  } finally {
    await dropShadowDatabase(maintenance).catch(() => undefined);
    await maintenance.end().catch(() => undefined);
  }
}

async function dropShadowDatabase(client: Client): Promise<void> {
  await client.query(
    `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1
        AND pid <> pg_backend_pid()
    `,
    [SHADOW_DATABASE],
  );
  await client.query(`DROP DATABASE IF EXISTS "${SHADOW_DATABASE}"`);
}

function runPrismaDiff(shadowDatabaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "./node_modules/.bin/prisma",
      [
        "migrate",
        "diff",
        "--from-migrations",
        "prisma/migrations",
        "--to-schema",
        "prisma/schema.prisma",
        "--script",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, SHADOW_DATABASE_URL: shadowDatabaseUrl },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Prisma migration diff failed."));
    });
  });
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await run().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Migration diff failed safely.",
    );
    process.exitCode = 1;
  });
}
