import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Button,
  Card,
  Input,
  PageContainer,
  Select,
  TableShell,
} from "@/components/ui";
import {
  SUBMISSION_TYPE_LABELS,
  formatWorkflowDate,
} from "@/components/workflow/workflow-labels";
import {
  firstSearchParam,
  hasUnexpectedSearchParams,
  parseStrictPositivePage,
} from "@/lib/http/search-params";
import { isWorkflowError } from "@/lib/workflow/errors";
import {
  getLeaderSubmissionQueue,
  type LeaderSubmissionQueuePage,
} from "@/lib/workflow/leader-submission-query";

import type { SubmissionType } from "@/lib/workflow/types";

export const metadata: Metadata = {
  title: "Bản gửi chờ xử lý | UEB Core",
};

const ALLOWED_TYPES = new Set<SubmissionType>([
  "CONFIRM_UNCHANGED",
  "UPDATE_EXISTING",
  "CREATE_NEW",
]);

export default async function LeaderSubmissionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  if (
    hasUnexpectedSearchParams(raw, ["page", "q", "unitId", "type"]) ||
    Object.values(raw).some(Array.isArray)
  ) {
    notFound();
  }
  const page = parseStrictPositivePage(firstSearchParam(raw.page));
  const submissionType = parseType(firstSearchParam(raw.type));
  if (page === null || submissionType === undefined) notFound();

  let result: LeaderSubmissionQueuePage;
  try {
    result = await getLeaderSubmissionQueue({
      page,
      search: firstSearchParam(raw.q),
      unitId: firstSearchParam(raw.unitId),
      submissionType: submissionType ?? undefined,
    });
  } catch (error) {
    if (isWorkflowError(error) && error.code === "WORKFLOW_SCOPE_DENIED") {
      notFound();
    }
    throw error;
  }

  return (
    <main className="relative py-8 sm:py-10 lg:py-12">
      <PageContainer className="max-w-7xl space-y-8">
        <header>
          <Link
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-2"
            href="/dashboard"
          >
            ← Quay lại bảng điều khiển
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Bản gửi chờ xử lý
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Queue chỉ gồm submission có một sự kiện SUBMITTED và chưa có sự kiện
            terminal. Danh sách được sắp từ cũ đến mới.
          </p>
        </header>

        <QueueFilters result={result} />
        <QueueTable result={result} />
        <QueuePagination result={result} />
      </PageContainer>
    </main>
  );
}

function QueueFilters({
  result,
}: Readonly<{ result: LeaderSubmissionQueuePage }>) {
  return (
    <Card className="p-4 sm:p-5">
      <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" method="get">
        <label className="text-sm font-semibold text-ink">
          Tìm kiếm
          <Input
            className="mt-2"
            defaultValue={result.search}
            maxLength={100}
            name="q"
            placeholder="Giảng viên, học phần, record…"
            type="search"
          />
        </label>
        <label className="text-sm font-semibold text-ink">
          Đơn vị
          <Select
            className="mt-2"
            defaultValue={result.unitId ?? ""}
            name="unitId"
          >
            <option value="">Tất cả đơn vị trong phạm vi</option>
            {result.units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.displayName}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-semibold text-ink">
          Loại bản gửi
          <Select
            className="mt-2"
            defaultValue={result.submissionType ?? ""}
            name="type"
          >
            <option value="">Tất cả</option>
            {Object.entries(SUBMISSION_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <Button className="flex-1 sm:flex-none" type="submit">
            Lọc queue
          </Button>
          <Link
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-control border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink shadow-control hover:bg-surface-subtle sm:flex-none"
            href="/leader/submissions"
          >
            Xóa lọc
          </Link>
        </div>
      </form>
    </Card>
  );
}

function QueueTable({
  result,
}: Readonly<{ result: LeaderSubmissionQueuePage }>) {
  if (result.submissions.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border-strong bg-surface p-10 text-center text-sm text-muted shadow-control">
        Không có bản gửi đang chờ trong phạm vi được giao.
      </p>
    );
  }

  return (
    <TableShell aria-label="Bản gửi chờ xử lý">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-brand-700 text-white">
          <tr>
            {[
              "Giảng viên",
              "Loại",
              "Học phần/record",
              "Đơn vị",
              "Phiên bản nền",
              "Thời điểm gửi",
              "Cảnh báo",
              "Chi tiết",
            ].map((label) => (
              <th className="px-4 py-3 font-semibold" key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface">
          {result.submissions.map((submission) => (
            <tr key={submission.submissionId}>
              <td className="px-4 py-3">
                <p className="font-semibold">
                  {submission.lecturerName ?? "—"}
                </p>
                <p className="text-xs text-muted">
                  {submission.lecturerCode ?? submission.lecturerEmail ?? "—"}
                </p>
              </td>
              <td className="px-4 py-3">
                {SUBMISSION_TYPE_LABELS[submission.submissionType]}
              </td>
              <td className="max-w-64 px-4 py-3">
                <p>{submission.courseCode ?? submission.courseName ?? "—"}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted">
                  {submission.recordUid}
                </p>
              </td>
              <td className="px-4 py-3">{submission.approvalUnit}</td>
              <td className="px-4 py-3">
                {submission.baseVersionNo ?? "Dòng mới"}
              </td>
              <td className="px-4 py-3">
                {formatWorkflowDate(submission.submittedAt)}
              </td>
              <td className="px-4 py-3">
                {submission.stale ? (
                  <span className="font-semibold text-warning-text">
                    Dữ liệu lõi đã thay đổi
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3">
                <Link
                  className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-2"
                  href={`/leader/submissions/${submission.submissionId}`}
                >
                  Xem và xử lý
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

function QueuePagination({
  result,
}: Readonly<{ result: LeaderSubmissionQueuePage }>) {
  return (
    <nav
      aria-label="Phân trang queue"
      className="flex flex-wrap items-center justify-between gap-4 text-sm"
    >
      <p className="text-muted">
        {result.totalSubmissions} bản gửi đang chờ · Trang {result.page}/
        {result.totalPages}
      </p>
      <div className="flex flex-wrap gap-2">
        {result.page > 1 && (
          <Link
            className="inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface px-3 py-2 font-semibold shadow-control hover:bg-surface-subtle"
            href={buildPageHref(result, result.page - 1)}
          >
            Trang trước
          </Link>
        )}
        {result.page < result.totalPages && (
          <Link
            className="inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface px-3 py-2 font-semibold shadow-control hover:bg-surface-subtle"
            href={buildPageHref(result, result.page + 1)}
          >
            Trang sau
          </Link>
        )}
      </div>
    </nav>
  );
}

function buildPageHref(
  result: LeaderSubmissionQueuePage,
  page: number,
): string {
  const params = new URLSearchParams({ page: String(page) });
  if (result.search) params.set("q", result.search);
  if (result.unitId) params.set("unitId", result.unitId);
  if (result.submissionType) params.set("type", result.submissionType);
  return "/leader/submissions?" + params.toString();
}

function parseType(
  value: string | undefined,
): SubmissionType | null | undefined {
  if (!value) return null;
  return ALLOWED_TYPES.has(value as SubmissionType)
    ? (value as SubmissionType)
    : undefined;
}
