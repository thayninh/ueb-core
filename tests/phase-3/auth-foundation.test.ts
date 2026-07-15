// @vitest-environment node

import type { BetterAuthOptions } from "better-auth";
import { describe, expect, it } from "vitest";

import {
  parseTrustedOrigins,
  readAuthEnvironment,
  type AuthEnvironment,
} from "../../src/lib/auth/environment";
import {
  AUTH_MODEL_NAMES,
  AUTH_SESSION_SECONDS,
  createBetterAuthOptions,
} from "../../src/lib/auth/options";

const environment: AuthEnvironment = {
  baseUrl: "http://localhost:3000",
  secret: "a".repeat(32),
  trustedOrigins: ["http://localhost:3000"],
};

function createOptions(): BetterAuthOptions {
  return createBetterAuthOptions({
    database: {} as NonNullable<BetterAuthOptions["database"]>,
    environment,
    isUserSessionEligible: async () => true,
  });
}

describe("Better Auth foundation", () => {
  it("disables public email/password signup", () => {
    const options = createOptions();

    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      requireEmailVerification: false,
    });
  });

  it("validates required auth environment variables lazily", () => {
    expect(() => readAuthEnvironment({})).toThrow(/BETTER_AUTH_URL/u);
    expect(() =>
      readAuthEnvironment({
        BETTER_AUTH_URL: "http://localhost:3000",
      }),
    ).toThrow(/BETTER_AUTH_SECRET/u);
    expect(() =>
      readAuthEnvironment({
        BETTER_AUTH_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: "a".repeat(32),
      }),
    ).toThrow(/AUTH_TRUSTED_ORIGINS/u);
  });

  it("uses database-backed session timings without cookie caching", () => {
    const options = createOptions();

    expect(options.database).toBeDefined();
    expect(options.secondaryStorage).toBeUndefined();
    expect(options.logger).toEqual({ level: "error" });
    expect(options.session).toMatchObject({
      modelName: AUTH_MODEL_NAMES.session,
      expiresIn: AUTH_SESSION_SECONDS.expiresIn,
      updateAge: AUTH_SESSION_SECONDS.updateAge,
      freshAge: AUTH_SESSION_SECONDS.freshAge,
      cookieCache: {
        enabled: false,
      },
    });
    expect(options.advanced?.database?.generateId).toBe("uuid");
    expect(options.plugins?.at(-1)?.id).toBe("next-cookies");
    expect(options.user?.additionalFields).toBeUndefined();
    expect(options.session?.additionalFields).toBeUndefined();
  });

  it("blocks session creation when the business access profile is inactive", async () => {
    const options = createBetterAuthOptions({
      database: {} as NonNullable<BetterAuthOptions["database"]>,
      environment,
      isUserSessionEligible: async () => false,
    });
    const beforeSessionCreate = options.databaseHooks?.session?.create?.before;

    expect(beforeSessionCreate).toBeTypeOf("function");
    await expect(
      beforeSessionCreate?.(
        { userId: "11111111-1111-4111-8111-111111111111" } as never,
        null,
      ),
    ).rejects.toMatchObject({
      body: { code: "INVALID_EMAIL_OR_PASSWORD" },
    });
  });

  it("parses, normalizes, and deduplicates comma-separated trusted origins", () => {
    expect(
      parseTrustedOrigins(
        " http://localhost:3000,https://example.edu:443,https://example.edu ",
      ),
    ).toEqual(["http://localhost:3000", "https://example.edu"]);

    expect(() => parseTrustedOrigins("https://example.edu/path")).toThrow(
      /origins without credentials, paths/u,
    );
    expect(() => parseTrustedOrigins("javascript:alert(1)")).toThrow(
      /http or https/u,
    );
  });

  it("uses prefixed auth models and disables self-service account changes", () => {
    const options = createOptions();

    expect(options.user).toMatchObject({
      modelName: AUTH_MODEL_NAMES.user,
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    });
    expect(options.account).toMatchObject({
      modelName: AUTH_MODEL_NAMES.account,
      accountLinking: { enabled: false },
    });
    expect(options.verification?.modelName).toBe(AUTH_MODEL_NAMES.verification);
    expect(Object.values(AUTH_MODEL_NAMES)).toEqual(
      expect.arrayContaining([
        "auth_user",
        "auth_session",
        "auth_account",
        "auth_verification",
      ]),
    );
  });
});
