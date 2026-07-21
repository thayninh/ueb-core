// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BusinessRole } from "@/generated/prisma/client";
import { getDashboard } from "@/lib/data/dashboard";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/authorization", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));
vi.mock("@/lib/server/prisma", () => ({
  getPrismaClient: () => ({
    auth_user: { findUnique: mocks.findUnique },
  }),
}));

describe("dashboard admin navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      name: "Opaque user",
      unitScopeAssignments: [],
    });
  });

  it("keeps the lecturer feature inventory exact", async () => {
    mocks.requireAuthenticated.mockResolvedValue({
      userId: "lecturer-user",
      roles: [BusinessRole.LECTURER],
    });

    const dashboard = await getDashboard();

    expect(dashboard.allowedFeatures.map(({ href }) => href)).toEqual([
      "/lecturer/profile",
    ]);
  });

  it("keeps the faculty-leader feature inventory exact", async () => {
    mocks.requireAuthenticated.mockResolvedValue({
      userId: "leader-user",
      roles: [BusinessRole.FACULTY_LEADER],
    });

    const dashboard = await getDashboard();

    expect(dashboard.allowedFeatures.map(({ href }) => href)).toEqual([
      "/leader/data",
      "/leader/submissions",
    ]);
  });

  it("keeps the pure-admin feature inventory exact", async () => {
    mocks.requireAuthenticated.mockResolvedValue({
      userId: "admin-user",
      roles: [BusinessRole.ADMIN],
    });

    const dashboard = await getDashboard();

    expect(dashboard.allowedFeatures.map(({ href }) => href)).toEqual([
      "/leader/submissions",
      "/admin/data",
      "/admin/users",
      "/admin/audit",
    ]);
  });
});
