import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

import { readPhase3TestDatabaseUrls } from "./scripts/phase-3/lib/test-database";

const urls = readPhase3TestDatabaseUrls(process.env);
if (
  !process.env.PHASE7_E2E_LECTURER_EMAIL ||
  !process.env.PHASE7_E2E_LEADER_EMAIL ||
  !process.env.PHASE7_E2E_INITIAL_PASSWORD ||
  !process.env.PHASE7_E2E_NEW_PASSWORD
) {
  throw new Error("Phase 7 local E2E credentials are required.");
}

const baseURL = "http://127.0.0.1:3107";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "phase7-password-change.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "phase7-password-change-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "./node_modules/.bin/tsx scripts/phase-7/seed-password-change-e2e.ts && ./node_modules/.bin/next dev --port 3107",
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
