// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BusinessRole } from "@/generated/prisma/client";
import { getAdminData } from "@/lib/data/admin-data";
import { UEB_CORE_DATA_DTO_SELECT } from "@/lib/data/dto";
import { getLeaderData, getLeaderDataPage } from "@/lib/data/leader-data";
import { getLecturerData } from "@/lib/data/lecturer-data";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireLecturerIdentity: vi.fn(),
  requireRole: vi.fn(),
  requireUnitScope: vi.fn(),
  coreFindMany: vi.fn(),
  coreCount: vi.fn(),
  unitFindMany: vi.fn(),
  unitFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: mocks.requireAdmin,
  requireLecturerIdentity: mocks.requireLecturerIdentity,
  requireRole: mocks.requireRole,
  requireUnitScope: mocks.requireUnitScope,
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
          uebCoreData: {
            findMany: typeof mocks.coreFindMany;
            count: typeof mocks.coreCount;
          };
          organizationUnit: {
            findMany: typeof mocks.unitFindMany;
            findFirst: typeof mocks.unitFindFirst;
          };
        }) => Promise<unknown>,
      ) =>
        callback({
          $queryRaw: mocks.queryRaw,
          uebCoreData: {
            findMany: mocks.coreFindMany,
            count: mocks.coreCount,
          },
          organizationUnit: {
            findMany: mocks.unitFindMany,
            findFirst: mocks.unitFindFirst,
          },
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

  it("validates the selected unit and applies server-side search and pagination", async () => {
    mocks.requireUnitScope.mockResolvedValue({ userId: "leader-user-id" });
    mocks.unitFindFirst.mockResolvedValue({
      id: "assigned-unit-id",
      displayName: "Assigned unit",
      sourceValue: "Exact assigned source value",
    });
    mocks.coreCount.mockResolvedValue(51);

    const result = await getLeaderDataPage({
      unitId: "assigned-unit-id",
      search: "  Lecturer name  ",
      page: 2,
    });

    expect(mocks.requireUnitScope).toHaveBeenCalledWith("assigned-unit-id");
    expect(mocks.unitFindFirst).toHaveBeenCalledWith({
      where: { id: "assigned-unit-id", isActive: true },
      select: { id: true, displayName: true, sourceValue: true },
    });
    expect(mocks.coreCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        approvalUnit: "Exact assigned source value",
        OR: expect.any(Array),
      }),
    });
    expect(mocks.coreFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          approvalUnit: "Exact assigned source value",
        }),
        skip: 25,
        take: 25,
      }),
    );
    expect(result).toMatchObject({
      search: "Lecturer name",
      page: 2,
      pageSize: 25,
      totalRows: 51,
      totalPages: 3,
    });
  });
});
