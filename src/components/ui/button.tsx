import type { ButtonHTMLAttributes } from "react";

import { classNames } from "@/components/ui/class-names";

const variants = {
  primary:
    "bg-brand-600 text-white shadow-control hover:bg-brand-700 active:bg-brand-800",
  secondary:
    "border border-border-strong bg-surface text-ink shadow-control hover:bg-surface-subtle",
  ghost: "bg-transparent text-muted hover:bg-surface-subtle hover:text-ink",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly loading?: boolean;
  readonly variant?: keyof typeof variants;
}

export function Button({
  className,
  disabled,
  loading = false,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      aria-busy={loading || undefined}
      className={classNames(
        "inline-flex min-h-11 items-center justify-center rounded-control px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      type={type}
      {...props}
    />
  );
}
