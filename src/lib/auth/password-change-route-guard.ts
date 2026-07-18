import "server-only";

import { getPasswordChangeRequirement } from "@/lib/auth/password-change";
import { getAuth } from "@/lib/auth/server";

export const REQUIRED_PASSWORD_CHANGE_BROWSER_PATH = "/change-password";
export const REQUIRED_PASSWORD_CHANGE_AUTH_ALLOWLIST = [
  "/api/auth/get-session",
  "/api/auth/sign-out",
] as const;

export function isAllowedAuthPathDuringRequiredPasswordChange(
  pathname: string,
): boolean {
  return REQUIRED_PASSWORD_CHANGE_AUTH_ALLOWLIST.includes(
    pathname as (typeof REQUIRED_PASSWORD_CHANGE_AUTH_ALLOWLIST)[number],
  );
}

export function passwordChangeRequiredApiResponse(): Response {
  return Response.json(
    {
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "Password change is required before this request is allowed.",
    },
    { status: 403 },
  );
}

export async function guardBetterAuthRequest(
  request: Request,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (isAllowedAuthPathDuringRequiredPasswordChange(pathname)) return null;

  const session = await getAuth().api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  if (!session) return null;

  try {
    const requirement = await getPasswordChangeRequirement(session.user.id);
    return requirement.required ? passwordChangeRequiredApiResponse() : null;
  } catch {
    return passwordChangeRequiredApiResponse();
  }
}
