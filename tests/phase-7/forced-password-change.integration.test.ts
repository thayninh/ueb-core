// @vitest-environment node

import "dotenv/config";

import { randomBytes, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { Client, Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AccessProfileStatus, PrismaClient } from "@/generated/prisma/client";
import { createBetterAuthOptions } from "@/lib/auth/options";
import {
  completeRequiredPasswordChange,
  RequiredPasswordChangeError,
} from "@/lib/auth/password-change";
import {
  assertExactPhase3TestDatabase,
  PHASE3_REHEARSAL_DATABASE,
  readPhase3TestDatabaseUrls,
} from "../../scripts/phase-3/lib/test-database";

vi.mock("server-only", () => ({}));

const integrationEnabled =
  process.env.PHASE7_PASSWORD_CHANGE_INTEGRATION === "1";
const isolatedDescribe = integrationEnabled
  ? describe.sequential
  : describe.skip;
const email = "phase7-password-change@localhost.test";
const initialPassword = `${randomBytes(24).toString("base64url")}Aa1!`;
const newPassword = `${randomBytes(24).toString("base64url")}Bb2!`;

let owner: Client;
let runtimePool: Pool;
let prisma: PrismaClient;
let auth: ReturnType<typeof betterAuth>;
let userId: string;

isolatedDescribe("Phase 7 forced password change integration", () => {
  beforeAll(async () => {
    const urls = readPhase3TestDatabaseUrls(process.env);
    assertExactPhase3TestDatabase(
      urls.rehearsalMigrationUrl,
      PHASE3_REHEARSAL_DATABASE,
    );
    owner = new Client({
      connectionString: urls.rehearsalMigrationUrl,
      application_name: "ueb-core-phase7-password-change-owner-test",
    });
    runtimePool = new Pool({
      connectionString: urls.rehearsalRuntimeUrl,
      application_name: "ueb-core-phase7-password-change-runtime-test",
      max: 4,
    });
    prisma = new PrismaClient({
      adapter: new PrismaPg(runtimePool, { disposeExternalPool: false }),
    });
    await owner.connect();

    userId = randomUUID();
    await prisma.$transaction(async (transaction) => {
      await transaction.auth_user.create({
        data: { id: userId, email, name: "Phase 7 local test user" },
      });
      await transaction.auth_account.create({
        data: {
          accountId: userId,
          providerId: "credential",
          userId,
          password: await hashPassword(initialPassword),
        },
      });
      await transaction.accessProfile.create({
        data: {
          userId,
          status: AccessProfileStatus.ACTIVE,
          mustChangePassword: true,
          createdBy: userId,
        },
      });
      await transaction.roleAssignment.create({
        data: { userId, role: "ADMIN", grantedBy: userId },
      });
    });

    auth = betterAuth(
      createBetterAuthOptions({
        database: prismaAdapter(prisma, { provider: "postgresql" }),
        environment: {
          baseUrl: "http://localhost:3000",
          secret: "p".repeat(32),
          trustedOrigins: ["http://localhost:3000"],
        },
        isUserSessionEligible: async (candidateUserId) => {
          const profile = await prisma.accessProfile.findUnique({
            where: { userId: candidateUserId },
            select: { status: true },
          });
          return profile?.status === AccessProfileStatus.ACTIVE;
        },
      }),
    );
  }, 60_000);

  beforeEach(async () => {
    await dropAuditFailureTrigger();
    await prisma.$transaction(async (transaction) => {
      const account = await transaction.auth_account.findFirstOrThrow({
        where: { userId, providerId: "credential" },
        select: { id: true },
      });
      await transaction.auth_account.update({
        where: { id: account.id },
        data: { password: await hashPassword(initialPassword) },
      });
      await transaction.accessProfile.update({
        where: { userId },
        data: { mustChangePassword: true, passwordChangedAt: null },
      });
      await transaction.auth_session.deleteMany({ where: { userId } });
    });
  });

  afterAll(async () => {
    await dropAuditFailureTrigger().catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
    await runtimePool?.end().catch(() => undefined);
    await owner?.end().catch(() => undefined);
  });

  it("keeps the forced state for wrong current password and password reuse", async () => {
    await expect(
      completeRequiredPasswordChange(
        {
          userId,
          currentPassword: "wrong-current-password",
          newPassword,
        },
        prisma,
      ),
    ).rejects.toBeInstanceOf(RequiredPasswordChangeError);
    await expect(
      completeRequiredPasswordChange(
        {
          userId,
          currentPassword: initialPassword,
          newPassword: initialPassword,
        },
        prisma,
      ),
    ).rejects.toEqual(
      expect.objectContaining({ code: "PASSWORD_REUSE_NOT_ALLOWED" }),
    );
    await expect(readProfile()).resolves.toMatchObject({
      mustChangePassword: true,
      passwordChangedAt: null,
    });
  });

  it("rolls back password, flag, sessions, and success result when audit fails", async () => {
    await installAuditFailureTrigger();
    try {
      await expect(
        completeRequiredPasswordChange(
          { userId, currentPassword: initialPassword, newPassword },
          prisma,
        ),
      ).rejects.toThrow(/phase7 injected audit failure/u);

      const [profile, account] = await Promise.all([
        readProfile(),
        prisma.auth_account.findFirstOrThrow({
          where: { userId, providerId: "credential" },
          select: { password: true },
        }),
      ]);
      expect(profile).toMatchObject({
        mustChangePassword: true,
        passwordChangedAt: null,
      });
      expect(
        await verifyPassword({
          hash: account.password!,
          password: initialPassword,
        }),
      ).toBe(true);
      expect(
        await verifyPassword({
          hash: account.password!,
          password: newPassword,
        }),
      ).toBe(false);
    } finally {
      await dropAuditFailureTrigger();
    }
  });

  it("allows only one consistent winner for concurrent change attempts", async () => {
    const attempts = await Promise.allSettled([
      completeRequiredPasswordChange(
        { userId, currentPassword: initialPassword, newPassword },
        prisma,
      ),
      completeRequiredPasswordChange(
        { userId, currentPassword: initialPassword, newPassword },
        prisma,
      ),
    ]);
    expect(
      attempts.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    await expect(readProfile()).resolves.toMatchObject({
      mustChangePassword: false,
      passwordChangedAt: expect.any(Date),
    });
    const account = await prisma.auth_account.findFirstOrThrow({
      where: { userId, providerId: "credential" },
      select: { password: true },
    });
    expect(
      await verifyPassword({ hash: account.password!, password: newPassword }),
    ).toBe(true);
  });

  it("atomically changes the password, records timestamp/audit, and revokes every session", async () => {
    const firstLogin = await signIn(initialPassword);
    const secondLogin = await signIn(initialPassword);
    expect(firstLogin.ok).toBe(true);
    expect(secondLogin.ok).toBe(true);
    const firstCookie = readSessionCookie(firstLogin);
    expect(await prisma.auth_session.count({ where: { userId } })).toBe(2);

    const result = await completeRequiredPasswordChange(
      { userId, currentPassword: initialPassword, newPassword },
      prisma,
    );
    expect(result.revokedSessionCount).toBe(2);
    expect(await prisma.auth_session.count({ where: { userId } })).toBe(0);

    const profile = await readProfile();
    expect(profile.mustChangePassword).toBe(false);
    expect(profile.passwordChangedAt).toBeInstanceOf(Date);
    const audit = await prisma.authAuditEvent.findFirstOrThrow({
      where: {
        eventType: "AUTH_REQUIRED_PASSWORD_CHANGED",
        targetUserId: userId,
      },
      orderBy: { occurredAt: "desc" },
      select: { actorUserId: true, targetUserId: true, metadata: true },
    });
    expect(audit).toMatchObject({
      actorUserId: userId,
      targetUserId: userId,
      metadata: {
        secretFields: "NONE",
        sessionRevocation: "ALL",
        revokedSessionCount: 2,
      },
    });
    expect(JSON.stringify(audit)).not.toContain(initialPassword);
    expect(JSON.stringify(audit)).not.toContain(newPassword);

    const staleSession = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session", {
        headers: { cookie: firstCookie },
      }),
    );
    expect(await staleSession.json()).toBeNull();
    expect((await signIn(initialPassword)).ok).toBe(false);
    expect((await signIn(newPassword)).ok).toBe(true);
  });
});

