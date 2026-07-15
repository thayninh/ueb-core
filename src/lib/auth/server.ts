import "server-only";

import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";

import { readAuthEnvironment } from "@/lib/auth/environment";
import { createBetterAuthOptions } from "@/lib/auth/options";
import { getPrismaClient } from "@/lib/server/prisma";

type UebCoreAuth = ReturnType<typeof betterAuth>;

let authInstance: UebCoreAuth | undefined;

export function getAuth(): UebCoreAuth {
  authInstance ??= betterAuth(
    createBetterAuthOptions({
      database: prismaAdapter(getPrismaClient(), {
        provider: "postgresql",
      }),
      environment: readAuthEnvironment(),
    }),
  );

  return authInstance;
}
