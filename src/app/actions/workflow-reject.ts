"use server";

import { revalidatePath } from "next/cache";

import { BusinessRole } from "@/generated/prisma/client";
import { requireAnyRole } from "@/lib/auth/authorization";
import { isWorkflowError, type WorkflowErrorCode } from "@/lib/workflow/errors";
import { rejectSubmissionInputSchema } from "@/lib/workflow/reject-policy";
import {
  rejectSubmission,
  type RejectedSubmissionDto,
} from "@/lib/workflow/reject-service";

export interface WorkflowRejectActionResult {
  readonly success: boolean;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly formError: string | null;
  readonly errorCode: WorkflowErrorCode | "VALIDATION_ERROR" | null;
  readonly rejection: RejectedSubmissionDto | null;
}

const WORKFLOW_REJECT_ERROR_MESSAGES: Partial<
  Readonly<Record<WorkflowErrorCode, string>>
> = {
  WORKFLOW_SUBMISSION_NOT_FOUND:
    "Không tìm thấy bản gửi hoặc bạn không có quyền truy cập.",
  WORKFLOW_SCOPE_DENIED:
    "Không tìm thấy bản gửi hoặc bạn không có quyền truy cập.",
  WORKFLOW_NOT_OWNER:
    "Không tìm thấy bản gửi hoặc bạn không có quyền truy cập.",
  WORKFLOW_ALREADY_TERMINAL: "Bản gửi này đã được xử lý trước đó.",
  WORKFLOW_INVALID_STATE: "Trạng thái bản gửi không hợp lệ.",
  WORKFLOW_INVALID_PAYLOAD: "Nội dung từ chối không hợp lệ.",
};

export async function rejectSubmissionAction(
  formData: FormData,
): Promise<WorkflowRejectActionResult> {
  const raw = formDataToObject(formData);
  if (!raw.success) return raw.result;

  const parsed = rejectSubmissionInputSchema.safeParse(raw.data);
  if (!parsed.success) {
    return {
      success: false,
      fieldErrors: parsed.error.flatten().fieldErrors,
      formError: "Biểu mẫu chưa hợp lệ. Vui lòng kiểm tra lại.",
      errorCode: "VALIDATION_ERROR",
      rejection: null,
    };
  }

  try {
    await requireAnyRole([BusinessRole.FACULTY_LEADER, BusinessRole.ADMIN]);
    const rejection = await rejectSubmission(parsed.data);
    revalidateWorkflowPaths(rejection.submissionId);
    return {
      success: true,
      fieldErrors: {},
      formError: null,
      errorCode: null,
      rejection,
    };
  } catch (error) {
    const workflowError = isWorkflowError(error) ? error : null;
    return {
      success: false,
      fieldErrors: {},
      formError: workflowError
        ? (WORKFLOW_REJECT_ERROR_MESSAGES[workflowError.code] ??
          "Không thể từ chối bản gửi ở trạng thái hiện tại.")
        : "Không thể hoàn tất quyết định. Vui lòng thử lại.",
      errorCode: workflowError?.code ?? null,
      rejection: null,
    };
  }
}

export async function rejectSubmissionFormAction(
  _previousState: WorkflowRejectActionResult,
  formData: FormData,
): Promise<WorkflowRejectActionResult> {
  return rejectSubmissionAction(formData);
}

function revalidateWorkflowPaths(submissionId: string): void {
  revalidatePath("/leader/submissions");
  revalidatePath(`/leader/submissions/${submissionId}`);
  revalidatePath("/lecturer/submissions");
  revalidatePath(`/lecturer/submissions/${submissionId}`);
  revalidatePath("/dashboard");
}

function formDataToObject(
  formData: FormData,
):
  | { success: true; data: Record<string, FormDataEntryValue> }
  | { success: false; result: WorkflowRejectActionResult } {
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
          rejection: null,
        },
      };
    }
    data[key] = value;
  }
  return { success: true, data };
}
