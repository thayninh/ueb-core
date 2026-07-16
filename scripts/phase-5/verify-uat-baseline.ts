import "dotenv/config";

import { pathToFileURL } from "node:url";

import { Client } from "pg";

import {
  assertMigrationRoleOwnsSource,
  parseUatTargetCommand,
  readUatOwnerDatabaseContext,
} from "./lib/database-guards";
import { verifyUatBaseline } from "./lib/uat-database";

export async function runUatBaselineVerification(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly targetDatabase: string;
}) {
  const context = readUatOwnerDatabaseContext(
    input.environment,
    input.targetDatabase,
  );
  const client = new Client({
    connectionString: context.migrationUrl,
    application_name: "ueb-core-phase5-uat-baseline",
  });
  try {
    await client.connect();
    await assertMigrationRoleOwnsSource(client, context);
    return await verifyUatBaseline(client, context.runtimeRole);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  try {
    const command = parseUatTargetCommand(process.argv.slice(2));
    const report = await runUatBaselineVerification({
      environment: process.env,
      targetDatabase: command.targetDatabase,
    });
    console.log(
      [
        `TARGET_DATABASE=${command.targetDatabase}`,
        `CORE_ROW_COUNT=${report.coreRows}`,
        `WORKFLOW_EVENT_COUNT=${report.workflowEvents}`,
        `IMPORT_RUN_COUNT=${report.importRuns}`,
        `MIGRATIONS_APPLIED=${report.migrationsApplied}`,
        `MIGRATIONS_PENDING=${report.migrationsPending}`,
        `MAX_STT=${report.maxStt}`,
        `NEXT_STT=${report.nextStt}`,
        `AUTH_USER_COUNT=${report.authUsers}`,
        `ACTIVE_SESSION_COUNT=${report.activeSessions}`,
        "RUNTIME_ROLE_SEPARATION=PASS",
        "RUNTIME_NONSUPERUSER=PASS",
        "RUNTIME_NOBYPASSRLS=PASS",
        "RUNTIME_NO_CONTEXT_VISIBILITY=0",
        "RUNTIME_PHASE4_ACL=PASS",
        "DATABASE_WRITES=0",
        "BASELINE_VERIFY=PASS",
      ].join("\n"),
    );
  } catch {
    console.error("DATABASE_WRITES=0\nBASELINE_VERIFY=FAIL");
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
