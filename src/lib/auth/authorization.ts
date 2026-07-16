import "server-only";

import { forbidden, redirect } from "next/navigation";

import { BusinessRole } from "@/generated/prisma/client";
import { getCurrentPrincipal } from "@/lib/auth/dal";
import type { LecturerPrincipal, Principal } from "@/lib/auth/principal";

export class AuthorizationError extends Error {
  readonly code: "FORBIDDEN" | "INVALID_AUTHORIZATION_REQUEST";

  constructor(
    code: "FORBIDDEN" | "INVALID_AUTHORIZATION_REQUEST" = "FORBIDDEN",
  ) {
    super(
      code === "FORBIDDEN"
        ? "You are not authorized to perform this action."
        : "The authorization request is invalid.",
    );
    this.name = "AuthorizationError";
    this.code = code;
  }
}

export async function requireAuthenticated(): Promise<Principal> {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/sign-in?reauth=1");
  return principal;
}

export async function requireRole(role: BusinessRole): Promise<Principal> {
  return requireAnyRole([role]);
}

export async function requireAnyRole(
  roles: readonly BusinessRole[],
): Promise<Principal> {
  if (roles.length === 0) {
    throw new AuthorizationError("INVALID_AUTHORIZATION_REQUEST");
  }

  const principal = await requireAuthenticated();
  if (!roles.some((role) => principal.roles.includes(role))) {
    forbidden();
  }
  return principal;
}

export async function requireAdmin(): Promise<Principal> {
  return requireRole(BusinessRole.ADMIN);
}

export async function requireLecturerIdentity(): Promise<LecturerPrincipal> {
  const principal = await requireRole(BusinessRole.LECTURER);
  if (!principal.lecturerUid) forbidden();
  return principal as LecturerPrincipal;
}

export async function requireUnitScope(unitId: string): Promise<Principal> {
  if (unitId.trim().length === 0) {
    throw new AuthorizationError("INVALID_AUTHORIZATION_REQUEST");
  }

  const principal = await requireRole(BusinessRole.FACULTY_LEADER);
  if (!principal.activeUnitIds.includes(unitId)) {
    forbidden();
  }
  return principal;
}
