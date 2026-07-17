import "dotenv/config";

import { pathToFileURL } from "node:url";

import { Client } from "pg";

import {
  assertMigrationRoleOwnsSource,
  parseUatTargetCommand,
  readUatOwnerDatabaseContext,
} from "./lib/database-guards";
import { resolveSingleActiveAdmin } from "./lib/uat-database";

export async function lookupActiveUatAdmin(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly targetDatabase: string;
}): Promise<string> {
  const context = readUatOwnerDatabaseContext(
    input.environment,
    input.targetDatabase,
  );
  const client = new Client({
    connectionString: context.migrationUrl,
    application_name: "ueb-core-phase5-lookup-active-admin",
  });
  try {
    await client.connect();
    await assertMigrationRoleOwnsSource(client, context);
    await client.query("BEGIN TRANSACTION READ ONLY");
    const candidates = (
      await client.query<{ user_id: string }>(`
        SELECT DISTINCT role_assignment.user_id
        FROM public.role_assignment
        INNER JOIN public.access_profile
          ON access_profile.user_id = role_assignment.user_id
        WHERE role_assignment.role = 'ADMIN'
          AND role_assignment.revoked_at IS NULL
          AND access_profile.status = 'ACTIVE'
        ORDER BY role_assignment.user_id
      `)
    ).rows;
    const userId = resolveSingleActiveAdmin(candidates);
    await client.query("COMMIT");
    return userId;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  try {
    const command = parseUatTargetCommand(process.argv.slice(2));
    const userId = await lookupActiveUatAdmin({
      environment: process.env,
      targetDatabase: command.targetDatabase,
    });
    console.log(
      [
        "ACTIVE_ADMIN_COUNT=1",
        `ACTIVE_ADMIN_INTERNAL_USER_ID=${userId}`,
        "DATABASE_WRITES=0",
        "ADMIN_LOOKUP=PASS",
      ].join("\n"),
    );
  } catch {
    console.error(
      "ACTIVE_ADMIN_COUNT=INVALID\nDATABASE_WRITES=0\nADMIN_LOOKUP=FAIL",
    );
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
