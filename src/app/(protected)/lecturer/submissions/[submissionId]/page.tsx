import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SubmissionStatusBadge } from "@/components/workflow/submission-status-badge";
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
    <main className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <header>
        <Link
          className="text-sm font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
          href="/lecturer/submissions"
        >
          ← Quay lại các bản gửi
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Chi tiết bản gửi
          </h1>
          <SubmissionStatusBadge state={detail.state} />
        </div>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">
          Thông tin workflow
        </h2>
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
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Bản gửi cha
              </dt>
              <dd className="mt-1">
                <Link
                  className="break-all font-mono text-xs text-blue-700 underline dark:text-blue-300"
                  href={"/lecturer/submissions/" + detail.parentSubmissionId}
                >
                  {detail.parentSubmissionId}
                </Link>
              </dd>
            </div>
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
          <p className="mt-2 text-sm">
            STT kết quả: {detail.resultStt} · Phiên bản kết quả:{" "}
            {detail.resultVersionNo}
          </p>
        </section>
      )}

      <section>
        <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
          19 trường nội dung đã gửi
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          STT không thuộc payload; STT nền được hiển thị riêng ở phần metadata.
        </p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          {SUBMISSION_PAYLOAD_FIELD_NAMES.map((field) => (
            <div
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              data-submission-payload-field={field}
              key={field}
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {BUSINESS_FIELD_LABELS[field]}
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">
                {formatWorkflowFieldValue(detail.payload[field])}
              </dd>
            </div>
          ))}
        </dl>
      </section>
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
