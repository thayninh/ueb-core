// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  guardBetterAuthRequest,
  isAllowedAuthPathDuringRequiredPasswordChange,
  passwordChangeRequiredApiResponse,
  REQUIRED_PASSWORD_CHANGE_AUTH_ALLOWLIST,
} from "@/lib/auth/password-change-route-guard";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPasswordChangeRequirement: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } }),
}));
vi.mock("@/lib/auth/password-change", () => ({
  getPasswordChangeRequirement: mocks.getPasswordChangeRequirement,
}));

describe("required password change route guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getPasswordChangeRequirement.mockResolvedValue({ required: true });
  });

  it("keeps the auth allowlist exact and minimal", () => {
    expect(REQUIRED_PASSWORD_CHANGE_AUTH_ALLOWLIST).toEqual([
      "/api/auth/get-session",
      "/api/auth/sign-out",
    ]);
    expect(
      isAllowedAuthPathDuringRequiredPasswordChange("/api/auth/get-session"),
    ).toBe(true);
    expect(
      isAllowedAuthPathDuringRequiredPasswordChange("/api/auth/sign-out"),
    ).toBe(true);
    expect(
      isAllowedAuthPathDuringRequiredPasswordChange(
        "/api/auth/change-password",
      ),
    ).toBe(false);
    expect(
      isAllowedAuthPathDuringRequiredPasswordChange("/api/auth/list-sessions"),
    ).toBe(false);
    expect(
      isAllowedAuthPathDuringRequiredPasswordChange(
        "/api/auth/sign-out?bypass=1",
      ),
    ).toBe(false);
  });

  it("returns the machine-readable API error", async () => {
    const response = passwordChangeRequiredApiResponse();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  });

  it("blocks a direct Better Auth password change from bypassing the domain transaction", async () => {
    const response = await guardBetterAuthRequest(
      new Request("http://localhost:3000/api/auth/change-password", {
        method: "POST",
      }),
    );
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  });

  it("allows logout without querying forced-change state", async () => {
    await expect(
      guardBetterAuthRequest(
        new Request("http://localhost:3000/api/auth/sign-out", {
          method: "POST",
        }),
      ),
    ).resolves.toBeNull();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("fails closed when authenticated state cannot be loaded", async () => {
    mocks.getPasswordChangeRequirement.mockRejectedValue(
      new Error("missing profile"),
    );
    const response = await guardBetterAuthRequest(
      new Request("http://localhost:3000/api/auth/list-sessions"),
    );
    expect(response?.status).toBe(403);
  });

  it("does not block unauthenticated or non-required sessions", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    await expect(
      guardBetterAuthRequest(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
        }),
      ),
    ).resolves.toBeNull();

    mocks.getPasswordChangeRequirement.mockResolvedValueOnce({
      required: false,
    });
    await expect(
      guardBetterAuthRequest(
        new Request("http://localhost:3000/api/auth/list-sessions"),
      ),
    ).resolves.toBeNull();
  });
});
