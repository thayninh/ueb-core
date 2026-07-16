// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccessProfileStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { disableUserAndRevokeSessions } from "@/lib/auth/account-lifecycle";

vi.mock("server-only", () => ({}));

const actorUserId = "11111111-1111-4111-8111-111111111111";
const targetUserId = "22222222-2222-4222-8222-222222222222";

function createDatabaseMock(status: AccessProfileStatus, sessionCount: number) {
  const transaction = {
    roleAssignment: {
      findFirst: vi.fn().mockResolvedValue({ id: "admin-role" }),
    },
    accessProfile: {
      findUnique: vi.fn().mockResolvedValue({ status }),
      update: vi.fn().mockResolvedValue({}),
    },
    auth_session: {
      deleteMany: vi.fn().mockResolvedValue({ count: sessionCount }),
    },
    authAuditEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  } as unknown as PrismaClient;

  return { prisma, transaction };
}

describe("account lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables the profile, revokes every session, and appends audit", async () => {
    const { prisma, transaction } = createDatabaseMock(
      AccessProfileStatus.ACTIVE,
      3,
    );

    await expect(
      disableUserAndRevokeSessions({ actorUserId, targetUserId }, prisma),
    ).resolves.toEqual({ status: "DISABLED", revokedSessionCount: 3 });
    expect(transaction.accessProfile.update).toHaveBeenCalledWith({
      where: { userId: targetUserId },
      data: { status: AccessProfileStatus.DISABLED },
    });
    expect(transaction.auth_session.deleteMany).toHaveBeenCalledWith({
      where: { userId: targetUserId },
    });
    expect(transaction.authAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "USER_DISABLED",
        actorUserId,
        targetUserId,
        metadata: expect.objectContaining({ revokedSessionCount: 3 }),
      }),
    });
  });

  it("is idempotent when the user is already disabled and has no session", async () => {
    const { prisma, transaction } = createDatabaseMock(
      AccessProfileStatus.DISABLED,
      0,
    );

    await expect(
      disableUserAndRevokeSessions({ actorUserId, targetUserId }, prisma),
    ).resolves.toEqual({
      status: "ALREADY_DISABLED",
      revokedSessionCount: 0,
    });
    expect(transaction.accessProfile.update).not.toHaveBeenCalled();
    expect(transaction.authAuditEvent.create).not.toHaveBeenCalled();
  });
});
