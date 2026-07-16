import "dotenv/config";

import { pathToFileURL } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../../src/generated/prisma/client";
import { seedOrganizationUnits } from "../../src/lib/auth/organization-unit-seed";
import { assertLocalPostgresDatabaseUrl } from "../../src/lib/auth/provisioning-policy";

async function main(): Promise<void> {
  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;
  try {
    const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
    const runtimeDatabaseUrl = process.env.DATABASE_URL;
    if (!migrationDatabaseUrl) {
      throw new Error("MIGRATION_DATABASE_URL is required.");
    }
    if (!runtimeDatabaseUrl) throw new Error("DATABASE_URL is required.");
    assertLocalPostgresDatabaseUrl(migrationDatabaseUrl);
    assertLocalPostgresDatabaseUrl(runtimeDatabaseUrl);
    if (
      new URL(migrationDatabaseUrl).pathname !==
      new URL(runtimeDatabaseUrl).pathname
    ) {
      throw new Error("Migration and runtime URLs must target one database.");
    }

    pool = new Pool({
      connectionString: migrationDatabaseUrl,
      application_name: "ueb-core-organization-unit-seed",
      max: 1,
    });
    prisma = new PrismaClient({
      adapter: new PrismaPg(pool, { disposeExternalPool: false }),
    });

    const result = await seedOrganizationUnits(prisma);
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
    await prisma?.$disconnect().catch(() => undefined);
    await pool?.end().catch(() => undefined);
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
