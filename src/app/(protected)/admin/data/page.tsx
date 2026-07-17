import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CoreDataTable } from "@/components/core-data-table";
import { getLatestCoreRowsForAdmin } from "@/lib/data/latest-core-data";
import {
  firstSearchParam,
  hasUnexpectedSearchParams,
  parseStrictPositivePage,
} from "@/lib/http/search-params";

export const metadata: Metadata = {
  title: "Dữ liệu hiện hành | UEB Core",
};

type AdminDataPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    page?: string | string[];
  }>;
};

export default async function AdminDataPage({
  searchParams,
}: AdminDataPageProps) {
  const params = await searchParams;
  if (
    hasUnexpectedSearchParams(params, ["q", "page"]) ||
    Object.values(params).some(Array.isArray)
  ) {
    notFound();
  }

  const page = parseStrictPositivePage(firstSearchParam(params.page));
  if (page === null) notFound();
  const result = await getLatestCoreRowsForAdmin({
    search: firstSearchParam(params.q),
    page,
  });

  return (
    <main className="mx-auto w-full max-w-[1800px] space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
            Quản trị viên · Chỉ đọc
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Dữ liệu hiện hành toàn hệ thống
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
            Mỗi record chỉ hiển thị phiên bản đã phê duyệt mới nhất. Trang này
            không cung cấp thao tác sửa, gửi hoặc quyết định workflow.
          </p>
        </div>
        <nav aria-label="Quản trị hệ thống" className="flex flex-wrap gap-3">
          <Link
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            href="/admin/users"
          >
            Tài khoản
          </Link>
          <Link
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            href="/admin/audit"
          >
            Nhật ký bảo mật
          </Link>
        </nav>
      </header>

      <form
        className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-[minmax(16rem,1fr)_auto]"
        method="get"
      >
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Tìm kiếm
          <input
            className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950"
            defaultValue={result.search}
            maxLength={100}
            name="q"
            placeholder="Giảng viên, học phần, mã cán bộ, STT…"
            type="search"
          />
        </label>
        <button
          className="self-end rounded-lg bg-blue-700 px-5 py-2.5 font-medium text-white hover:bg-blue-800"
          type="submit"
        >
          Tra cứu
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-300">
        <p>
          {result.totalRows} record hiện hành · Trang {result.page}/
          {result.totalPages}
        </p>
        <Pagination result={result} />
      </div>

      <CoreDataTable
        emptyMessage="Không có dữ liệu hiện hành phù hợp bộ lọc."
        rows={result.rows}
      />
    </main>
  );
}

function Pagination({
  result,
}: Readonly<{
  result: Awaited<ReturnType<typeof getLatestCoreRowsForAdmin>>;
}>) {
  return (
    <nav aria-label="Phân trang dữ liệu hiện hành" className="flex gap-2">
      <PageLink
        disabled={result.page <= 1}
        href={adminDataHref(result.search, result.page - 1)}
        label="Trang trước"
      />
      <PageLink
        disabled={result.page >= result.totalPages}
        href={adminDataHref(result.search, result.page + 1)}
        label="Trang sau"
      />
    </nav>
  );
}

function PageLink({
  href,
  label,
  disabled,
}: Readonly<{ href: string; label: string; disabled: boolean }>) {
  const classes =
    "rounded-lg border border-zinc-300 px-3 py-2 font-medium dark:border-zinc-700";
  if (disabled) {
    return (
      <span className={`${classes} cursor-not-allowed opacity-40`}>
        {label}
      </span>
    );
  }
  return (
    <Link
      className={`${classes} hover:bg-zinc-100 dark:hover:bg-zinc-800`}
      href={href}
    >
      {label}
    </Link>
  );
}

function adminDataHref(search: string, page: number): string {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("q", search);
  return `/admin/data?${params.toString()}`;
}
