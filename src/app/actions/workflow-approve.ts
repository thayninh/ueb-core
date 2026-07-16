"use server";

import { revalidatePath } from "next/cache";

import { BusinessRole } from "@/generated/prisma/client";
import { requireAnyRole } from "@/lib/auth/authorization";
import {
  approveSubmission,
  approveSubmissionInputSchema,
  type ApprovedSubmissionDto,
} from "@/lib/workflow/approve-service";
import { isWorkflowError, type WorkflowErrorCode } from "@/lib/workflow/errors";

export interface WorkflowApproveActionResult {
  readonly success: boolean;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly formError: string | null;
  readonly errorCode: WorkflowErrorCode | "VALIDATION_ERROR" | null;
  readonly approval: ApprovedSubmissionDto | null;
}

const WORKFLOW_APPROVE_ERROR_MESSAGES: Partial<
  Readonly<Record<WorkflowErrorCode, string>>
> = {
  WORKFLOW_SUBMISSION_NOT_FOUND:
    "Không tìm thấy bản gửi hoặc bạn không có quyền truy cập.",
  WORKFLOW_SCOPE_DENIED:
    "Không tìm thấy bản gửi hoặc bạn không có quyền truy cập.",
  WORKFLOW_NOT_OWNER:
    "Không tìm thấy bản gửi hoặc bạn không có quyền truy cập.",
  WORKFLOW_ALREADY_TERMINAL: "Bản gửi này đã được xử lý trước đó.",
  WORKFLOW_STALE_BASE:
    "Dữ liệu lõi đã thay đổi từ sau thời điểm gửi. Không thể phê duyệt.",
  WORKFLOW_PAYLOAD_MISMATCH:
    "Nội dung bản gửi không còn đáp ứng contract phê duyệt.",
  WORKFLOW_INVALID_STATE: "Trạng thái bản gửi không hợp lệ.",
  WORKFLOW_INVALID_PAYLOAD: "Yêu cầu phê duyệt không hợp lệ.",
};

export async function approveSubmissionAction(
  formData: FormData,
): Promise<WorkflowApproveActionResult> {
  const raw = formDataToObject(formData);
  if (!raw.success) return raw.result;

  const parsed = approveSubmissionInputSchema.safeParse(raw.data);
  if (!parsed.success) {
    return {
      success: false,
      fieldErrors: parsed.error.flatten().fieldErrors,
      formError: "Yêu cầu phê duyệt không hợp lệ.",
      errorCode: "VALIDATION_ERROR",
      approval: null,
    };
  }

  try {
    await requireAnyRole([BusinessRole.FACULTY_LEADER, BusinessRole.ADMIN]);
    const approval = await approveSubmission(parsed.data);
    revalidateWorkflowPaths(approval.submissionId);
    return {
      success: true,
      fieldErrors: {},
      formError: null,
      errorCode: null,
      approval,
    };
  } catch (error) {
    const workflowError = isWorkflowError(error) ? error : null;
    return {
      success: false,
      fieldErrors: {},
      formError: workflowError
        ? (WORKFLOW_APPROVE_ERROR_MESSAGES[workflowError.code] ??
          "Không thể phê duyệt bản gửi ở trạng thái hiện tại.")
        : "Không thể hoàn tất phê duyệt. Vui lòng thử lại.",
      errorCode: workflowError?.code ?? null,
      approval: null,
    };
  }
}

function revalidateWorkflowPaths(submissionId: string): void {
  revalidatePath("/leader/submissions");
  revalidatePath(`/leader/submissions/${submissionId}`);
  revalidatePath("/lecturer/profile");
  revalidatePath("/lecturer/submissions");
  revalidatePath(`/lecturer/submissions/${submissionId}`);
  revalidatePath("/dashboard");
}

function formDataToObject(
  formData: FormData,
):
  | { success: true; data: Record<string, FormDataEntryValue> }
  | { success: false; result: WorkflowApproveActionResult } {
  const data: Record<string, FormDataEntryValue> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_")) continue;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return {
        success: false,
        result: {
          success: false,
          fieldErrors: { [key]: ["Duplicate form field."] },
          formError: "Yêu cầu phê duyệt không hợp lệ.",
          errorCode: "VALIDATION_ERROR",
          approval: null,
        },
      };
    }
    data[key] = value;
  }
  return { success: true, data };
}
