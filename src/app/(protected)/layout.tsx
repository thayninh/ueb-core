import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";

import uebLogo from "../../../data/input/logo.png";

import { signOutAction } from "@/app/actions/auth";
import { Button, PageContainer } from "@/components/ui";
import { requireBusinessSession } from "@/lib/auth/session";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  await requireBusinessSession();

  return (
    <div className="relative min-h-screen bg-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-16 h-[32rem] overflow-hidden"
      >
        <div className="absolute -top-48 right-[-12rem] h-[32rem] w-[32rem] rounded-full bg-brand-100 opacity-70 blur-3xl dark:opacity-10" />
        <div className="absolute top-24 left-[-10rem] h-80 w-80 rounded-full border border-brand-100 opacity-60 dark:opacity-15" />
      </div>

      <header className="relative z-20 border-t-4 border-brand-600 border-b border-border bg-surface/95 shadow-control backdrop-blur">
        <PageContainer className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 sm:flex-nowrap sm:py-4">
          <Link
            aria-label="UEB Core"
            className="flex min-h-11 shrink-0 items-center gap-3 rounded-control pr-2 font-semibold tracking-tight text-ink"
            href="/dashboard"
          >
            <Image
              alt="Logo UEB"
              className="h-10 w-auto shrink-0"
              priority
              src={uebLogo}
            />
            <span>UEB Core</span>
          </Link>
          <div className="flex w-full items-center justify-between gap-2 border-t border-border pt-2 sm:ml-auto sm:w-auto sm:justify-end sm:border-t-0 sm:pt-0">
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-control px-3 text-sm font-semibold text-muted transition-colors hover:bg-surface-subtle hover:text-brand-700"
              href="/dashboard"
            >
              Bảng điều khiển
            </Link>
            <form action={signOutAction}>
              <Button variant="secondary" type="submit">
                Đăng xuất
              </Button>
            </form>
          </div>
        </PageContainer>
      </header>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
