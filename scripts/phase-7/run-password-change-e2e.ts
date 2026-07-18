import "dotenv/config";

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

import { preparePhase3TestDatabases } from "../phase-3/prepare-test-databases";

const CONFIRMATION = "--confirm-reset-phase7-password-change";

async function run(): Promise<void> {
  if (!process.argv.includes(CONFIRMATION)) {
    throw new Error("Explicit Phase 7 local E2E confirmation required.");
  }
  await preparePhase3TestDatabases(process.env);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PHASE7_E2E_LECTURER_EMAIL: randomEmail("lecturer"),
    PHASE7_E2E_LEADER_EMAIL: randomEmail("leader"),
    PHASE7_E2E_INITIAL_PASSWORD: randomPassword("Aa1!"),
    PHASE7_E2E_NEW_PASSWORD: randomPassword("Bb2!"),
  };
  await runPlaywright(environment);
}

function randomEmail(role: string): string {
  return `phase7-${role}-${randomBytes(8).toString("hex")}@localhost.test`;
}

function randomPassword(suffix: string): string {
  return `${randomBytes(24).toString("base64url")}${suffix}`;
}

function runPlaywright(environment: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "./node_modules/.bin/playwright",
      ["test", "--config=playwright.phase-7.config.ts"],
      {
        cwd: process.cwd(),
        env: environment,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Phase 7 password-change Playwright failed."));
    });
  });
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await run().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Phase 7 local E2E failed safely.",
    );
    process.exitCode = 1;
  });
}
