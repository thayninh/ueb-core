"use client";

import { useActionState } from "react";

import {
  changeRequiredPasswordAction,
  type ChangePasswordActionState,
} from "@/app/actions/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

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
        <Alert aria-live="polite" role="alert" variant="danger">
          {state.error}
        </Alert>
      ) : null}

      <Button className="w-full" loading={pending} type="submit">
        {pending ? "Đang đổi mật khẩu…" : "Đổi mật khẩu"}
      </Button>
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
    <FormField htmlFor={name} label={label}>
      <Input
        autoComplete={autoComplete}
        id={name}
        maxLength={128}
        minLength={12}
        name={name}
        required
        type="password"
      />
    </FormField>
  );
}
