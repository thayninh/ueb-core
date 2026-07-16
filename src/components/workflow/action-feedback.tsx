"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { WorkflowSubmitActionResult } from "@/app/actions/workflow-submit";

export const EMPTY_WORKFLOW_ACTION_RESULT: WorkflowSubmitActionResult = {
  success: false,
  fieldErrors: {},
  formError: null,
  errorCode: null,
  submission: null,
};

export function useStableSubmissionId(initialValue?: string): string {
  const [submissionId, setSubmissionId] = useState(initialValue ?? "");

  useEffect(() => {
    if (submissionId) return;

    const timeoutId = globalThis.setTimeout(() => {
      setSubmissionId(globalThis.crypto.randomUUID());
    }, 0);

    return () => globalThis.clearTimeout(timeoutId);
  }, [submissionId]);

  return submissionId;
}

export function WorkflowActionFeedback({
  result,
}: Readonly<{ result: WorkflowSubmitActionResult }>) {
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (result.formError) feedbackRef.current?.focus();
  }, [result.formError]);

  if (result.success && result.submission) {
    return (
      <div
        aria-live="polite"
        className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
        role="status"
      >
        Bản gửi đã được ghi nhận và đang chờ phê duyệt.{" "}
        <Link
          className="font-semibold underline underline-offset-2"
          href={"/lecturer/submissions/" + result.submission.submissionId}
        >
          Xem bản gửi
        </Link>
      </div>
    );
  }

  if (!result.formError) return null;
  return (
    <div
      aria-live="assertive"
      className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
      ref={feedbackRef}
      role="alert"
      tabIndex={-1}
    >
      <p className="font-semibold">Chưa thể gửi biểu mẫu</p>
      <p className="mt-1">{result.formError}</p>
    </div>
  );
}
