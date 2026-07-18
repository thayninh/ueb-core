import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { SignInForm } from "@/app/(auth)/sign-in/sign-in-form";
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
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-10">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-700 dark:text-blue-400">
          UEB Core
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Đăng nhập
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Sử dụng tài khoản đã được quản trị viên cấp.
        </p>
        <SignInForm />
      </section>
    </main>
  );
}
