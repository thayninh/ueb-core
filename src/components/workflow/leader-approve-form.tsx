"use client";

import { useActionState } from "react";

import {
  approveSubmissionFormAction,
  type WorkflowApproveActionResult,
} from "@/app/actions/workflow-approve";
import { Alert, Button } from "@/components/ui";

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
      <Alert aria-live="polite" role="status" variant="success">
        Bản gửi đã được phê duyệt. STT kết quả: {result.approval.resultStt} ·
        Phiên bản kết quả: {result.approval.resultVersionNo}.
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input name="submissionId" type="hidden" value={submissionId} />
      <p className="text-sm font-medium text-ink">
        Phê duyệt sẽ tạo một phiên bản dữ liệu mới và không thay đổi phiên bản
        cũ.
      </p>
      <label className="flex min-h-11 items-start gap-3 rounded-control text-sm text-muted">
        <input
          className="mt-1 h-5 w-5 shrink-0 accent-brand-700"
          disabled={stale || pending}
          required
          type="checkbox"
        />
        <span>Tôi đã kiểm tra nội dung và xác nhận phê duyệt bản gửi này.</span>
      </label>
      {result.formError && (
        <Alert aria-live="assertive" role="alert" variant="danger">
          {result.formError}
        </Alert>
      )}
      <Button
        className="bg-success-text text-white hover:opacity-90"
        disabled={stale || pending}
        type="submit"
      >
        {stale
          ? "Không thể phê duyệt dữ liệu đã thay đổi"
          : pending
            ? "Đang phê duyệt…"
            : "Phê duyệt bản gửi"}
      </Button>
    </form>
  );
}
