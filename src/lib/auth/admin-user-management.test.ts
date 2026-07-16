// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccessProfileStatus,
  BusinessRole,
  type PrismaClient,
} from "@/generated/prisma/client";
import {
  revokeUserSessions,
  setUserRole,
  setUserUnitScope,
} from "@/lib/auth/admin-user-management";

vi.mock("server-only", () => ({}));

const actorUserId = "11111111-1111-4111-8111-111111111111";
const targetUserId = "22222222-2222-4222-8222-222222222222";
const organizationUnitId = "33333333-3333-4333-8333-333333333333";

function databaseMock() {
  const transaction = {
    roleAssignment: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    accessProfile: { findUnique: vi.fn() },
    organizationUnit: { findFirst: vi.fn() },
    unitScopeAssignment: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auth_session: { deleteMany: vi.fn() },
    authAuditEvent: { create: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  } as unknown as PrismaClient;
  return { prisma, transaction };
}

describe("admin user management service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses LECTURER without a lecturer_uid mapping", async () => {
    const { prisma, transaction } = databaseMock();
    transaction.roleAssignment.findFirst
      .mockResolvedValueOnce({ id: "admin-role" })
      .mockResolvedValueOnce(null);
    transaction.accessProfile.findUnique.mockResolvedValue({
      status: AccessProfileStatus.ACTIVE,
      lecturerUid: null,
    });

    await expect(
      setUserRole(
        {
          actorUserId,
          targetUserId,
          role: BusinessRole.LECTURER,
          enabled: true,
        },
        prisma,
      ),
    ).rejects.toThrow(/lecturer_uid/u);
    expect(transaction.roleAssignment.create).not.toHaveBeenCalled();
  });

  it("refuses to remove the final unit from an active leader", async () => {
    const { prisma, transaction } = databaseMock();
    transaction.roleAssignment.findFirst.mockResolvedValue({
      id: "admin-role",
    });
    transaction.accessProfile.findUnique.mockResolvedValue({
      status: AccessProfileStatus.ACTIVE,
      lecturerUid: null,
    });
    transaction.organizationUnit.findFirst.mockResolvedValue({
      id: organizationUnitId,
    });
    transaction.unitScopeAssignment.findFirst.mockResolvedValue({
      id: "scope-id",
    });
    transaction.roleAssignment.count.mockResolvedValue(1);
    transaction.unitScopeAssignment.count.mockResolvedValue(1);

    await expect(
      setUserUnitScope(
        {
          actorUserId,
          targetUserId,
          organizationUnitId,
          enabled: false,
        },
        prisma,
      ),
    ).rejects.toThrow(/final unit scope/u);
    expect(transaction.unitScopeAssignment.update).not.toHaveBeenCalled();
  });

  it("revokes sessions and audits only the aggregate count", async () => {
    const { prisma, transaction } = databaseMock();
    transaction.roleAssignment.findFirst.mockResolvedValue({
      id: "admin-role",
    });
    transaction.accessProfile.findUnique.mockResolvedValue({
      status: AccessProfileStatus.ACTIVE,
      lecturerUid: null,
    });
    transaction.auth_session.deleteMany.mockResolvedValue({ count: 3 });
    transaction.authAuditEvent.create.mockResolvedValue({});

    await expect(
      revokeUserSessions({ actorUserId, targetUserId }, prisma),
    ).resolves.toBe(3);
    expect(transaction.authAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "SESSION_REVOKED",
        metadata: {
          revocationType: "ADMIN_REQUEST",
          revokedSessionCount: 3,
        },
      }),
    });
    expect(
      transaction.authAuditEvent.create.mock.calls[0]?.[0],
    ).not.toHaveProperty("data.sessionToken");
  });

  it("propagates audit insert failure from the permission transaction", async () => {
    const { prisma, transaction } = databaseMock();
    transaction.roleAssignment.findFirst
      .mockResolvedValueOnce({ id: "admin-role" })
      .mockResolvedValueOnce(null);
    transaction.accessProfile.findUnique.mockResolvedValue({
      status: AccessProfileStatus.ACTIVE,
      lecturerUid: "44444444-4444-4444-8444-444444444444",
    });
    transaction.roleAssignment.create.mockResolvedValue({});
    transaction.authAuditEvent.create.mockRejectedValue(
      new Error("audit insert failed"),
    );

    await expect(
      setUserRole(
        {
          actorUserId,
          targetUserId,
          role: BusinessRole.LECTURER,
          enabled: true,
        },
        prisma,
      ),
    ).rejects.toThrow("audit insert failed");
    expect(transaction.roleAssignment.create).toHaveBeenCalledOnce();
  });
});
