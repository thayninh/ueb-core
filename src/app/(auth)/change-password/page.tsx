import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { ChangePasswordForm } from "@/app/(auth)/change-password/change-password-form";
import { signOutAction } from "@/app/actions/auth";
import { requireActiveSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Đổi mật khẩu | UEB Core",
};

export default async function ChangePasswordPage() {
  await connection();
  const session = await requireActiveSession();
  if (!session.mustChangePassword) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-10">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-700 dark:text-blue-400">
          UEB Core
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Đổi mật khẩu lần đầu
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Bạn cần đặt mật khẩu mới trước khi sử dụng các chức năng khác. Sau khi
          đổi thành công, mọi phiên đăng nhập sẽ kết thúc.
        </p>
        <ChangePasswordForm />
        <form action={signOutAction} className="mt-4 text-center">
          <button
            className="text-sm font-medium text-zinc-600 hover:text-blue-700 dark:text-zinc-300 dark:hover:text-blue-400"
            type="submit"
          >
            Đăng xuất
          </button>
        </form>
      </section>
    </main>
  );
}
