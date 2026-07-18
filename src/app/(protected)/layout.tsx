import Link from "next/link";
import { connection } from "next/server";

import { signOutAction } from "@/app/actions/auth";
import { requireBusinessSession } from "@/lib/auth/session";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  await requireBusinessSession();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            className="font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
            href="/dashboard"
          >
            UEB Core
          </Link>
          <div className="flex items-center gap-3">
            <Link
              className="text-sm font-medium text-zinc-600 hover:text-blue-700 dark:text-zinc-300 dark:hover:text-blue-400"
              href="/dashboard"
            >
              Bảng điều khiển
            </Link>
            <form action={signOutAction}>
              <button
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                type="submit"
              >
                Đăng xuất
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
