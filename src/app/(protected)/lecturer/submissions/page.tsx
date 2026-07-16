import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SubmissionStatusBadge } from "@/components/workflow/submission-status-badge";
import {
  SUBMISSION_TYPE_LABELS,
  formatWorkflowDate,
} from "@/components/workflow/workflow-labels";
import {
  firstSearchParam,
  hasUnexpectedSearchParams,
  parseStrictPositivePage,
} from "@/lib/http/search-params";
import {
  getLecturerSubmissions,
  type LecturerSubmissionListPage,
} from "@/lib/workflow/lecturer-submission-query";
import type { SubmissionState, SubmissionType } from "@/lib/workflow/types";

export const metadata: Metadata = {
  title: "Các bản gửi | UEB Core",
};

const ALLOWED_STATES = new Set<SubmissionState>([
  "PENDING",
  "REJECTED",
  "APPROVED",
]);
const ALLOWED_TYPES = new Set<SubmissionType>([
  "CONFIRM_UNCHANGED",
  "UPDATE_EXISTING",
  "CREATE_NEW",
]);

export default async function LecturerSubmissionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  if (
    hasUnexpectedSearchParams(rawParams, ["page", "q", "state", "type"]) ||
    Object.values(rawParams).some(Array.isArray)
  ) {
    notFound();
  }
  const page = parseStrictPositivePage(firstSearchParam(rawParams.page));
  const state = parseState(firstSearchParam(rawParams.state));
  const submissionType = parseType(firstSearchParam(rawParams.type));
  if (page === null || state === undefined || submissionType === undefined) {
    notFound();
  }
  const result = await getLecturerSubmissions({
    page,
    search: firstSearchParam(rawParams.q),
    state: state ?? undefined,
    submissionType: submissionType ?? undefined,
  });

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
      <header>
        <Link
          className="text-sm font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
          href="/lecturer/profile"
        >
          ← Quay lại hồ sơ
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Các bản gửi của tôi
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          Trạng thái được suy ra từ chuỗi sự kiện bất biến của từng submission.
        </p>
      </header>

      <SubmissionFilters result={result} />
      <SubmissionTable result={result} />
      <Pagination result={result} />
    </main>
  );
}

function SubmissionFilters({
  result,
}: Readonly<{ result: LecturerSubmissionListPage }>) {
  return (
    <form
      className="grid gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900"
      method="get"
    >
      <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Tìm submission/record
        <input
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          defaultValue={result.search}
          maxLength={100}
          name="q"
          type="search"
        />
      </label>
      <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Trạng thái
        <select
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          defaultValue={result.state ?? ""}
          name="state"
        >
          <option value="">Tất cả</option>
          <option value="PENDING">Đang chờ</option>
          <option value="REJECTED">Đã từ chối</option>
          <option value="APPROVED">Đã phê duyệt</option>
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
          Lọc
        </button>
        <Link
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700"
          href="/lecturer/submissions"
        >
          Xóa lọc
        </Link>
      </div>
    </form>
  );
}

function SubmissionTable({
  result,
}: Readonly<{ result: LecturerSubmissionListPage }>) {
  if (result.submissions.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
        Không có bản gửi phù hợp.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          <tr>
            {[
              "Loại",
              "Trạng thái",
              "Record",
              "Phiên bản nền",
              "Thời điểm gửi",
              "Kết quả xử lý",
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
                {SUBMISSION_TYPE_LABELS[submission.submissionType]}
              </td>
              <td className="px-4 py-3">
                <SubmissionStatusBadge state={submission.state} />
              </td>
              <td className="max-w-52 break-all px-4 py-3 font-mono text-xs">
                {submission.recordUid}
              </td>
              <td className="px-4 py-3">
                {submission.baseVersionNo ?? "Dòng mới"}
              </td>
              <td className="px-4 py-3">
                {formatWorkflowDate(submission.submittedAt)}
              </td>
              <td className="max-w-80 px-4 py-3">
                {submission.state === "REJECTED" ? (
                  <div className="space-y-1">
                    <p>{formatWorkflowDate(submission.terminalAt)}</p>
                    <p className="line-clamp-2 text-xs text-red-700 dark:text-red-300">
                      {submission.rejectionReason}
                    </p>
                  </div>
                ) : submission.state === "APPROVED" ? (
                  <div className="space-y-1">
                    <p>{formatWorkflowDate(submission.terminalAt)}</p>
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      STT {submission.resultStt} · Phiên bản{" "}
                      {submission.resultVersionNo}
                    </p>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3">
                <Link
                  className="font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
                  href={"/lecturer/submissions/" + submission.submissionId}
                >
                  Xem
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({
  result,
}: Readonly<{ result: LecturerSubmissionListPage }>) {
  return (
    <nav
      aria-label="Phân trang bản gửi"
      className="flex items-center justify-between text-sm"
    >
      <p className="text-zinc-600 dark:text-zinc-300">
        {result.totalSubmissions} bản gửi · Trang {result.page}/
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
  result: LecturerSubmissionListPage,
  page: number,
): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (result.search) params.set("q", result.search);
  if (result.state) params.set("state", result.state);
  if (result.submissionType) params.set("type", result.submissionType);
  return "/lecturer/submissions?" + params.toString();
}

function parseState(
  value: string | undefined,
): SubmissionState | null | undefined {
  if (!value) return null;
  return ALLOWED_STATES.has(value as SubmissionState)
    ? (value as SubmissionState)
    : undefined;
}

function parseType(
  value: string | undefined,
): SubmissionType | null | undefined {
  if (!value) return null;
  return ALLOWED_TYPES.has(value as SubmissionType)
    ? (value as SubmissionType)
    : undefined;
}
