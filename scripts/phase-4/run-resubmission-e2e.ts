import "dotenv/config";

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  dropPhase4LecturerPortalTestDatabase,
  preparePhase4LecturerPortalTestDatabase,
} from "./prepare-lecturer-portal-test-database";

const CONFIRMATION = "--confirm-reset-phase4-resubmission";

async function run(): Promise<void> {
  if (!process.argv.includes(CONFIRMATION)) {
    throw new Error("Explicit Phase 4 resubmission E2E confirmation required.");
  }
  const urls = await preparePhase4LecturerPortalTestDatabase(process.env);
  try {
    await runPlaywright();
  } finally {
    await dropPhase4LecturerPortalTestDatabase(urls);
  }
}

function runPlaywright(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "./node_modules/.bin/playwright",
      ["test", "--config=playwright.phase-4-resubmission.config.ts"],
      { cwd: process.cwd(), env: process.env, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Phase 4 resubmission Playwright tests failed."));
    });
  });
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await run().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Phase 4 resubmission E2E failed safely.",
    );
    process.exitCode = 1;
  });
}
