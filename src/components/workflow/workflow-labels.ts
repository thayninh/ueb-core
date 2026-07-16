import type { SubmissionState, SubmissionType } from "@/lib/workflow/types";

export const SUBMISSION_TYPE_LABELS: Readonly<Record<SubmissionType, string>> =
  {
    CONFIRM_UNCHANGED: "Xác nhận không thay đổi",
    UPDATE_EXISTING: "Cập nhật dòng hiện có",
    CREATE_NEW: "Tạo dòng mới",
  };

export const SUBMISSION_STATE_LABELS: Readonly<
  Record<SubmissionState, string>
> = {
  PENDING: "Đang chờ phê duyệt",
  REJECTED: "Đã từ chối",
  APPROVED: "Đã phê duyệt",
};

export function formatWorkflowDate(value: Date | null): string {
  return value ? value.toLocaleString("vi-VN") : "—";
}
