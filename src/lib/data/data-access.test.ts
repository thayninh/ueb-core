// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BusinessRole } from "@/generated/prisma/client";
import { getAdminData } from "@/lib/data/admin-data";
import { getLeaderData, getLeaderDataPage } from "@/lib/data/leader-data";
import { getLecturerData } from "@/lib/data/lecturer-data";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireLecturerIdentity: vi.fn(),
  requireRole: vi.fn(),
  requireUnitScope: vi.fn(),
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
    mocks.queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
      const sql = query.strings?.join("?") ?? "";
      if (sql.includes("set_config")) return Promise.resolve([{ set_config: "" }]);
      if (sql.includes("count(*)")) return Promise.resolve([{ totalRows: 51 }]);
      return Promise.resolve([]);
    });
    mocks.transaction.mockImplementation(
      async (
        callback: (transaction: {
          $queryRaw: typeof mocks.queryRaw;
          organizationUnit: {
            findMany: typeof mocks.unitFindMany;
            findFirst: typeof mocks.unitFindFirst;
          };
        }) => Promise<unknown>,
      ) =>
        callback({
          $queryRaw: mocks.queryRaw,
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

    expect(mocks.requireLecturerIdentity).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.queryRaw.mock.invocationCallOrder[1] ?? 0,
    );
    expect(rawQueryValues(1)).toContain("lecturer-from-database");
    expect(rawQueryText(1)).toContain('PARTITION BY "core"."record_uid"');
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
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(rawQueryValues(1)).toContain("Exact database approval unit");
    expect(getLeaderData).toHaveLength(0);
  });

  it("requires ADMIN before using the all-rows DAL", async () => {
    mocks.requireAdmin.mockResolvedValue({ userId: "admin-user-id" });

    await getAdminData();

    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(rawQueryText(1)).toContain('WHERE TRUE');
  });

  it("validates the selected unit and applies server-side search and pagination", async () => {
    mocks.requireUnitScope.mockResolvedValue({ userId: "leader-user-id" });
    mocks.unitFindFirst.mockResolvedValue({
      id: "assigned-unit-id",
      displayName: "Assigned unit",
      sourceValue: "Exact assigned source value",
    });
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
    expect(mocks.queryRaw).toHaveBeenCalledTimes(3);
    expect(rawQueryText(1)).toContain("count(*)");
    expect(rawQueryText(2)).toContain("LIMIT");
    expect(rawQueryValues(1)).toEqual(
      expect.arrayContaining(["Exact assigned source value", "%Lecturer name%"]),
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

function rawQueryText(index: number): string {
  const query = mocks.queryRaw.mock.calls[index]?.[0] as {
    strings?: readonly string[];
  };
  return query.strings?.join("?") ?? "";
}

function rawQueryValues(index: number): readonly unknown[] {
  const query = mocks.queryRaw.mock.calls[index]?.[0] as {
    values?: readonly unknown[];
  };
  return query.values ?? [];
}
