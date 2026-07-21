import Link from "next/link";

import { Card, PageContainer } from "@/components/ui";

export default function ForbiddenPage() {
  return (
    <main className="relative flex min-h-dvh items-center overflow-hidden bg-canvas py-12 sm:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-40 right-[-10rem] h-96 w-96 rounded-full bg-brand-100 opacity-70 blur-3xl dark:opacity-10" />
        <div className="absolute -bottom-52 left-[-8rem] h-96 w-96 rounded-full border border-brand-200 opacity-70 dark:opacity-20" />
      </div>
      <PageContainer className="relative">
        <Card className="mx-auto max-w-xl p-6 text-center sm:p-10">
          <p className="text-sm font-semibold text-danger-text">HTTP 403</p>
          <h1 className="mt-3 text-3xl font-semibold text-ink">
            Không có quyền truy cập
          </h1>
          <p className="mt-3 leading-7 text-muted">
            Tài khoản hiện tại không được phép mở tài nguyên này.
          </p>
          <Link
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-control bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-control transition-colors hover:bg-brand-700"
            href="/dashboard"
          >
            Về bảng điều khiển
          </Link>
        </Card>
      </PageContainer>
    </main>
  );
}
