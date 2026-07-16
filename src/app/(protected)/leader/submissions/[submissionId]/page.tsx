import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LeaderApproveForm } from "@/components/workflow/leader-approve-form";
import { LeaderRejectForm } from "@/components/workflow/leader-reject-form";
import { SubmissionStatusBadge } from "@/components/workflow/submission-status-badge";
import {
  SUBMISSION_TYPE_LABELS,
  formatWorkflowDate,
} from "@/components/workflow/workflow-labels";
import { hasUnexpectedSearchParams } from "@/lib/http/search-params";
import { formatWorkflowFieldValue } from "@/lib/workflow/field-display";
import { getLeaderSubmissionDetail } from "@/lib/workflow/leader-submission-query";

export const metadata: Metadata = {
  title: "Chi tiết bản gửi đơn vị | UEB Core",
};

const CHANGE_LABELS = {
  UNCHANGED: "Không thay đổi",
  MODIFIED: "Đã thay đổi",
  NEW: "Giá trị mới",
} as const;

export default async function LeaderSubmissionDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ submissionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (hasUnexpectedSearchParams(await searchParams, [])) notFound();
  const { submissionId } = await params;
  const detail = await getLeaderSubmissionDetail(submissionId);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10">
      <header>
        <Link
          className="text-sm font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
          href="/leader/submissions"
        >
          ← Quay lại queue
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Chi tiết bản gửi đơn vị
          </h1>
          <SubmissionStatusBadge state={detail.state} />
        </div>
      </header>

      {detail.state === "PENDING" && detail.stale && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <h2 className="font-semibold">
            Dữ liệu lõi đã thay đổi kể từ khi bản gửi được tạo. Không thể phê
            duyệt bản gửi này.
          </h2>
          <p className="mt-2 text-sm">
            Reject vẫn được phép vì thao tác này không ghi dữ liệu lõi.
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-semibold">Thông tin workflow</h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Metadata
            label="Loại bản gửi"
            value={SUBMISSION_TYPE_LABELS[detail.submissionType]}
          />
          <Metadata
            label="Thời điểm gửi"
            value={formatWorkflowDate(detail.submittedAt)}
          />
          <Metadata label="Giảng viên" value={detail.lecturerName ?? "—"} />
          <Metadata label="Mã cán bộ" value={detail.lecturerCode ?? "—"} />
          <Metadata label="Đơn vị phê duyệt" value={detail.approvalUnit} />
          <Metadata label="Record UID" value={detail.recordUid} mono />
          <Metadata
            label="STT nền"
            value={
              detail.baseStt === null ? "Dòng mới" : String(detail.baseStt)
            }
          />
          <Metadata
            label="Phiên bản nền"
            value={
              detail.baseVersionNo === null
                ? "Dòng mới"
                : String(detail.baseVersionNo)
            }
          />
          <Metadata
            label="STT hiện tại"
            value={
              detail.currentStt === null
                ? "Dòng mới/không có"
                : String(detail.currentStt)
            }
          />
          <Metadata
            label="Phiên bản hiện tại"
            value={
              detail.currentVersionNo === null
                ? "Dòng mới/không có"
                : String(detail.currentVersionNo)
            }
          />
          {detail.terminalAt && (
            <Metadata
              label="Thời điểm xử lý"
              value={formatWorkflowDate(detail.terminalAt)}
            />
          )}
        </dl>
      </section>

      {detail.state === "REJECTED" && (
        <section className="rounded-2xl border border-red-300 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950/40">
          <h2 className="font-semibold">Lý do từ chối</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {detail.rejectionReason}
          </p>
        </section>
      )}

      {detail.state === "APPROVED" && (
        <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-950/40">
          <h2 className="font-semibold">Kết quả phê duyệt</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <Metadata
              label="Thời điểm quyết định"
              value={formatWorkflowDate(detail.terminalAt)}
            />
            <Metadata
              label="STT kết quả"
              value={detail.resultStt === null ? "—" : String(detail.resultStt)}
            />
            <Metadata
              label="Phiên bản kết quả"
              value={
                detail.resultVersionNo === null
                  ? "—"
                  : String(detail.resultVersionNo)
              }
            />
          </dl>
        </section>
      )}

      <section>
        <h2 className="text-xl font-semibold">So sánh 19 trường nội dung</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          STT là metadata riêng và không nằm trong payload hoặc diff.
        </p>
        <div className="mt-5 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-100 dark:bg-zinc-800">
              <tr>
                {[
                  "Trường",
                  "Giá trị hiện tại",
                  "Giá trị đã gửi",
                  "Thay đổi",
                ].map((label) => (
                  <th
                    className="px-4 py-3 font-semibold"
                    key={label}
                    scope="col"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {detail.diff.map((item) => (
                <tr data-workflow-diff-field={item.field} key={item.field}>
                  <th className="px-4 py-3 font-semibold" scope="row">
                    {item.label}
                  </th>
                  <td className="max-w-80 whitespace-pre-wrap px-4 py-3">
                    {detail.submissionType === "CREATE_NEW"
                      ? "Dòng mới"
                      : formatWorkflowFieldValue(item.before)}
                  </td>
                  <td className="max-w-80 whitespace-pre-wrap px-4 py-3">
                    {formatWorkflowFieldValue(item.after)}
                  </td>
                  <td className="px-4 py-3">
                    {CHANGE_LABELS[item.changeType]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {detail.state === "PENDING" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm dark:border-emerald-900 dark:bg-zinc-900">
            <h2 className="text-xl font-semibold">Phê duyệt bản gửi</h2>
            <div className="mt-5">
              <LeaderApproveForm
                stale={detail.stale}
                submissionId={detail.submissionId}
              />
            </div>
          </section>
          <section className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm dark:border-red-900 dark:bg-zinc-900">
            <h2 className="text-xl font-semibold">Từ chối bản gửi</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Từ chối không ghi dữ liệu lõi và lý do sẽ được lưu bất biến.
            </p>
            <div className="mt-5">
              <LeaderRejectForm submissionId={detail.submissionId} />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function Metadata({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd
        className={
          "mt-1 break-all text-sm " + (mono ? "font-mono text-xs" : "")
        }
      >
        {value}
      </dd>
    </div>
  );
}
