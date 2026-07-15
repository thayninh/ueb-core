import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getPostgresPool } from "@/lib/server/postgres";

type GlobalPrisma = typeof globalThis & {
  uebCorePrismaClient?: PrismaClient;
};

const globalPrisma = globalThis as GlobalPrisma;

let prismaClient: PrismaClient | undefined;

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg(getPostgresPool(), {
    disposeExternalPool: false,
  });

  return new PrismaClient({ adapter });
}

export function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === "development") {
    globalPrisma.uebCorePrismaClient ??= createPrismaClient();

    return globalPrisma.uebCorePrismaClient;
  }

  prismaClient ??= createPrismaClient();

  return prismaClient;
}