async function readProfile() {
  return prisma.accessProfile.findUniqueOrThrow({
    where: { userId },
    select: { mustChangePassword: true, passwordChangedAt: true },
  });
}

async function signIn(password: string): Promise<Response> {
  return auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
}

function readSessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const tokenCookie = setCookie
    .split(/,(?=\s*better-auth\.)/u)
    .find((entry) => entry.includes("better-auth.session_token="));
  if (!tokenCookie) throw new Error("Better Auth session cookie was not set.");
  return tokenCookie.split(";", 1)[0]!;
}

async function installAuditFailureTrigger(): Promise<void> {
  await owner.query(`
    CREATE OR REPLACE FUNCTION public.phase7_reject_password_change_audit()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      IF NEW.event_type = 'AUTH_REQUIRED_PASSWORD_CHANGED' THEN
        RAISE EXCEPTION 'phase7 injected audit failure';
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE TRIGGER phase7_reject_password_change_audit
    BEFORE INSERT ON public.auth_audit_event
    FOR EACH ROW
    EXECUTE FUNCTION public.phase7_reject_password_change_audit();
  `);
}

async function dropAuditFailureTrigger(): Promise<void> {
  if (!owner) return;
  await owner.query(`
    DROP TRIGGER IF EXISTS phase7_reject_password_change_audit
      ON public.auth_audit_event;
    DROP FUNCTION IF EXISTS public.phase7_reject_password_change_audit();
  `);
}
