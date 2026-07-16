import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CoreDataTable } from "@/components/core-data-table";
import type { UebCoreDataDto } from "@/lib/data/dto";

vi.mock("server-only", () => ({}));

const row: UebCoreDataDto = {
  stt: 1,
  donViPhuTrachHocPhan: "Đơn vị phụ trách",
  boMonPhuTrachHocPhan: "Bộ môn phụ trách",
  khoiKienThuc: 2,
  maHocPhan: "UEB101",
  tenHocPhan: "Tên học phần",
  tenGiangVien: "Tên giảng viên",
  maSoCanBo: "CB001",
  emailTaiKhoanVnu: "lecturer@example.edu",
  boMon: "Bộ môn",
  donVi: "Đơn vị",
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
  versionNo: 1,
  identityStatus: "RESOLVED",
  approvalUnit: "Đơn vị",
  origin: "LEGACY_IMPORT",
  approvedAt: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("CoreDataTable", () => {
  afterEach(cleanup);

  it("renders all 20 source-contract business columns", () => {
    render(<CoreDataTable rows={[row]} />);

    expect(screen.getAllByRole("columnheader")).toHaveLength(20);
    const dataRow = screen.getAllByRole("row")[1];
    expect(within(dataRow).getAllByRole("cell")).toHaveLength(20);
    expect(screen.getByText("Email tài khoản VNU")).toBeInTheDocument();
    expect(screen.getByText("TC4: Giảng thử")).toBeInTheDocument();
  });

  it("marks the first ordered history row as current", () => {
    render(
      <CoreDataTable
        rows={[{ ...row, stt: 3, versionNo: 2, snapshotId: "snapshot-2" }, row]}
        showVersionMetadata
      />,
    );

    const historyRows = screen.getAllByRole("row").slice(1);
    expect(historyRows).toHaveLength(2);
    expect(historyRows[0]).toHaveAttribute("data-current-version", "true");
    expect(historyRows[0]).toHaveAttribute("data-version-no", "2");
    expect(within(historyRows[0]!).getByText("Hiện hành")).toBeInTheDocument();
    expect(
      within(historyRows[1]!).getByText("Phiên bản cũ"),
    ).toBeInTheDocument();
  });
});
