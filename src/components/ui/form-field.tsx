import type { HTMLAttributes, ReactNode } from "react";

import { classNames } from "@/components/ui/class-names";

export function FormField({
  children,
  className,
  error,
  hint,
  htmlFor,
  label,
}: Readonly<{
  children: ReactNode;
  className?: string;
  error?: string | null;
  hint?: string;
  htmlFor: string;
  label: string;
}>) {
  return (
    <div className={classNames("space-y-2", className)}>
      <label className="block text-sm font-semibold text-ink" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="text-sm leading-5 text-muted">{hint}</p> : null}
      {error ? <FormMessage>{error}</FormMessage> : null}
    </div>
  );
}

export function FormMessage({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={classNames("text-sm leading-5 text-danger-text", className)}
      {...props}
    />
  );
}
