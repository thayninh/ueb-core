import { pathToFileURL } from "node:url";

import { readSourceMigrationLedger } from "../phase-6/lib/migration-ledger";
import { SafePhase6StagingError } from "../phase-6/lib/staging-contracts";
import {
  createRollbackReadinessDryRun,
  executeRollbackReadiness,
  generateRollbackMetadataDraft,
} from "./lib/rollback-metadata-readiness";

const GIT_SHA = /^[a-f0-9]{40}$/u;

export async function main(arguments_ = process.argv.slice(2)): Promise<void> {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (args.includes("--generate-draft")) {
    const allowed = new Set([
      "--generate-draft",
      "--release-sha=",
      "--report=",
      "--output=",
    ]);
    for (const argument of args) {
      if (argument === "--generate-draft") continue;
      if (![...allowed].some((prefix) => argument.startsWith(prefix))) {
        throw new SafePhase6StagingError(
          "Unsupported rollback draft argument.",
        );
      }
    }
    if (
      args.filter((argument) => argument === "--generate-draft").length !== 1
    ) {
      throw new SafePhase6StagingError(
        "Rollback draft mode is missing or duplicated.",
      );
    }
    const releaseSha = singleValue(args, "--release-sha=");
    if (!GIT_SHA.test(releaseSha)) {
      throw new SafePhase6StagingError(
        "Rollback draft release SHA is invalid.",
      );
    }
    const draft = await generateRollbackMetadataDraft({
      releaseSha,
      reportPath: singleValue(args, "--report="),
      outputPath: singleValue(args, "--output="),
    });
    process.stdout.write(
      `${JSON.stringify({
        status: draft.status,
        approved: false,
        draftWritten: true,
        operatorDecisionCount: draft.operatorDecisions.length,
        blockerCount: draft.blockers.length,
        mutationCommands: 0,
        serverConnectionPerformed: false,
        secretsPrinted: false,
      })}\n`,
    );
    return;
  }
  if (args.includes("--execute-read-only")) {
    const report = await executeRollbackReadiness(arguments_);
    process.stdout.write(
      `${JSON.stringify({
        status: report.status,
        reportSchemaVersion: report.reportSchemaVersion,
        outputWritten: true,
        mutationCommands: 0,
        serverConnectionPerformed: true,
        secretsPrinted: false,
      })}\n`,
    );
    if (report.status !== "PASS") process.exitCode = 2;
    return;
  }
  const ledger = await readSourceMigrationLedger();
  const plan = createRollbackReadinessDryRun(arguments_, ledger);
  process.stdout.write(`${JSON.stringify(plan)}\n`);
}

function singleValue(arguments_: readonly string[], prefix: string): string {
  const values = arguments_
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length));
  if (values.length !== 1 || !values[0]) {
    throw new SafePhase6StagingError(
      "Rollback readiness argument is missing or duplicated.",
    );
  }
  return values[0];
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
