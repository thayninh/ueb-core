import { pathToFileURL } from "node:url";

import {
  parseProductionExecutorCommand,
  parseProductionExecutorMode,
  runProductionExecutor,
  SafeProductionExecutorError,
} from "./lib/production-executor";

export function formatProductionExecutorFailure(error: unknown): string {
  const safeError =
    error instanceof SafeProductionExecutorError ? error : undefined;
  const code = safeError?.code ?? "PRODUCTION_EXECUTOR_FAILED";
  return [
    "PRODUCTION_EXECUTOR=BLOCKED",
    `FAILED_PHASE=${safeError?.diagnostic.phase ?? "NOT_AVAILABLE"}`,
    `ERROR_CODE=${code}`,
    `POSTGRES_SQLSTATE=${safeError?.diagnostic.postgresSqlstate ?? "NOT_AVAILABLE"}`,
    `SAFE_OBJECT_TYPE=${safeError?.diagnostic.objectType ?? "NOT_AVAILABLE"}`,
    `SAFE_OBJECT_NAME=${safeError?.diagnostic.objectName ?? "NOT_AVAILABLE"}`,
    `DATABASE_CONNECTIONS=${safeError?.mutationPossible ? "REDACTED" : "0"}`,
    `DATABASE_MUTATIONS=${safeError?.mutationPossible ? "UNKNOWN_RECONCILIATION_REQUIRED" : "0"}`,
    "PRODUCTION_DEPLOYMENT=NOT_PERFORMED",
    "PRODUCTION_PROVISIONING=NOT_PERFORMED",
  ].join("\n");
}

async function main(): Promise<void> {
  try {
    const mode = parseProductionExecutorMode(process.argv[2]);
    const command = parseProductionExecutorCommand(mode, process.argv.slice(3));
    const result = await runProductionExecutor({ command });
    if (result.exitCode === 0) console.log(result.report);
    else console.error(result.report);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(formatProductionExecutorFailure(error));
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
