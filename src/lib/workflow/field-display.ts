import type { LatestCoreRowDto } from "@/lib/data/dto";

import type {
  BusinessFieldName,
  CoreBusinessRow,
  RowSubmissionPayload,
} from "./types";

export const BUSINESS_FIELD_LABELS = {
  stt: "STT",
  don_vi_phu_trach_hoc_phan: "Đơn vị phụ trách học phần",
  bo_mon_phu_trach_hoc_phan: "Bộ môn phụ trách học phần",
  khoi_kien_thuc: "Khối kiến thức",
  ma_hoc_phan: "Mã học phần",
  ten_hoc_phan: "Tên học phần",
  ten_giang_vien: "Tên giảng viên",
  ma_so_can_bo: "Mã số cán bộ",
  email_tai_khoan_vnu: "Email tài khoản VNU",
  bo_mon: "Bộ môn",
  don_vi: "Đơn vị",
  core_1_2_3: "Core 1/2/3",
  tc1_tro_giang: "TC1: Trợ giảng",
  tc2_sh_chuyen_mon: "TC2: SH chuyên môn",
  tc3_tong_hop: "TC3: Tổng hợp",
  tc3_1_nganh_tot_nghiep_phu_hop: "TC3.1: Ngành tốt nghiệp phù hợp",
  tc3_2_bien_soan_de_cuong_giao_trinh: "TC3.2: Biên soạn đề cương/giáo trình",
  tc3_3_chu_nhiem_de_tai_nckh_lien_quan:
    "TC3.3: Chủ nhiệm đề tài NCKH liên quan",
  tc3_4_bai_bao_lien_quan: "TC3.4: Bài báo liên quan",
  tc4_giang_thu: "TC4: Giảng thử",
} as const satisfies Readonly<Record<BusinessFieldName, string>>;

export const DTO_FIELD_BY_BUSINESS_FIELD = {
  stt: "stt",
  don_vi_phu_trach_hoc_phan: "donViPhuTrachHocPhan",
  bo_mon_phu_trach_hoc_phan: "boMonPhuTrachHocPhan",
  khoi_kien_thuc: "khoiKienThuc",
  ma_hoc_phan: "maHocPhan",
  ten_hoc_phan: "tenHocPhan",
  ten_giang_vien: "tenGiangVien",
  ma_so_can_bo: "maSoCanBo",
  email_tai_khoan_vnu: "emailTaiKhoanVnu",
  bo_mon: "boMon",
  don_vi: "donVi",
  core_1_2_3: "core123",
  tc1_tro_giang: "tc1TroGiang",
  tc2_sh_chuyen_mon: "tc2ShChuyenMon",
  tc3_tong_hop: "tc3TongHop",
  tc3_1_nganh_tot_nghiep_phu_hop: "tc31NganhTotNghiepPhuHop",
  tc3_2_bien_soan_de_cuong_giao_trinh: "tc32BienSoanDeCuongGiaoTrinh",
  tc3_3_chu_nhiem_de_tai_nckh_lien_quan: "tc33ChuNhiemDeTaiNckhLienQuan",
  tc3_4_bai_bao_lien_quan: "tc34BaiBaoLienQuan",
  tc4_giang_thu: "tc4GiangThu",
} as const satisfies Readonly<
  Record<BusinessFieldName, keyof LatestCoreRowDto>
>;

export function coreRowDtoToBusinessRow(
  row: LatestCoreRowDto,
): CoreBusinessRow {
  return Object.fromEntries(
    Object.entries(DTO_FIELD_BY_BUSINESS_FIELD).map(
      ([businessField, dtoField]) => [businessField, row[dtoField]],
    ),
  ) as unknown as CoreBusinessRow;
}

export function formatWorkflowFieldValue(
  value:
    | CoreBusinessRow[BusinessFieldName]
    | RowSubmissionPayload[keyof RowSubmissionPayload],
): string {
  return value === null ? "—" : String(value);
}
