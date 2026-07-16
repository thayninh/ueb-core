import "dotenv/config";

import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  setLecturerMapping,
  setUserRole,
  setUserUnitScope,
} from "../../src/lib/auth/admin-user-management";
import type { Phase5ProvisioningAuditContext } from "../../src/lib/auth/audit";
import { provisionUser } from "../../src/lib/auth/provision-user-core";
import { getPrismaClient } from "../../src/lib/server/prisma";
import { closeRuntimeDatabaseConnections } from "../phase-3/lib/runtime-database";
import { recordProvisioningBatchReconciled } from "./lib/provisioning-audit";
import {
  assertExternalOutputPath,
  assertProvisioningDatabaseSafety,
  buildProvisioningPlan,
  loadProvisioningBundle,
  parseProvisioningCommand,
  SafeProvisioningError,
  type ProvisioningPlan,
} from "./lib/provisioning-guards";

interface GeneratedCredential {
  readonly email: string;
  readonly temporary_password: string;
}

export async function runControlledProvisioning(input: {
  readonly arguments: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
}): Promise<{ readonly report: string; readonly exitCode: number }> {
  let databaseOpened = false;
  let writesStarted = false;
  try {
    const command = parseProvisioningCommand(input.arguments);
    const loaded = await loadProvisioningBundle({
      inputPath: command.inputPath,
      approvalBatchId: command.approvalBatchId,
      expectedChecksum: command.inputChecksum,
    });
    await assertProvisioningDatabaseSafety(
      input.environment,
      command.expectedDatabase,
    );
    databaseOpened = true;
    const prisma = getPrismaClient();
    const plan = await buildProvisioningPlan({
      prisma,
      bundle: loaded.bundle,
      approvalBatchId: command.approvalBatchId,
      inputChecksum: command.inputChecksum,
    });
    if (plan.blockers.length > 0) {
      return {
        report: formatProvisioningReport(command.apply, plan),
        exitCode: 2,
      };
    }
    if (!command.apply) {
      return { report: formatProvisioningReport(false, plan), exitCode: 0 };
    }

    const actorUserId = command.actorUserId!;
    const actorRole = await prisma.roleAssignment.findFirst({
      where: {
        userId: actorUserId,
        role: "ADMIN",
        revokedAt: null,
        user: { accessProfile: { status: "ACTIVE" } },
      },
      select: { id: true },
    });
    if (!actorRole) {
      throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
    }
    const auditContext: Phase5ProvisioningAuditContext = {
      approvalBatchId: command.approvalBatchId,
      inputChecksum: command.inputChecksum,
      operation: "APPLY",
    };
    const credentialByRow = await prepareCredentials(
      plan,
      command.credentialOutputPath!,
    );
    for (const entry of plan.entries) {
      const entryWrites =
        entry.createAccount ||
        entry.assignLecturerMapping ||
        entry.unitScopesToGrant.length > 0 ||
        entry.rolesToGrant.length > 0 ||
        entry.needsReconciliationMarker;
      if (!entryWrites) continue;
      writesStarted = true;
      if (entry.createAccount) {
        const temporaryPassword = credentialByRow.get(entry.rowNumber);
        if (!temporaryPassword || !entry.lecturerUid) {
          throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
        }
        await provisionUser(
          {
            actorUserId,
            email: entry.email,
            temporaryPassword,
            roles: ["LECTURER"],
            lecturerUid: entry.lecturerUid,
          },
          { phase5AuditContext: auditContext },
        );
        continue;
      }
      const targetUserId = entry.targetUserId!;
      if (entry.assignLecturerMapping) {
        await setLecturerMapping({
          actorUserId,
          targetUserId,
          lecturerUid: entry.lecturerUid!,
          phase5AuditContext: auditContext,
        });
      }
      for (const scope of entry.unitScopesToGrant) {
        await setUserUnitScope({
          actorUserId,
          targetUserId,
          organizationUnitId: scope.organizationUnitId,
          enabled: true,
          phase5AuditContext: auditContext,
        });
      }
      for (const role of entry.rolesToGrant) {
        await setUserRole({
          actorUserId,
          targetUserId,
          role,
          enabled: true,
          phase5AuditContext: auditContext,
        });
      }
      if (entry.needsReconciliationMarker) {
        await recordProvisioningBatchReconciled({
          prisma,
          actorUserId,
          targetUserId,
          auditContext,
        });
      }
    }
    return { report: formatProvisioningReport(true, plan), exitCode: 0 };
  } catch (error) {
    const code =
      error instanceof SafeProvisioningError
        ? error.code
        : "INPUT_VALIDATION_FAILED";
    return {
      report: formatFailureReport(
        input.arguments.includes("--confirm-apply"),
        code,
        writesStarted,
      ),
      exitCode: 2,
    };
  } finally {
    if (databaseOpened) await closeRuntimeDatabaseConnections();
  }
}

