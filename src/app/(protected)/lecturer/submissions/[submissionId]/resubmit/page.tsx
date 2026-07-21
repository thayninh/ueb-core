import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert, PageContainer } from "@/components/ui";
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
    <main className="relative py-8 sm:py-10 lg:py-12">
      <PageContainer className="max-w-5xl space-y-8">
        <header>
          <Link
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-2"
            href={`/lecturer/submissions/${draft.parentSubmissionId}`}
          >
            ← Quay lại bản gửi bị từ chối
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {draft.submissionType === "CONFIRM_UNCHANGED"
              ? "Xác nhận và gửi lại"
              : "Chỉnh sửa và gửi lại"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            {SUBMISSION_TYPE_LABELS[draft.submissionType]} · Lần gửi mới sẽ có
            mã submission mới và liên kết với bản gửi bị từ chối.
          </p>
        </header>

        <Alert className="p-5 sm:p-6" variant="danger">
          <h2 className="font-semibold">Lý do từ chối</h2>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide">
            {formatWorkflowDate(draft.rejectedAt)}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm">
            {draft.rejectionReason}
          </p>
        </Alert>

        {draft.baseChanged && (
          <Alert className="p-5 sm:p-6" role="status" variant="warning">
            <h2 className="font-semibold">Dữ liệu hiện hành đã thay đổi</h2>
            <p className="mt-2 text-sm">
              Bản cũ dựa trên STT {draft.previousBaseStt}, phiên bản{" "}
              {draft.previousBaseVersionNo}. Lần gửi này sẽ dùng STT{" "}
              {draft.latestBaseStt}, phiên bản {draft.latestBaseVersionNo}. Vui
              lòng kiểm tra lại nội dung trước khi gửi.
            </p>
          </Alert>
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
      </PageContainer>
    </main>
  );
}

function CurrentRowPanel({ row }: Readonly<{ row: CoreBusinessRow }>) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-ink">
        Dữ liệu hiện hành để xác nhận
      </h2>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        {CORE_DISPLAY_FIELD_NAMES.map((field) => (
          <div
            className="rounded-control border border-border bg-surface p-4 shadow-control"
            data-current-row-field={field}
            key={field}
          >
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              {BUSINESS_FIELD_LABELS[field]}
            </dt>
            <dd className="mt-2 whitespace-pre-wrap text-sm text-ink">
              {formatWorkflowFieldValue(row[field])}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
