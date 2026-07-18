// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccessProfileStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import {
  completeRequiredPasswordChange,
  getPasswordChangeRequirement,
  markPasswordChangeRequired,
} from "@/lib/auth/password-change";

vi.mock("server-only", () => ({}));

const cryptoMocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("better-auth/crypto", () => cryptoMocks);

const userId = "11111111-1111-4111-8111-111111111111";
const actorUserId = "22222222-2222-4222-8222-222222222222";

function databaseMock() {
  const transaction = {
    accessProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auth_account: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    auth_session: { deleteMany: vi.fn() },
    authAuditEvent: { create: vi.fn() },
  };
  const prisma = {
    accessProfile: { findUnique: vi.fn() },
    $transaction: vi.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  } as unknown as PrismaClient;
  return { prisma, transaction };
}

describe("required password change service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cryptoMocks.hashPassword.mockResolvedValue("new-supported-hash");
    cryptoMocks.verifyPassword.mockResolvedValue(true);
  });

  it("treats an existing default profile as not requiring a change", async () => {
    const { prisma } = databaseMock();
    vi.mocked(prisma.accessProfile.findUnique).mockResolvedValue({
      mustChangePassword: false,
      passwordChangedAt: null,
    } as never);

    await expect(getPasswordChangeRequirement(userId, prisma)).resolves.toEqual(
      { required: false, passwordChangedAt: null },
    );
  });

  it("fails closed when the profile state is missing", async () => {
    const { prisma } = databaseMock();
    vi.mocked(prisma.accessProfile.findUnique).mockResolvedValue(null);

    await expect(getPasswordChangeRequirement(userId, prisma)).rejects.toEqual(
      expect.objectContaining({ code: "PASSWORD_CHANGE_STATE_UNAVAILABLE" }),
    );
  });

  it("marks the requirement without exposing a separate flag-clear path", async () => {
    const { prisma, transaction } = databaseMock();
    transaction.accessProfile.findUnique.mockResolvedValue({ id: "profile" });
    transaction.accessProfile.update.mockResolvedValue({});
    transaction.authAuditEvent.create.mockResolvedValue({});

    await markPasswordChangeRequired(userId, actorUserId, prisma);

    expect(transaction.accessProfile.update).toHaveBeenCalledWith({
      where: { userId },
      data: { mustChangePassword: true },
    });
    const audit = transaction.authAuditEvent.create.mock.calls[0]?.[0];
    expect(audit.data.metadata).toEqual({
      passwordChangeRequired: true,
      secretFields: "NONE",
    });
    expect(audit.data.metadata).not.toHaveProperty("password");
    expect(audit.data.metadata).not.toHaveProperty("passwordHash");
  });

  it("rejects reuse before reading or mutating the credential account", async () => {
    const { prisma, transaction } = databaseMock();

    await expect(
      completeRequiredPasswordChange(
        {
          userId,
          currentPassword: "same-password-123",
          newPassword: "same-password-123",
        },
        prisma,
      ),
    ).rejects.toEqual(
      expect.objectContaining({ code: "PASSWORD_REUSE_NOT_ALLOWED" }),
    );
    expect(transaction.auth_account.findMany).not.toHaveBeenCalled();
  });

  it("keeps the flag when current-password verification fails", async () => {
    const { prisma, transaction } = readyDatabaseMock();
    cryptoMocks.verifyPassword.mockResolvedValue(false);

    await expect(
      completeRequiredPasswordChange(
        {
          userId,
          currentPassword: "incorrect-current-password",
          newPassword: "different-new-password-123",
        },
        prisma,
      ),
    ).rejects.toEqual(
      expect.objectContaining({ code: "INVALID_CURRENT_PASSWORD" }),
    );
    expect(transaction.auth_account.update).not.toHaveBeenCalled();
    expect(transaction.accessProfile.updateMany).not.toHaveBeenCalled();
  });

  it("updates the password before clearing the flag, audits no secret, and revokes all sessions", async () => {
    const { prisma, transaction } = readyDatabaseMock();
    const occurredAt = new Date("2026-07-18T12:00:00.000Z");

    await expect(
      completeRequiredPasswordChange(
        {
          userId,
          currentPassword: "current-password-123",
          newPassword: "different-new-password-123",
          occurredAt,
        },
        prisma,
      ),
    ).resolves.toEqual({
      passwordChangedAt: occurredAt,
      revokedSessionCount: 3,
    });

    expect(transaction.auth_account.update).toHaveBeenCalledWith({
      where: { id: "credential-account" },
      data: { password: "new-supported-hash" },
    });
    expect(transaction.accessProfile.updateMany).toHaveBeenCalledWith({
      where: { userId, mustChangePassword: true },
      data: { mustChangePassword: false, passwordChangedAt: occurredAt },
    });
    expect(
      transaction.auth_account.update.mock.invocationCallOrder[0],
    ).toBeLessThan(
      transaction.accessProfile.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(transaction.auth_session.deleteMany).toHaveBeenCalledWith({
      where: { userId },
    });
    const auditInput = transaction.authAuditEvent.create.mock.calls[0]?.[0];
    expect(auditInput).toEqual({
      data: expect.objectContaining({
        eventType: "AUTH_REQUIRED_PASSWORD_CHANGED",
        actorUserId: userId,
        targetUserId: userId,
        metadata: {
          secretFields: "NONE",
          sessionRevocation: "ALL",
          revokedSessionCount: 3,
        },
      }),
    });
    expect(JSON.stringify(auditInput)).not.toContain("current-password-123");
    expect(JSON.stringify(auditInput)).not.toContain(
      "different-new-password-123",
    );
    expect(JSON.stringify(auditInput)).not.toContain("new-supported-hash");
  });

  it("never clears the flag when the password update fails", async () => {
    const { prisma, transaction } = readyDatabaseMock();
    transaction.auth_account.update.mockRejectedValue(
      new Error("password update failed"),
    );

    await expect(
      completeRequiredPasswordChange(
        {
          userId,
          currentPassword: "current-password-123",
          newPassword: "different-new-password-123",
        },
        prisma,
      ),
    ).rejects.toThrow("password update failed");
    expect(transaction.accessProfile.updateMany).not.toHaveBeenCalled();
  });

  it("does not report success when the audit insert fails", async () => {
    const { prisma, transaction } = readyDatabaseMock();
    transaction.authAuditEvent.create.mockRejectedValue(
      new Error("audit insert failed"),
    );

    await expect(
      completeRequiredPasswordChange(
        {
          userId,
          currentPassword: "current-password-123",
          newPassword: "different-new-password-123",
        },
        prisma,
      ),
    ).rejects.toThrow("audit insert failed");
  });
});

function readyDatabaseMock() {
  const result = databaseMock();
  result.transaction.accessProfile.findUnique.mockResolvedValue({
    status: AccessProfileStatus.ACTIVE,
    mustChangePassword: true,
  });
  result.transaction.auth_account.findMany.mockResolvedValue([
    { id: "credential-account", password: "current-supported-hash" },
  ]);
  result.transaction.auth_account.update.mockResolvedValue({});
  result.transaction.accessProfile.updateMany.mockResolvedValue({ count: 1 });
  result.transaction.auth_session.deleteMany.mockResolvedValue({ count: 3 });
  result.transaction.authAuditEvent.create.mockResolvedValue({});
  return result;
}
