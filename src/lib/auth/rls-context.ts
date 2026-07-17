import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { Principal } from "@/lib/auth/principal";
import { getPrismaClient } from "@/lib/server/prisma";

type CoreDataTransaction = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

/**
 * Installs the PostgreSQL RLS identity only for the lifetime of one transaction.
 * Never replace this with a session-global SET on a pooled connection.
 */
export async function withCoreDataRlsContext<T>(
  principal: Pick<Principal, "userId">,
  query: (transaction: CoreDataTransaction) => Promise<T>,
  options: Readonly<{
    isolationLevel?: Prisma.TransactionIsolationLevel;
    readOnly?: boolean;
    prisma?: PrismaClient;
  }> = {},
): Promise<T> {
  return (options.prisma ?? getPrismaClient()).$transaction(
    async (transaction) => {
      if (options.readOnly) {
        await transaction.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      }
      await transaction.$queryRaw(
        Prisma.sql`SELECT set_config('app.current_user_id', ${principal.userId}, true)`,
      );
      return query(transaction);
    },
    options.isolationLevel
      ? { isolationLevel: options.isolationLevel }
      : undefined,
  );
}
