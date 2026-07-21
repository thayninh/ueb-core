import Link from "next/link";

import { TableShell } from "@/components/ui";
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
      <div className="rounded-card border border-dashed border-border-strong bg-surface px-5 py-12 text-center text-sm text-muted shadow-control sm:px-6">
        Không có dữ liệu hiện hành trong phạm vi được phép.
      </div>
    );
  }

  return (
    <TableShell aria-label="Dữ liệu hiện hành và thao tác workflow">
      <table className="min-w-max border-collapse text-left text-sm">
        <thead className="bg-brand-700 text-xs uppercase tracking-wide text-white">
          <tr>
            {CORE_DISPLAY_FIELD_NAMES.map((field) => (
              <th
                className="border-b border-brand-800 px-4 py-3 font-semibold"
                key={field}
                scope="col"
              >
                <span className="block max-w-56 whitespace-normal">
                  {BUSINESS_FIELD_LABELS[field]}
                </span>
              </th>
            ))}
            <th
              className="border-b border-brand-800 px-4 py-3 font-semibold"
              scope="col"
            >
              Phiên bản
            </th>
            <th
              className="border-b border-brand-800 px-4 py-3 font-semibold"
              scope="col"
            >
              Record UID
            </th>
            <th
              className="border-b border-brand-800 px-4 py-3 font-semibold"
              scope="col"
            >
              Trạng thái và thao tác
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface">
          {rows.map((row) => {
            const pending = pendingByRecord.get(row.recordUid);
            return (
              <tr
                className="align-top"
                data-record-uid={row.recordUid}
                data-stt={row.stt}
                data-version-no={row.versionNo}
                key={row.recordUid}
              >
                {CORE_DISPLAY_FIELD_NAMES.map((field) => (
                  <td
                    className="max-w-80 whitespace-pre-wrap px-4 py-3 text-muted"
                    key={field}
                  >
                    {formatValue(row[DTO_FIELD_BY_BUSINESS_FIELD[field]])}
                  </td>
                ))}
                <td className="px-4 py-3 font-medium text-ink">
                  {row.versionNo}
                </td>
                <td className="max-w-64 break-all px-4 py-3 font-mono text-xs text-muted">
                  {row.recordUid}
                </td>
                <td className="w-96 space-y-3 px-4 py-3">
                  {pending ? (
                    <div className="space-y-2">
                      <p className="font-semibold text-warning-text">
                        Đang chờ phê duyệt
                      </p>
                      <p className="text-xs text-muted">
                        {SUBMISSION_TYPE_LABELS[pending.submissionType]} ·{" "}
                        {formatWorkflowDate(pending.submittedAt)}
                      </p>
                      <Link
                        className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-2"
                        href={"/lecturer/submissions/" + pending.submissionId}
                      >
                        Xem submission đang chờ
                      </Link>
                    </div>
                  ) : (
                    <details>
                      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand-700">
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
                        className="inline-flex min-h-11 cursor-not-allowed items-center text-muted opacity-60"
                      >
                        Chỉnh sửa và gửi
                      </span>
                    ) : (
                      <Link
                        className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-2"
                        href={"/lecturer/rows/" + row.recordUid + "/edit"}
                      >
                        Chỉnh sửa và gửi
                      </Link>
                    )}
                    <Link
                      className="inline-flex min-h-11 items-center font-semibold text-muted underline underline-offset-2"
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
    </TableShell>
  );
}

function formatValue(value: LatestCoreRowDto[keyof LatestCoreRowDto]): string {
  if (value === null) return "—";
  if (value instanceof Date) return value.toLocaleString("vi-VN");
  return String(value);
}
