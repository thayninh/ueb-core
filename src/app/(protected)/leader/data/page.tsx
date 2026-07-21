import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CoreDataTable } from "@/components/core-data-table";
import {
  Alert,
  Button,
  Card,
  Input,
  PageContainer,
  Select,
} from "@/components/ui";
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
      <main className="relative py-8 sm:py-10 lg:py-12">
        <PageContainer className="max-w-6xl">
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Dữ liệu đơn vị
          </h1>
          <Alert className="mt-4" variant="warning">
            Tài khoản chưa được gán đơn vị đang hoạt động.
          </Alert>
        </PageContainer>
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
    <main className="relative py-8 sm:py-10 lg:py-12">
      <PageContainer className="max-w-[1800px] space-y-6">
        <header>
          <p className="text-sm font-semibold text-brand-700">
            Chế độ chỉ đọc
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Dữ liệu đơn vị
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Không có thao tác sửa, xóa hoặc phê duyệt trong Giai đoạn 3.
          </p>
        </header>

        <Card className="p-4 sm:p-5">
          <form
            className="grid gap-4 md:grid-cols-[minmax(16rem,1fr)_minmax(16rem,2fr)_auto]"
            method="get"
          >
            <label className="text-sm font-semibold text-ink">
              Đơn vị
              <Select
                className="mt-2"
                defaultValue={selectedUnit.id}
                name="unitId"
              >
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.displayName}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm font-semibold text-ink">
              Tìm kiếm
              <Input
                className="mt-2"
                defaultValue={result.search}
                maxLength={100}
                name="q"
                placeholder="Tên giảng viên, học phần, mã cán bộ…"
                type="search"
              />
            </label>
            <Button className="self-end" type="submit">
              Tra cứu
            </Button>
          </form>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
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
      </PageContainer>
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
    <nav aria-label="Phân trang" className="flex flex-wrap gap-2">
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
      <span
        aria-disabled="true"
        className="inline-flex min-h-11 cursor-not-allowed items-center rounded-control border border-border px-3 py-2 text-muted opacity-60"
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      className="inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface px-3 py-2 font-semibold text-ink shadow-control hover:bg-surface-subtle"
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