async function prepareCredentials(
  plan: ProvisioningPlan,
  outputPath: string,
): Promise<Map<number, string>> {
  const creates = plan.entries.filter(({ createAccount }) => createAccount);
  const credentialByRow = new Map<number, string>();
  if (creates.length === 0) return credentialByRow;
  const safeOutputPath = await assertExternalOutputPath(outputPath);
  const credentials: GeneratedCredential[] = creates.map((entry) => {
    const temporaryPassword = `${randomBytes(24).toString("base64url")}Aa1!`;
    credentialByRow.set(entry.rowNumber, temporaryPassword);
    return { email: entry.email, temporary_password: temporaryPassword };
  });
  await writeFile(safeOutputPath, `${JSON.stringify(credentials)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return credentialByRow;
}

function formatProvisioningReport(
  apply: boolean,
  plan: ProvisioningPlan,
): string {
  const lines = [
    `PROVISIONING_MODE=${apply ? "APPLY" : "DRY_RUN"}`,
    `INPUT_VALIDATION=${plan.blockers.length === 0 ? "PASS" : "FAIL"}`,
    `DATABASE_WRITES=${
      apply && plan.blockers.length === 0 && planHasWrites(plan)
        ? "CONTROLLED"
        : "0"
    }`,
    `CREATE_COUNT=${plan.createCount}`,
    `UPDATE_COUNT=${plan.updateCount}`,
    `ROLE_ASSIGNMENT_COUNT=${plan.roleAssignmentCount}`,
    `LECTURER_MAPPING_COUNT=${plan.lecturerMappingCount}`,
    `UNIT_SCOPE_ASSIGNMENT_COUNT=${plan.unitScopeAssignmentCount}`,
    `ERROR_COUNT=${plan.blockers.length}`,
  ];
  plan.blockers.forEach((blocker, index) => {
    lines.push(
      `ERROR_${index + 1}_ROW=${blocker.source}:${blocker.rowNumber}`,
      `ERROR_${index + 1}_CODE=${blocker.code}`,
    );
  });
  return lines.join("\n");
}

function planHasWrites(plan: ProvisioningPlan): boolean {
  return plan.entries.some(
    (entry) =>
      entry.createAccount ||
      entry.assignLecturerMapping ||
      entry.rolesToGrant.length > 0 ||
      entry.unitScopesToGrant.length > 0 ||
      entry.needsReconciliationMarker,
  );
}

function formatFailureReport(
  apply: boolean,
  code: string,
  writesStarted: boolean,
): string {
  return [
    `PROVISIONING_MODE=${apply ? "APPLY" : "DRY_RUN"}`,
    "INPUT_VALIDATION=FAIL",
    `DATABASE_WRITES=${writesStarted ? "PARTIAL_RECONCILE_REQUIRED" : "0"}`,
    "CREATE_COUNT=0",
    "UPDATE_COUNT=0",
    "ROLE_ASSIGNMENT_COUNT=0",
    "LECTURER_MAPPING_COUNT=0",
    "UNIT_SCOPE_ASSIGNMENT_COUNT=0",
    "ERROR_COUNT=1",
    "ERROR_1_ROW=BATCH:0",
    `ERROR_1_CODE=${code}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const result = await runControlledProvisioning({
    arguments: process.argv.slice(2),
    environment: process.env,
  });
  if (result.exitCode === 0) console.log(result.report);
  else console.error(result.report);
  process.exitCode = result.exitCode;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
