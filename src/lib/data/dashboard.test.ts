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

  it("links pure ADMIN to the all-latest read-only portal", async () => {
    mocks.requireAuthenticated.mockResolvedValue({
      userId: "admin-user",
      roles: [BusinessRole.ADMIN],
    });

    const dashboard = await getDashboard();

    expect(dashboard.allowedFeatures).toContainEqual(
      expect.objectContaining({ href: "/admin/data" }),
    );
    expect(dashboard.allowedFeatures).not.toContainEqual(
      expect.objectContaining({ href: "/leader/data" }),
    );
  });

  it("does not expose the admin portal link to non-admin roles", async () => {
    mocks.requireAuthenticated.mockResolvedValue({
      userId: "leader-user",
      roles: [BusinessRole.FACULTY_LEADER],
    });

    const dashboard = await getDashboard();

    expect(dashboard.allowedFeatures).not.toContainEqual(
      expect.objectContaining({ href: "/admin/data" }),
    );
    expect(dashboard.allowedFeatures).toContainEqual(
      expect.objectContaining({ href: "/leader/data" }),
    );
  });
});
