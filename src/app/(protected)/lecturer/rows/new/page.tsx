import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EditableRowForm } from "@/components/workflow/editable-row-form";
import { PageContainer } from "@/components/ui";
import { requireLecturerIdentity } from "@/lib/auth/authorization";
import { hasUnexpectedSearchParams } from "@/lib/http/search-params";

export const metadata: Metadata = {
  title: "Tạo dòng mới | UEB Core",
};

export default async function NewLecturerRowPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (hasUnexpectedSearchParams(await searchParams, [])) notFound();
  await requireLecturerIdentity();

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
            Tạo bản gửi cho dòng mới
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
            Bạn chỉ nhập 14 trường được phép. Đơn vị phê duyệt, định danh giảng
            viên, record UID, phiên bản và STT được hệ thống xác định ở phía
            server. Nếu không xác định duy nhất đơn vị phê duyệt, bản gửi sẽ bị
            chặn an toàn.
          </p>
        </header>
        <EditableRowForm kind="CREATE_NEW" />
      </PageContainer>
    </main>
  );
}
