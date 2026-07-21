"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { WorkflowSubmitActionResult } from "@/app/actions/workflow-submit";
import { Alert } from "@/components/ui";

export const EMPTY_WORKFLOW_ACTION_RESULT: WorkflowSubmitActionResult = {
  success: false,
  fieldErrors: {},
  formError: null,
  errorCode: null,
  submission: null,
};

export function useStableSubmissionId(
  initialValue?: string,
  excludedValue?: string,
): string {
  const [submissionId, setSubmissionId] = useState(
    initialValue && initialValue !== excludedValue ? initialValue : "",
  );

  useEffect(() => {
    if (submissionId) return;

    const timeoutId = globalThis.setTimeout(() => {
      let candidate = globalThis.crypto.randomUUID();
      while (candidate === excludedValue) {
        candidate = globalThis.crypto.randomUUID();
      }
      setSubmissionId(candidate);
    }, 0);

    return () => globalThis.clearTimeout(timeoutId);
  }, [excludedValue, submissionId]);

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
      <Alert aria-live="polite" role="status" variant="success">
        Bản gửi đã được ghi nhận và đang chờ phê duyệt.{" "}
        <Link
          className="font-semibold underline underline-offset-2"
          href={"/lecturer/submissions/" + result.submission.submissionId}
        >
          Xem bản gửi
        </Link>
      </Alert>
    );
  }

  if (!result.formError) return null;
  return (
    <Alert
      aria-live="assertive"
      ref={feedbackRef}
      role="alert"
      tabIndex={-1}
      variant="danger"
    >
      <p className="font-semibold">Chưa thể gửi biểu mẫu</p>
      <p className="mt-1">{result.formError}</p>
    </Alert>
  );
}
