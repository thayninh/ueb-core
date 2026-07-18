"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/server";
import { recordLoginFailure } from "@/lib/auth/audit-writer";
import {
  completeRequiredPasswordChange,
  getPasswordChangeRequirement,
} from "@/lib/auth/password-change";
import {
  extractLoginIdentifier,
  genericSignInFailure,
  parseSignInCredentials,
  type SignInActionState,
} from "@/lib/auth/sign-in-policy";
import { requireActiveSession } from "@/lib/auth/session";

export interface ChangePasswordActionState {
  readonly error: string | null;
}

export async function signInAction(
  _previousState: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const credentials = parseSignInCredentials(formData);
  if (!credentials.success) {
    await recordLoginFailure(extractLoginIdentifier(formData));
    return genericSignInFailure();
  }

  let userId: string;
  try {
    const result = await getAuth().api.signInEmail({
      headers: await headers(),
      body: credentials.data,
    });
    userId = result.user.id;
  } catch {
    await recordLoginFailure(credentials.data.email);
    return genericSignInFailure();
  }

  const requirement = await getPasswordChangeRequirement(userId);
  if (requirement.required) redirect("/change-password");
  redirect("/dashboard");
}

export async function changeRequiredPasswordAction(
  _previousState: ChangePasswordActionState,
  formData: FormData,
): Promise<ChangePasswordActionState> {
  const currentPassword = formData.get("currentPassword");
  const newPassword = formData.get("newPassword");
  const confirmPassword = formData.get("confirmPassword");
  if (
    typeof currentPassword !== "string" ||
    typeof newPassword !== "string" ||
    typeof confirmPassword !== "string" ||
    newPassword !== confirmPassword
  ) {
    return {
      error: "Mật khẩu mới và xác nhận mật khẩu phải trùng khớp.",
    };
  }

  const session = await requireActiveSession();
  if (!session.mustChangePassword) redirect("/dashboard");

  try {
    await completeRequiredPasswordChange({
      userId: session.userId,
      currentPassword,
      newPassword,
    });
  } catch {
    return {
      error:
        "Không thể đổi mật khẩu. Hãy kiểm tra mật khẩu hiện tại và bảo đảm mật khẩu mới dài từ 12 đến 128 ký tự, khác mật khẩu hiện tại.",
    };
  }

  redirect("/sign-in?passwordChanged=1&reauth=1");
}

export async function signOutAction(): Promise<never> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
