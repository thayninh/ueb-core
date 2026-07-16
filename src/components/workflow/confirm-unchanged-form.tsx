"use client";

import { useActionState } from "react";

import { submitUnchangedRowFormAction } from "@/app/actions/workflow-submit";

import {
  EMPTY_WORKFLOW_ACTION_RESULT,
  useStableSubmissionId,
  WorkflowActionFeedback,
} from "./action-feedback";

export function ConfirmUnchangedForm({
  submissionId: initialSubmissionId,
  recordUid,
  baseStt,
  baseVersionNo,
}: Readonly<{
  submissionId?: string;
  recordUid: string;
  baseStt: number;
  baseVersionNo: number;
}>) {
  const submissionId = useStableSubmissionId(initialSubmissionId);
  const [result, formAction, pending] = useActionState(
    submitUnchangedRowFormAction,
    EMPTY_WORKFLOW_ACTION_RESULT,
  );

  return (
    <form action={formAction} className="space-y-3">
      <input name="submissionId" type="hidden" value={submissionId} />
      <input name="recordUid" type="hidden" value={recordUid} />
      <input name="baseStt" type="hidden" value={baseStt} />
      <input name="baseVersionNo" type="hidden" value={baseVersionNo} />
      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
        Bạn đang gửi xác nhận rằng dòng này không thay đổi. Sau khi gửi, bản gửi
        sẽ bị khóa và chờ lãnh đạo xử lý.
      </p>
      <WorkflowActionFeedback result={result} />
      {!result.success && (
        <button
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
          disabled={pending || !submissionId}
          type="submit"
        >
          {!submissionId
            ? "Đang chuẩn bị…"
            : pending
              ? "Đang gửi…"
              : "Xác nhận và gửi"}
        </button>
      )}
    </form>
  );
}
