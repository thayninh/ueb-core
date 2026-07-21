import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { ChangePasswordForm } from "@/app/(auth)/change-password/change-password-form";
import { signOutAction } from "@/app/actions/auth";
import { AuthLayout } from "@/components/ui/auth-layout";
import { Button } from "@/components/ui/button";
import { requireActiveSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Đổi mật khẩu | UEB Core",
};

export default async function ChangePasswordPage() {
  await connection();
  const session = await requireActiveSession();
  if (!session.mustChangePassword) redirect("/dashboard");

  return (
    <AuthLayout
      description="Bạn cần đặt mật khẩu mới trước khi sử dụng các chức năng khác. Sau khi đổi thành công, mọi phiên đăng nhập sẽ kết thúc."
      footer={
        <form action={signOutAction} className="mt-4 text-center">
          <Button type="submit" variant="ghost">
            Đăng xuất
          </Button>
        </form>
      }
      title="Đổi mật khẩu lần đầu"
    >
      <ChangePasswordForm />
    </AuthLayout>
  );
}
