import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CoreDataTable } from "@/components/core-data-table";
import {
  getLeaderDataPage,
  getLeaderUnits,
} from "@/lib/data/leader-data";
import {
  firstSearchParam,
  hasUnexpectedSearchParams,
  parseStrictPositivePage,
} from "@/lib/http/search-params";

export const metadata: Metadata = {
  title: "Dữ liệu đơn vị | UEB Core",
};

type LeaderPageProps = {
  searchParams: Promise<{
    unitId?: string | string[];
    q?: string | string[];
    page?: string | string[];
  }>;
};

export default async function LeaderDataPage({
  searchParams,
}: LeaderPageProps) {
  const [params, units] = await Promise.all([searchParams, getLeaderUnits()]);
  if (hasUnexpectedSearchParams(params, ["unitId", "q", "page"])) notFound();
  if (units.length === 0) {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <h1 className="text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
          Dữ liệu đơn vị
        </h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Tài khoản chưa được gán đơn vị đang hoạt động.
        </p>
      </main>
    );
  }

  const requestedUnitId = firstSearchParam(params.unitId);
  const selectedUnit = requestedUnitId
    ? units.find(({ id }) => id === requestedUnitId)
    : units[0];
  if (!selectedUnit) notFound();
  const search = firstSearchParam(params.q) ?? "";
  const page = parseStrictPositivePage(firstSearchParam(params.page));
  if (page === null) notFound();
  const result = await getLeaderDataPage({
    unitId: selectedUnit.id,
    search,
    page,
  });

  return (
    <main className="mx-auto w-full max-w-[1800px] space-y-6 px-6 py-10">
      <header>
        <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
          Chế độ chỉ đọc
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Dữ liệu đơn vị
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          Không có thao tác sửa, xóa hoặc phê duyệt trong Giai đoạn 3.
        </p>
      </header>

      <form className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-[minmax(16rem,1fr)_minmax(16rem,2fr)_auto]" method="get">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Đơn vị
          <select
            className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950"
            defaultValue={selectedUnit.id}
            name="unitId"
          >
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Tìm kiếm
          <input
            className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950"
            defaultValue={result.search}
            maxLength={100}
            name="q"
            placeholder="Tên giảng viên, học phần, mã cán bộ…"
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
          {result.totalRows} dòng · Trang {result.page}/{result.totalPages}
        </p>
        <Pagination
          page={result.page}
          search={result.search}
          totalPages={result.totalPages}
          unitId={result.unit.id}
        />
      </div>

      <CoreDataTable rows={result.rows} />
    </main>
  );
}

function Pagination({
  page,
  totalPages,
  unitId,
  search,
}: Readonly<{
  page: number;
  totalPages: number;
  unitId: string;
  search: string;
}>) {
  return (
    <nav aria-label="Phân trang" className="flex gap-2">
      <PageLink
        disabled={page <= 1}
        href={leaderHref(unitId, search, page - 1)}
        label="Trang trước"
      />
      <PageLink
        disabled={page >= totalPages}
        href={leaderHref(unitId, search, page + 1)}
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
  if (disabled) {
    return (
      <span className="cursor-not-allowed rounded-lg border border-zinc-200 px-3 py-2 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
        {label}
      </span>
    );
  }
  return (
    <Link
      className="rounded-lg border border-zinc-300 px-3 py-2 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      href={href}
    >
      {label}
    </Link>
  );
}

function leaderHref(unitId: string, search: string, page: number): string {
  const params = new URLSearchParams({ unitId, page: String(page) });
  if (search) params.set("q", search);
  return `/leader/data?${params.toString()}`;
}
