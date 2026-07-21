import { pathToFileURL } from "node:url";

import { readSourceMigrationLedger } from "./lib/migration-ledger";

export async function main(arguments_ = process.argv.slice(2)): Promise<void> {
  if (arguments_.length !== 1 || arguments_[0] !== "--json") {
    throw new Error("Migration ledger output requires --json.");
  }
  const ledger = await readSourceMigrationLedger();
  process.stdout.write(`${JSON.stringify(ledger)}\n`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
