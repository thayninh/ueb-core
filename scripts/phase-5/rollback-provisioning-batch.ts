import "dotenv/config";

import { pathToFileURL } from "node:url";

import { disableUserAndRevokeSessions } from "../../src/lib/auth/account-lifecycle";
import {
  revokeUserSessions,
  setUserRole,
  setUserUnitScope,
} from "../../src/lib/auth/admin-user-management";
import type { Phase5ProvisioningAuditContext } from "../../src/lib/auth/audit";
import { getPrismaClient } from "../../src/lib/server/prisma";
import { closeRuntimeDatabaseConnections } from "../phase-3/lib/runtime-database";
import {
  assertProvisioningDatabaseSafety,
  buildProvisioningPlan,
  loadProvisioningBundle,
  parseRollbackCommand,
  readBatchEvidence,
  withAuthorizedProvisioningReadContext,
} from "./lib/provisioning-guards";

interface TargetRollback {
  readonly targetUserId: string;
  readonly createdByBatch: boolean;
  readonly roles: readonly ("LECTURER" | "FACULTY_LEADER")[];
  readonly organizationUnitIds: readonly string[];
}

async function runProvisioningRollback(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ readonly report: string; readonly exitCode: number }> {
  let databaseOpened = false;
  let writesStarted = false;
  try {
    const command = parseRollbackCommand(arguments_);
    await assertProvisioningDatabaseSafety(
      environment,
      command.expectedDatabase,
    );
    databaseOpened = true;
    const prisma = getPrismaClient();
    if (!command.apply) {
      const loaded = await loadProvisioningBundle({
        inputPath: command.inputPath!,
        approvalBatchId: command.approvalBatchId,
        expectedChecksum: command.inputChecksum,
      });
      const plan = await withAuthorizedProvisioningReadContext({
        actorUserId: command.actorUserId,
        query: (transaction) =>
          buildProvisioningPlan({
            prisma: transaction,
            bundle: loaded.bundle,
            approvalBatchId: command.approvalBatchId,
            inputChecksum: command.inputChecksum,
          }),
      });
      if (plan.blockers.length > 0) throw new Error("Blocked rollback plan.");
      return {
        report: formatRollbackReport({
          apply: false,
          targetCount: plan.entries.length,
          disableCount: plan.createCount,
          roleCount: plan.roleAssignmentCount,
          scopeCount: plan.unitScopeAssignmentCount,
          errorCount: 0,
          writesStarted: false,
        }),
        exitCode: 0,
      };
    }
    const evidence = await readBatchEvidence({
      prisma,
      approvalBatchId: command.approvalBatchId,
      inputChecksum: command.inputChecksum,
      operation: "APPLY",
    });
    const targets = toRollbackTargets(evidence);
    if (targets.length === 0) throw new Error("No batch evidence.");
    const roleCount = targets.reduce(
      (count, target) => count + target.roles.length,
      0,
    );
    const scopeCount = targets.reduce(
      (count, target) => count + target.organizationUnitIds.length,
      0,
    );
    const actorUserId = command.actorUserId!;
    const auditContext: Phase5ProvisioningAuditContext = {
      approvalBatchId: command.approvalBatchId,
      inputChecksum: command.inputChecksum,
      operation: "ROLLBACK",
    };
    for (const target of targets) {
      writesStarted = true;
      const roles = [...target.roles].sort(
        (left, right) => roleRollbackOrder(left) - roleRollbackOrder(right),
      );
      for (const role of roles) {
        await setUserRole({
          actorUserId,
          targetUserId: target.targetUserId,
          role,
          enabled: false,
          phase5AuditContext: auditContext,
        });
      }
      for (const organizationUnitId of target.organizationUnitIds) {
        await setUserUnitScope({
          actorUserId,
          targetUserId: target.targetUserId,
          organizationUnitId,
          enabled: false,
          phase5AuditContext: auditContext,
        });
      }
      if (target.createdByBatch) {
        await disableUserAndRevokeSessions({
          actorUserId,
          targetUserId: target.targetUserId,
          phase5AuditContext: auditContext,
        });
      } else {
        await revokeUserSessions({
          actorUserId,
          targetUserId: target.targetUserId,
          phase5AuditContext: auditContext,
        });
      }
    }
    return {
      report: formatRollbackReport({
        apply: true,
        targetCount: targets.length,
        disableCount: targets.filter(({ createdByBatch }) => createdByBatch)
          .length,
        roleCount,
        scopeCount,
        errorCount: 0,
        writesStarted,
      }),
      exitCode: 0,
    };
  } catch {
    return {
      report: formatRollbackReport({
        apply: arguments_.includes("--confirm-rollback"),
        targetCount: 0,
        disableCount: 0,
        roleCount: 0,
        scopeCount: 0,
        errorCount: 1,
        writesStarted,
      }),
      exitCode: 2,
    };
  } finally {
    if (databaseOpened) await closeRuntimeDatabaseConnections();
  }
}

function roleRollbackOrder(role: "LECTURER" | "FACULTY_LEADER"): number {
  return role === "FACULTY_LEADER" ? 0 : 1;
}

export function toRollbackTargets(
  evidence: Awaited<ReturnType<typeof readBatchEvidence>>,
): TargetRollback[] {
  const grouped = new Map<
    string,
    {
      createdByBatch: boolean;
      roles: Set<"LECTURER" | "FACULTY_LEADER">;
      organizationUnitIds: Set<string>;
    }
  >();
  for (const event of evidence) {
    const target = grouped.get(event.targetUserId) ?? {
      createdByBatch: false,
      roles: new Set<"LECTURER" | "FACULTY_LEADER">(),
      organizationUnitIds: new Set<string>(),
    };
    if (event.eventType === "USER_CREATED") target.createdByBatch = true;
    if (event.eventType === "ROLE_GRANTED" && event.role) {
      target.roles.add(event.role);
    }
    if (event.eventType === "UNIT_SCOPE_GRANTED" && event.organizationUnitId) {
      target.organizationUnitIds.add(event.organizationUnitId);
    }
    grouped.set(event.targetUserId, target);
  }
  return [...grouped.entries()].map(([targetUserId, target]) => ({
    targetUserId,
    createdByBatch: target.createdByBatch,
    roles: [...target.roles],
    organizationUnitIds: [...target.organizationUnitIds],
  }));
}

function formatRollbackReport(input: {
  readonly apply: boolean;
  readonly targetCount: number;
  readonly disableCount: number;
  readonly roleCount: number;
  readonly scopeCount: number;
  readonly errorCount: number;
  readonly writesStarted: boolean;
}): string {
  return [
    `ROLLBACK_MODE=${input.apply ? "APPLY" : "DRY_RUN"}`,
    `ROLLBACK_STATUS=${input.errorCount === 0 ? "PASS" : "FAIL"}`,
    `TARGET_COUNT=${input.targetCount}`,
    `DISABLE_PROFILE_COUNT=${input.disableCount}`,
    `ROLE_REVOCATION_COUNT=${input.roleCount}`,
    `UNIT_SCOPE_REVOCATION_COUNT=${input.scopeCount}`,
    `SESSION_REVOCATION_TARGET_COUNT=${input.targetCount}`,
    `DATABASE_WRITES=${
      input.writesStarted ? "CONTROLLED_OR_PARTIAL_RECONCILE_REQUIRED" : "0"
    }`,
    "ACCOUNT_DELETE_COUNT=0",
    "AUDIT_DELETE_COUNT=0",
    `ERROR_COUNT=${input.errorCount}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const result = await runProvisioningRollback(
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
