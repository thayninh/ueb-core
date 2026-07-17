// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminDataPage from "@/app/(protected)/admin/data/page";
import type { LatestCoreRowDto } from "@/lib/data/dto";

const mocks = vi.hoisted(() => ({
  getLatestCoreRowsForAdmin: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/data/latest-core-data", () => ({
  getLatestCoreRowsForAdmin: mocks.getLatestCoreRowsForAdmin,
}));

const row: LatestCoreRowDto = {
  stt: 2570,
  donViPhuTrachHocPhan: "Pilot unit",
  boMonPhuTrachHocPhan: "Pilot department",
  khoiKienThuc: 2,
  maHocPhan: "UAT101",
  tenHocPhan: "Approved latest row",
  tenGiangVien: "Opaque lecturer",
  maSoCanBo: "OPAQUE",
  emailTaiKhoanVnu: "lecturer@example.invalid",
  boMon: "Pilot department",
  donVi: "Pilot unit",
  core123: "Core 1",
  tc1TroGiang: "TC1",
  tc2ShChuyenMon: "TC2",
  tc3TongHop: "TC3",
  tc31NganhTotNghiepPhuHop: "TC3.1",
  tc32BienSoanDeCuongGiaoTrinh: "TC3.2",
  tc33ChuNhiemDeTaiNckhLienQuan: "TC3.3",
  tc34BaiBaoLienQuan: "TC3.4",
  tc4GiangThu: "TC4",
  recordUid: "record-1",
  snapshotId: "snapshot-1",
  versionNo: 2,
  identityStatus: "RESOLVED",
  approvalUnit: "Pilot unit",
  origin: "WORKFLOW_APPROVED",
  approvedAt: new Date("2026-07-17T00:00:00Z"),
  createdAt: new Date("2026-07-17T00:00:00Z"),
};

describe("admin latest data page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLatestCoreRowsForAdmin.mockResolvedValue({
      rows: [row],
      search: "",
      page: 1,
      pageSize: 25,
      totalRows: 1,
      totalPages: 1,
    });
  });

  afterEach(cleanup);

  it("renders the read-only latest-row portal with all 20 core fields", async () => {
    render(await AdminDataPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", {
        name: "Dữ liệu hiện hành toàn hệ thống",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(20);
    expect(
      within(screen.getAllByRole("row")[1]!).getAllByRole("cell"),
    ).toHaveLength(20);
    expect(screen.getByText("1 record hiện hành", { exact: false })).toBeVisible();
  });

  it("contains navigation and search but no workflow mutation controls", async () => {
    render(await AdminDataPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "Tài khoản" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
    expect(
      screen.getByRole("link", { name: "Nhật ký bảo mật" }),
    ).toHaveAttribute("href", "/admin/audit");
    expect(screen.getByRole("button", { name: "Tra cứu" })).toBeVisible();
    for (const label of [
      /Chỉnh sửa/iu,
      /Gửi bản/iu,
      /Phê duyệt/iu,
      /Từ chối/iu,
    ]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
  });

  it("passes validated search and pagination to the admin DAL", async () => {
    render(
      await AdminDataPage({
        searchParams: Promise.resolve({ q: "UAT101", page: "2" }),
      }),
    );

    expect(mocks.getLatestCoreRowsForAdmin).toHaveBeenCalledWith({
      search: "UAT101",
      page: 2,
    });
  });

  it("safe-denies malformed or unexpected query parameters", async () => {
    await expect(
      AdminDataPage({
        searchParams: Promise.resolve({ page: "1 OR 1=1" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      AdminDataPage({
        searchParams: Promise.resolve({ unitId: "forged" } as never),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
