import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { withCoreDataRlsContext } from "@/lib/auth/dal";

import type { Principal } from "@/lib/auth/principal";

export type WorkflowTransaction = Parameters<
  Parameters<typeof withCoreDataRlsContext>[1]
>[0];

/**
 * Reuses the single application RLS context contract. The PostgreSQL setting
 * is transaction-local and every workflow query and lock receives the same
 * transaction client.
 */
export function withWorkflowTransaction<T>(
  principal: Pick<Principal, "userId">,
  operation: (transaction: WorkflowTransaction) => Promise<T>,
  options: Readonly<{
    isolationLevel?: Prisma.TransactionIsolationLevel;
  }> = {},
): Promise<T> {
  return withCoreDataRlsContext(principal, operation, options);
}
