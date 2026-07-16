import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "next/link";

import { LecturerRowsTable } from "@/components/workflow/lecturer-rows-table";
import { getLecturerData } from "@/lib/data/lecturer-data";
import { hasUnexpectedSearchParams } from "@/lib/http/search-params";
import { getPendingSubmissionsForLecturerRecords } from "@/lib/workflow/lecturer-submission-query";

export const metadata: Metadata = {
  title: "Hồ sơ giảng viên | UEB Core",
};

export default async function LecturerProfilePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (hasUnexpectedSearchParams(await searchParams, [])) notFound();
  const rows = await getLecturerData();
  const pendingSubmissions = await getPendingSubmissionsForLecturerRecords(
    rows.map(({ recordUid }) => recordUid),
  );

  return (
    <main className="mx-auto w-full max-w-[1800px] space-y-6 px-6 py-10">
      <header>
        <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
          Dữ liệu hiện hành theo từng record
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Hồ sơ giảng viên
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          {rows.length} dòng thuộc định danh giảng viên của bạn. Bảng hiển thị
          đủ 20 trường nghiệp vụ. STT là metadata chỉ đọc và không thuộc nội
          dung submission.
        </p>
        <nav
          className="mt-5 flex flex-wrap gap-3"
          aria-label="Workflow giảng viên"
        >
          <Link
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            href="/lecturer/rows/new"
          >
            Tạo dòng mới
          </Link>
          <Link
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
            href="/lecturer/submissions"
          >
            Xem các bản gửi
          </Link>
        </nav>
      </header>
      <LecturerRowsTable pendingSubmissions={pendingSubmissions} rows={rows} />
    </main>
  );
}
