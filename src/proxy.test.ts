// @vitest-environment node

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

const sessionCookie = "better-auth.session_token=optimistic-token";

describe("authentication proxy", () => {
  it("redirects unauthenticated protected requests to sign-in", () => {
    const response = proxy(new NextRequest("http://localhost:3000/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/sign-in",
    );
  });

  it.each([
    "/lecturer/profile",
    "/leader/data",
    "/admin/users",
    "/admin/audit",
  ])("redirects unauthenticated access to %s", (pathname) => {
    const response = proxy(new NextRequest(`http://localhost:3000${pathname}`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/sign-in",
    );
  });

  it("requires authentication for the password-change page", () => {
    const response = proxy(
      new NextRequest("http://localhost:3000/change-password"),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/sign-in",
    );
  });

  it("allows a session cookie to reach password-change without a redirect loop", () => {
    const response = proxy(
      new NextRequest("http://localhost:3000/change-password?next=/admin", {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("optimistically redirects a session cookie away from sign-in", () => {
    const response = proxy(
      new NextRequest("http://localhost:3000/sign-in", {
        headers: { cookie: sessionCookie },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });

  it("allows authoritative reauthentication to resolve a stale cookie", () => {
    const response = proxy(
      new NextRequest("http://localhost:3000/sign-in?reauth=1", {
        headers: { cookie: sessionCookie },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
