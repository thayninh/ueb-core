// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccessProfileStatus, BusinessRole } from "@/generated/prisma/client";
import {
  AuthorizationError,
  requireAdmin,
  requireAnyRole,
  requireLecturerIdentity,
  requireUnitScope,
} from "@/lib/auth/authorization";

const mocks = vi.hoisted(() => ({ getCurrentPrincipal: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/dal", () => ({
  getCurrentPrincipal: mocks.getCurrentPrincipal,
}));

const basePrincipal = {
  userId: "user-1",
  roles: [BusinessRole.LECTURER] as const,
  lecturerUid: "lecturer-1",
  activeUnitIds: [] as readonly string[],
  status: AccessProfileStatus.ACTIVE,
};

describe("authorization guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentPrincipal.mockResolvedValue(basePrincipal);
  });

  it("denies roles not granted by the current database principal", async () => {
    await expect(requireAdmin()).rejects.toMatchObject({
      name: "AuthorizationError",
      code: "FORBIDDEN",
    });
  });

  it("requires a lecturer mapping as well as the LECTURER role", async () => {
    mocks.getCurrentPrincipal.mockResolvedValue({
      ...basePrincipal,
      lecturerUid: null,
    });

    await expect(requireLecturerIdentity()).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("denies an unassigned unit even for a faculty leader", async () => {
    mocks.getCurrentPrincipal.mockResolvedValue({
      ...basePrincipal,
      roles: [BusinessRole.FACULTY_LEADER],
      activeUnitIds: ["unit-1"],
    });

    await expect(requireUnitScope("unit-from-client")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects an empty any-role policy instead of allowing it", async () => {
    await expect(requireAnyRole([])).rejects.toMatchObject({
      code: "INVALID_AUTHORIZATION_REQUEST",
    });
    expect(mocks.getCurrentPrincipal).not.toHaveBeenCalled();
  });
});
