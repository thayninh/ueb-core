"use client";

import { useActionState } from "react";

import { submitUnchangedRowFormAction } from "@/app/actions/workflow-submit";
import { Button } from "@/components/ui";

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
  parentSubmissionId,
}: Readonly<{
  submissionId?: string;
  recordUid: string;
  baseStt: number;
  baseVersionNo: number;
  parentSubmissionId?: string;
}>) {
  const submissionId = useStableSubmissionId(
    initialSubmissionId,
    parentSubmissionId,
  );
  const [result, formAction, pending] = useActionState(
    submitUnchangedRowFormAction,
    EMPTY_WORKFLOW_ACTION_RESULT,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input name="submissionId" type="hidden" value={submissionId} />
      <input name="recordUid" type="hidden" value={recordUid} />
      <input name="baseStt" type="hidden" value={baseStt} />
      <input name="baseVersionNo" type="hidden" value={baseVersionNo} />
      {parentSubmissionId && (
        <input
          name="parentSubmissionId"
          type="hidden"
          value={parentSubmissionId}
        />
      )}
      <p className="text-sm leading-6 text-muted">
        Bạn đang gửi xác nhận rằng dòng này không thay đổi. Sau khi gửi, một bản
        gửi mới sẽ được tạo và chờ lãnh đạo xử lý.
      </p>
      <WorkflowActionFeedback result={result} />
      {!result.success && (
        <Button
          className="w-full sm:w-auto"
          disabled={pending || !submissionId}
          loading={pending}
          type="submit"
        >
          {!submissionId
            ? "Đang chuẩn bị…"
            : pending
              ? "Đang gửi…"
              : "Xác nhận và gửi"}
        </Button>
      )}
    </form>
  );
}
