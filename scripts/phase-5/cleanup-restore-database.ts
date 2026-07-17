import "dotenv/config";

import { pathToFileURL } from "node:url";

import { Client } from "pg";

import {
  ACCEPTANCE_DATABASE,
  assertMigrationRoleOwnsSource,
  DISPOSABLE_DATABASE_MARKER,
  parseCleanupCommand,
  quoteIdentifier,
  readOwnerDatabaseContext,
  SafePhase5DatabaseError,
  withDatabaseName,
} from "./lib/database-guards";

export async function cleanupRestoreDatabase(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly targetDatabase: string;
}): Promise<void> {
  const context = readOwnerDatabaseContext(
    input.environment,
    ACCEPTANCE_DATABASE,
  );
  const maintenance = new Client({
    connectionString: withDatabaseName(context.migrationUrl, "postgres"),
    application_name: "ueb-core-phase5-restore-cleanup",
  });
  try {
    await maintenance.connect();
    await assertMigrationRoleOwnsSource(maintenance, context);
    const target = (
      await maintenance.query<{ marker: string | null }>(
        `
          SELECT shobj_description(oid, 'pg_database') AS marker
          FROM pg_database
          WHERE datname = $1
        `,
        [input.targetDatabase],
      )
    ).rows[0];
    if (!target || target.marker !== DISPOSABLE_DATABASE_MARKER) {
      throw new SafePhase5DatabaseError(
        "Cleanup target is missing its disposable marker.",
      );
    }
    await maintenance.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [input.targetDatabase],
    );
    await maintenance.query(
      `DROP DATABASE ${quoteIdentifier(input.targetDatabase)}`,
    );
  } finally {
    await maintenance.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  let targetGuard: "PASS" | "FAIL" = "FAIL";
  try {
    const command = parseCleanupCommand(process.argv.slice(2));
    targetGuard = "PASS";
    await cleanupRestoreDatabase({
      environment: process.env,
      targetDatabase: command.targetDatabase,
    });
    console.log(`CLEANUP_TARGET_GUARD=${targetGuard}\nCLEANUP_STATUS=PASS`);
  } catch {
    console.error(`CLEANUP_TARGET_GUARD=${targetGuard}\nCLEANUP_STATUS=FAIL`);
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
