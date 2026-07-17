import "dotenv/config";

import { pathToFileURL } from "node:url";

import {
  createProvisioningDatabase,
  type ProvisioningDatabase,
} from "./lib/provisioning-database";
import {
  assertProvisioningDatabaseSafety,
  buildProvisioningPlan,
  loadProvisioningBundle,
  parseReconciliationCommand,
  readBatchEvidence,
  withAuthorizedProvisioningReadContext,
} from "./lib/provisioning-guards";

async function reconcileProvisioningBatch(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ readonly report: string; readonly exitCode: number }> {
  let database: ProvisioningDatabase | undefined;
  try {
    const command = parseReconciliationCommand(arguments_);
    const loaded = await loadProvisioningBundle({
      inputPath: command.inputPath,
      approvalBatchId: command.approvalBatchId,
      expectedChecksum: command.inputChecksum,
    });
    const databaseContext = await assertProvisioningDatabaseSafety(
      environment,
      command.expectedDatabase,
    );
    database = createProvisioningDatabase(databaseContext.connections);
    const { prisma } = database;
    const { plan, evidence } = await withAuthorizedProvisioningReadContext({
      prisma,
      actorUserId: command.actorUserId,
      query: async (transaction) => ({
        plan: await buildProvisioningPlan({
          prisma: transaction,
          bundle: loaded.bundle,
          approvalBatchId: command.approvalBatchId,
          inputChecksum: command.inputChecksum,
        }),
        evidence: await readBatchEvidence({
          prisma: transaction,
          approvalBatchId: command.approvalBatchId,
          inputChecksum: command.inputChecksum,
          operation: "APPLY",
        }),
      }),
    });
    const evidenceTargets = new Set(
      evidence.map(({ targetUserId }) => targetUserId),
    );
    const targetEntries = plan.entries.filter((entry) => entry.targetUserId);
    const changeDrift = plan.entries.filter(
      (entry) =>
        entry.createAccount ||
        entry.assignLecturerMapping ||
        entry.rolesToGrant.length > 0 ||
        entry.unitScopesToGrant.length > 0,
    ).length;
    const missingEvidence = targetEntries.filter(
      (entry) => !evidenceTargets.has(entry.targetUserId!),
    ).length;
    const driftCount =
      plan.blockers.length +
      changeDrift +
      missingEvidence +
      (plan.entries.length - targetEntries.length);
    const recordCount =
      loaded.bundle.lecturers.length + loaded.bundle.leaders.length;
    const reconciledCount = Math.max(0, recordCount - driftCount);
    return {
      report: [
        `RECONCILIATION_STATUS=${driftCount === 0 ? "PASS" : "FAIL"}`,
        `BATCH_RECORD_COUNT=${recordCount}`,
        `RECONCILED_COUNT=${reconciledCount}`,
        `AUDIT_TARGET_COUNT=${evidenceTargets.size}`,
        `DRIFT_COUNT=${driftCount}`,
        "DATABASE_WRITES=0",
      ].join("\n"),
      exitCode: driftCount === 0 ? 0 : 2,
    };
  } catch {
    return {
      report: [
        "RECONCILIATION_STATUS=FAIL",
        "BATCH_RECORD_COUNT=0",
        "RECONCILED_COUNT=0",
        "AUDIT_TARGET_COUNT=0",
        "DRIFT_COUNT=1",
        "DATABASE_WRITES=0",
      ].join("\n"),
      exitCode: 2,
    };
  } finally {
    await database?.close();
  }
}

async function main(): Promise<void> {
  const result = await reconcileProvisioningBatch(
    process.argv.slice(2),
    process.env,
  );
  if (result.exitCode === 0) console.log(result.report);
  else console.error(result.report);
  process.exitCode = result.exitCode;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
