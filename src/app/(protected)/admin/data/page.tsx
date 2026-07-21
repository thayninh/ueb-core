import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CoreDataTable } from "@/components/core-data-table";
import { Button, Input, PageContainer } from "@/components/ui";
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
    <main className="py-8 sm:py-10">
      <PageContainer className="max-w-[1800px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-sm font-semibold text-brand-700">
            Quản trị viên · Chỉ đọc
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Dữ liệu hiện hành toàn hệ thống
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
            Mỗi record chỉ hiển thị phiên bản đã phê duyệt mới nhất. Trang này
            không cung cấp thao tác sửa, gửi hoặc quyết định workflow.
          </p>
        </div>
        <nav aria-label="Quản trị hệ thống" className="flex flex-wrap gap-3">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink shadow-control transition-colors hover:bg-surface-subtle"
            href="/admin/users"
          >
            Tài khoản
          </Link>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink shadow-control transition-colors hover:bg-surface-subtle"
            href="/admin/audit"
          >
            Nhật ký bảo mật
          </Link>
        </nav>
      </header>

      <form
        className="grid gap-4 rounded-card border border-border bg-surface p-4 shadow-card sm:p-5 md:grid-cols-[minmax(16rem,1fr)_auto]"
        method="get"
      >
        <label className="text-sm font-semibold text-ink">
          Tìm kiếm
          <Input
            className="mt-2"
            defaultValue={result.search}
            maxLength={100}
            name="q"
            placeholder="Giảng viên, học phần, mã cán bộ, STT…"
            type="search"
          />
        </label>
        <Button className="self-end" type="submit">
          Tra cứu
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
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
      </PageContainer>
    </main>
  );
}

function Pagination({
  result,
}: Readonly<{
  result: Awaited<ReturnType<typeof getLatestCoreRowsForAdmin>>;
}>) {
  return (
    <nav
      aria-label="Phân trang dữ liệu hiện hành"
      className="flex flex-wrap gap-2"
    >
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
    "inline-flex min-h-11 items-center justify-center rounded-control border border-border px-3 py-2 text-center font-semibold";
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={`${classes} cursor-not-allowed bg-surface-subtle text-muted opacity-60`}
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      className={`${classes} bg-surface text-ink shadow-control transition-colors hover:bg-surface-subtle`}
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
