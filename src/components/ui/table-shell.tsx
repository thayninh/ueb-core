import type { HTMLAttributes } from "react";

import { classNames } from "@/components/ui/class-names";

export function TableShell({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={classNames(
        "overflow-x-auto rounded-card border border-border bg-surface shadow-control",
        className,
      )}
      tabIndex={0}
    />
  );
}
