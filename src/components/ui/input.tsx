import type { InputHTMLAttributes } from "react";

import { classNames } from "@/components/ui/class-names";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={classNames(
        "block min-h-11 w-full rounded-control border border-border bg-surface px-3.5 py-2.5 text-base text-ink shadow-control transition-colors placeholder:text-muted/75 hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:opacity-70 aria-invalid:border-danger-text",
        className,
      )}
      {...props}
    />
  );
}
