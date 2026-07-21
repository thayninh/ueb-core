import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button, PageContainer, Select, TableShell } from "@/components/ui";
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
    <main className="py-8 sm:py-10">
      <PageContainer className="max-w-7xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm font-semibold text-brand-700">
              Chỉ đọc · Append-only
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Nhật ký bảo mật
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              Không hiển thị email đăng nhập thất bại, mật khẩu, session token
              hoặc OAuth token.
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink shadow-control transition-colors hover:bg-surface-subtle"
            href="/admin/users"
          >
            Quản trị tài khoản
          </Link>
        </header>

        <form
          className="grid gap-4 rounded-card border border-border bg-surface p-4 shadow-card sm:p-5 md:grid-cols-[1fr_1fr_auto]"
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
          <Button className="self-end" type="submit">
            Lọc
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <p>
            {result.totalRows} sự kiện · Trang {result.page}/{result.totalPages}
          </p>
          <nav aria-label="Phân trang audit" className="flex flex-wrap gap-2">
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

        <TableShell aria-label="Nhật ký bảo mật">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-brand-700 text-xs uppercase tracking-wide text-white">
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
            <tbody className="divide-y divide-border bg-surface">
              {result.rows.map((row) => (
                <tr
                  className="align-top transition-colors hover:bg-surface-subtle"
                  key={row.id}
                >
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
                  <td className="min-w-64 px-4 py-3 text-xs text-muted">
                    {formatMetadata(row.metadata)}
                  </td>
                </tr>
              ))}
              {result.rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-10 text-center text-muted" colSpan={7}>
                    Không có sự kiện phù hợp bộ lọc.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableShell>
      </PageContainer>
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
    <label className="text-sm font-semibold text-ink">
      {label}
      <Select className="mt-2" defaultValue={value} name={name}>
        <option value="">Tất cả</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </label>
  );
}

function IdCell({ value }: Readonly<{ value: string | null }>) {
  return (
    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted">
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

  const params = new URLSearchParams({ page: String(page) });
  if (eventType) params.set("eventType", eventType);
  if (outcome) params.set("outcome", outcome);
  return (
    <Link
      className={`${classes} bg-surface text-ink shadow-control transition-colors hover:bg-surface-subtle`}
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
