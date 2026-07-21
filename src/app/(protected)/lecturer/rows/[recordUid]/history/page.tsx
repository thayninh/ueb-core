import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CoreDataTable } from "@/components/core-data-table";
import { PageContainer } from "@/components/ui";
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
    <main className="relative py-8 sm:py-10 lg:py-12">
      <PageContainer className="max-w-[1800px] space-y-6">
        <header>
          <Link
            className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-2"
            href="/lecturer/profile"
          >
            ← Quay lại hồ sơ
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Lịch sử phiên bản
          </h1>
          <p className="mt-3 text-sm text-muted">
            {versions.length} phiên bản bất biến, mới nhất hiển thị trước.
          </p>
        </header>
        <CoreDataTable rows={versions} showVersionMetadata />
      </PageContainer>
    </main>
  );
}
