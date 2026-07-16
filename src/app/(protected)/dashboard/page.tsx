import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDashboard } from "@/lib/data/dashboard";
import { hasUnexpectedSearchParams } from "@/lib/http/search-params";

export const metadata: Metadata = {
  title: "Bảng điều khiển | UEB Core",
};

const ROLE_LABELS = {
  LECTURER: "Giảng viên",
  FACULTY_LEADER: "Lãnh đạo khoa/đơn vị",
  ADMIN: "Quản trị viên",
} as const;

export default async function DashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (hasUnexpectedSearchParams(await searchParams, [])) notFound();
  const dashboard = await getDashboard();

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
      <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
          Xin chào
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {dashboard.name}
        </h1>
        <div className="mt-5 flex flex-wrap gap-2">
          {dashboard.roles.map((role) => (
            <span
              className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-800 dark:bg-blue-950/50 dark:text-blue-200"
              key={role}
            >
              {ROLE_LABELS[role]}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
          Chức năng được phép
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {dashboard.allowedFeatures.map((feature) => (
            <Link
              className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-700"
              href={feature.href}
              key={feature.href}
            >
              <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">
                {feature.label}
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                {feature.description}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">
          Đơn vị đang quản lý
        </h2>
        {dashboard.managedUnits.length > 0 ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {dashboard.managedUnits.map((unit) => (
              <li
                className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                key={unit.id}
              >
                {unit.displayName}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            Không có đơn vị quản lý đang hoạt động.
          </p>
        )}
      </section>
    </main>
  );
}
