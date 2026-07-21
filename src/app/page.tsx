import { Card, PageContainer } from "@/components/ui";

export default function Home() {
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
        <Card className="mx-auto max-w-2xl p-6 sm:p-10 lg:p-12">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-700">
            Project foundation
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            UEB Core
          </h1>
          <p className="mt-4 text-lg leading-8 text-muted">
            Hệ thống quản lý dữ liệu giảng viên
          </p>
        </Card>
      </PageContainer>
    </main>
  );
}
