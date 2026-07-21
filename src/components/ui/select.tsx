import type { SelectHTMLAttributes } from "react";

import { classNames } from "@/components/ui/class-names";

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={classNames(
        "block min-h-11 w-full rounded-control border border-border bg-surface px-3.5 py-2.5 text-base text-ink shadow-control transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-70 aria-invalid:border-danger-text",
        className,
      )}
      {...props}
    />
  );
}
