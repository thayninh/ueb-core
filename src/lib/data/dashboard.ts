import "server-only";

import { BusinessRole } from "@/generated/prisma/client";
import { requireAuthenticated } from "@/lib/auth/authorization";
import { getPrismaClient } from "@/lib/server/prisma";

export interface DashboardDto {
  readonly name: string;
  readonly roles: readonly BusinessRole[];
  readonly managedUnits: readonly {
    id: string;
    displayName: string;
    sourceValue: string;
  }[];
  readonly allowedFeatures: readonly {
    href: string;
    label: string;
    description: string;
  }[];
}

export async function getDashboard(): Promise<DashboardDto> {
  const principal = await requireAuthenticated();
  const user = await getPrismaClient().auth_user.findUnique({
    where: { id: principal.userId },
    select: {
      name: true,
      unitScopeAssignments: {
        where: {
          revokedAt: null,
          organizationUnit: { isActive: true },
        },
        orderBy: { organizationUnit: { displayName: "asc" } },
        select: {
          organizationUnit: {
            select: { id: true, displayName: true, sourceValue: true },
          },
        },
      },
    },
  });
  if (!user) throw new Error("Authenticated user record was not found.");

  return {
    name: user.name,
    roles: principal.roles,
    managedUnits: user.unitScopeAssignments.map(
      ({ organizationUnit }) => organizationUnit,
    ),
    allowedFeatures: allowedFeatures(principal.roles),
  };
}

function allowedFeatures(roles: readonly BusinessRole[]) {
  const features: DashboardDto["allowedFeatures"][number][] = [];
  if (roles.includes(BusinessRole.LECTURER)) {
    features.push({
      href: "/lecturer/profile",
      label: "Hồ sơ giảng viên",
      description: "Xem toàn bộ dữ liệu giảng viên của chính bạn.",
    });
  }
  if (roles.includes(BusinessRole.FACULTY_LEADER)) {
    features.push({
      href: "/leader/data",
      label: "Dữ liệu đơn vị",
      description: "Tra cứu dữ liệu thuộc các đơn vị được giao.",
    });
  }
  if (
    roles.includes(BusinessRole.FACULTY_LEADER) ||
    roles.includes(BusinessRole.ADMIN)
  ) {
    features.push({
      href: "/leader/submissions",
      label: "Bản gửi chờ xử lý",
      description: "Xem chi tiết, so sánh và từ chối bản gửi trong phạm vi.",
    });
  }
  if (roles.includes(BusinessRole.ADMIN)) {
    features.push({
      href: "/admin/data",
      label: "Dữ liệu hiện hành",
      description:
        "Tra cứu toàn bộ phiên bản đã phê duyệt mới nhất ở chế độ chỉ đọc.",
    });
    features.push({
      href: "/admin/users",
      label: "Quản trị tài khoản",
      description: "Quản lý tài khoản, vai trò, ánh xạ và session.",
    });
    features.push({
      href: "/admin/audit",
      label: "Nhật ký bảo mật",
      description: "Xem sự kiện đăng nhập và thay đổi quyền ở chế độ chỉ đọc.",
    });
  }
  return features;
}
