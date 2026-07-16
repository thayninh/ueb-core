"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireLecturerIdentity } from "@/lib/auth/authorization";
import { isWorkflowError } from "@/lib/workflow/errors";
import {
  confirmUnchangedInputSchema,
  createNewInputSchema,
  updateExistingInputSchema,
} from "@/lib/workflow/payload-schema";
import {
  submitNewRow,
  submitUnchangedRow,
  submitUpdatedRow,
  type SubmittedRowDto,
} from "@/lib/workflow/submit-service";

export interface WorkflowSubmitActionResult {
  readonly success: boolean;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly formError: string | null;
  readonly submission: SubmittedRowDto | null;
}

const parentSubmissionIdSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.uuid().nullable(),
);

const unchangedFormSchema = z
  .object({
    submissionId: z.uuid(),
    recordUid: z.uuid(),
    baseStt: z.coerce.number().int(),
    baseVersionNo: z.coerce.number().int().min(1),
    parentSubmissionId: parentSubmissionIdSchema.optional(),
  })
  .strict()
  .pipe(confirmUnchangedInputSchema);

const editableFieldsJsonSchema = z.string().transform((value, context) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    context.addIssue({ code: "custom", message: "Invalid editable fields." });
    return z.NEVER;
  }
});

const updateFormSchema = z
  .object({
    submissionId: z.uuid(),
    recordUid: z.uuid(),
    baseStt: z.coerce.number().int(),
    baseVersionNo: z.coerce.number().int().min(1),
    editableFields: editableFieldsJsonSchema,
    parentSubmissionId: parentSubmissionIdSchema.optional(),
  })
  .strict()
  .pipe(updateExistingInputSchema);

const createFormSchema = z
  .object({
    submissionId: z.uuid(),
    editableFields: editableFieldsJsonSchema,
    parentSubmissionId: parentSubmissionIdSchema.optional(),
  })
  .strict()
  .pipe(createNewInputSchema);

export function submitUnchangedRowAction(
  formData: FormData,
): Promise<WorkflowSubmitActionResult> {
  return runAction(formData, unchangedFormSchema, submitUnchangedRow);
}

export function submitUpdatedRowAction(
  formData: FormData,
): Promise<WorkflowSubmitActionResult> {
  return runAction(formData, updateFormSchema, submitUpdatedRow);
}

export function submitNewRowAction(
  formData: FormData,
): Promise<WorkflowSubmitActionResult> {
  return runAction(formData, createFormSchema, submitNewRow);
}

async function runAction<Input>(
  formData: FormData,
  schema: z.ZodType<Input>,
  service: (input: Input) => Promise<SubmittedRowDto>,
): Promise<WorkflowSubmitActionResult> {
  const raw = formDataToObject(formData);
  if (!raw.success) return raw.result;

  const parsed = schema.safeParse(raw.data);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(
      Object.entries(parsed.error.flatten().fieldErrors).filter(
        (entry): entry is [string, string[]] => Array.isArray(entry[1]),
      ),
    );
    return {
      success: false,
      fieldErrors,
      formError: "The submission form is invalid.",
      submission: null,
    };
  }

  try {
    await requireLecturerIdentity();
    const submission = await service(parsed.data);
    revalidateWorkflowPaths();
    return {
      success: true,
      fieldErrors: {},
      formError: null,
      submission,
    };
  } catch (error) {
    return {
      success: false,
      fieldErrors: {},
      formError: isWorkflowError(error)
        ? error.message
        : "The submission could not be completed.",
      submission: null,
    };
  }
}

function formDataToObject(
  formData: FormData,
):
  | { success: true; data: Record<string, FormDataEntryValue> }
  | { success: false; result: WorkflowSubmitActionResult } {
  const data: Record<string, FormDataEntryValue> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_")) continue;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return {
        success: false,
        result: {
          success: false,
          fieldErrors: { [key]: ["Duplicate form field."] },
          formError: "The submission form is invalid.",
          submission: null,
        },
      };
    }
    data[key] = value;
  }
  return { success: true, data };
}

function revalidateWorkflowPaths(): void {
  revalidatePath("/lecturer/profile");
  revalidatePath("/lecturer/submissions");
  revalidatePath("/dashboard");
}
