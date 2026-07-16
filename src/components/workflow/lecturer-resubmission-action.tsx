import Link from "next/link";

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
    <section className="rounded-2xl border border-blue-300 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-950/40">
      <h2 className="font-semibold text-blue-950 dark:text-blue-100">
        Gửi lại sau khi chỉnh sửa
      </h2>
      <p className="mt-2 text-sm leading-6 text-blue-900 dark:text-blue-200">
        Lần gửi lại sẽ tạo một mã submission mới. Bản gửi đã bị từ chối và lý do
        từ chối vẫn được giữ nguyên trong lịch sử.
      </p>
      <Link
        className="mt-4 inline-flex rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
        href={`/lecturer/submissions/${submissionId}/resubmit`}
      >
        {label}
      </Link>
    </section>
  );
}
