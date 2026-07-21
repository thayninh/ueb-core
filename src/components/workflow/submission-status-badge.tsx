import { SUBMISSION_STATE_LABELS } from "./workflow-labels";

import { Badge } from "@/components/ui";

import type { SubmissionState } from "@/lib/workflow/types";

const STATE_VARIANTS: Readonly<
  Record<SubmissionState, "warning" | "danger" | "success">
> = {
  PENDING: "warning",
  REJECTED: "danger",
  APPROVED: "success",
};

export function SubmissionStatusBadge({
  state,
}: Readonly<{ state: SubmissionState }>) {
  return (
    <Badge className="min-h-7" variant={STATE_VARIANTS[state]}>
      {SUBMISSION_STATE_LABELS[state]}
    </Badge>
  );
}
