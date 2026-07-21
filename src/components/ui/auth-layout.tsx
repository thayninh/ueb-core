import Image from "next/image";
import type { ReactNode } from "react";

import uebLogo from "../../../data/input/logo.png";

import { Card } from "@/components/ui/card";

export function AuthLayout({
  children,
  description,
  footer,
  title,
}: Readonly<{
  children: ReactNode;
  description: ReactNode;
  footer?: ReactNode;
  title: string;
}>) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1.5 bg-brand-600"
      />
      <div
        aria-hidden="true"
        className="absolute -top-24 right-[-8rem] h-72 w-72 rounded-full bg-brand-100 opacity-70 blur-3xl dark:opacity-15"
      />
      <Card className="relative grid w-full max-w-[var(--ueb-container-auth)] overflow-hidden rounded-panel lg:grid-cols-[minmax(17rem,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col items-center justify-center border-b border-border bg-brand-50 px-6 py-8 text-center lg:border-r lg:border-b-0 lg:px-10 lg:py-12">
          <Image
            alt="Logo UEB"
            className="h-20 w-auto sm:h-24 lg:h-28"
            priority
            src={uebLogo}
          />
          <p className="mt-5 text-sm font-semibold tracking-[0.18em] text-brand-700 uppercase">
            UEB Core
          </p>
        </div>

        <div className="min-w-0 px-5 py-7 sm:px-8 sm:py-10 lg:px-12 lg:py-12">
          <h1 className="text-2xl leading-8 font-semibold tracking-tight text-ink sm:text-3xl sm:leading-10">
            {title}
          </h1>
          <div className="mt-3 max-w-prose text-sm leading-6 text-muted">
            {description}
          </div>
          {children}
          {footer}
        </div>
      </Card>
    </main>
  );
}
