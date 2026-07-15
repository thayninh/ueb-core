import sourceContract from "./source-contract.json";

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

const ROLE_BY_POSTGRESQL_COLUMN: Readonly<
  Partial<Record<string, { role: HeaderRole; aliases: readonly string[] }>>
> = {
  stt: { role: "stt", aliases: ["stt.", "số thứ tự", "số tt"] },
  ma_hoc_phan: { role: "courseCode", aliases: ["mã học phần"] },
  ten_hoc_phan: { role: "courseName", aliases: ["tên học phần"] },
  ten_giang_vien: {
    role: "staffName",
    aliases: ["tên giảng viên", "họ và tên"],
  },
  ma_so_can_bo: {
    role: "staffCode",
    aliases: ["mã số cán bộ", "mã cán bộ"],
  },
  email_tai_khoan_vnu: {
    role: "email",
    aliases: ["email tài khoản vnu", "email"],
  },
};

export const SOURCE_INSPECTION_COLUMNS = sourceContract.column_mapping.map(
  (column): SourceInspectionColumnConfig => {
    const role = ROLE_BY_POSTGRESQL_COLUMN[column.postgresql_column];
    let valuePolicy: SourceColumnValuePolicy = "UNRESTRICTED";
    if (
      sourceContract.date_text_policy.date_only_headers.includes(
        column.excel_header,
      )
    ) {
      valuePolicy = "DATE_TEXT";
    } else if (
      sourceContract.date_text_policy.date_or_status_headers.includes(
        column.excel_header,
      )
    ) {
      valuePolicy = "DATE_OR_COMPLETED";
    }

    return {
      header: column.excel_header,
      ...(role ? { role: role.role, aliases: role.aliases } : {}),
      valuePolicy,
    };
  },
);

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
      (candidate) => candidate.role === role,
    );
    if (!column) {
      throw new Error(`Missing source inspection role configuration: ${role}`);
    }
    return [role, [column.header, ...(column.aliases ?? [])]];
  }),
) as unknown as Record<HeaderRole, readonly string[]>;

export const SOURCE_INSPECTION_CONFIG = {
  headerRowNumber: 1,
  completedStatusText: sourceContract.date_text_policy.accepted_status_text,
  columns: SOURCE_INSPECTION_COLUMNS,
  expectedHeaders: sourceContract.exact_header_order,
} as const;
