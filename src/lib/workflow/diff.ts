import { SUBMISSION_PAYLOAD_FIELD_NAMES } from "./field-policy";
import { BUSINESS_FIELD_LABELS } from "./field-display";

import type {
  CoreBusinessRow,
  RowSubmissionPayload,
  SubmissionPayloadFieldName,
  SubmissionType,
} from "./types";

export type WorkflowFieldChangeType = "UNCHANGED" | "MODIFIED" | "NEW";

export interface WorkflowFieldDiff {
  readonly field: SubmissionPayloadFieldName;
  readonly label: string;
  readonly before: RowSubmissionPayload[SubmissionPayloadFieldName] | null;
  readonly after: RowSubmissionPayload[SubmissionPayloadFieldName];
  readonly changeType: WorkflowFieldChangeType;
}

export function diffSubmittedRow(input: {
  readonly currentRow: CoreBusinessRow | null;
  readonly submittedPayload: RowSubmissionPayload;
  readonly submissionType: SubmissionType;
}): readonly WorkflowFieldDiff[] {
  return SUBMISSION_PAYLOAD_FIELD_NAMES.map((field) => {
    const after = input.submittedPayload[field];
    if (input.submissionType === "CREATE_NEW") {
      return {
        field,
        label: BUSINESS_FIELD_LABELS[field],
        before: null,
        after,
        changeType: "NEW" as const,
      };
    }

    const before = input.currentRow?.[field] ?? null;
    return {
      field,
      label: BUSINESS_FIELD_LABELS[field],
      before,
      after,
      changeType: Object.is(before, after)
        ? ("UNCHANGED" as const)
        : ("MODIFIED" as const),
    };
  });
}
