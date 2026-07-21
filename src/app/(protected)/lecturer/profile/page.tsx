import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "next/link";

import { PageContainer } from "@/components/ui";
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
    <main className="relative py-8 sm:py-10 lg:py-12">
      <PageContainer className="max-w-[1800px] space-y-6">
        <header>
          <p className="text-sm font-semibold text-brand-700">
            Dữ liệu hiện hành theo từng record
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Hồ sơ giảng viên
          </h1>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-muted">
            {rows.length} dòng thuộc định danh giảng viên của bạn. Bảng hiển thị
            đủ 20 trường nghiệp vụ. STT là metadata chỉ đọc và không thuộc nội
            dung submission.
          </p>
          <nav
            className="mt-5 flex flex-wrap gap-3"
            aria-label="Workflow giảng viên"
          >
            <Link
              className="inline-flex min-h-11 w-full items-center justify-center rounded-control bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-control transition-colors hover:bg-brand-700 sm:w-auto"
              href="/lecturer/rows/new"
            >
              Tạo dòng mới
            </Link>
            <Link
              className="inline-flex min-h-11 w-full items-center justify-center rounded-control border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink shadow-control transition-colors hover:bg-surface-subtle sm:w-auto"
              href="/lecturer/submissions"
            >
              Xem các bản gửi
            </Link>
          </nav>
        </header>
        <LecturerRowsTable
          pendingSubmissions={pendingSubmissions}
          rows={rows}
        />
      </PageContainer>
    </main>
  );
}
