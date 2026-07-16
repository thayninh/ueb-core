// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccessProfileStatus, BusinessRole } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  findUnique: vi.fn(),
  getActiveSession: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  getActiveSession: mocks.getActiveSession,
}));
vi.mock("@/lib/server/prisma", () => ({
  getPrismaClient: () => ({
    $transaction: mocks.transaction,
    accessProfile: { findUnique: mocks.findUnique },
  }),
}));

import { getCurrentPrincipal } from "@/lib/auth/dal";
import { withCoreDataRlsContext } from "@/lib/auth/rls-context";

describe("current principal DAL", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only active database roles, scopes, and identity fields", async () => {
    mocks.getActiveSession.mockResolvedValue({ userId: "user-1" });
    mocks.findUnique.mockResolvedValue({
      userId: "user-1",
      lecturerUid: "lecturer-1",
      status: AccessProfileStatus.ACTIVE,
      user: {
        roleAssignments: [{ role: BusinessRole.LECTURER }],
        unitScopeAssignments: [{ organizationUnitId: "unit-1" }],
      },
    });

    await expect(getCurrentPrincipal()).resolves.toEqual({
      userId: "user-1",
      roles: [BusinessRole.LECTURER],
      lecturerUid: "lecturer-1",
      activeUnitIds: ["unit-1"],
      status: AccessProfileStatus.ACTIVE,
    });
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        select: expect.objectContaining({
          userId: true,
          lecturerUid: true,
          status: true,
        }),
      }),
    );
    expect(mocks.findUnique.mock.calls[0]?.[0]).toMatchObject({
      select: {
        user: {
          select: {
            roleAssignments: { where: { revokedAt: null } },
            unitScopeAssignments: { where: { revokedAt: null } },
          },
        },
      },
    });
    expect(mocks.findUnique.mock.calls[0]?.[0]).not.toHaveProperty(
      "select.user.email",
    );
  });
});

describe("withCoreDataRlsContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeRaw.mockResolvedValue(0);
    mocks.queryRaw.mockResolvedValue([{ set_config: "actor-id" }]);
    mocks.transaction.mockImplementation(
      async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation({
          $executeRaw: mocks.executeRaw,
          $queryRaw: mocks.queryRaw,
        }),
    );
  });

  it("sets a transaction-local RLS actor inside a read-only transaction", async () => {
    const query = vi.fn().mockResolvedValue("visible-core-rows");

    await expect(
      withCoreDataRlsContext({ userId: "actor-id" }, query, {
        readOnly: true,
      }),
    ).resolves.toBe("visible-core-rows");

    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queryRaw.mock.invocationCallOrder[0]!,
    );
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      query.mock.invocationCallOrder[0]!,
    );
  });

  it("uses an explicitly injected database client for dedicated operations", async () => {
    const dedicatedTransaction = vi.fn(
      async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation({
          $executeRaw: mocks.executeRaw,
          $queryRaw: mocks.queryRaw,
        }),
    );

    await withCoreDataRlsContext(
      { userId: "actor-id" },
      vi.fn().mockResolvedValue("dedicated-result"),
      {
        readOnly: true,
        prisma: {
          $transaction: dedicatedTransaction,
        } as never,
      },
    );

    expect(dedicatedTransaction).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
