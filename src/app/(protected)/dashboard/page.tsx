import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card, PageContainer } from "@/components/ui";
import { getDashboard } from "@/lib/data/dashboard";
import { hasUnexpectedSearchParams } from "@/lib/http/search-params";

export const metadata: Metadata = {
  title: "Bảng điều khiển | UEB Core",
};

const ROLE_LABELS = {
  LECTURER: "Giảng viên",
  FACULTY_LEADER: "Lãnh đạo khoa/đơn vị",
  ADMIN: "Quản trị viên",
} as const;

export default async function DashboardPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (hasUnexpectedSearchParams(await searchParams, [])) notFound();
  const dashboard = await getDashboard();

  return (
    <main className="relative py-8 sm:py-10 lg:py-12">
      <PageContainer className="space-y-8 lg:space-y-10">
        <Card className="relative overflow-hidden border-brand-200 p-6 sm:p-8 lg:p-10">
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1.5 bg-brand-600"
          />
          <div
            aria-hidden="true"
            className="absolute -top-20 -right-20 h-56 w-56 rounded-full border-[2.5rem] border-brand-50 opacity-80 dark:opacity-10"
          />
          <div className="relative max-w-4xl">
            <p className="text-sm font-semibold text-brand-700">Xin chào</p>
            <h1 className="mt-2 text-3xl leading-tight font-semibold tracking-tight text-ink sm:text-4xl">
              {dashboard.name}
            </h1>
            <div className="mt-5 flex flex-wrap gap-2">
              {dashboard.roles.map((role) => (
                <Badge
                  className="min-h-8 px-3 text-sm"
                  key={role}
                  variant="brand"
                >
                  {ROLE_LABELS[role]}
                </Badge>
              ))}
            </div>
          </div>
        </Card>

        <section aria-labelledby="allowed-features-heading">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-brand-600"
            />
            <h2
              className="text-xl font-semibold tracking-tight text-ink sm:text-2xl"
              id="allowed-features-heading"
            >
              Chức năng được phép
            </h2>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dashboard.allowedFeatures.map((feature) => (
              <Link
                className="group flex min-h-36 flex-col rounded-card border border-border bg-surface p-5 shadow-control transition-[border-color,box-shadow] hover:border-brand-200 hover:shadow-card sm:p-6"
                href={feature.href}
                key={feature.href}
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-semibold text-ink">{feature.label}</h3>
                  <span
                    aria-hidden="true"
                    className="text-xl leading-none text-brand-600 transition-transform group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted">
                  {feature.description}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <Card className="p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-brand-600"
            />
            <h2 className="font-semibold text-ink">Đơn vị đang quản lý</h2>
          </div>
          {dashboard.managedUnits.length > 0 ? (
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {dashboard.managedUnits.map((unit) => (
                <li
                  className="rounded-control border border-border bg-surface-subtle px-4 py-3 text-sm font-medium text-ink"
                  key={unit.id}
                >
                  {unit.displayName}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-control border border-dashed border-border-strong bg-surface-subtle px-4 py-4 text-sm text-muted">
              Không có đơn vị quản lý đang hoạt động.
            </p>
          )}
        </Card>
      </PageContainer>
    </main>
  );
}
