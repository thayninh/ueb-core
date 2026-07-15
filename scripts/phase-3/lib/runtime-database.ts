import { getPrismaClient } from "../../../src/lib/server/prisma";
import { getPostgresPool } from "../../../src/lib/server/postgres";

export async function closeRuntimeDatabaseConnections(): Promise<void> {
  await getPrismaClient()
    .$disconnect()
    .catch(() => undefined);
  await getPostgresPool()
    .end()
    .catch(() => undefined);
}
