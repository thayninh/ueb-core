import type { BetterAuthOptions } from "better-auth";

import type { AuthEnvironment } from "@/lib/auth/environment";

export const AUTH_MODEL_NAMES = {
  user: "auth_user",
  session: "auth_session",
  account: "auth_account",
  verification: "auth_verification",
} as const;

export const AUTH_SESSION_SECONDS = {
  expiresIn: 8 * 60 * 60,
  updateAge: 60 * 60,
  freshAge: 10 * 60,
} as const;

type AuthDatabase = NonNullable<BetterAuthOptions["database"]>;

export function createBetterAuthOptions(input: {
  database: AuthDatabase;
  environment: AuthEnvironment;
}): BetterAuthOptions {
  return {
    appName: "UEB Core",
    baseURL: input.environment.baseUrl,
    basePath: "/api/auth",
    secret: input.environment.secret,
    trustedOrigins: input.environment.trustedOrigins,
    database: input.database,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      requireEmailVerification: false,
    },
    user: {
      modelName: AUTH_MODEL_NAMES.user,
      changeEmail: {
        enabled: false,
      },
      deleteUser: {
        enabled: false,
      },
    },
    session: {
      modelName: AUTH_MODEL_NAMES.session,
      expiresIn: AUTH_SESSION_SECONDS.expiresIn,
      updateAge: AUTH_SESSION_SECONDS.updateAge,
      freshAge: AUTH_SESSION_SECONDS.freshAge,
      cookieCache: {
        enabled: false,
      },
    },
    account: {
      modelName: AUTH_MODEL_NAMES.account,
      accountLinking: {
        enabled: false,
      },
    },
    verification: {
      modelName: AUTH_MODEL_NAMES.verification,
    },
    advanced: {
      database: {
        generateId: "uuid",
      },
    },
  };
}
