"use client";

import { useActionState } from "react";

import { createUserAction, type AdminActionState } from "@/app/actions/admin";
import { Alert, Button, Input, Select } from "@/components/ui";

const initialState: AdminActionState = { status: "IDLE", message: null };

export function CreateUserForm({
  units,
  lecturerCandidates,
}: Readonly<{
  units: readonly { id: string; displayName: string }[];
  lecturerCandidates: readonly {
    lecturerUid: string;
    lecturerName: string | null;
    email: string | null;
  }[];
}>) {
  const [state, action, pending] = useActionState(
    createUserAction,
    initialState,
  );

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tên hiển thị" name="name" required />
        <Field label="Email đăng nhập" name="email" required type="email" />
        <Field
          autoComplete="new-password"
          label="Mật khẩu tạm"
          maxLength={128}
          minLength={12}
          name="temporaryPassword"
          required
          type="password"
        />
        <label className="text-sm font-semibold text-ink">
          Ánh xạ giảng viên
          <Select className="mt-2" defaultValue="" name="lecturerUid">
            <option value="">Không ánh xạ</option>
            {lecturerCandidates.map((candidate) => (
              <option key={candidate.lecturerUid} value={candidate.lecturerUid}>
                {candidate.lecturerName ?? "Chưa có tên"} —{" "}
                {candidate.email ?? "Chưa có email"}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-semibold text-ink">
          Yêu cầu đổi mật khẩu lần đầu
          <Select
            className="mt-2"
            defaultValue=""
            name="requirePasswordChange"
            required
          >
            <option disabled value="">
              Chọn chính sách
            </option>
            <option value="true">Có</option>
            <option value="false">Không</option>
          </Select>
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">Vai trò</legend>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {[
            ["LECTURER", "Giảng viên"],
            ["FACULTY_LEADER", "Lãnh đạo khoa/đơn vị"],
            ["ADMIN", "Quản trị viên"],
          ].map(([value, label]) => (
            <label
              className="flex min-h-11 items-center gap-3 rounded-control px-2 text-sm text-ink hover:bg-surface-subtle"
              key={value}
            >
              <input
                className="size-4"
                name="roles"
                type="checkbox"
                value={value}
              />{" "}
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">
          Đơn vị quản lý
        </legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {units.map((unit) => (
            <label
              className="flex min-h-11 items-start gap-3 rounded-control px-2 py-2 text-sm leading-6 text-ink hover:bg-surface-subtle"
              key={unit.id}
            >
              <input
                className="mt-1 size-4 shrink-0"
                name="unitIds"
                type="checkbox"
                value={unit.id}
              />
              {unit.displayName}
            </label>
          ))}
        </div>
      </fieldset>

      {state.message ? (
        <Alert
          aria-live="polite"
          variant={state.status === "SUCCESS" ? "success" : "danger"}
        >
          {state.message}
        </Alert>
      ) : null}

      <Button loading={pending} type="submit">
        {pending ? "Đang tạo…" : "Tạo tài khoản"}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  ...props
}: Readonly<
  {
    label: string;
    name: string;
    type?: React.HTMLInputTypeAttribute;
  } & React.InputHTMLAttributes<HTMLInputElement>
>) {
  return (
    <label className="text-sm font-semibold text-ink">
      {label}
      <Input className="mt-2" name={name} type={type} {...props} />
    </label>
  );
}
