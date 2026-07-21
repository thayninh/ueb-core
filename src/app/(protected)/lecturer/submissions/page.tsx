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
    <main className="relative py-8 sm:py-10 lg:py-12">
      <PageContainer className="space-y-8">
        <header>
          <Link
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-2"
            href="/lecturer/profile"
          >
            ← Quay lại hồ sơ
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Các bản gửi của tôi
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Trạng thái được suy ra từ chuỗi sự kiện bất biến của từng
            submission.
          </p>
        </header>

        <SubmissionFilters result={result} />
        <SubmissionTable result={result} />
        <Pagination result={result} />
      </PageContainer>
    </main>
  );
}

function SubmissionFilters({
  result,
}: Readonly<{ result: LecturerSubmissionListPage }>) {
  return (
    <Card className="p-4 sm:p-5">
      <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" method="get">
        <label className="text-sm font-semibold text-ink">
          Tìm submission/record
          <Input
            className="mt-2"
            defaultValue={result.search}
            maxLength={100}
            name="q"
            type="search"
          />
        </label>
        <label className="text-sm font-semibold text-ink">
          Trạng thái
          <Select
            className="mt-2"
            defaultValue={result.state ?? ""}
            name="state"
          >
            <option value="">Tất cả</option>
            <option value="PENDING">Đang chờ</option>
            <option value="REJECTED">Đã từ chối</option>
            <option value="APPROVED">Đã phê duyệt</option>
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
            Lọc
          </Button>
          <Link
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-control border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink shadow-control transition-colors hover:bg-surface-subtle sm:flex-none"
            href="/lecturer/submissions"
          >
            Xóa lọc
          </Link>
        </div>
      </form>
    </Card>
  );
}

function SubmissionTable({
  result,
}: Readonly<{ result: LecturerSubmissionListPage }>) {
  if (result.submissions.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border-strong bg-surface p-10 text-center text-sm text-muted shadow-control">
        Không có bản gửi phù hợp.
      </p>
    );
  }
  return (
    <TableShell aria-label="Danh sách bản gửi của tôi">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-brand-700 text-white">
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
        <tbody className="divide-y divide-border bg-surface">
          {result.submissions.map((submission) => (
            <tr key={submission.submissionId}>
              <td className="px-4 py-3">
                {SUBMISSION_TYPE_LABELS[submission.submissionType]}
              </td>
              <td className="px-4 py-3">
                <SubmissionStatusBadge state={submission.state} />
              </td>
              <td className="max-w-52 break-all px-4 py-3 font-mono text-xs text-muted">
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
                    <p className="line-clamp-2 text-xs text-danger-text">
                      {submission.rejectionReason}
                    </p>
                  </div>
                ) : submission.state === "APPROVED" ? (
                  <div className="space-y-1">
                    <p>{formatWorkflowDate(submission.terminalAt)}</p>
                    <p className="text-xs font-medium text-success-text">
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
                  className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-2"
                  href={"/lecturer/submissions/" + submission.submissionId}
                >
                  Xem
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

function Pagination({
  result,
}: Readonly<{ result: LecturerSubmissionListPage }>) {
  return (
    <nav
      aria-label="Phân trang bản gửi"
      className="flex flex-wrap items-center justify-between gap-4 text-sm"
    >
      <p className="text-muted">
        {result.totalSubmissions} bản gửi · Trang {result.page}/
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
