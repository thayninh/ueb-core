// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccessProfileStatus, BusinessRole } from "@/generated/prisma/client";
import { getAdminUserManagement } from "@/lib/data/admin-data";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  userFindMany: vi.fn(),
  unitFindMany: vi.fn(),
  withCoreDataRlsContext: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/auth/dal", () => ({
  withCoreDataRlsContext: mocks.withCoreDataRlsContext,
}));
vi.mock("@/lib/server/prisma", () => ({
  getPrismaClient: () => ({
    auth_user: { findMany: mocks.userFindMany },
    organizationUnit: { findMany: mocks.unitFindMany },
  }),
}));

describe("admin user DTO", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ userId: "admin-user" });
    mocks.userFindMany.mockResolvedValue([
      {
        id: "target-user",
        name: "Target User",
        email: "target@example.edu",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        accessProfile: {
          status: AccessProfileStatus.ACTIVE,
          lecturerUid: null,
        },
        roleAssignments: [{ role: BusinessRole.ADMIN }],
        unitScopeAssignments: [],
        _count: { auth_sessions: 2 },
      },
    ]);
    mocks.unitFindMany.mockResolvedValue([]);
    mocks.withCoreDataRlsContext.mockResolvedValue([]);
  });

  it("returns session counts without selecting session or account secrets", async () => {
    const result = await getAdminUserManagement();

    expect(result.users[0]).toMatchObject({
      id: "target-user",
      sessionCount: 2,
      roles: [BusinessRole.ADMIN],
    });
    expect(result.users[0]).not.toHaveProperty("password");
    expect(result.users[0]).not.toHaveProperty("sessionToken");

    const selection = mocks.userFindMany.mock.calls[0]?.[0]?.select;
    expect(selection).not.toHaveProperty("auth_accounts");
    expect(selection).not.toHaveProperty("auth_sessions");
    expect(selection).toMatchObject({
      _count: { select: { auth_sessions: true } },
    });
  });
});
