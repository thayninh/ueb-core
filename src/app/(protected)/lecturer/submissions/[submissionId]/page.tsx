import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert, Card, PageContainer } from "@/components/ui";
import { SubmissionStatusBadge } from "@/components/workflow/submission-status-badge";
import { LecturerResubmissionAction } from "@/components/workflow/lecturer-resubmission-action";
import {
  SUBMISSION_TYPE_LABELS,
  formatWorkflowDate,
} from "@/components/workflow/workflow-labels";
import { hasUnexpectedSearchParams } from "@/lib/http/search-params";
import { SUBMISSION_PAYLOAD_FIELD_NAMES } from "@/lib/workflow/field-policy";
import {
  BUSINESS_FIELD_LABELS,
  formatWorkflowFieldValue,
} from "@/lib/workflow/field-display";
import { getLecturerSubmissionDetail } from "@/lib/workflow/lecturer-submission-query";

export const metadata: Metadata = {
  title: "Chi tiết bản gửi | UEB Core",
};

export default async function LecturerSubmissionDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ submissionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (hasUnexpectedSearchParams(await searchParams, [])) notFound();
  const { submissionId } = await params;
  const detail = await getLecturerSubmissionDetail(submissionId);

  return (
    <main className="relative py-8 sm:py-10 lg:py-12">
      <PageContainer className="max-w-5xl space-y-8">
        <header>
          <Link
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-2"
            href="/lecturer/submissions"
          >
            ← Quay lại các bản gửi
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Chi tiết bản gửi
            </h1>
            <SubmissionStatusBadge state={detail.state} />
          </div>
        </header>

        <Card className="p-5 sm:p-6">
          <h2 className="font-semibold text-ink">Thông tin workflow</h2>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Metadata
              label="Loại bản gửi"
              value={SUBMISSION_TYPE_LABELS[detail.submissionType]}
            />
            <Metadata
              label="Thời điểm gửi"
              value={formatWorkflowDate(detail.submittedAt)}
            />
            <Metadata label="Record UID" value={detail.recordUid} mono />
            <Metadata
              label="STT nền (metadata)"
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
            {detail.parentSubmissionId && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Bản gửi cha
                </dt>
                <dd className="mt-1">
                  <Link
                    className="inline-flex min-h-11 items-center break-all font-mono text-xs text-brand-700 underline"
                    href={"/lecturer/submissions/" + detail.parentSubmissionId}
                  >
                    {detail.parentSubmissionId}
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </Card>

        {detail.state === "REJECTED" && (
          <Alert className="p-5 sm:p-6" variant="danger">
            <h2 className="font-semibold">Lý do từ chối</h2>
            <p className="mt-2 text-xs font-medium uppercase tracking-wide">
              Thời điểm từ chối: {formatWorkflowDate(detail.terminalAt)}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">
              {detail.rejectionReason}
            </p>
          </Alert>
        )}
        {detail.state === "APPROVED" && (
          <Alert className="p-5 sm:p-6" variant="success">
            <h2 className="font-semibold">Kết quả phê duyệt</h2>
            <p className="mt-2 text-xs font-medium uppercase tracking-wide">
              Thời điểm phê duyệt: {formatWorkflowDate(detail.terminalAt)}
            </p>
            <p className="mt-2 text-sm">
              STT kết quả: {detail.resultStt} · Phiên bản kết quả:{" "}
              {detail.resultVersionNo}
            </p>
          </Alert>
        )}

        <LecturerResubmissionAction
          state={detail.state}
          submissionId={detail.submissionId}
          submissionType={detail.submissionType}
        />

        <section>
          <h2 className="text-xl font-semibold text-ink">
            19 trường nội dung đã gửi
          </h2>
          <p className="mt-2 text-sm text-muted">
            STT không thuộc payload; STT nền được hiển thị riêng ở phần
            metadata.
          </p>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            {SUBMISSION_PAYLOAD_FIELD_NAMES.map((field) => (
              <div
                className="rounded-control border border-border bg-surface p-4 shadow-control"
                data-submission-payload-field={field}
                key={field}
              >
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {BUSINESS_FIELD_LABELS[field]}
                </dt>
                <dd className="mt-2 whitespace-pre-wrap text-sm text-ink">
                  {formatWorkflowFieldValue(detail.payload[field])}
                </dd>
              </div>
            ))}
          </dl>
        </section>
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
