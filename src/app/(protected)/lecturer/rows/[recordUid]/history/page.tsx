import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CoreDataTable } from "@/components/core-data-table";
import { requireLecturerIdentity } from "@/lib/auth/authorization";
import { getCoreRowVersionHistory } from "@/lib/data/latest-core-data";
import { hasUnexpectedSearchParams } from "@/lib/http/search-params";

export const metadata: Metadata = {
  title: "Lịch sử phiên bản | UEB Core",
};

export default async function LecturerRowHistoryPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ recordUid: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (hasUnexpectedSearchParams(await searchParams, [])) notFound();
  await requireLecturerIdentity();
  const { recordUid } = await params;
  const versions = await getCoreRowVersionHistory(recordUid);
  if (versions.length === 0) notFound();

  return (
    <main className="mx-auto w-full max-w-[1800px] space-y-6 px-6 py-10">
      <header>
        <Link
          className="text-sm font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
          href="/lecturer/profile"
        >
          ← Quay lại hồ sơ
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Lịch sử phiên bản
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          {versions.length} phiên bản bất biến, mới nhất hiển thị trước.
        </p>
      </header>
      <CoreDataTable rows={versions} />
    </main>
  );
}
