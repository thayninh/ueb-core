"use client";

import { useActionState, useState } from "react";

import {
  submitNewRowFormAction,
  submitUpdatedRowFormAction,
} from "@/app/actions/workflow-submit";
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
    }
  | {
      readonly kind: "CREATE_NEW";
      readonly submissionId?: string;
    };

const emptyEditableFields = Object.fromEntries(
  EDITABLE_BUSINESS_FIELD_NAMES.map((field) => [
    field,
    field === "khoi_kien_thuc" ? 0 : null,
  ]),
) as unknown as EditableBusinessFields;

export function EditableRowForm(props: Readonly<EditableFormMode>) {
  const submissionId = useStableSubmissionId(props.submissionId);
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
    <form action={formAction} className="space-y-8">
      <input name="submissionId" type="hidden" value={submissionId} />
      <input
        name="editableFields"
        type="hidden"
        value={JSON.stringify(editableFields)}
      />
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
        <fieldset className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
          <legend className="px-2 font-semibold text-zinc-950 dark:text-zinc-50">
            Thông tin chỉ đọc
          </legend>
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {READ_ONLY_BUSINESS_FIELD_NAMES.map((field) => (
              <div key={field}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {BUSINESS_FIELD_LABELS[field]}
                </dt>
                <dd className="mt-1 break-words text-sm text-zinc-900 dark:text-zinc-100">
                  {formatWorkflowFieldValue(props.currentRow[field])}
                </dd>
              </div>
            ))}
          </dl>
        </fieldset>
      )}

      <fieldset className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
        <legend className="px-2 font-semibold text-zinc-950 dark:text-zinc-50">
          14 trường được phép chỉnh sửa
        </legend>
        <div className="grid gap-5 md:grid-cols-2">
          {EDITABLE_BUSINESS_FIELD_NAMES.map((field) => {
            const errorId = field + "-error";
            const fieldErrors = result.fieldErrors.editableFields;
            return (
              <div key={field}>
                <label
                  className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
                  htmlFor={field}
                >
                  {BUSINESS_FIELD_LABELS[field]}
                </label>
                <input
                  aria-describedby={fieldErrors ? errorId : undefined}
                  className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
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
                  <p className="mt-1 text-sm text-red-700" id={errorId}>
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
        <button
          className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
          disabled={pending || !submissionId}
          type="submit"
        >
          {!submissionId
            ? "Đang chuẩn bị…"
            : pending
              ? "Đang gửi…"
              : "Gửi bản chờ phê duyệt"}
        </button>
      )}
    </form>
  );
}

function pickInitialEditableFields(
  props: Readonly<EditableFormMode>,
): EditableBusinessFields {
  const source =
    props.kind === "UPDATE_EXISTING" ? props.currentRow : emptyEditableFields;
  return Object.fromEntries(
    EDITABLE_BUSINESS_FIELD_NAMES.map((field) => [field, source[field]]),
  ) as unknown as EditableBusinessFields;
}

function toInputValue(
  value: CoreBusinessRow[EditableBusinessFieldName],
): string | number {
  return value ?? "";
}
