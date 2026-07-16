import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../../../src/generated/prisma/client";
import type { ProvisioningConnectionEnvironment } from "./provisioning-role";

export interface ProvisioningDatabase {
  readonly prisma: PrismaClient;
  close(): Promise<void>;
}

export function createProvisioningDatabase(
  connections: ProvisioningConnectionEnvironment,
): ProvisioningDatabase {
  const pool = new Pool({
    connectionString: connections.provisioningUrl,
    application_name: "ueb-core-phase5-controlled-provisioning",
    max: 5,
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: false }),
  });

  return {
    prisma,
    async close(): Promise<void> {
      await prisma.$disconnect().catch(() => undefined);
      await pool.end().catch(() => undefined);
    },
  };
}
