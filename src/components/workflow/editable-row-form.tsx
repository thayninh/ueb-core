"use client";

import { useActionState, useState } from "react";

import {
  submitNewRowFormAction,
  submitUpdatedRowFormAction,
} from "@/app/actions/workflow-submit";
import { Button, Input } from "@/components/ui";
import {
  EDITABLE_BUSINESS_FIELD_NAMES,
  READ_ONLY_BUSINESS_FIELD_NAMES,
} from "@/lib/workflow/field-policy";
import {
  BUSINESS_FIELD_LABELS,
  formatWorkflowFieldValue,
} from "@/lib/workflow/field-display";

import {
  EMPTY_WORKFLOW_ACTION_RESULT,
  useStableSubmissionId,
  WorkflowActionFeedback,
} from "./action-feedback";

import type {
  CoreBusinessRow,
  EditableBusinessFieldName,
  EditableBusinessFields,
} from "@/lib/workflow/types";

type EditableFormMode =
  | {
      readonly kind: "UPDATE_EXISTING";
      readonly submissionId?: string;
      readonly recordUid: string;
      readonly baseStt: number;
      readonly baseVersionNo: number;
      readonly currentRow: CoreBusinessRow;
      readonly initialEditableFields?: EditableBusinessFields;
      readonly parentSubmissionId?: string;
    }
  | {
      readonly kind: "CREATE_NEW";
      readonly submissionId?: string;
      readonly initialEditableFields?: EditableBusinessFields;
      readonly parentSubmissionId?: string;
    };

const emptyEditableFields = Object.fromEntries(
  EDITABLE_BUSINESS_FIELD_NAMES.map((field) => [
    field,
    field === "khoi_kien_thuc" ? 0 : null,
  ]),
) as unknown as EditableBusinessFields;

export function EditableRowForm(props: Readonly<EditableFormMode>) {
  const submissionId = useStableSubmissionId(
    props.submissionId,
    props.parentSubmissionId,
  );
  const [editableFields, setEditableFields] = useState<EditableBusinessFields>(
    () => pickInitialEditableFields(props),
  );
  const action =
    props.kind === "UPDATE_EXISTING"
      ? submitUpdatedRowFormAction
      : submitNewRowFormAction;
  const [result, formAction, pending] = useActionState(
    action,
    EMPTY_WORKFLOW_ACTION_RESULT,
  );

  return (
    <form action={formAction} className="space-y-6 sm:space-y-8">
      <input name="submissionId" type="hidden" value={submissionId} />
      <input
        name="editableFields"
        type="hidden"
        value={JSON.stringify(editableFields)}
      />
      {props.parentSubmissionId && (
        <input
          name="parentSubmissionId"
          type="hidden"
          value={props.parentSubmissionId}
        />
      )}
      {props.kind === "UPDATE_EXISTING" && (
        <>
          <input name="recordUid" type="hidden" value={props.recordUid} />
          <input name="baseStt" type="hidden" value={props.baseStt} />
          <input
            name="baseVersionNo"
            type="hidden"
            value={props.baseVersionNo}
          />
        </>
      )}
      {props.kind === "UPDATE_EXISTING" && (
        <fieldset className="rounded-card border border-border bg-surface p-4 shadow-control sm:p-6">
          <legend className="px-2 font-semibold text-ink">
            Thông tin chỉ đọc
          </legend>
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {READ_ONLY_BUSINESS_FIELD_NAMES.map((field) => (
              <div key={field}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {BUSINESS_FIELD_LABELS[field]}
                </dt>
                <dd className="mt-1 break-words text-sm text-ink">
                  {formatWorkflowFieldValue(props.currentRow[field])}
                </dd>
              </div>
            ))}
          </dl>
        </fieldset>
      )}

      <fieldset className="rounded-card border border-border bg-surface p-4 shadow-control sm:p-6">
        <legend className="px-2 font-semibold text-ink">
          14 trường được phép chỉnh sửa
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          {EDITABLE_BUSINESS_FIELD_NAMES.map((field) => {
            const errorId = field + "-error";
            const fieldErrors = result.fieldErrors.editableFields;
            return (
              <div key={field}>
                <label
                  className="block text-sm font-semibold text-ink"
                  htmlFor={field}
                >
                  {BUSINESS_FIELD_LABELS[field]}
                </label>
                <Input
                  aria-describedby={fieldErrors ? errorId : undefined}
                  className="mt-2"
                  data-workflow-editable-field={field}
                  id={field}
                  inputMode={field === "khoi_kien_thuc" ? "numeric" : undefined}
                  onChange={(event) =>
                    setEditableFields((current) => ({
                      ...current,
                      [field]:
                        field === "khoi_kien_thuc"
                          ? Number(event.target.value)
                          : event.target.value === ""
                            ? null
                            : event.target.value,
                    }))
                  }
                  required={field === "khoi_kien_thuc"}
                  type={field === "khoi_kien_thuc" ? "number" : "text"}
                  value={toInputValue(editableFields[field])}
                />
                {fieldErrors && (
                  <p className="mt-1 text-sm text-danger-text" id={errorId}>
                    {fieldErrors.join(" ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

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
              : "Gửi bản chờ phê duyệt"}
        </Button>
      )}
    </form>
  );
}

function pickInitialEditableFields(
  props: Readonly<EditableFormMode>,
): EditableBusinessFields {
  const source =
    props.initialEditableFields ??
    (props.kind === "UPDATE_EXISTING" ? props.currentRow : emptyEditableFields);
  return Object.fromEntries(
    EDITABLE_BUSINESS_FIELD_NAMES.map((field) => [field, source[field]]),
  ) as unknown as EditableBusinessFields;
}

function toInputValue(
  value: CoreBusinessRow[EditableBusinessFieldName],
): string | number {
  return value ?? "";
}
