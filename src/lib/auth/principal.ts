import type {
  AccessProfileStatus,
  BusinessRole,
} from "@/generated/prisma/client";

/**
 * Minimal authorization context safe to pass between server-only DAL modules.
 * Unit source values stay in the database and are deliberately not embedded.
 */
export interface Principal {
  readonly userId: string;
  readonly roles: readonly BusinessRole[];
  readonly lecturerUid: string | null;
  readonly activeUnitIds: readonly string[];
  readonly status: AccessProfileStatus;
}

export type LecturerPrincipal = Principal & {
  readonly lecturerUid: string;
};
