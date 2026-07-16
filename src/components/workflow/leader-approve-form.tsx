"use client";

import { useActionState } from "react";

import {
  approveSubmissionFormAction,
  type WorkflowApproveActionResult,
} from "@/app/actions/workflow-approve";

const EMPTY_APPROVE_RESULT: WorkflowApproveActionResult = {
  success: false,
  fieldErrors: {},
  formError: null,
  errorCode: null,
  approval: null,
};

export function LeaderApproveForm({
  submissionId,
  stale,
}: Readonly<{ submissionId: string; stale: boolean }>) {
  const [result, formAction, pending] = useActionState(
    approveSubmissionFormAction,
    EMPTY_APPROVE_RESULT,
  );

  if (result.success && result.approval) {
    return (
      <div
        aria-live="polite"
        className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
        role="status"
      >
        Bản gửi đã được phê duyệt. STT kết quả: {result.approval.resultStt} ·
        Phiên bản kết quả: {result.approval.resultVersionNo}.
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input name="submissionId" type="hidden" value={submissionId} />
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Phê duyệt sẽ tạo một phiên bản dữ liệu mới và không thay đổi phiên bản
        cũ.
      </p>
      <label className="flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-200">
        <input
          className="mt-1"
          disabled={stale || pending}
          required
          type="checkbox"
        />
        <span>Tôi đã kiểm tra nội dung và xác nhận phê duyệt bản gửi này.</span>
      </label>
      {result.formError && (
        <p
          aria-live="assertive"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
          role="alert"
        >
          {result.formError}
        </p>
      )}
      <button
        className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={stale || pending}
        type="submit"
      >
        {stale
          ? "Không thể phê duyệt dữ liệu đã thay đổi"
          : pending
            ? "Đang phê duyệt…"
            : "Phê duyệt bản gửi"}
      </button>
    </form>
  );
}
