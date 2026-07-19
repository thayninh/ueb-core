import { pathToFileURL } from "node:url";

import {
  formatProductionIdentityApplyFailure,
  parseProductionIdentityApplyCommand,
  runProductionIdentityApply,
} from "./lib/production-identity-apply";

async function main(): Promise<void> {
  try {
    const command = parseProductionIdentityApplyCommand(process.argv.slice(2));
    const result = await runProductionIdentityApply({ command });
    if (result.exitCode === 0) console.log(result.report);
    else console.error(result.report);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(formatProductionIdentityApplyFailure(error));
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
