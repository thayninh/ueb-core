import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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
    <main className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10">
      <header>
        <Link
          className="text-sm font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
          href="/dashboard"
        >
          ← Quay lại bảng điều khiển
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Bản gửi chờ xử lý
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          Queue chỉ gồm submission có một sự kiện SUBMITTED và chưa có sự kiện
          terminal. Danh sách được sắp từ cũ đến mới.
        </p>
      </header>

      <QueueFilters result={result} />
      <QueueTable result={result} />
      <QueuePagination result={result} />
    </main>
  );
}

function QueueFilters({
  result,
}: Readonly<{ result: LeaderSubmissionQueuePage }>) {
  return (
    <form
      className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900"
      method="get"
    >
      <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Tìm kiếm
        <input
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          defaultValue={result.search}
          maxLength={100}
          name="q"
          placeholder="Giảng viên, học phần, record…"
          type="search"
        />
      </label>
      <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Đơn vị
        <select
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          defaultValue={result.unitId ?? ""}
          name="unitId"
        >
          <option value="">Tất cả đơn vị trong phạm vi</option>
          {result.units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Loại bản gửi
        <select
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          defaultValue={result.submissionType ?? ""}
          name="type"
        >
          <option value="">Tất cả</option>
          {Object.entries(SUBMISSION_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-3">
        <button
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          type="submit"
        >
          Lọc queue
        </button>
        <Link
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700"
          href="/leader/submissions"
        >
          Xóa lọc
        </Link>
      </div>
    </form>
  );
}

function QueueTable({
  result,
}: Readonly<{ result: LeaderSubmissionQueuePage }>) {
  if (result.submissions.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
        Không có bản gửi đang chờ trong phạm vi được giao.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
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
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {result.submissions.map((submission) => (
            <tr key={submission.submissionId}>
              <td className="px-4 py-3">
                <p className="font-semibold">
                  {submission.lecturerName ?? "—"}
                </p>
                <p className="text-xs text-zinc-500">
                  {submission.lecturerCode ?? submission.lecturerEmail ?? "—"}
                </p>
              </td>
              <td className="px-4 py-3">
                {SUBMISSION_TYPE_LABELS[submission.submissionType]}
              </td>
              <td className="max-w-64 px-4 py-3">
                <p>{submission.courseCode ?? submission.courseName ?? "—"}</p>
                <p className="mt-1 break-all font-mono text-xs text-zinc-500">
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
                  <span className="font-semibold text-amber-800 dark:text-amber-200">
                    Dữ liệu lõi đã thay đổi
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3">
                <Link
                  className="font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
                  href={`/leader/submissions/${submission.submissionId}`}
                >
                  Xem và xử lý
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueuePagination({
  result,
}: Readonly<{ result: LeaderSubmissionQueuePage }>) {
  return (
    <nav
      aria-label="Phân trang queue"
      className="flex items-center justify-between text-sm"
    >
      <p className="text-zinc-600 dark:text-zinc-300">
        {result.totalSubmissions} bản gửi đang chờ · Trang {result.page}/
        {result.totalPages}
      </p>
      <div className="flex gap-2">
        {result.page > 1 && (
          <Link
            className="rounded-lg border border-zinc-300 px-3 py-2 font-semibold dark:border-zinc-700"
            href={buildPageHref(result, result.page - 1)}
          >
            Trang trước
          </Link>
        )}
        {result.page < result.totalPages && (
          <Link
            className="rounded-lg border border-zinc-300 px-3 py-2 font-semibold dark:border-zinc-700"
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
