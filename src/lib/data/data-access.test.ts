// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BusinessRole } from "@/generated/prisma/client";
import { getAdminData } from "@/lib/data/admin-data";
import { UEB_CORE_DATA_DTO_SELECT } from "@/lib/data/dto";
import { getLeaderData } from "@/lib/data/leader-data";
import { getLecturerData } from "@/lib/data/lecturer-data";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireLecturerIdentity: vi.fn(),
  requireRole: vi.fn(),
  coreFindMany: vi.fn(),
  unitFindMany: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: mocks.requireAdmin,
  requireLecturerIdentity: mocks.requireLecturerIdentity,
  requireRole: mocks.requireRole,
}));
vi.mock("@/lib/server/prisma", () => ({
  getPrismaClient: () => ({
    $transaction: mocks.transaction,
  }),
}));

describe("role-scoped core data DAL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.coreFindMany.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([{ set_config: "" }]);
    mocks.transaction.mockImplementation(
      async (
        callback: (transaction: {
          $queryRaw: typeof mocks.queryRaw;
          uebCoreData: { findMany: typeof mocks.coreFindMany };
          organizationUnit: { findMany: typeof mocks.unitFindMany };
        }) => Promise<unknown>,
      ) =>
        callback({
          $queryRaw: mocks.queryRaw,
          uebCoreData: { findMany: mocks.coreFindMany },
          organizationUnit: { findMany: mocks.unitFindMany },
        }),
    );
  });

  it("always scopes lecturer rows to the authenticated lecturer identity", async () => {
    mocks.requireLecturerIdentity.mockResolvedValue({
      userId: "lecturer-user-id",
      lecturerUid: "lecturer-from-database",
    });

    await getLecturerData();

    expect(mocks.coreFindMany).toHaveBeenCalledWith({
      where: { lecturerUid: "lecturer-from-database" },
      orderBy: { stt: "asc" },
      select: UEB_CORE_DATA_DTO_SELECT,
    });
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.coreFindMany.mock.invocationCallOrder[0] ?? 0,
    );
    expect(getLecturerData).toHaveLength(0);
  });

  it("resolves leader source values only from active assigned unit IDs", async () => {
    mocks.requireRole.mockResolvedValue({
      userId: "leader-user-id",
      activeUnitIds: ["assigned-unit-id"],
    });
    mocks.unitFindMany.mockResolvedValue([
      { sourceValue: "Exact database approval unit" },
    ]);

    await getLeaderData();

    expect(mocks.requireRole).toHaveBeenCalledWith(
      BusinessRole.FACULTY_LEADER,
    );
    expect(mocks.unitFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["assigned-unit-id"] },
        isActive: true,
      },
      select: { sourceValue: true },
    });
    expect(mocks.coreFindMany).toHaveBeenCalledWith({
      where: {
        approvalUnit: { in: ["Exact database approval unit"] },
      },
      orderBy: { stt: "asc" },
      select: UEB_CORE_DATA_DTO_SELECT,
    });
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(getLeaderData).toHaveLength(0);
  });

  it("requires ADMIN before using the all-rows DAL", async () => {
    mocks.requireAdmin.mockResolvedValue({ userId: "admin-user-id" });

    await getAdminData();

    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.coreFindMany).toHaveBeenCalledWith({
      orderBy: { stt: "asc" },
      select: UEB_CORE_DATA_DTO_SELECT,
    });
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });
});
