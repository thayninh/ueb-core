import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

import { readPhase3TestDatabaseUrls } from "./scripts/phase-3/lib/test-database";
import { parsePhase3FixtureEnvironment } from "./scripts/phase-3/lib/test-fixtures";

const urls = readPhase3TestDatabaseUrls(process.env);
parsePhase3FixtureEnvironment(process.env);

const baseURL = "http://127.0.0.1:3103";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "phase3.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "phase3-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "./node_modules/.bin/tsx scripts/phase-3/seed-e2e-fixtures.ts && ./node_modules/.bin/next dev --port 3103",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: urls.e2eRuntimeUrl,
      PHASE3_SOURCE_MIGRATION_DATABASE_URL: urls.sourceMigrationUrl,
      PHASE3_SOURCE_DATABASE_URL: urls.sourceRuntimeUrl,
      BETTER_AUTH_URL: baseURL,
      AUTH_TRUSTED_ORIGINS: baseURL,
    },
  },
});
