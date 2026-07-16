import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AUTH_AUDIT_EVENT_TYPES } from "@/lib/auth/audit";
import {
  AUTH_AUDIT_OUTCOMES,
  getAdminAuditPage,
  parseAuditEventType,
  parseAuditOutcome,
} from "@/lib/data/admin-audit";
import {
  firstSearchParam,
  hasUnexpectedSearchParams,
  parseStrictPositivePage,
} from "@/lib/http/search-params";

export const metadata: Metadata = {
  title: "Nhật ký bảo mật | UEB Core",
};

type AuditPageProps = {
  searchParams: Promise<{
    eventType?: string | string[];
    outcome?: string | string[];
    page?: string | string[];
  }>;
};

export default async function AdminAuditPage({ searchParams }: AuditPageProps) {
  const params = await searchParams;
  if (hasUnexpectedSearchParams(params, ["eventType", "outcome", "page"])) {
    notFound();
  }
  const rawEventType = firstSearchParam(params.eventType);
  const rawOutcome = firstSearchParam(params.outcome);
  const eventType = parseAuditEventType(rawEventType);
  const outcome = parseAuditOutcome(rawOutcome);
  const page = parseStrictPositivePage(firstSearchParam(params.page));
  if (
    page === null ||
    (rawEventType !== undefined && eventType === null) ||
    (rawOutcome !== undefined && outcome === null)
  ) {
    notFound();
  }
  const result = await getAdminAuditPage({
    eventType,
    outcome,
    page,
  });

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
            Chỉ đọc · Append-only
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Nhật ký bảo mật
          </h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            Không hiển thị email đăng nhập thất bại, mật khẩu, session token
            hoặc OAuth token.
          </p>
        </div>
        <Link
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          href="/admin/users"
        >
          Quản trị tài khoản
        </Link>
      </header>

      <form
        className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-[1fr_1fr_auto]"
        method="get"
      >
        <FilterSelect
          label="Loại sự kiện"
          name="eventType"
          options={AUTH_AUDIT_EVENT_TYPES}
          value={result.eventType ?? ""}
        />
        <FilterSelect
          label="Kết quả"
          name="outcome"
          options={AUTH_AUDIT_OUTCOMES}
          value={result.outcome ?? ""}
        />
        <button
          className="self-end rounded-lg bg-blue-700 px-5 py-2.5 font-medium text-white hover:bg-blue-800"
          type="submit"
        >
          Lọc
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-300">
        <p>
          {result.totalRows} sự kiện · Trang {result.page}/{result.totalPages}
        </p>
        <nav aria-label="Phân trang audit" className="flex gap-2">
          <AuditPageLink
            disabled={result.page <= 1}
            eventType={result.eventType}
            label="Trang trước"
            outcome={result.outcome}
            page={result.page - 1}
          />
          <AuditPageLink
            disabled={result.page >= result.totalPages}
            eventType={result.eventType}
            label="Trang sau"
            outcome={result.outcome}
            page={result.page + 1}
          />
        </nav>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            <tr>
              {[
                "Thời điểm",
                "Sự kiện",
                "Kết quả",
                "Actor ID",
                "Target ID",
                "Session ID",
                "Metadata an toàn",
              ].map((label) => (
                <th className="px-4 py-3 font-semibold" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {result.rows.map((row) => (
              <tr className="align-top" key={row.id}>
                <td className="whitespace-nowrap px-4 py-3">
                  {row.occurredAt.toLocaleString("vi-VN")}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-medium">
                  {row.eventType}
                </td>
                <td className="px-4 py-3">{row.outcome}</td>
                <IdCell value={row.actorUserId} />
                <IdCell value={row.targetUserId} />
                <IdCell value={row.sessionId} />
                <td className="min-w-64 px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">
                  {formatMetadata(row.metadata)}
                </td>
              </tr>
            ))}
            {result.rows.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-10 text-center text-zinc-500"
                  colSpan={7}
                >
                  Không có sự kiện phù hợp bộ lọc.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function FilterSelect({
  label,
  name,
  options,
  value,
}: Readonly<{
  label: string;
  name: string;
  options: readonly string[];
  value: string;
}>) {
  return (
    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
      {label}
      <select
        className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950"
        defaultValue={value}
        name={name}
      >
        <option value="">Tất cả</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function IdCell({ value }: Readonly<{ value: string | null }>) {
  return (
    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
      {value ?? "—"}
    </td>
  );
}

function AuditPageLink({
  page,
  label,
  disabled,
  eventType,
  outcome,
}: Readonly<{
  page: number;
  label: string;
  disabled: boolean;
  eventType: string | null;
  outcome: string | null;
}>) {
  const classes =
    "rounded-lg border border-zinc-300 px-3 py-2 font-medium dark:border-zinc-700";
  if (disabled) {
    return (
      <span className={`${classes} cursor-not-allowed opacity-40`}>
        {label}
      </span>
    );
  }

  const params = new URLSearchParams({ page: String(page) });
  if (eventType) params.set("eventType", eventType);
  if (outcome) params.set("outcome", outcome);
  return (
    <Link
      className={`${classes} hover:bg-zinc-100 dark:hover:bg-zinc-800`}
      href={`/admin/audit?${params.toString()}`}
    >
      {label}
    </Link>
  );
}

function formatMetadata(
  metadata: Readonly<Record<string, string | number | null>>,
): string {
  const entries = Object.entries(metadata);
  return entries.length > 0
    ? entries.map(([key, value]) => `${key}: ${value ?? "—"}`).join(" · ")
    : "—";
}
