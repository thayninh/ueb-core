// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { signInAction } from "@/app/actions/auth";
import { GENERIC_SIGN_IN_ERROR } from "@/lib/auth/sign-in-policy";

const mocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  recordLoginFailure: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
}));
vi.mock("@/lib/auth/server", () => ({
  getAuth: () => ({ api: { signInEmail: mocks.signInEmail } }),
}));
vi.mock("@/lib/auth/audit-writer", () => ({
  recordLoginFailure: mocks.recordLoginFailure,
}));

describe("sign-in audit action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordLoginFailure.mockResolvedValue(undefined);
  });

  it("audits failed credentials with only the normalized identifier", async () => {
    mocks.signInEmail.mockRejectedValue(new Error("invalid credentials"));
    const form = new FormData();
    form.set("email", " Failed@Example.edu ");
    form.set("password", "not-the-password");

    await expect(signInAction({ error: null }, form)).resolves.toEqual({
      error: GENERIC_SIGN_IN_ERROR,
    });
    expect(mocks.recordLoginFailure).toHaveBeenCalledWith("failed@example.edu");
    expect(mocks.recordLoginFailure).not.toHaveBeenCalledWith(
      "not-the-password",
    );
  });

  it("audits malformed login attempts without calling Better Auth", async () => {
    const form = new FormData();
    form.set("email", " malformed-identifier ");
    form.set("password", "x");

    await signInAction({ error: null }, form);

    expect(mocks.signInEmail).not.toHaveBeenCalled();
    expect(mocks.recordLoginFailure).toHaveBeenCalledWith(
      "malformed-identifier",
    );
  });
});
