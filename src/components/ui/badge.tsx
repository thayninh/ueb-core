import type { HTMLAttributes } from "react";

import { classNames } from "@/components/ui/class-names";

const variants = {
  brand: "bg-brand-100 text-brand-800",
  danger: "bg-danger-surface text-danger-text",
  info: "bg-info-surface text-info-text",
  neutral: "bg-surface-subtle text-muted",
  success: "bg-success-surface text-success-text",
  warning: "bg-warning-surface text-warning-text",
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly variant?: keyof typeof variants;
}

export function Badge({
  className,
  variant = "neutral",
  ...props
}: BadgeProps) {
  return (
    <span
      className={classNames(
        "inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
