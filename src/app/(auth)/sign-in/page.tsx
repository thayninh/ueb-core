import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { SignInForm } from "@/app/(auth)/sign-in/sign-in-form";
import { AuthLayout } from "@/components/ui/auth-layout";
import { getActiveSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Đăng nhập | UEB Core",
};

export default async function SignInPage() {
  await connection();
  const session = await getActiveSession();
  if (session?.mustChangePassword) redirect("/change-password");
  if (session) redirect("/dashboard");

  return (
    <AuthLayout
      description="Sử dụng tài khoản đã được quản trị viên cấp."
      title="Đăng nhập"
    >
      <SignInForm />
    </AuthLayout>
  );
}
