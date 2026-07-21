"use client";

import { useActionState } from "react";

import { signInAction } from "@/app/actions/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import type { SignInActionState } from "@/lib/auth/sign-in-policy";

const initialState: SignInActionState = { error: null };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <FormField htmlFor="email" label="Email">
        <Input
          autoComplete="email"
          id="email"
          inputMode="email"
          name="email"
          required
          type="email"
        />
      </FormField>

      <FormField htmlFor="password" label="Mật khẩu">
        <Input
          autoComplete="current-password"
          id="password"
          maxLength={128}
          name="password"
          required
          type="password"
        />
      </FormField>

      {state.error ? (
        <Alert aria-live="polite" role="alert" variant="danger">
          {state.error}
        </Alert>
      ) : null}

      <Button className="w-full" loading={pending} type="submit">
        {pending ? "Đang đăng nhập…" : "Đăng nhập"}
      </Button>
    </form>
  );
}
