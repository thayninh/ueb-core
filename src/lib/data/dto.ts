import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/** Exactly the 20 source-contract business fields plus reviewed display metadata. */
export const UEB_CORE_DATA_DTO_SELECT = {
  stt: true,
  donViPhuTrachHocPhan: true,
  boMonPhuTrachHocPhan: true,
  khoiKienThuc: true,
  maHocPhan: true,
  tenHocPhan: true,
  tenGiangVien: true,
  maSoCanBo: true,
  emailTaiKhoanVnu: true,
  boMon: true,
  donVi: true,
  core123: true,
  tc1TroGiang: true,
  tc2ShChuyenMon: true,
  tc3TongHop: true,
  tc31NganhTotNghiepPhuHop: true,
  tc32BienSoanDeCuongGiaoTrinh: true,
  tc33ChuNhiemDeTaiNckhLienQuan: true,
  tc34BaiBaoLienQuan: true,
  tc4GiangThu: true,
  recordUid: true,
  snapshotId: true,
  versionNo: true,
  identityStatus: true,
  approvalUnit: true,
  origin: true,
  approvedAt: true,
  createdAt: true,
} as const satisfies Prisma.UebCoreDataSelect;

export type UebCoreDataDto = Prisma.UebCoreDataGetPayload<{
  select: typeof UEB_CORE_DATA_DTO_SELECT;
}>;

/** A current logical row selected by record_uid, version_no and stt. */
export type LatestCoreRowDto = UebCoreDataDto;

/** One immutable version in a record_uid history. */
export type CoreRowVersionDto = UebCoreDataDto;
