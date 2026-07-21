import type { UebCoreDataDto } from "@/lib/data/dto";

import { TableShell } from "@/components/ui";

const BUSINESS_COLUMNS = [
  ["stt", "STT"],
  ["donViPhuTrachHocPhan", "Đơn vị phụ trách học phần"],
  ["boMonPhuTrachHocPhan", "Bộ môn phụ trách học phần"],
  ["khoiKienThuc", "Khối kiến thức"],
  ["maHocPhan", "Mã học phần"],
  ["tenHocPhan", "Tên học phần"],
  ["tenGiangVien", "Tên giảng viên"],
  ["maSoCanBo", "Mã số cán bộ"],
  ["emailTaiKhoanVnu", "Email tài khoản VNU"],
  ["boMon", "Bộ môn"],
  ["donVi", "Đơn vị"],
  ["core123", "Core 1/2/3"],
  ["tc1TroGiang", "TC1: Trợ giảng"],
  ["tc2ShChuyenMon", "TC2: SH chuyên môn"],
  ["tc3TongHop", "TC3: Tốt nghiệp/NCKH/Bài báo/Chính cương"],
  ["tc31NganhTotNghiepPhuHop", "TC3.1: Ngành tốt nghiệp phù hợp"],
  ["tc32BienSoanDeCuongGiaoTrinh", "TC3.2: Biên soạn đề cương/giáo trình"],
  ["tc33ChuNhiemDeTaiNckhLienQuan", "TC3.3: Chủ nhiệm đề tài NCKH liên quan"],
  ["tc34BaiBaoLienQuan", "TC3.4: Bài báo liên quan"],
  ["tc4GiangThu", "TC4: Giảng thử"],
] as const satisfies readonly (readonly [keyof UebCoreDataDto, string])[];

export function CoreDataTable({
  rows,
  emptyMessage = "Không có dữ liệu trong phạm vi được phép.",
  showVersionMetadata = false,
}: Readonly<{
  rows: readonly UebCoreDataDto[];
  emptyMessage?: string;
  showVersionMetadata?: boolean;
}>) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border-strong bg-surface px-5 py-12 text-center text-sm text-muted shadow-control sm:px-6">
        {emptyMessage}
      </div>
    );
  }

  return (
    <TableShell aria-label="Dữ liệu UEB Core">
      <table className="min-w-max border-collapse text-left text-sm">
        <thead className="bg-brand-700 text-xs uppercase tracking-wide text-white">
          <tr>
            {showVersionMetadata && (
              <>
                <th
                  className="border-b border-brand-800 px-4 py-3 font-semibold"
                  scope="col"
                >
                  Phiên bản
                </th>
                <th
                  className="border-b border-brand-800 px-4 py-3 font-semibold"
                  scope="col"
                >
                  Trạng thái
                </th>
              </>
            )}
            {BUSINESS_COLUMNS.map(([key, label], index) => (
              <th
                className={`border-b border-brand-800 px-4 py-3 font-semibold ${
                  index === 0 ? "sticky left-0 z-10 bg-brand-700" : ""
                }`}
                key={key}
                scope="col"
              >
                <span className="block max-w-56 whitespace-normal">
                  {label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface">
          {rows.map((row, rowIndex) => (
            <tr
              className="align-top transition-colors hover:bg-surface-subtle"
              data-current-version={showVersionMetadata && rowIndex === 0}
              data-version-no={row.versionNo}
              key={`${row.recordUid}:${row.versionNo}:${row.stt}`}
            >
              {showVersionMetadata && (
                <>
                  <td className="px-4 py-3 font-semibold text-ink">
                    {row.versionNo}
                  </td>
                  <td className="px-4 py-3">
                    {rowIndex === 0 ? (
                      <span className="inline-flex min-h-6 items-center rounded-full bg-success-surface px-2.5 py-0.5 text-xs font-semibold text-success-text">
                        Hiện hành
                      </span>
                    ) : (
                      <span className="text-xs text-muted">Phiên bản cũ</span>
                    )}
                  </td>
                </>
              )}
              {BUSINESS_COLUMNS.map(([key], index) => (
                <td
                  className={`max-w-80 px-4 py-3 text-muted ${
                    index === 0
                      ? "sticky left-0 z-10 bg-surface font-medium text-ink"
                      : "whitespace-pre-wrap"
                  }`}
                  key={key}
                >
                  {formatCell(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableShell>
  );
}

function formatCell(value: UebCoreDataDto[keyof UebCoreDataDto]): string {
  if (value === null) return "—";
  if (value instanceof Date) return value.toLocaleString("vi-VN");
  return String(value);
}
