import "dotenv/config";

import { pathToFileURL } from "node:url";

import { Client } from "pg";

import {
  assertMigrationRoleOwnsSource,
  parseRevokeUatSessionsCommand,
  readUatOwnerDatabaseContext,
  SafePhase5DatabaseError,
} from "./lib/database-guards";

export async function revokeCopiedUatSessions(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly targetDatabase: string;
}): Promise<{ readonly revokedCount: number; readonly activeSessionCount: 0 }> {
  const context = readUatOwnerDatabaseContext(
    input.environment,
    input.targetDatabase,
  );
  const client = new Client({
    connectionString: context.migrationUrl,
    application_name: "ueb-core-phase5-revoke-copied-uat-sessions",
  });
  let transactionStarted = false;
  try {
    await client.connect();
    await assertMigrationRoleOwnsSource(client, context);
    await client.query("BEGIN");
    transactionStarted = true;
    const deleted = await client.query("DELETE FROM public.auth_session");
    const remaining = (
      await client.query<{ row_count: number }>(
        "SELECT count(*)::integer AS row_count FROM public.auth_session",
      )
    ).rows[0]?.row_count;
    if (remaining !== 0) {
      throw new SafePhase5DatabaseError(
        "Copied UAT sessions were not fully revoked.",
      );
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return { revokedCount: deleted.rowCount ?? 0, activeSessionCount: 0 };
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  try {
    const command = parseRevokeUatSessionsCommand(process.argv.slice(2));
    const report = await revokeCopiedUatSessions({
      environment: process.env,
      targetDatabase: command.targetDatabase,
    });
    console.log(
      [
        `TARGET_DATABASE=${command.targetDatabase}`,
        `SESSION_REVOKED_COUNT=${report.revokedCount}`,
        `ACTIVE_SESSION_COUNT=${report.activeSessionCount}`,
        "SESSION_REVOKE_STATUS=PASS",
      ].join("\n"),
    );
  } catch {
    console.error("SESSION_REVOKE_STATUS=FAIL");
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
