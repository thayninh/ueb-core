// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { UEB_CORE_DATA_DTO_SELECT } from "@/lib/data/dto";

vi.mock("server-only", () => ({}));

describe("core data DTO whitelist", () => {
  it("contains the 20 contract fields and only approved technical metadata", () => {
    expect(Object.keys(UEB_CORE_DATA_DTO_SELECT)).toEqual([
      "stt",
      "donViPhuTrachHocPhan",
      "boMonPhuTrachHocPhan",
      "khoiKienThuc",
      "maHocPhan",
      "tenHocPhan",
      "tenGiangVien",
      "maSoCanBo",
      "emailTaiKhoanVnu",
      "boMon",
      "donVi",
      "core123",
      "tc1TroGiang",
      "tc2ShChuyenMon",
      "tc3TongHop",
      "tc31NganhTotNghiepPhuHop",
      "tc32BienSoanDeCuongGiaoTrinh",
      "tc33ChuNhiemDeTaiNckhLienQuan",
      "tc34BaiBaoLienQuan",
      "tc4GiangThu",
      "recordUid",
      "snapshotId",
      "versionNo",
      "identityStatus",
      "approvalUnit",
      "origin",
      "approvedAt",
      "createdAt",
    ]);
    expect(UEB_CORE_DATA_DTO_SELECT).not.toHaveProperty("sourceRowChecksum");
    expect(UEB_CORE_DATA_DTO_SELECT).not.toHaveProperty("lecturerUid");
    expect(UEB_CORE_DATA_DTO_SELECT).not.toHaveProperty("sourceImportRunId");
    expect(UEB_CORE_DATA_DTO_SELECT).not.toHaveProperty("sourceSubmissionId");
    expect(UEB_CORE_DATA_DTO_SELECT).not.toHaveProperty("approvedBy");
  });
});
