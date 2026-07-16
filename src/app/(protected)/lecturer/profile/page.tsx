import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CoreDataTable } from "@/components/core-data-table";
import { getLecturerData } from "@/lib/data/lecturer-data";
import { hasUnexpectedSearchParams } from "@/lib/http/search-params";

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

  return (
    <main className="mx-auto w-full max-w-[1800px] space-y-6 px-6 py-10">
      <header>
        <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
          Chế độ chỉ đọc
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Hồ sơ giảng viên
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          {rows.length} dòng thuộc định danh giảng viên của bạn. Bảng hiển thị
          đủ 20 cột nghiệp vụ từ dữ liệu nguồn.
        </p>
      </header>
      <CoreDataTable rows={rows} />
    </main>
  );
}
