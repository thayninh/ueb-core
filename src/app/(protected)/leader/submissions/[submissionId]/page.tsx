import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert, Card, PageContainer, TableShell } from "@/components/ui";
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
    <main className="relative py-8 sm:py-10 lg:py-12">
      <PageContainer className="max-w-6xl space-y-8">
        <header>
          <Link
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-2"
            href="/leader/submissions"
          >
            ← Quay lại queue
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Chi tiết bản gửi đơn vị
            </h1>
            <SubmissionStatusBadge state={detail.state} />
          </div>
        </header>

        {detail.state === "PENDING" && detail.stale && (
          <section>
            <Alert className="p-5" variant="warning">
              <h2 className="font-semibold">
                Dữ liệu lõi đã thay đổi kể từ khi bản gửi được tạo. Không thể
                phê duyệt bản gửi này.
              </h2>
              <p className="mt-2 text-sm">
                Reject vẫn được phép vì thao tác này không ghi dữ liệu lõi.
              </p>
            </Alert>
          </section>
        )}

        <Card className="p-5 sm:p-6">
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
        </Card>

        {detail.state === "REJECTED" && (
          <section>
            <Alert className="p-5 sm:p-6" variant="danger">
              <h2 className="font-semibold">Lý do từ chối</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {detail.rejectionReason}
              </p>
            </Alert>
          </section>
        )}

        {detail.state === "APPROVED" && (
          <section>
            <Alert className="p-5 sm:p-6" variant="success">
              <h2 className="font-semibold">Kết quả phê duyệt</h2>
              <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                <Metadata
                  label="Thời điểm quyết định"
                  value={formatWorkflowDate(detail.terminalAt)}
                />
                <Metadata
                  label="STT kết quả"
                  value={
                    detail.resultStt === null ? "—" : String(detail.resultStt)
                  }
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
            </Alert>
          </section>
        )}

        <section>
          <h2 className="text-xl font-semibold text-ink">
            So sánh 19 trường nội dung
          </h2>
          <p className="mt-2 text-sm text-muted">
            STT là metadata riêng và không nằm trong payload hoặc diff.
          </p>
          <TableShell aria-label="So sánh 19 trường nội dung" className="mt-5">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-brand-700 text-white">
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
              <tbody className="divide-y divide-border bg-surface">
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
          </TableShell>
        </section>

        {detail.state === "PENDING" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-success-text/25 p-5 sm:p-6">
              <h2 className="text-xl font-semibold">Phê duyệt bản gửi</h2>
              <div className="mt-5">
                <LeaderApproveForm
                  stale={detail.stale}
                  submissionId={detail.submissionId}
                />
              </div>
            </Card>
            <Card className="border-danger-text/25 p-5 sm:p-6">
              <h2 className="text-xl font-semibold">Từ chối bản gửi</h2>
              <p className="mt-2 text-sm text-muted">
                Từ chối không ghi dữ liệu lõi và lý do sẽ được lưu bất biến.
              </p>
              <div className="mt-5">
                <LeaderRejectForm submissionId={detail.submissionId} />
              </div>
            </Card>
          </div>
        )}
      </PageContainer>
    </main>
  );
}

function Metadata({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
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
