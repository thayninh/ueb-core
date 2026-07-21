import type { HTMLAttributes } from "react";

import { classNames } from "@/components/ui/class-names";

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={classNames(
        "rounded-card border border-border bg-surface shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={classNames(
        "rounded-card border border-border bg-surface-subtle",
        className,
      )}
      {...props}
    />
  );
}
