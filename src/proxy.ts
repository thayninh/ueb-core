import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hasSessionCookie = getSessionCookie(request) !== null;
  const isProtectedRoute = [
    "/dashboard",
    "/lecturer",
    "/leader",
    "/admin",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const isSignInRoute = pathname === "/sign-in";

  if (isProtectedRoute && !hasSessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  if (
    isSignInRoute &&
    hasSessionCookie &&
    !request.nextUrl.searchParams.has("reauth")
  ) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/lecturer/:path*",
    "/leader/:path*",
    "/admin/:path*",
    "/sign-in",
  ],
};
