"use client";

import { useActionState } from "react";

import { createUserAction, type AdminActionState } from "@/app/actions/admin";

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
      <div className="grid gap-4 md:grid-cols-2">
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
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Ánh xạ giảng viên
          <select
            className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950"
            defaultValue=""
            name="lecturerUid"
          >
            <option value="">Không ánh xạ</option>
            {lecturerCandidates.map((candidate) => (
              <option key={candidate.lecturerUid} value={candidate.lecturerUid}>
                {candidate.lecturerName ?? "Chưa có tên"} —{" "}
                {candidate.email ?? "Chưa có email"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Yêu cầu đổi mật khẩu lần đầu
          <select
            className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950"
            defaultValue=""
            name="requirePasswordChange"
            required
          >
            <option disabled value="">
              Chọn chính sách
            </option>
            <option value="true">Có</option>
            <option value="false">Không</option>
          </select>
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          Vai trò
        </legend>
        <div className="mt-3 flex flex-wrap gap-4">
          {[
            ["LECTURER", "Giảng viên"],
            ["FACULTY_LEADER", "Lãnh đạo khoa/đơn vị"],
            ["ADMIN", "Quản trị viên"],
          ].map(([value, label]) => (
            <label className="flex items-center gap-2 text-sm" key={value}>
              <input name="roles" type="checkbox" value={value} /> {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          Đơn vị quản lý
        </legend>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {units.map((unit) => (
            <label className="flex items-start gap-2 text-sm" key={unit.id}>
              <input
                className="mt-1"
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
        <p
          aria-live="polite"
          className={`rounded-lg px-4 py-3 text-sm ${
            state.status === "SUCCESS"
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200"
          }`}
        >
          {state.message}
        </p>
      ) : null}

      <button
        className="rounded-lg bg-blue-700 px-5 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Đang tạo…" : "Tạo tài khoản"}
      </button>
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
    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
      {label}
      <input
        className="mt-2 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950"
        name={name}
        type={type}
        {...props}
      />
    </label>
  );
}
