import Link from "next/link";

import { CORE_DISPLAY_FIELD_NAMES } from "@/lib/workflow/field-policy";
import {
  BUSINESS_FIELD_LABELS,
  DTO_FIELD_BY_BUSINESS_FIELD,
} from "@/lib/workflow/field-display";

import { ConfirmUnchangedForm } from "./confirm-unchanged-form";
import { SUBMISSION_TYPE_LABELS, formatWorkflowDate } from "./workflow-labels";

import type { LatestCoreRowDto } from "@/lib/data/dto";
import type { PendingSubmissionByRecordDto } from "@/lib/workflow/lecturer-submission-query";

export function LecturerRowsTable({
  rows,
  pendingSubmissions,
}: Readonly<{
  rows: readonly LatestCoreRowDto[];
  pendingSubmissions: readonly PendingSubmissionByRecordDto[];
}>) {
  const pendingByRecord = new Map(
    pendingSubmissions.map((submission) => [submission.recordUid, submission]),
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
        Không có dữ liệu hiện hành trong phạm vi được phép.
      </div>
    );
  }

  return (
    <div
      aria-label="Dữ liệu hiện hành và thao tác workflow"
      className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800"
      tabIndex={0}
    >
      <table className="min-w-max border-collapse text-left text-sm">
        <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          <tr>
            {CORE_DISPLAY_FIELD_NAMES.map((field) => (
              <th
                className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-700"
                key={field}
                scope="col"
              >
                <span className="block max-w-56 whitespace-normal">
                  {BUSINESS_FIELD_LABELS[field]}
                </span>
              </th>
            ))}
            <th
              className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-700"
              scope="col"
            >
              Phiên bản
            </th>
            <th
              className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-700"
              scope="col"
            >
              Record UID
            </th>
            <th
              className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-700"
              scope="col"
            >
              Trạng thái và thao tác
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
          {rows.map((row) => {
            const pending = pendingByRecord.get(row.recordUid);
            return (
              <tr className="align-top" key={row.recordUid}>
                {CORE_DISPLAY_FIELD_NAMES.map((field) => (
                  <td
                    className="max-w-80 whitespace-pre-wrap px-4 py-3 text-zinc-700 dark:text-zinc-200"
                    key={field}
                  >
                    {formatValue(row[DTO_FIELD_BY_BUSINESS_FIELD[field]])}
                  </td>
                ))}
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                  {row.versionNo}
                </td>
                <td className="max-w-64 break-all px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  {row.recordUid}
                </td>
                <td className="w-96 space-y-3 px-4 py-3">
                  {pending ? (
                    <div className="space-y-2">
                      <p className="font-semibold text-amber-800 dark:text-amber-200">
                        Đang chờ phê duyệt
                      </p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-300">
                        {SUBMISSION_TYPE_LABELS[pending.submissionType]} ·{" "}
                        {formatWorkflowDate(pending.submittedAt)}
                      </p>
                      <Link
                        className="inline-block text-sm font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
                        href={"/lecturer/submissions/" + pending.submissionId}
                      >
                        Xem submission đang chờ
                      </Link>
                    </div>
                  ) : (
                    <details>
                      <summary className="cursor-pointer font-semibold text-blue-700 dark:text-blue-300">
                        Xác nhận không thay đổi
                      </summary>
                      <div className="mt-3">
                        <ConfirmUnchangedForm
                          baseStt={row.stt}
                          baseVersionNo={row.versionNo}
                          recordUid={row.recordUid}
                        />
                      </div>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    {pending ? (
                      <span
                        aria-disabled="true"
                        className="cursor-not-allowed text-zinc-400"
                      >
                        Chỉnh sửa và gửi
                      </span>
                    ) : (
                      <Link
                        className="font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
                        href={"/lecturer/rows/" + row.recordUid + "/edit"}
                      >
                        Chỉnh sửa và gửi
                      </Link>
                    )}
                    <Link
                      className="font-semibold text-zinc-700 underline underline-offset-2 dark:text-zinc-200"
                      href={"/lecturer/rows/" + row.recordUid + "/history"}
                    >
                      Xem lịch sử phiên bản
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatValue(value: LatestCoreRowDto[keyof LatestCoreRowDto]): string {
  if (value === null) return "—";
  if (value instanceof Date) return value.toLocaleString("vi-VN");
  return String(value);
}
