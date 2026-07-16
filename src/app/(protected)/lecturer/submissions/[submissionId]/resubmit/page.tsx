import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmUnchangedForm } from "@/components/workflow/confirm-unchanged-form";
import { EditableRowForm } from "@/components/workflow/editable-row-form";
import {
  SUBMISSION_TYPE_LABELS,
  formatWorkflowDate,
} from "@/components/workflow/workflow-labels";
import { hasUnexpectedSearchParams } from "@/lib/http/search-params";
import {
  BUSINESS_FIELD_LABELS,
  formatWorkflowFieldValue,
} from "@/lib/workflow/field-display";
import { CORE_DISPLAY_FIELD_NAMES } from "@/lib/workflow/field-policy";
import { getLecturerResubmissionDraft } from "@/lib/workflow/lecturer-submission-query";

import type { CoreBusinessRow } from "@/lib/workflow/types";

export const metadata: Metadata = {
  title: "Gửi lại bản đã từ chối | UEB Core",
};

export default async function LecturerResubmissionPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ submissionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (hasUnexpectedSearchParams(await searchParams, [])) notFound();
  const { submissionId } = await params;
  const draft = await getLecturerResubmissionDraft(submissionId);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <header>
        <Link
          className="text-sm font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
          href={`/lecturer/submissions/${draft.parentSubmissionId}`}
        >
          ← Quay lại bản gửi bị từ chối
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {draft.submissionType === "CONFIRM_UNCHANGED"
            ? "Xác nhận và gửi lại"
            : "Chỉnh sửa và gửi lại"}
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          {SUBMISSION_TYPE_LABELS[draft.submissionType]} · Lần gửi mới sẽ có mã
          submission mới và liên kết với bản gửi bị từ chối.
        </p>
      </header>

      <section className="rounded-2xl border border-red-300 bg-red-50 p-6 dark:border-red-800 dark:bg-red-950/40">
        <h2 className="font-semibold">Lý do từ chối</h2>
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-red-700 dark:text-red-300">
          {formatWorkflowDate(draft.rejectedAt)}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm">
          {draft.rejectionReason}
        </p>
      </section>

      {draft.baseChanged && (
        <section
          className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          <h2 className="font-semibold">Dữ liệu hiện hành đã thay đổi</h2>
          <p className="mt-2 text-sm">
            Bản cũ dựa trên STT {draft.previousBaseStt}, phiên bản{" "}
            {draft.previousBaseVersionNo}. Lần gửi này sẽ dùng STT{" "}
            {draft.latestBaseStt}, phiên bản {draft.latestBaseVersionNo}. Vui
            lòng kiểm tra lại nội dung trước khi gửi.
          </p>
        </section>
      )}

      {draft.submissionType === "CONFIRM_UNCHANGED" ? (
        <>
          <CurrentRowPanel row={draft.currentRow} />
          <ConfirmUnchangedForm
            baseStt={draft.latestBaseStt}
            baseVersionNo={draft.latestBaseVersionNo}
            parentSubmissionId={draft.parentSubmissionId}
            recordUid={draft.recordUid}
          />
        </>
      ) : draft.submissionType === "UPDATE_EXISTING" ? (
        <EditableRowForm
          baseStt={draft.latestBaseStt}
          baseVersionNo={draft.latestBaseVersionNo}
          currentRow={draft.currentRow}
          initialEditableFields={draft.editableFields}
          kind="UPDATE_EXISTING"
          parentSubmissionId={draft.parentSubmissionId}
          recordUid={draft.recordUid}
        />
      ) : (
        <EditableRowForm
          initialEditableFields={draft.editableFields}
          kind="CREATE_NEW"
          parentSubmissionId={draft.parentSubmissionId}
        />
      )}
    </main>
  );
}

function CurrentRowPanel({ row }: Readonly<{ row: CoreBusinessRow }>) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
        Dữ liệu hiện hành để xác nhận
      </h2>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        {CORE_DISPLAY_FIELD_NAMES.map((field) => (
          <div
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            data-current-row-field={field}
            key={field}
          >
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {BUSINESS_FIELD_LABELS[field]}
            </dt>
            <dd className="mt-2 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">
              {formatWorkflowFieldValue(row[field])}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
