import Link from "next/link";

import { Card } from "@/components/ui";

import type { SubmissionState } from "@/lib/workflow/types";

export function LecturerResubmissionAction({
  submissionId,
  state,
  submissionType,
}: Readonly<{
  submissionId: string;
  state: SubmissionState;
  submissionType: "CONFIRM_UNCHANGED" | "UPDATE_EXISTING" | "CREATE_NEW";
}>) {
  if (state !== "REJECTED") return null;

  const label =
    submissionType === "CONFIRM_UNCHANGED"
      ? "Xác nhận và gửi lại"
      : "Chỉnh sửa và gửi lại";

  return (
    <Card className="border-brand-200 p-5 sm:p-6">
      <h2 className="font-semibold text-ink">Gửi lại sau khi chỉnh sửa</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        Lần gửi lại sẽ tạo một mã submission mới. Bản gửi đã bị từ chối và lý do
        từ chối vẫn được giữ nguyên trong lịch sử.
      </p>
      <Link
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-control bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-control transition-colors hover:bg-brand-700 sm:w-auto"
        href={`/lecturer/submissions/${submissionId}/resubmit`}
      >
        {label}
      </Link>
    </Card>
  );
}
