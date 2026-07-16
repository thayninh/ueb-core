"use server";

import { z } from "zod";

import { requireLecturerIdentity } from "@/lib/auth/authorization";
import { isWorkflowError, type WorkflowErrorCode } from "@/lib/workflow/errors";
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
  readonly errorCode: WorkflowErrorCode | "VALIDATION_ERROR" | null;
  readonly submission: SubmittedRowDto | null;
}

const WORKFLOW_ERROR_MESSAGES: Readonly<Record<WorkflowErrorCode, string>> = {
  WORKFLOW_ALREADY_PENDING: "Dòng này đã có một bản gửi đang chờ xử lý.",
  WORKFLOW_STALE_BASE:
    "Dữ liệu đã thay đổi. Vui lòng tải lại và kiểm tra phiên bản mới nhất.",
  WORKFLOW_UNIT_UNRESOLVED:
    "Không thể xác định duy nhất đơn vị phê duyệt. Vui lòng liên hệ quản trị viên.",
  WORKFLOW_PAYLOAD_MISMATCH: "Yêu cầu gửi lại không khớp với bản gửi trước.",
  WORKFLOW_NOT_OWNER:
    "Không tìm thấy dữ liệu hoặc bạn không có quyền truy cập.",
  WORKFLOW_RECORD_NOT_FOUND:
    "Không tìm thấy dữ liệu hoặc bạn không có quyền truy cập.",
  WORKFLOW_SUBMISSION_NOT_FOUND:
    "Không tìm thấy bản gửi hoặc bạn không có quyền truy cập.",
  WORKFLOW_INVALID_STATE: "Trạng thái bản gửi không hợp lệ.",
  WORKFLOW_SCOPE_DENIED: "Bạn không có quyền thực hiện thao tác này.",
  WORKFLOW_ALREADY_TERMINAL: "Bản gửi này đã được xử lý.",
  WORKFLOW_INVALID_PAYLOAD: "Nội dung bản gửi không hợp lệ.",
};

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

export async function submitUnchangedRowAction(
  formData: FormData,
): Promise<WorkflowSubmitActionResult> {
  return runAction(formData, unchangedFormSchema, submitUnchangedRow);
}

export async function submitUpdatedRowAction(
  formData: FormData,
): Promise<WorkflowSubmitActionResult> {
  return runAction(formData, updateFormSchema, submitUpdatedRow);
}

export async function submitNewRowAction(
  formData: FormData,
): Promise<WorkflowSubmitActionResult> {
  return runAction(formData, createFormSchema, submitNewRow);
}

export async function submitUnchangedRowFormAction(
  _previousState: WorkflowSubmitActionResult,
  formData: FormData,
): Promise<WorkflowSubmitActionResult> {
  return submitUnchangedRowAction(formData);
}

export async function submitUpdatedRowFormAction(
  _previousState: WorkflowSubmitActionResult,
  formData: FormData,
): Promise<WorkflowSubmitActionResult> {
  return submitUpdatedRowAction(formData);
}

export async function submitNewRowFormAction(
  _previousState: WorkflowSubmitActionResult,
  formData: FormData,
): Promise<WorkflowSubmitActionResult> {
  return submitNewRowAction(formData);
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
      formError: "Biểu mẫu chưa hợp lệ. Vui lòng kiểm tra lại.",
      errorCode: "VALIDATION_ERROR",
      submission: null,
    };
  }

  try {
    await requireLecturerIdentity();
    const submission = await service(parsed.data);
    return {
      success: true,
      fieldErrors: {},
      formError: null,
      errorCode: null,
      submission,
    };
  } catch (error) {
    return {
      success: false,
      fieldErrors: {},
      formError: isWorkflowError(error)
        ? WORKFLOW_ERROR_MESSAGES[error.code]
        : "Không thể hoàn tất bản gửi. Vui lòng thử lại.",
      errorCode: isWorkflowError(error) ? error.code : null,
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
          formError: "Biểu mẫu chưa hợp lệ. Vui lòng kiểm tra lại.",
          errorCode: "VALIDATION_ERROR",
          submission: null,
        },
      };
    }
    data[key] = value;
  }
  return { success: true, data };
}
