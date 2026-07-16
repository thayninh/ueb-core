import type { UebCoreDataDto } from "@/lib/data/dto";

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
      <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="min-w-max border-collapse text-left text-sm">
        <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          <tr>
            {showVersionMetadata && (
              <>
                <th
                  className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-700"
                  scope="col"
                >
                  Phiên bản
                </th>
                <th
                  className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-700"
                  scope="col"
                >
                  Trạng thái
                </th>
              </>
            )}
            {BUSINESS_COLUMNS.map(([key, label], index) => (
              <th
                className={`border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-700 ${
                  index === 0
                    ? "sticky left-0 z-10 bg-zinc-100 dark:bg-zinc-800"
                    : ""
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
        <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
          {rows.map((row, rowIndex) => (
            <tr
              className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
              data-current-version={showVersionMetadata && rowIndex === 0}
              data-version-no={row.versionNo}
              key={`${row.recordUid}:${row.versionNo}:${row.stt}`}
            >
              {showVersionMetadata && (
                <>
                  <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                    {row.versionNo}
                  </td>
                  <td className="px-4 py-3">
                    {rowIndex === 0 ? (
                      <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
                        Hiện hành
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-500">
                        Phiên bản cũ
                      </span>
                    )}
                  </td>
                </>
              )}
              {BUSINESS_COLUMNS.map(([key], index) => (
                <td
                  className={`max-w-80 px-4 py-3 text-zinc-700 dark:text-zinc-200 ${
                    index === 0
                      ? "sticky left-0 z-10 bg-white font-medium text-zinc-950 dark:bg-zinc-900 dark:text-zinc-50"
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
    </div>
  );
}

function formatCell(value: UebCoreDataDto[keyof UebCoreDataDto]): string {
  if (value === null) return "—";
  if (value instanceof Date) return value.toLocaleString("vi-VN");
  return String(value);
}
