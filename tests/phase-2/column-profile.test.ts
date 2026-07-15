// @vitest-environment node

import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import sourceContractJson from "../../config/phase-2/source-contract.json";
import {
  cellTextDiffersFromRaw,
  hasLeadingZeroNumberFormat,
  isOnePointZeroDisplay,
  profileSourceColumnBytes,
} from "../../scripts/phase-2/lib/column-profiler";
import { sha256Bytes } from "../../scripts/phase-2/lib/checksum";
import type { SourceContract } from "../../scripts/phase-2/lib/source-contract";

const { Workbook } = ExcelJS;
const contract = structuredClone(sourceContractJson) as SourceContract;
const profilerSource = readFileSync(
  new URL("../../scripts/phase-2/lib/column-profiler.ts", import.meta.url),
  "utf8",
);
const profileCliSource = readFileSync(
  new URL("../../scripts/phase-2/profile-column.ts", import.meta.url),
  "utf8",
);

describe("Phase 2 khoi_kien_thuc read-only profiler", () => {
  it("profiles General integers and decimals without coercion", async () => {
    const bytes = await createProfileWorkbook([
      { value: 0, numFmt: "General" },
      { value: 2, numFmt: "General" },
      { value: -3, numFmt: "General" },
      { value: 1.5, numFmt: "General" },
    ]);
    const report = await profileSourceColumnBytes(
      bytes,
      contract.source_filename,
      contract,
      "khoi_kien_thuc",
    );

    expect(report.profile.number_format_counts).toEqual({ General: 4 });
    expect(report.profile.integer_count).toBe(3);
    expect(report.profile.decimal_count).toBe(1);
    expect(report.profile.zero_count).toBe(1);
    expect(report.profile.minimum).toBe(-3);
    expect(report.profile.maximum).toBe(2);
    expect(report.technical_assessment.recommended_storage_category).toBe(
      "decimal",
    );
  });

  it("detects 00 and custom leading-zero number formats", async () => {
    const bytes = await createProfileWorkbook([
      { value: 7, numFmt: "00" },
      { value: 12, numFmt: "000" },
    ]);
    const report = await profileSourceColumnBytes(
      bytes,
      contract.source_filename,
      contract,
      "khoi_kien_thuc",
    );

    expect(hasLeadingZeroNumberFormat("General")).toBe(false);
    expect(hasLeadingZeroNumberFormat("00")).toBe(true);
    expect(hasLeadingZeroNumberFormat("000-00")).toBe(true);
    expect(report.decision_checks.leading_zero_number_format_detected).toBe(
      true,
    );
    expect(report.profile.raw_display_difference_count).toBe(0);
    expect(report.technical_assessment.recommended_storage_category).toBe(
      "text",
    );
  });

  it("detects a raw value that differs from display text", () => {
    expect(cellTextDiffersFromRaw(7, "07")).toBe(true);
    expect(cellTextDiffersFromRaw(7, "7")).toBe(false);
    expect(isOnePointZeroDisplay(1, "1.0")).toBe(true);
    expect(isOnePointZeroDisplay(1, "1")).toBe(false);
    expect(isOnePointZeroDisplay(1, "1", "0.0")).toBe(true);
  });

  it("records 0.0 number format independently from ExcelJS cell.text", async () => {
    const bytes = await createProfileWorkbook([{ value: 1, numFmt: "0.0" }]);
    const report = await profileSourceColumnBytes(
      bytes,
      contract.source_filename,
      contract,
      "khoi_kien_thuc",
    );

    expect(report.profile.integer_count).toBe(1);
    expect(report.profile.number_format_counts).toEqual({ "0.0": 1 });
    expect(report.decision_checks.one_point_zero_display_count).toBe(1);
    expect(report.profile.raw_display_differences).toEqual([]);
  });

  it("does not mutate or save workbook bytes", async () => {
    const bytes = await createProfileWorkbook([
      { value: 1, numFmt: "General" },
      { value: null, numFmt: "General" },
    ]);
    const checksumBefore = sha256Bytes(bytes);

    await profileSourceColumnBytes(
      bytes,
      contract.source_filename,
      contract,
      "khoi_kien_thuc",
    );

    expect(sha256Bytes(bytes)).toBe(checksumBefore);
  });

  it("has no database client or database environment dependency", () => {
    const implementation = `${profilerSource}\n${profileCliSource}`;
    expect(implementation).not.toMatch(/@prisma|PrismaClient|from ["']pg["']/u);
    expect(implementation).not.toMatch(
      /DATABASE_URL|MIGRATION_DATABASE_URL|APP_DATABASE_PASSWORD/u,
    );
  });
});

async function createProfileWorkbook(
  values: Array<{ value: number | null; numFmt: string }>,
): Promise<Buffer> {
  const workbook = new Workbook();
  const dataSheet = workbook.addWorksheet(contract.sheet_name);
  dataSheet.getRow(1).values = contract.exact_header_order;
  values.forEach((entry, index) => {
    const row = dataSheet.getRow(index + 2);
    row.getCell(1).value = index + 1;
    const cell = row.getCell(4);
    cell.value = entry.value;
    cell.numFmt = entry.numFmt;
  });

  const mappingSheet = workbook.addWorksheet("Anh_xa_PostgreSQL");
  mappingSheet.addRow([
    "thu_tu",
    "tieu_de_excel_goc",
    "ten_cot_postgresql",
    "kieu_postgresql",
    "ghi_chu",
  ]);
  mappingSheet.addRow([
    4,
    "khoi_kien_thuc",
    "khoi_kien_thuc",
    "INTEGER",
    "Giá trị số nguyên.",
  ]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
