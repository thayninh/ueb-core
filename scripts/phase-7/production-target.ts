import { pathToFileURL } from "node:url";

import {
  parseProductionTargetCommand,
  parseProductionTargetMode,
  runProductionTargetPlan,
  SafeProductionTargetError,
} from "./lib/production-target-contract";

async function main(): Promise<void> {
  try {
    const mode = parseProductionTargetMode(process.argv[2]);
    const command = parseProductionTargetCommand(mode, process.argv.slice(3));
    const result = await runProductionTargetPlan({ command });
    if (result.exitCode === 0) console.log(result.report);
    else console.error(result.report);
    process.exitCode = result.exitCode;
  } catch (error) {
    const code =
      error instanceof SafeProductionTargetError
        ? error.code
        : "PRODUCTION_TARGET_PLAN_FAILED";
    console.error(
      [
        "PLAN_STATUS=BLOCKED",
        `ERROR_CODE=${code}`,
        "DATABASE_CONNECTIONS=0",
        "DATABASE_MUTATIONS=0",
        "PRODUCTION_DEPLOYMENT=NOT_PERFORMED",
        "PRODUCTION_PROVISIONING=NOT_PERFORMED",
      ].join("\n"),
    );
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
