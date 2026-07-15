// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccessProfileStatus, BusinessRole } from "@/generated/prisma/client";
import { getCurrentPrincipal } from "@/lib/auth/dal";

const mocks = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  getActiveSession: mocks.getActiveSession,
}));
vi.mock("@/lib/server/prisma", () => ({
  getPrismaClient: () => ({
    accessProfile: { findUnique: mocks.findUnique },
  }),
}));

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
    expect(mocks.findUnique.mock.calls[0]?.[0]).not.toHaveProperty(
      "select.user.email",
    );
  });
});
