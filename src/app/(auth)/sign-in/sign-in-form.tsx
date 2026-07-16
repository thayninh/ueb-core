"use client";

import { useActionState } from "react";

import { signInAction } from "@/app/actions/auth";
import type { SignInActionState } from "@/lib/auth/sign-in-policy";

const initialState: SignInActionState = { error: null };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <div>
        <label
          className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
          htmlFor="email"
        >
          Email
        </label>
        <input
          autoComplete="email"
          className="mt-2 block w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-950 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          id="email"
          inputMode="email"
          name="email"
          required
          type="email"
        />
      </div>

      <div>
        <label
          className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
          htmlFor="password"
        >
          Mật khẩu
        </label>
        <input
          autoComplete="current-password"
          className="mt-2 block w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-950 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          id="password"
          maxLength={128}
          name="password"
          required
          type="password"
        />
      </div>

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
        {pending ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
    </form>
  );
}
