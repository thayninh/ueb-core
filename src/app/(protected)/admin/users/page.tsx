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
import { Badge, Card, PageContainer, Select } from "@/components/ui";
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
    <main className="py-8 sm:py-10">
      <PageContainer className="max-w-7xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-sm font-semibold text-brand-700">
              Quản trị định danh
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Tài khoản và phân quyền
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              Không hỗ trợ hard delete, impersonation hoặc thay đổi dữ liệu
              legacy.
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-border-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink shadow-control transition-colors hover:bg-surface-subtle"
            href="/admin/audit"
          >
            Xem nhật ký bảo mật
          </Link>
        </header>

        <Card className="p-4 sm:p-6">
          <h2 className="text-xl font-semibold text-ink">Tạo tài khoản</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Mật khẩu tạm chỉ được gửi tới server khi tạo và không được hiển thị
            lại.
          </p>
          <div className="mt-6">
            <CreateUserForm
              lecturerCandidates={data.lecturerCandidates}
              units={data.units}
            />
          </div>
        </Card>

        <section>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-xl font-semibold text-ink">
              Danh sách tài khoản
            </h2>
            <p className="text-sm text-muted">{data.users.length} tài khoản</p>
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
      </PageContainer>
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
    <article className="rounded-card border border-border bg-surface p-4 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold text-ink">
            {user.name}
          </h3>
          <p className="mt-1 break-all text-sm text-muted">{user.email}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge variant={user.status === "ACTIVE" ? "success" : "danger"}>
              Trạng thái: {user.status}
            </Badge>
            <Badge>
              {user.lecturerUid
                ? "Đã ánh xạ giảng viên"
                : "Chưa ánh xạ giảng viên"}
            </Badge>
            <Badge>{user.sessionCount} session đang hoạt động</Badge>
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
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

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <section className="rounded-control border border-border bg-surface-subtle p-4">
          <h4 className="text-sm font-semibold text-ink">Vai trò</h4>
          <div className="mt-3 space-y-2">
            {Object.values(BusinessRole).map((role) => {
              const enabled = user.roles.includes(role);
              return (
                <form
                  action={setUserRoleAction}
                  className="flex items-center justify-between gap-3"
                  key={role}
                >
                  <span className="min-w-0 text-sm leading-6 text-ink">
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

        <section className="rounded-control border border-border bg-surface-subtle p-4">
          <h4 className="text-sm font-semibold text-ink">Đơn vị quản lý</h4>
          <p className="mt-1 text-xs leading-5 text-muted">
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
                  <span className="min-w-0 text-sm leading-6 text-ink">
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

        <section className="rounded-control border border-border bg-surface-subtle p-4">
          <h4 className="text-sm font-semibold text-ink">
            Ánh xạ lecturer_uid
          </h4>
          <form action={setLecturerMappingAction} className="mt-3 space-y-3">
            <input name="targetUserId" type="hidden" value={user.id} />
            <Select
              aria-label="Ánh xạ lecturer_uid"
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
            </Select>
            <ActionButton label="Lưu ánh xạ" />
          </form>
        </section>
      </div>
    </article>
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
    neutral: "border-border-strong bg-surface text-ink hover:bg-surface-subtle",
    primary: "border-brand-600 bg-brand-600 text-white hover:bg-brand-700",
    danger:
      "border-danger-text bg-danger-surface text-danger-text hover:brightness-95",
  }[tone];
  return (
    <button
      className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-control border font-semibold shadow-control transition-colors ${colors} ${
        small ? "px-3 py-2 text-xs" : "px-3.5 py-2.5 text-sm"
      }`}
      type="submit"
    >
      {label}
    </button>
  );
}
