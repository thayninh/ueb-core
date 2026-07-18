// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeRequiredPasswordAction, signInAction } from "@/app/actions/auth";
import { GENERIC_SIGN_IN_ERROR } from "@/lib/auth/sign-in-policy";

const mocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  recordLoginFailure: vi.fn(),
  getPasswordChangeRequirement: vi.fn(),
  completeRequiredPasswordChange: vi.fn(),
  requireActiveSession: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));
vi.mock("@/lib/auth/server", () => ({
  getAuth: () => ({ api: { signInEmail: mocks.signInEmail } }),
}));
vi.mock("@/lib/auth/audit-writer", () => ({
  recordLoginFailure: mocks.recordLoginFailure,
}));
vi.mock("@/lib/auth/password-change", () => ({
  completeRequiredPasswordChange: mocks.completeRequiredPasswordChange,
  getPasswordChangeRequirement: mocks.getPasswordChangeRequirement,
}));
vi.mock("@/lib/auth/session", () => ({
  requireActiveSession: mocks.requireActiveSession,
}));

describe("sign-in audit action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordLoginFailure.mockResolvedValue(undefined);
    mocks.completeRequiredPasswordChange.mockResolvedValue({
      revokedSessionCount: 1,
    });
    mocks.requireActiveSession.mockResolvedValue({
      userId: "user-1",
      mustChangePassword: true,
    });
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

  it("redirects a successful forced login to the canonical change page", async () => {
    mocks.signInEmail.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getPasswordChangeRequirement.mockResolvedValue({ required: true });
    const form = signInForm();

    await expect(signInAction({ error: null }, form)).rejects.toThrow(
      "redirect",
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/change-password");
  });

  it("rejects confirmation mismatch before reading the authenticated session", async () => {
    const form = passwordChangeForm();
    form.set("confirmPassword", "different-confirmation-value");

    await expect(
      changeRequiredPasswordAction({ error: null }, form),
    ).resolves.toMatchObject({ error: expect.any(String) });
    expect(mocks.requireActiveSession).not.toHaveBeenCalled();
    expect(mocks.completeRequiredPasswordChange).not.toHaveBeenCalled();
  });

  it("requires reauthentication after a successful password change", async () => {
    const form = passwordChangeForm();

    await expect(
      changeRequiredPasswordAction({ error: null }, form),
    ).rejects.toThrow("redirect");
    expect(mocks.completeRequiredPasswordChange).toHaveBeenCalledWith({
      userId: "user-1",
      currentPassword: "current-password-value",
      newPassword: "new-password-value-123",
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/sign-in?passwordChanged=1&reauth=1",
    );
  });
});

function signInForm(): FormData {
  const form = new FormData();
  form.set("email", "forced@example.edu");
  form.set("password", "valid-password-value");
  return form;
}

function passwordChangeForm(): FormData {
  const form = new FormData();
  form.set("currentPassword", "current-password-value");
  form.set("newPassword", "new-password-value-123");
  form.set("confirmPassword", "new-password-value-123");
  return form;
}
