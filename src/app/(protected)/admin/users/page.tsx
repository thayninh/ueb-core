import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  revokeUserSessionsAction,
  setLecturerMappingAction,
  setUserRoleAction,
  setUserStatusAction,
  setUserUnitScopeAction,
} from "@/app/actions/admin";
import { CreateUserForm } from "@/app/(protected)/admin/users/create-user-form";
import { BusinessRole } from "@/generated/prisma/client";
import {
  getAdminUserManagement,
  type AdminUserDto,
} from "@/lib/data/admin-data";
import { hasUnexpectedSearchParams } from "@/lib/http/search-params";

export const metadata: Metadata = {
  title: "Quản trị tài khoản | UEB Core",
};

const ROLE_LABELS = {
  LECTURER: "Giảng viên",
  FACULTY_LEADER: "Lãnh đạo khoa/đơn vị",
  ADMIN: "Quản trị viên",
} as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (hasUnexpectedSearchParams(await searchParams, [])) notFound();
  const data = await getAdminUserManagement();

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-700 dark:text-blue-400">
            Quản trị định danh
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Tài khoản và phân quyền
          </h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            Không hỗ trợ hard delete, impersonation hoặc thay đổi dữ liệu
            legacy.
          </p>
        </div>
        <Link
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          href="/admin/audit"
        >
          Xem nhật ký bảo mật
        </Link>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
          Tạo tài khoản
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          Mật khẩu tạm chỉ được gửi tới server khi tạo và không được hiển thị
          lại.
        </p>
        <div className="mt-6">
          <CreateUserForm
            lecturerCandidates={data.lecturerCandidates}
            units={data.units}
          />
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            Danh sách tài khoản
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {data.users.length} tài khoản
          </p>
        </div>
        <div className="mt-4 space-y-5">
          {data.users.map((user) => (
            <UserCard
              lecturerCandidates={data.lecturerCandidates}
              key={user.id}
              units={data.units}
              user={user}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

function UserCard({
  user,
  units,
  lecturerCandidates,
}: Readonly<{
  user: AdminUserDto;
  units: readonly { id: string; displayName: string }[];
  lecturerCandidates: readonly {
    lecturerUid: string;
    lecturerName: string | null;
    email: string | null;
  }[];
}>) {
  const activeUnitIds = new Set(user.units.map(({ id }) => id));

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            {user.name}
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            {user.email}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge label={`Trạng thái: ${user.status}`} />
            <Badge
              label={
                user.lecturerUid
                  ? "Đã ánh xạ giảng viên"
                  : "Chưa ánh xạ giảng viên"
              }
            />
            <Badge label={`${user.sessionCount} session đang hoạt động`} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={setUserStatusAction}>
            <input name="targetUserId" type="hidden" value={user.id} />
            <input
              name="status"
              type="hidden"
              value={user.status === "ACTIVE" ? "DISABLED" : "ACTIVE"}
            />
            <ActionButton
              label={user.status === "ACTIVE" ? "Vô hiệu hóa" : "Kích hoạt"}
              tone={user.status === "ACTIVE" ? "danger" : "primary"}
            />
          </form>
          <form action={revokeUserSessionsAction}>
            <input name="targetUserId" type="hidden" value={user.id} />
            <ActionButton label="Thu hồi session" />
          </form>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Vai trò
          </h4>
          <div className="mt-3 space-y-2">
            {Object.values(BusinessRole).map((role) => {
              const enabled = user.roles.includes(role);
              return (
                <form
                  action={setUserRoleAction}
                  className="flex items-center justify-between gap-3"
                  key={role}
                >
                  <span className="text-sm text-zinc-700 dark:text-zinc-200">
                    {ROLE_LABELS[role]}
                  </span>
                  <input name="targetUserId" type="hidden" value={user.id} />
                  <input name="role" type="hidden" value={role} />
                  <input
                    name="enabled"
                    type="hidden"
                    value={String(!enabled)}
                  />
                  <ActionButton label={enabled ? "Thu hồi" : "Gán"} small />
                </form>
              );
            })}
          </div>
        </section>

        <section>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Đơn vị quản lý
          </h4>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Gán ít nhất một đơn vị trước khi cấp vai trò lãnh đạo.
          </p>
          <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
            {units.map((unit) => {
              const enabled = activeUnitIds.has(unit.id);
              return (
                <form
                  action={setUserUnitScopeAction}
                  className="flex items-start justify-between gap-3"
                  key={unit.id}
                >
                  <span className="text-sm text-zinc-700 dark:text-zinc-200">
                    {unit.displayName}
                  </span>
                  <input name="targetUserId" type="hidden" value={user.id} />
                  <input
                    name="organizationUnitId"
                    type="hidden"
                    value={unit.id}
                  />
                  <input
                    name="enabled"
                    type="hidden"
                    value={String(!enabled)}
                  />
                  <ActionButton label={enabled ? "Thu hồi" : "Gán"} small />
                </form>
              );
            })}
          </div>
        </section>

        <section>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Ánh xạ lecturer_uid
          </h4>
          <form action={setLecturerMappingAction} className="mt-3 space-y-3">
            <input name="targetUserId" type="hidden" value={user.id} />
            <select
              className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              defaultValue={user.lecturerUid ?? ""}
              name="lecturerUid"
            >
              <option value="">Không ánh xạ</option>
              {lecturerCandidates.map((candidate) => (
                <option
                  key={candidate.lecturerUid}
                  value={candidate.lecturerUid}
                >
                  {candidate.lecturerName ?? "Chưa có tên"} —{" "}
                  {candidate.email ?? "Chưa có email"}
                </option>
              ))}
            </select>
            <ActionButton label="Lưu ánh xạ" />
          </form>
        </section>
      </div>
    </article>
  );
}

function Badge({ label }: Readonly<{ label: string }>) {
  return (
    <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      {label}
    </span>
  );
}

function ActionButton({
  label,
  small = false,
  tone = "neutral",
}: Readonly<{
  label: string;
  small?: boolean;
  tone?: "neutral" | "primary" | "danger";
}>) {
  const colors = {
    neutral:
      "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800",
    primary: "border-blue-700 bg-blue-700 text-white hover:bg-blue-800",
    danger:
      "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40",
  }[tone];
  return (
    <button
      className={`shrink-0 rounded-lg border font-medium ${colors} ${
        small ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm"
      }`}
      type="submit"
    >
      {label}
    </button>
  );
}
