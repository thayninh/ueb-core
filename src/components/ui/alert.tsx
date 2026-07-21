import type { HTMLAttributes } from "react";

import { classNames } from "@/components/ui/class-names";

const variants = {
  danger: "bg-danger-surface text-danger-text",
  info: "bg-info-surface text-info-text",
  success: "bg-success-surface text-success-text",
  warning: "bg-warning-surface text-warning-text",
} as const;

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  readonly variant?: keyof typeof variants;
}

export function Alert({ className, variant = "info", ...props }: AlertProps) {
  return (
    <div
      className={classNames(
        "rounded-control px-4 py-3 text-sm leading-6",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
