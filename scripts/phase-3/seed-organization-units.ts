import "dotenv/config";

import { pathToFileURL } from "node:url";

import { seedOrganizationUnits } from "../../src/lib/auth/organization-unit-seed";
import { assertLocalPostgresDatabaseUrl } from "../../src/lib/auth/provisioning-policy";
import { closeRuntimeDatabaseConnections } from "./lib/runtime-database";

async function main(): Promise<void> {
  let databaseOpened = false;
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required.");
    assertLocalPostgresDatabaseUrl(databaseUrl);
    databaseOpened = true;

    const result = await seedOrganizationUnits();
    console.log(
      JSON.stringify({
        status: "SUCCESS",
        sourceUnitCount: result.sourceUnitCount,
        insertedUnitCount: result.insertedUnitCount,
        existingUnitCount: result.existingUnitCount,
        leaderAssignmentCount: result.leaderAssignmentCount,
      }),
    );
  } catch {
    console.error(
      JSON.stringify({
        status: "ERROR",
        message:
          "Organization unit seed failed safely; no source value or credential was logged.",
      }),
    );
    process.exitCode = 1;
  } finally {
    if (databaseOpened) await closeRuntimeDatabaseConnections();
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
