// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  GENERIC_SIGN_IN_ERROR,
  extractLoginIdentifier,
  genericSignInFailure,
  parseSignInCredentials,
} from "@/lib/auth/sign-in-policy";

describe("sign-in policy", () => {
  it("normalizes valid email without changing the password", () => {
    const formData = new FormData();
    formData.set("email", " Lecturer@Example.edu ");
    formData.set("password", "temporary-password");

    expect(parseSignInCredentials(formData)).toEqual({
      success: true,
      data: {
        email: "lecturer@example.edu",
        password: "temporary-password",
      },
    });
  });

  it("uses one generic failure for malformed or missing credentials", () => {
    const malformed = new FormData();
    malformed.set("email", "not-an-email");
    malformed.set("password", "wrong");

    expect(parseSignInCredentials(malformed)).toEqual({ success: false });
    expect(parseSignInCredentials(new FormData())).toEqual({ success: false });
    expect(genericSignInFailure()).toEqual({ error: GENERIC_SIGN_IN_ERROR });
    expect(GENERIC_SIGN_IN_ERROR).not.toMatch(/tài khoản|không tồn tại/u);
    expect(extractLoginIdentifier(malformed)).toBe("not-an-email");
    expect(extractLoginIdentifier(new FormData())).toBeNull();
  });
});
