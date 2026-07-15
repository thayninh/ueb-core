export type HeaderRole =
  "stt" | "staffName" | "staffCode" | "email" | "courseCode" | "courseName";

export type SourceColumnValuePolicy =
  "UNRESTRICTED" | "DATE_TEXT" | "DATE_OR_COMPLETED";

export interface SourceInspectionColumnConfig {
  header: string;
  role?: HeaderRole;
  aliases?: readonly string[];
  valuePolicy: SourceColumnValuePolicy;
}

export const SOURCE_INSPECTION_COLUMNS = [
  {
    header: "stt",
    role: "stt",
    aliases: ["stt.", "số thứ tự", "số tt"],
    valuePolicy: "UNRESTRICTED",
  },
  { header: "don_vi_phu_trach_hoc_phan", valuePolicy: "UNRESTRICTED" },
  { header: "bo_mon_phu_trach_hoc_phan", valuePolicy: "UNRESTRICTED" },
  { header: "khoi_kien_thuc", valuePolicy: "UNRESTRICTED" },
  {
    header: "ma_hoc_phan",
    role: "courseCode",
    aliases: ["mã học phần"],
    valuePolicy: "UNRESTRICTED",
  },
  {
    header: "ten_hoc_phan",
    role: "courseName",
    aliases: ["tên học phần"],
    valuePolicy: "UNRESTRICTED",
  },
  {
    header: "ten_giang_vien",
    role: "staffName",
    aliases: ["tên giảng viên", "họ và tên"],
    valuePolicy: "UNRESTRICTED",
  },
  {
    header: "ma_so_can_bo",
    role: "staffCode",
    aliases: ["mã số cán bộ", "mã cán bộ"],
    valuePolicy: "UNRESTRICTED",
  },
  {
    header: "email_tai_khoan_vnu",
    role: "email",
    aliases: ["email tài khoản vnu", "email"],
    valuePolicy: "UNRESTRICTED",
  },
  { header: "bo_mon", valuePolicy: "UNRESTRICTED" },
  { header: "don_vi", valuePolicy: "UNRESTRICTED" },
  { header: "core_1_2_3", valuePolicy: "UNRESTRICTED" },
  { header: "TC1:Trợ Giảng", valuePolicy: "DATE_OR_COMPLETED" },
  { header: "TC2: SH Chuyên môn", valuePolicy: "DATE_OR_COMPLETED" },
  {
    header: "TC3: Tốt nghiệp/NCKH/Bài báo/Chính cương",
    valuePolicy: "DATE_OR_COMPLETED",
  },
  {
    header: "tc3_1_nganh_tot_nghiep_phu_hop",
    valuePolicy: "DATE_OR_COMPLETED",
  },
  {
    header: "tc3_2_bien_soan_de_cuong_giao_trinh",
    valuePolicy: "DATE_OR_COMPLETED",
  },
  {
    header: "tc3_3_chu_nhiem_de_tai_nckh_lien_quan",
    valuePolicy: "DATE_TEXT",
  },
  {
    header: "tc3_4_bai_bao_lien_quan",
    valuePolicy: "DATE_OR_COMPLETED",
  },
  { header: "TC4: Giảng thử", valuePolicy: "DATE_OR_COMPLETED" },
] as const satisfies readonly SourceInspectionColumnConfig[];

const HEADER_ROLES: readonly HeaderRole[] = [
  "stt",
  "staffName",
  "staffCode",
  "email",
  "courseCode",
  "courseName",
];

export const SOURCE_HEADER_ROLE_ALIASES = Object.fromEntries(
  HEADER_ROLES.map((role) => {
    const column = SOURCE_INSPECTION_COLUMNS.find(
      (candidate) => "role" in candidate && candidate.role === role,
    );
    if (!column)
      throw new Error(`Missing source inspection role configuration: ${role}`);
    return [
      role,
      [column.header, ...("aliases" in column ? column.aliases : [])],
    ];
  }),
) as unknown as Record<HeaderRole, readonly string[]>;

export const SOURCE_INSPECTION_CONFIG = {
  headerRowNumber: 1,
  completedStatusText: "Đã hoàn thành",
  columns: SOURCE_INSPECTION_COLUMNS,
  expectedHeaders: SOURCE_INSPECTION_COLUMNS.map((column) => column.header),
} as const;
