import { pathToFileURL } from "node:url";

import {
  formatProductionOrganizationUnitSeedFailure,
  parseProductionOrganizationUnitSeedCommand,
  runProductionOrganizationUnitSeed,
} from "./lib/production-organization-unit-seed";

async function main(): Promise<void> {
  try {
    const command = parseProductionOrganizationUnitSeedCommand(
      process.argv.slice(2),
    );
    const result = await runProductionOrganizationUnitSeed({ command });
    if (result.exitCode === 0) console.log(result.report);
    else console.error(result.report);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(formatProductionOrganizationUnitSeedFailure(error));
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
