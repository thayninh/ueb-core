import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/(protected)/dashboard/page";
import { BusinessRole } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/data/dashboard", () => ({
  getDashboard: mocks.getDashboard,
}));

const features = [
  {
    description: "Xem toàn bộ dữ liệu giảng viên của chính bạn.",
    href: "/lecturer/profile",
    label: "Hồ sơ giảng viên",
  },
  {
    description: "Tra cứu dữ liệu thuộc các đơn vị được giao.",
    href: "/leader/data",
    label: "Dữ liệu đơn vị",
  },
  {
    description: "Xem chi tiết, so sánh và từ chối bản gửi trong phạm vi.",
    href: "/leader/submissions",
    label: "Bản gửi chờ xử lý",
  },
  {
    description:
      "Tra cứu toàn bộ phiên bản đã phê duyệt mới nhất ở chế độ chỉ đọc.",
    href: "/admin/data",
    label: "Dữ liệu hiện hành",
  },
  {
    description: "Quản lý tài khoản, vai trò, ánh xạ và session.",
    href: "/admin/users",
    label: "Quản trị tài khoản",
  },
  {
    description: "Xem sự kiện đăng nhập và thay đổi quyền ở chế độ chỉ đọc.",
    href: "/admin/audit",
    label: "Nhật ký bảo mật",
  },
] as const;

describe("DashboardPage presentation", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDashboard.mockResolvedValue({
      allowedFeatures: features,
      managedUnits: [
        {
          displayName: "Khoa Kinh tế phát triển",
          id: "unit-1",
          sourceValue: "Khoa KTPT",
        },
      ],
      name: "Opaque user",
      roles: [BusinessRole.LECTURER, BusinessRole.FACULTY_LEADER],
    });
  });

  it("renders the unchanged server-derived feature inventory in order", async () => {
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      features.map(({ href }) => href),
    );
    expect(links.map((link) => link.querySelector("h3")?.textContent)).toEqual(
      features.map(({ label }) => label),
    );
    expect(screen.getByText("Giảng viên")).toBeInTheDocument();
    expect(screen.getByText("Lãnh đạo khoa/đơn vị")).toBeInTheDocument();
    expect(screen.getByText("Khoa Kinh tế phát triển")).toBeInTheDocument();
  });

  it("keeps the responsive feature-card order in one DOM tree", async () => {
    const { container } = render(
      await DashboardPage({ searchParams: Promise.resolve({}) }),
    );

    const featureHeading = screen.getByRole("heading", {
      name: "Chức năng được phép",
    });
    const grid = featureHeading.parentElement?.nextElementSibling;
    expect(grid?.className).toContain("sm:grid-cols-2");
    expect(grid?.className).toContain("lg:grid-cols-3");
    expect(container.querySelectorAll('a[href="/admin/data"]')).toHaveLength(1);
    expect(container.textContent).not.toMatch(
      /menu|sidebar|drawer|hamburger/iu,
    );
  });
});
