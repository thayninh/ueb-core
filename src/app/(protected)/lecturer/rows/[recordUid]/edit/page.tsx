import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EditableRowForm } from "@/components/workflow/editable-row-form";
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
    <main className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <header>
        <Link
          className="text-sm font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
          href="/lecturer/profile"
        >
          ← Quay lại hồ sơ
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Chỉnh sửa và gửi
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          Phiên bản hiện hành: {row.versionNo} · STT nền: {row.stt}
        </p>
      </header>

      {pending ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <h2 className="font-semibold">Dòng này đang chờ phê duyệt</h2>
          <p className="mt-2 text-sm">
            Không thể tạo thêm bản gửi cho cùng record khi bản hiện tại chưa
            được xử lý.
          </p>
          <Link
            className="mt-4 inline-block font-semibold underline underline-offset-2"
            href={"/lecturer/submissions/" + pending.submissionId}
          >
            Xem submission đang chờ
          </Link>
        </section>
      ) : (
        <EditableRowForm
          baseStt={row.stt}
          baseVersionNo={row.versionNo}
          currentRow={coreRowDtoToBusinessRow(row)}
          kind="UPDATE_EXISTING"
          recordUid={row.recordUid}
        />
      )}
    </main>
  );
}
