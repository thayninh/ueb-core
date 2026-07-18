"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AccessProfileStatus, BusinessRole } from "@/generated/prisma/client";
import {
  activateUser,
  revokeUserSessions,
  setLecturerMapping,
  setUserRole,
  setUserUnitScope,
} from "@/lib/auth/admin-user-management";
import { disableUserAndRevokeSessions } from "@/lib/auth/account-lifecycle";
import { requireAdmin } from "@/lib/auth/authorization";
import { provisionUser } from "@/lib/auth/provision-user";

export interface AdminActionState {
  readonly status: "IDLE" | "SUCCESS" | "ERROR";
  readonly message: string | null;
}

const uuidSchema = z.uuid();
const roleSchema = z.enum(BusinessRole);

export async function createUserAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await requireAdmin();

  try {
    const roles = formData
      .getAll("roles")
      .map(String)
      .map((role) => roleSchema.parse(role));
    const unitIds = formData
      .getAll("unitIds")
      .map(String)
      .map((id) => uuidSchema.parse(id));
    const lecturerUidValue = formOptionalString(formData, "lecturerUid");
    await provisionUser({
      actorUserId: actor.userId,
      email: formString(formData, "email"),
      name: formString(formData, "name"),
      temporaryPassword: formString(formData, "temporaryPassword"),
      roles,
      unitIds,
      lecturerUid: lecturerUidValue
        ? uuidSchema.parse(lecturerUidValue)
        : undefined,
      requirePasswordChange:
        z
          .enum(["true", "false"])
          .parse(formString(formData, "requirePasswordChange")) === "true",
    });
  } catch {
    return {
      status: "ERROR",
      message:
        "Không thể tạo tài khoản. Hãy kiểm tra email, mật khẩu tạm, vai trò và ánh xạ.",
    };
  }

  revalidatePath("/admin/users");
  return { status: "SUCCESS", message: "Đã tạo tài khoản có kiểm soát." };
}

export async function setUserStatusAction(formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  const targetUserId = uuidSchema.parse(formString(formData, "targetUserId"));
  const status = z
    .enum([AccessProfileStatus.ACTIVE, AccessProfileStatus.DISABLED])
    .parse(formString(formData, "status"));
  if (
    targetUserId === actor.userId &&
    status === AccessProfileStatus.DISABLED
  ) {
    throw new Error("Administrators cannot disable their own account.");
  }

  if (status === AccessProfileStatus.ACTIVE) {
    await activateUser({ actorUserId: actor.userId, targetUserId });
  } else {
    await disableUserAndRevokeSessions({
      actorUserId: actor.userId,
      targetUserId,
    });
  }
  revalidatePath("/admin/users");
}

export async function setUserRoleAction(formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  await setUserRole({
    actorUserId: actor.userId,
    targetUserId: uuidSchema.parse(formString(formData, "targetUserId")),
    role: roleSchema.parse(formString(formData, "role")),
    enabled: booleanSchema(formData, "enabled"),
  });
  revalidatePath("/admin/users");
  revalidatePath("/dashboard");
}

export async function setUserUnitScopeAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireAdmin();
  await setUserUnitScope({
    actorUserId: actor.userId,
    targetUserId: uuidSchema.parse(formString(formData, "targetUserId")),
    organizationUnitId: uuidSchema.parse(
      formString(formData, "organizationUnitId"),
    ),
    enabled: booleanSchema(formData, "enabled"),
  });
  revalidatePath("/admin/users");
  revalidatePath("/dashboard");
}

export async function setLecturerMappingAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireAdmin();
  const lecturerUid = formOptionalString(formData, "lecturerUid");
  await setLecturerMapping({
    actorUserId: actor.userId,
    targetUserId: uuidSchema.parse(formString(formData, "targetUserId")),
    lecturerUid: lecturerUid ? uuidSchema.parse(lecturerUid) : null,
  });
  revalidatePath("/admin/users");
}

export async function revokeUserSessionsAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireAdmin();
  await revokeUserSessions({
    actorUserId: actor.userId,
    targetUserId: uuidSchema.parse(formString(formData, "targetUserId")),
  });
  revalidatePath("/admin/users");
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string") throw new Error(`${key} is required.`);
  return value;
}

function formOptionalString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (value === null) return "";
  if (typeof value !== "string") throw new Error(`${key} must be text.`);
  return value;
}

function booleanSchema(formData: FormData, key: string): boolean {
  return z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .parse(formString(formData, key));
}
