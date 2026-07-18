// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/auth/[...all]/route";

const mocks = vi.hoisted(() => ({
  authPost: vi.fn(),
  recordLoginFailure: vi.fn(),
}));

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({ GET: vi.fn(), POST: mocks.authPost }),
}));
vi.mock("@/lib/auth/server", () => ({ getAuth: vi.fn() }));
vi.mock("@/lib/auth/audit-writer", () => ({
  recordLoginFailure: mocks.recordLoginFailure,
}));
vi.mock("@/lib/auth/password-change-route-guard", () => ({
  guardBetterAuthRequest: vi.fn().mockResolvedValue(null),
}));

describe("Better Auth route audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordLoginFailure.mockResolvedValue(undefined);
  });

  it("audits direct email API failures without passing the password", async () => {
    mocks.authPost.mockResolvedValue(
      Response.json({ error: "invalid" }, { status: 401 }),
    );
    const request = new Request(
      "http://localhost:3000/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: " Direct@Example.edu ",
          password: "must-not-be-audit-input",
        }),
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(mocks.recordLoginFailure).toHaveBeenCalledWith("direct@example.edu");
    expect(mocks.recordLoginFailure).not.toHaveBeenCalledWith(
      "must-not-be-audit-input",
    );
  });

  it("does not add route-level audit to successful session creation", async () => {
    mocks.authPost.mockResolvedValue(Response.json({ success: true }));

    await POST(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "success@example.edu",
          password: "not-logged",
        }),
      }),
    );

    expect(mocks.recordLoginFailure).not.toHaveBeenCalled();
  });
});
