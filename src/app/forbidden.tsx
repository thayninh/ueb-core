import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-16">
      <section className="w-full rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-semibold text-red-700 dark:text-red-300">
          HTTP 403
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
          Không có quyền truy cập
        </h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-300">
          Tài khoản hiện tại không được phép mở tài nguyên này.
        </p>
        <Link
          className="mt-6 inline-block rounded-lg bg-blue-700 px-5 py-2.5 font-medium text-white hover:bg-blue-800"
          href="/dashboard"
        >
          Về bảng điều khiển
        </Link>
      </section>
    </main>
  );
}
