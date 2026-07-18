"use client";

import { useActionState } from "react";

import {
  changeRequiredPasswordAction,
  type ChangePasswordActionState,
} from "@/app/actions/auth";

const initialState: ChangePasswordActionState = { error: null };

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(
    changeRequiredPasswordAction,
    initialState,
  );

  return (
    <form action={action} className="mt-8 space-y-5">
      <PasswordField
        autoComplete="current-password"
        label="Mật khẩu hiện tại"
        name="currentPassword"
      />
      <PasswordField
        autoComplete="new-password"
        label="Mật khẩu mới"
        name="newPassword"
      />
      <PasswordField
        autoComplete="new-password"
        label="Xác nhận mật khẩu mới"
        name="confirmPassword"
      />

      {state.error ? (
        <p
          aria-live="polite"
          className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}

      <button
        className="flex w-full items-center justify-center rounded-xl bg-blue-700 px-4 py-3 font-medium text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Đang đổi mật khẩu…" : "Đổi mật khẩu"}
      </button>
    </form>
  );
}

function PasswordField({
  label,
  name,
  autoComplete,
}: Readonly<{
  label: string;
  name: string;
  autoComplete: string;
}>) {
  return (
    <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
      {label}
      <input
        autoComplete={autoComplete}
        className="mt-2 block w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-950 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
        maxLength={128}
        minLength={12}
        name={name}
        required
        type="password"
      />
    </label>
  );
}
