import "dotenv/config";

import { pathToFileURL } from "node:url";

import { Client } from "pg";

import {
  assertMigrationRoleOwnsSource,
  parseCanonicalFingerprintCommand,
  readOwnerDatabaseContext,
} from "./lib/database-guards";
import { readCanonicalFingerprint } from "./lib/uat-database";

export async function fingerprintCanonicalDatabase(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const context = readOwnerDatabaseContext(environment);
  const client = new Client({
    connectionString: context.migrationUrl,
    application_name: "ueb-core-phase5-canonical-fingerprint",
  });
  try {
    await client.connect();
    await assertMigrationRoleOwnsSource(client, context);
    return await readCanonicalFingerprint(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  try {
    parseCanonicalFingerprintCommand(process.argv.slice(2));
    const report = await fingerprintCanonicalDatabase(process.env);
    console.log(
      [
        `DATABASE_NAME=${report.databaseName}`,
        `CORE_ROW_COUNT=${report.coreRows}`,
        `WORKFLOW_EVENT_COUNT=${report.workflowEvents}`,
        `IMPORT_RUN_COUNT=${report.importRuns}`,
        `MIGRATIONS_APPLIED=${report.migrationsApplied}`,
        `MIGRATIONS_PENDING=${report.migrationsPending}`,
        `MAX_STT=${report.maxStt}`,
        `SEQUENCE_LAST_VALUE=${report.sequenceLastValue}`,
        `SEQUENCE_IS_CALLED=${report.sequenceIsCalled ? "YES" : "NO"}`,
        `DATABASE_FINGERPRINT=${report.sha256}`,
        "DATABASE_WRITES=0",
      ].join("\n"),
    );
  } catch {
    console.error("DATABASE_FINGERPRINT=FAIL\nDATABASE_WRITES=0");
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
