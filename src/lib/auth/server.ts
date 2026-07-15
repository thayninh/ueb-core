import "server-only";

import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";

import { AccessProfileStatus } from "@/generated/prisma/client";
import { readAuthEnvironment } from "@/lib/auth/environment";
import { createBetterAuthOptions } from "@/lib/auth/options";
import { getPrismaClient } from "@/lib/server/prisma";

type UebCoreAuth = ReturnType<typeof betterAuth>;

let authInstance: UebCoreAuth | undefined;

export function getAuth(): UebCoreAuth {
  authInstance ??= (() => {
    const prisma = getPrismaClient();

    return betterAuth(
      createBetterAuthOptions({
        database: prismaAdapter(prisma, {
          provider: "postgresql",
        }),
        environment: readAuthEnvironment(),
        isUserSessionEligible: async (userId) => {
          const profile = await prisma.accessProfile.findUnique({
            where: { userId },
            select: { status: true },
          });

          return profile?.status === AccessProfileStatus.ACTIVE;
        },
      }),
    );
  })();

  return authInstance;
}
