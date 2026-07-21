"use client";

import { useActionState } from "react";

import {
  rejectSubmissionFormAction,
  type WorkflowRejectActionResult,
} from "@/app/actions/workflow-reject";
import { Alert, Button, Textarea } from "@/components/ui";
import { REJECT_REASON_MAX_LENGTH } from "@/lib/workflow/reject-policy";

const EMPTY_REJECT_RESULT: WorkflowRejectActionResult = {
  success: false,
  fieldErrors: {},
  formError: null,
  errorCode: null,
  rejection: null,
};

export function LeaderRejectForm({
  submissionId,
}: Readonly<{ submissionId: string }>) {
  const [result, formAction, pending] = useActionState(
    rejectSubmissionFormAction,
    EMPTY_REJECT_RESULT,
  );

  if (result.success && result.rejection) {
    return (
      <Alert aria-live="polite" role="status" variant="danger">
        Bản gửi đã được từ chối. Quyết định đã được ghi thành sự kiện bất biến.
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input name="submissionId" type="hidden" value={submissionId} />
      <label
        className="block text-sm font-semibold text-ink"
        htmlFor="reject-reason"
      >
        Lý do từ chối
      </label>
      <Textarea
        aria-describedby={
          result.fieldErrors.reason
            ? "reject-reason-help reject-reason-error"
            : "reject-reason-help"
        }
        aria-invalid={result.fieldErrors.reason ? true : undefined}
        className="min-h-36"
        id="reject-reason"
        maxLength={REJECT_REASON_MAX_LENGTH}
        minLength={3}
        name="reason"
        required
      />
      <p className="text-xs text-muted" id="reject-reason-help">
        Lý do sẽ được hiển thị cho giảng viên và không thể chỉnh sửa sau khi
        gửi.
      </p>
      {result.fieldErrors.reason && (
        <p className="text-sm text-danger-text" id="reject-reason-error">
          {result.fieldErrors.reason.join(" ")}
        </p>
      )}
      {result.formError && (
        <Alert aria-live="assertive" role="alert" variant="danger">
          {result.formError}
        </Alert>
      )}
      <label className="flex min-h-11 items-start gap-3 rounded-control text-sm text-muted">
        <input
          className="mt-1 h-5 w-5 shrink-0 accent-brand-700"
          required
          type="checkbox"
        />
        <span>
          Tôi xác nhận từ chối bản gửi này và hiểu rằng quyết định không thể sửa
          lại.
        </span>
      </label>
      <Button
        className="bg-danger-text text-white hover:opacity-90"
        disabled={pending}
        type="submit"
      >
        {pending ? "Đang ghi quyết định…" : "Từ chối bản gửi"}
      </Button>
    </form>
  );
}
