import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EditableRowForm } from "@/components/workflow/editable-row-form";
import { Alert, PageContainer } from "@/components/ui";
import { getLatestCoreRowByRecordUid } from "@/lib/data/latest-core-data";
import { hasUnexpectedSearchParams } from "@/lib/http/search-params";
import { coreRowDtoToBusinessRow } from "@/lib/workflow/field-display";
import { getPendingSubmissionsForLecturerRecords } from "@/lib/workflow/lecturer-submission-query";

export const metadata: Metadata = {
  title: "Chỉnh sửa dòng | UEB Core",
};

export default async function EditLecturerRowPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ recordUid: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (hasUnexpectedSearchParams(await searchParams, [])) notFound();
  const { recordUid } = await params;
  const row = await getLatestCoreRowByRecordUid(recordUid);
  const [pending] = await getPendingSubmissionsForLecturerRecords([
    row.recordUid,
  ]);

  return (
    <main className="relative py-8 sm:py-10 lg:py-12">
      <PageContainer className="max-w-5xl space-y-8">
        <header>
          <Link
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-2"
            href="/lecturer/profile"
          >
            ← Quay lại hồ sơ
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Chỉnh sửa và gửi
          </h1>
          <p className="mt-3 text-sm text-muted">
            Phiên bản hiện hành: {row.versionNo} · STT nền: {row.stt}
          </p>
        </header>

        {pending ? (
          <Alert className="p-5 sm:p-6" variant="warning">
            <h2 className="font-semibold">Dòng này đang chờ phê duyệt</h2>
            <p className="mt-2 text-sm">
              Không thể tạo thêm bản gửi cho cùng record khi bản hiện tại chưa
              được xử lý.
            </p>
            <Link
              className="mt-4 inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
              href={"/lecturer/submissions/" + pending.submissionId}
            >
              Xem submission đang chờ
            </Link>
          </Alert>
        ) : (
          <EditableRowForm
            baseStt={row.stt}
            baseVersionNo={row.versionNo}
            currentRow={coreRowDtoToBusinessRow(row)}
            kind="UPDATE_EXISTING"
            recordUid={row.recordUid}
          />
        )}
      </PageContainer>
    </main>
  );
}
