import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

import { readPhase4LecturerPortalDatabaseUrls } from "./scripts/phase-4/lib/lecturer-portal-test-database";
import { readPhase4LecturerPortalFixtures } from "./scripts/phase-4/lib/lecturer-portal-fixtures";

const sourceMigrationUrl = process.env.MIGRATION_DATABASE_URL;
const sourceRuntimeUrl = process.env.DATABASE_URL;
if (!sourceMigrationUrl || !sourceRuntimeUrl) {
  throw new Error("Local source database URLs are required for Phase 4 E2E.");
}
const urls = readPhase4LecturerPortalDatabaseUrls(process.env);
readPhase4LecturerPortalFixtures(process.env);

const baseURL = "http://localhost:3107";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "phase4-resubmission.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "phase4-resubmission-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "./node_modules/.bin/tsx scripts/phase-4/seed-lecturer-portal-e2e.ts && ./node_modules/.bin/next dev --port 3107",
    url: baseURL + "/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: urls.runtimeUrl,
      PHASE4_SOURCE_MIGRATION_DATABASE_URL: sourceMigrationUrl,
      PHASE4_SOURCE_DATABASE_URL: sourceRuntimeUrl,
      BETTER_AUTH_URL: baseURL,
      AUTH_TRUSTED_ORIGINS: baseURL,
    },
  },
});
