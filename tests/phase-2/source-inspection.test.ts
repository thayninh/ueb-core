// @vitest-environment node

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { sha256Bytes } from "../../scripts/phase-2/lib/checksum";
import {
  inspectWorkbookBytes,
  WorkbookInspectionError,
} from "../../scripts/phase-2/lib/workbook";

const { Workbook } = ExcelJS;

const REQUIRED_HEADERS = [
  "stt",
  "Tên giảng viên",
  "Mã cán bộ",
  "Email",
  "Mã học phần",
  "Tên học phần",
] as const;

const DATE_ONLY_HEADER = "tc3_3_chu_nhiem_de_tai_nckh_lien_quan";
const MIXED_TC_HEADER = "TC1:Trợ Giảng";

describe("Phase 2 source inspection", () => {
  it("rejects a workbook that does not contain the requested sheet", async () => {
    const bytes = await createWorkbookBytes("other-sheet", [REQUIRED_HEADERS]);

    await expect(
      inspectWorkbookBytes(bytes, { sheetName: "csdlcore" }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkbookInspectionError>>({
        code: "MISSING_SHEET",
      }),
    );
  });

  it("detects a formula cell without exposing its value in an issue", async () => {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet("csdlcore");
    worksheet.addRow(REQUIRED_HEADERS);
    worksheet.addRow([
      1,
      "Giảng viên A",
      "CB-1",
      "a@example.edu",
      "HP-1",
      "Học phần A",
    ]);
    worksheet.getCell("F2").value = { formula: "1+1", result: 2 };
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());

    const report = await inspectWorkbookBytes(bytes, { sheetName: "csdlcore" });

    expect(report.cells.formulaCellCount).toBe(1);
    expect(report.columnTypes[5].counts.formula).toBe(1);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        sourceRowNumber: 2,
        stt: 1,
        issueType: "FORMULA_CELL",
        rowChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("reports duplicate stt values", async () => {
    const bytes = await createWorkbookBytes("csdlcore", [
      REQUIRED_HEADERS,
      [1, "Giảng viên A", "CB-1", "a@example.edu", "HP-1", "Học phần A"],
      [1, "Giảng viên B", "CB-2", "b@example.edu", "HP-2", "Học phần B"],
    ]);

    const report = await inspectWorkbookBytes(bytes, { sheetName: "csdlcore" });

    expect(report.stt.duplicates).toHaveLength(1);
    expect(report.stt.duplicates[0]).toMatchObject({ stt: 1, occurrences: 2 });
    expect(
      report.stt.duplicates[0].rows.map((issue) => issue.sourceRowNumber),
    ).toEqual([2, 3]);
  });

  it("accepts a valid leap-year date", async () => {
    const report = await inspectPolicyCell(DATE_ONLY_HEADER, "29/02/2024");

    expect(report.date_validation).toMatchObject({
      checked_cell_count: 1,
      valid_date_text_count: 1,
      status_text_count: 0,
      blank_count: 0,
      invalid_date_count: 0,
      invalid_cell_anomalies: [],
    });
  });

  it("rejects 31/02 as a nonexistent calendar date", async () => {
    const report = await inspectPolicyCell(DATE_ONLY_HEADER, "31/02/2024");

    expect(report.date_validation.invalid_date_count).toBe(1);
    expect(report.date_validation.invalid_cell_anomalies).toContainEqual(
      expect.objectContaining({
        sourceRowNumber: 2,
        stt: 1,
        issueType: "DATE_TEXT_INVALID_CALENDAR_DATE",
      }),
    );
  });

  it("rejects D/M/YYYY text that is not exactly DD/MM/YYYY", async () => {
    const report = await inspectPolicyCell(DATE_ONLY_HEADER, "1/2/2024");

    expect(report.date_validation.invalid_date_count).toBe(1);
    expect(report.date_validation.invalid_cell_anomalies[0].issueType).toBe(
      "DATE_TEXT_INVALID_FORMAT",
    );
  });

  it("accepts the exact completed status in a mixed TC column", async () => {
    const report = await inspectPolicyCell(MIXED_TC_HEADER, "Đã hoàn thành");

    expect(report.date_validation).toMatchObject({
      checked_cell_count: 1,
      valid_date_text_count: 0,
      status_text_count: 1,
      blank_count: 0,
      invalid_date_count: 0,
    });
  });

  it("reports unexpected text in a mixed TC column without exposing the value", async () => {
    const report = await inspectPolicyCell(
      MIXED_TC_HEADER,
      "Nội dung bất thường",
    );

    expect(report.date_validation.invalid_date_count).toBe(1);
    expect(report.date_validation.invalid_cell_anomalies[0]).toMatchObject({
      sourceRowNumber: 2,
      stt: 1,
      issueType: "MIXED_TC_UNEXPECTED_TEXT",
      rowChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(
      Object.keys(report.date_validation.invalid_cell_anomalies[0]).sort(),
    ).toEqual(["issueType", "rowChecksum", "sourceRowNumber", "stt"]);
  });

  it("accepts a blank configured date cell", async () => {
    const report = await inspectPolicyCell(DATE_ONLY_HEADER, null);

    expect(report.date_validation).toMatchObject({
      checked_cell_count: 1,
      valid_date_text_count: 0,
      status_text_count: 0,
      blank_count: 1,
      invalid_date_count: 0,
    });
  });

  it("lists every missing integer stt within the observed range", async () => {
    const rows: ExcelJS.CellValue[][] = [
      [...REQUIRED_HEADERS],
      ...[-1, 0, 2, 4, 5].map((stt) => [
        stt,
        `Giảng viên ${stt}`,
        `CB-${stt}`,
        `user-${stt}@example.edu`,
        `HP-${stt}`,
        `Học phần ${stt}`,
      ]),
    ];
    const bytes = await createWorkbookBytes("csdlcore", rows);

    const report = await inspectWorkbookBytes(bytes, { sheetName: "csdlcore" });

    expect(report).toMatchObject({
      raw_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      sheets: ["csdlcore"],
      selected_sheet: "csdlcore",
      header_count: REQUIRED_HEADERS.length,
      headers: [...REQUIRED_HEADERS],
      data_row_count: 5,
      missing_staff_code_and_email: 0,
      duplicate_business_row_groups: { group_count: 0, row_count: 0 },
      staff_name_variant_groups: 0,
      course_name_variant_groups: 0,
      formula_cell_count: 0,
      error_cell_count: 0,
    });
    expect(report.stt).toMatchObject({
      count: 5,
      distinct: 5,
      minimum: -1,
      maximum: 5,
      missing_within_range_count: 2,
      missing_within_range: [1, 3],
      next_generated: 6,
      duplicate_count: 0,
      non_integer_count: 0,
    });
  });

  it("marks a different observed header count as a structure error", async () => {
    const bytes = await createWorkbookBytes("csdlcore", [REQUIRED_HEADERS]);
    const expectedHeaders = [...REQUIRED_HEADERS, "Cột dự kiến bổ sung"];

    const report = await inspectWorkbookBytes(bytes, {
      sheetName: "csdlcore",
      expectedHeaders,
    });

    expect(report.header.columnCount).toBe(REQUIRED_HEADERS.length);
    expect(report.header.expected.columnCount).toBe(expectedHeaders.length);
    expect(report.header.expected.countMatches).toBe(false);
    expect(report.header.expected.orderMatches).toBe(false);
    expect(report.structure.valid).toBe(false);
    expect(report.structure.errors).toContain("HEADER_COLUMN_COUNT_MISMATCH");
  });

  it("calculates a stable SHA-256 checksum for the same raw bytes", () => {
    const bytes = Buffer.from("abc", "utf8");

    expect(sha256Bytes(bytes)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Bytes(bytes)).toBe(sha256Bytes(Buffer.from(bytes)));
  });
});

async function inspectPolicyCell(
  header: string,
  value: ExcelJS.CellValue,
): Promise<Awaited<ReturnType<typeof inspectWorkbookBytes>>> {
  const bytes = await createWorkbookBytes("csdlcore", [
    [...REQUIRED_HEADERS, header],
    [1, "Giảng viên A", "CB-1", "a@example.edu", "HP-1", "Học phần A", value],
  ]);
  return inspectWorkbookBytes(bytes, { sheetName: "csdlcore" });
}

async function createWorkbookBytes(
  sheetName: string,
  rows: ReadonlyArray<ReadonlyArray<ExcelJS.CellValue>>,
): Promise<Buffer> {
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  for (const row of rows) worksheet.addRow([...row]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
