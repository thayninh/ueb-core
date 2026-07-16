import "server-only";

import { AccessProfileStatus, BusinessRole } from "@/generated/prisma/client";

import { WorkflowError } from "./errors";

import type { Principal } from "@/lib/auth/principal";
import type { WorkflowTransaction } from "./context";

/**
 * Re-reads the terminal actor's active role and unit scope inside the decision
 * transaction. A principal loaded before the request is never sufficient for
 * an approve or reject commit.
 */
export async function assertCurrentDecisionScope(
  transaction: WorkflowTransaction,
  principal: Principal,
  approvalUnit: string,
): Promise<void> {
  const profile = await transaction.accessProfile.findUnique({
    where: { userId: principal.userId },
    select: {
      status: true,
      user: {
        select: {
          roleAssignments: {
            where: { revokedAt: null },
            select: { role: true },
          },
          unitScopeAssignments: {
            where: {
              revokedAt: null,
              organizationUnit: {
                isActive: true,
                sourceValue: approvalUnit,
              },
            },
            select: { id: true },
          },
        },
      },
    },
  });
  if (!profile || profile.status !== AccessProfileStatus.ACTIVE) {
    throw new WorkflowError("WORKFLOW_SCOPE_DENIED");
  }
  const roles = new Set(profile.user.roleAssignments.map(({ role }) => role));
  if (roles.has(BusinessRole.ADMIN)) return;
  if (
    !roles.has(BusinessRole.FACULTY_LEADER) ||
    profile.user.unitScopeAssignments.length === 0
  ) {
    throw new WorkflowError("WORKFLOW_SCOPE_DENIED");
  }
}
