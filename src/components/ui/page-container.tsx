import type { HTMLAttributes } from "react";

import { classNames } from "@/components/ui/class-names";

export function PageContainer({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={classNames(
        "mx-auto w-full max-w-[var(--ueb-container-content)] px-4 sm:px-6 lg:px-8",
        className,
      )}
      {...props}
    />
  );
}
