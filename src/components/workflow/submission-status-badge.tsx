import { SUBMISSION_STATE_LABELS } from "./workflow-labels";

import type { SubmissionState } from "@/lib/workflow/types";

const STATE_STYLES: Readonly<Record<SubmissionState, string>> = {
  PENDING:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
  REJECTED:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100",
  APPROVED:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100",
};

export function SubmissionStatusBadge({
  state,
}: Readonly<{ state: SubmissionState }>) {
  return (
    <span
      className={
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold " +
        STATE_STYLES[state]
      }
    >
      {SUBMISSION_STATE_LABELS[state]}
    </span>
  );
}
