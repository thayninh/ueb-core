import {
  BusinessRole,
  type PrismaClient,
} from "../../../src/generated/prisma/client";
import {
  appendAuthAuditEvent,
  withPhase5ProvisioningAuditContext,
  type Phase5ProvisioningAuditContext,
} from "../../../src/lib/auth/audit";

export async function recordProvisioningBatchReconciled(input: {
  readonly prisma: PrismaClient;
  readonly actorUserId: string;
  readonly targetUserId: string;
  readonly auditContext: Phase5ProvisioningAuditContext;
}): Promise<void> {
  await input.prisma.$transaction(async (transaction) => {
    const actorRole = await transaction.roleAssignment.findFirst({
      where: {
        userId: input.actorUserId,
        role: BusinessRole.ADMIN,
        revokedAt: null,
        user: { accessProfile: { status: "ACTIVE" } },
      },
      select: { id: true },
    });
    if (!actorRole) throw new Error("An active ADMIN actor is required.");

    const priorEvidence = await transaction.authAuditEvent.findFirst({
      where: {
        targetUserId: input.targetUserId,
        metadata: {
          path: ["phase5ApprovalBatchId"],
          equals: input.auditContext.approvalBatchId,
        },
        AND: {
          metadata: {
            path: ["phase5InputChecksum"],
            equals: input.auditContext.inputChecksum,
          },
        },
      },
      select: { id: true },
    });
    if (priorEvidence) return;

    await appendAuthAuditEvent(transaction, {
      eventType: "PROVISIONING_BATCH_RECONCILED",
      outcome: "SUCCESS",
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      metadata: withPhase5ProvisioningAuditContext(
        { provisioningStatus: "NO_CHANGE_REQUIRED" },
        input.auditContext,
      ),
    });
  });
}
