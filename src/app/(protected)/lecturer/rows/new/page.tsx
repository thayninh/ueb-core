import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EditableRowForm } from "@/components/workflow/editable-row-form";
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
    <main className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10">
      <header>
        <Link
          className="text-sm font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
          href="/lecturer/profile"
        >
          ← Quay lại hồ sơ
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Tạo bản gửi cho dòng mới
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          Bạn chỉ nhập 14 trường được phép. Đơn vị phê duyệt, định danh giảng
          viên, record UID, phiên bản và STT được hệ thống xác định ở phía
          server. Nếu không xác định duy nhất đơn vị phê duyệt, bản gửi sẽ bị
          chặn an toàn.
        </p>
      </header>
      <EditableRowForm kind="CREATE_NEW" />
    </main>
  );
}
