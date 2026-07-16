"use client";

import { useActionState } from "react";

import {
  rejectSubmissionFormAction,
  type WorkflowRejectActionResult,
} from "@/app/actions/workflow-reject";
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
      <div
        aria-live="polite"
        className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
        role="status"
      >
        Bản gửi đã được từ chối. Quyết định đã được ghi thành sự kiện bất biến.
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input name="submissionId" type="hidden" value={submissionId} />
      <label
        className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100"
        htmlFor="reject-reason"
      >
        Lý do từ chối
      </label>
      <textarea
        aria-describedby="reject-reason-help reject-reason-error"
        className="min-h-36 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none focus:border-red-600 focus:ring-2 focus:ring-red-200 dark:border-zinc-700 dark:bg-zinc-950"
        id="reject-reason"
        maxLength={REJECT_REASON_MAX_LENGTH}
        minLength={3}
        name="reason"
        required
      />
      <p
        className="text-xs text-zinc-600 dark:text-zinc-300"
        id="reject-reason-help"
      >
        Lý do sẽ được hiển thị cho giảng viên và không thể chỉnh sửa sau khi
        gửi.
      </p>
      {result.fieldErrors.reason && (
        <p
          className="text-sm text-red-700 dark:text-red-300"
          id="reject-reason-error"
        >
          {result.fieldErrors.reason.join(" ")}
        </p>
      )}
      {result.formError && (
        <p
          aria-live="assertive"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
          role="alert"
        >
          {result.formError}
        </p>
      )}
      <label className="flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-200">
        <input className="mt-1" required type="checkbox" />
        <span>
          Tôi xác nhận từ chối bản gửi này và hiểu rằng quyết định không thể sửa
          lại.
        </span>
      </label>
      <button
        className="rounded-lg bg-red-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Đang ghi quyết định…" : "Từ chối bản gửi"}
      </button>
    </form>
  );
}
