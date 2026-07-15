import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";

import ExcelJS from "exceljs";
import type { Cell, Worksheet } from "exceljs";

import { sha256Bytes } from "./checksum";
import type { SourceColumn, SourceContract } from "./source-contract";

const { ValueType, Workbook } = ExcelJS;

const HEADER_ROW_NUMBER = 1;
const MAPPING_SHEET_NAME = "Anh_xa_PostgreSQL";
const MAPPING_HEADERS = {
  source: "tieu_de_excel_goc",
  database: "ten_cot_postgresql",
  type: "kieu_postgresql",
} as const;
const POSTGRES_INTEGER_MINIMUM = -2_147_483_648;
const POSTGRES_INTEGER_MAXIMUM = 2_147_483_647;

type RawExcelType =
  | "blank"
  | "boolean"
  | "date"
  | "error"
  | "formula"
  | "hyperlink"
  | "merge"
  | "number"
  | "rich_text"
  | "string"
  | "other";

export interface ColumnProfileReport {
  report_version: 1;
  report_type: "SOURCE_COLUMN_PROFILE";
  generated_at_utc: string;
  read_only: true;
  source: {
    filename: string;
    raw_sha256: string;
    data_sheet: string;
    mapping_sheet: typeof MAPPING_SHEET_NAME;
  };
  profile: {
    source_column_header: string;
    mapped_database_column: string;
    source_contract_type: SourceColumn["postgresql_type"];
    declared_type_in_Anh_xa_PostgreSQL: string;
    total_non_blank_cells: number;
    raw_excel_type_counts: Record<RawExcelType, number>;
    number_format_counts: Record<string, number>;
    distinct_number_format_count: number;
    integer_count: number;
    decimal_count: number;
    zero_count: number;
    negative_count: number;
    positive_count: number;
    safe_integer_count: number;
    non_safe_integer_count: number;
    minimum: number | null;
    maximum: number | null;
    distinct_value_count: number;
    frequency_distribution?: Array<{ value: number; count: number }>;
    top_20_frequency?: Array<{ value: number; count: number }>;
    raw_display_difference_count: number;
    raw_display_differences: Array<{
      raw_value: number;
      display_text: string;
      count: number;
    }>;
    scientific_notation_count: number;
    blank_count: number;
    formula_count: number;
    error_count: number;
  };
  decision_checks: {
    leading_zero_number_format_detected: boolean;
    leading_zero_number_formats: string[];
    one_point_zero_display_count: number;
    display_text_differs_from_raw: boolean;
    outside_postgresql_integer_32_bit_count: number;
    non_integer_count: number;
  };
  technical_assessment: {
    recommended_storage_category: "integer" | "decimal" | "text";
    rationale: string;
    business_decision: false;
  };
  privacy: {
    contains_personal_data: false;
    contains_source_row_numbers: false;
  };
}

export async function profileSourceColumnFile(
  filePath: string,
  contract: SourceContract,
  databaseColumn: string,
  generatedAt = new Date(),
): Promise<ColumnProfileReport> {
  if (extname(filePath).toLocaleLowerCase("en-US") !== ".xlsx") {
    throw new ColumnProfileError(
      "SOURCE_EXTENSION_INVALID",
      "Source file must use the .xlsx extension.",
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new ColumnProfileError(
      "SOURCE_FILE_UNREADABLE",
      "Source file cannot be read.",
    );
  }

  return profileSourceColumnBytes(
    bytes,
    basename(filePath),
    contract,
    databaseColumn,
    generatedAt,
  );
}

export async function profileSourceColumnBytes(
  bytes: Uint8Array,
  sourceFileName: string,
  contract: SourceContract,
  databaseColumn: string,
  generatedAt = new Date(),
): Promise<ColumnProfileReport> {
  const column = contract.column_mapping.find(
    (candidate) => candidate.postgresql_column === databaseColumn,
  );
  if (!column) {
    throw new ColumnProfileError(
      "COLUMN_NOT_IN_CONTRACT",
      "Requested column is not present in the source contract.",
    );
  }
  if (databaseColumn !== "khoi_kien_thuc") {
    throw new ColumnProfileError(
      "COLUMN_NOT_ALLOWED",
      "This evidence profiler is restricted to khoi_kien_thuc.",
    );
  }

  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(
      Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new ColumnProfileError(
      "SOURCE_WORKBOOK_INVALID",
      "Source file is not a readable XLSX workbook.",
    );
  }

  const dataSheet = workbook.getWorksheet(contract.sheet_name);
  if (!dataSheet) {
    throw new ColumnProfileError(
      "SOURCE_SHEET_MISSING",
      "Contract data sheet does not exist in the source workbook.",
    );
  }
  assertSourceHeader(dataSheet, column);

  const mappingSheet = workbook.getWorksheet(MAPPING_SHEET_NAME);
  if (!mappingSheet) {
    throw new ColumnProfileError(
      "MAPPING_SHEET_MISSING",
      "Anh_xa_PostgreSQL does not exist in the source workbook.",
    );
  }
  const declaredType = readDeclaredMappingType(mappingSheet, column);

  const rawTypeCounts = createRawTypeCounts();
  const numberFormatCounts = new Map<string, number>();
  const numericFrequencies = new Map<number, number>();
  const rawDisplayDifferences = new Map<
    string,
    { raw_value: number; display_text: string; count: number }
  >();
  const numericValues: number[] = [];
  let totalNonBlankCells = 0;
  let integerCount = 0;
  let decimalCount = 0;
  let zeroCount = 0;
  let negativeCount = 0;
  let positiveCount = 0;
  let safeIntegerCount = 0;
  let nonSafeIntegerCount = 0;
  let rawDisplayDifferenceCount = 0;
  let scientificNotationCount = 0;
  let onePointZeroDisplayCount = 0;
  let outsidePostgresqlIntegerCount = 0;

  for (
    let rowNumber = HEADER_ROW_NUMBER + 1;
    rowNumber <= dataSheet.rowCount;
    rowNumber += 1
  ) {
    const cell = dataSheet.getRow(rowNumber).getCell(column.position);
    const rawType = getRawExcelType(cell);
    rawTypeCounts[rawType] += 1;
    if (rawType === "blank") continue;
    totalNonBlankCells += 1;

    const rawString = String(cell.value);
    if (cellTextDiffersFromRaw(cell.value, cell.text)) {
      rawDisplayDifferenceCount += 1;
    }
    if (rawType !== "number" || typeof cell.value !== "number") continue;

    const value = cell.value;
    const numberFormat = normalizeNumberFormat(cell.numFmt);
    incrementCount(numberFormatCounts, numberFormat);
    incrementCount(numericFrequencies, value);
    numericValues.push(value);

    if (Number.isInteger(value)) {
      integerCount += 1;
      if (Number.isSafeInteger(value)) safeIntegerCount += 1;
      else nonSafeIntegerCount += 1;
      if (
        value < POSTGRES_INTEGER_MINIMUM ||
        value > POSTGRES_INTEGER_MAXIMUM
      ) {
        outsidePostgresqlIntegerCount += 1;
      }
    } else {
      decimalCount += 1;
    }

    if (value === 0) zeroCount += 1;
    else if (value < 0) negativeCount += 1;
    else positiveCount += 1;

    if (cellTextDiffersFromRaw(value, cell.text)) {
      const differenceKey = `${rawString}\u0000${cell.text}`;
      const existing = rawDisplayDifferences.get(differenceKey);
      if (existing) existing.count += 1;
      else {
        rawDisplayDifferences.set(differenceKey, {
          raw_value: value,
          display_text: cell.text,
          count: 1,
        });
      }
    }
    if (isScientificNotation(cell.text, numberFormat)) {
      scientificNotationCount += 1;
    }
    if (isOnePointZeroDisplay(value, cell.text, numberFormat)) {
      onePointZeroDisplayCount += 1;
    }
  }

  const frequency = [...numericFrequencies.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort(
      (left, right) => right.count - left.count || left.value - right.value,
    );
  const numberFormats = Object.fromEntries(
    [...numberFormatCounts.entries()].sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
  const leadingZeroNumberFormats = Object.keys(numberFormats).filter(
    hasLeadingZeroNumberFormat,
  );
  const recommendedStorageCategory = assessStorageCategory({
    rawTypeCounts,
    decimalCount,
    outsidePostgresqlIntegerCount,
    leadingZeroNumberFormats,
    rawDisplayDifferenceCount,
  });

  const profile: ColumnProfileReport["profile"] = {
    source_column_header: column.excel_header,
    mapped_database_column: column.postgresql_column,
    source_contract_type: column.postgresql_type,
    declared_type_in_Anh_xa_PostgreSQL: declaredType,
    total_non_blank_cells: totalNonBlankCells,
    raw_excel_type_counts: rawTypeCounts,
    number_format_counts: numberFormats,
    distinct_number_format_count: numberFormatCounts.size,
    integer_count: integerCount,
    decimal_count: decimalCount,
    zero_count: zeroCount,
    negative_count: negativeCount,
    positive_count: positiveCount,
    safe_integer_count: safeIntegerCount,
    non_safe_integer_count: nonSafeIntegerCount,
    minimum: numericValues.length === 0 ? null : Math.min(...numericValues),
    maximum: numericValues.length === 0 ? null : Math.max(...numericValues),
    distinct_value_count: numericFrequencies.size,
    raw_display_difference_count: rawDisplayDifferenceCount,
    raw_display_differences: [...rawDisplayDifferences.values()].sort(
      (left, right) =>
        right.count - left.count || left.raw_value - right.raw_value,
    ),
    scientific_notation_count: scientificNotationCount,
    blank_count: rawTypeCounts.blank,
    formula_count: rawTypeCounts.formula,
    error_count: rawTypeCounts.error,
  };
  if (frequency.length <= 100) profile.frequency_distribution = frequency;
  else profile.top_20_frequency = frequency.slice(0, 20);

  return {
    report_version: 1,
    report_type: "SOURCE_COLUMN_PROFILE",
    generated_at_utc: generatedAt.toISOString(),
    read_only: true,
    source: {
      filename: sourceFileName,
      raw_sha256: sha256Bytes(bytes),
      data_sheet: dataSheet.name,
      mapping_sheet: MAPPING_SHEET_NAME,
    },
    profile,
    decision_checks: {
      leading_zero_number_format_detected: leadingZeroNumberFormats.length > 0,
      leading_zero_number_formats: leadingZeroNumberFormats,
      one_point_zero_display_count: onePointZeroDisplayCount,
      display_text_differs_from_raw: rawDisplayDifferenceCount > 0,
      outside_postgresql_integer_32_bit_count: outsidePostgresqlIntegerCount,
      non_integer_count: decimalCount,
    },
    technical_assessment: {
      recommended_storage_category: recommendedStorageCategory,
      rationale: storageRationale(recommendedStorageCategory),
      business_decision: false,
    },
    privacy: {
      contains_personal_data: false,
      contains_source_row_numbers: false,
    },
  };
}

function assertSourceHeader(worksheet: Worksheet, column: SourceColumn): void {
  const actual = worksheet.getRow(HEADER_ROW_NUMBER).getCell(column.position);
  if (
    actual.type !== ValueType.String ||
    actual.value !== column.excel_header
  ) {
    throw new ColumnProfileError(
      "SOURCE_HEADER_MISMATCH",
      "Source column header does not match the source contract.",
    );
  }
}

function readDeclaredMappingType(
  worksheet: Worksheet,
  column: SourceColumn,
): string {
  const headerPositions = new Map<string, number>();
  worksheet.getRow(HEADER_ROW_NUMBER).eachCell((cell, columnNumber) => {
    if (typeof cell.value === "string") {
      headerPositions.set(cell.value, columnNumber);
    }
  });
  const sourcePosition = headerPositions.get(MAPPING_HEADERS.source);
  const databasePosition = headerPositions.get(MAPPING_HEADERS.database);
  const typePosition = headerPositions.get(MAPPING_HEADERS.type);
  if (!sourcePosition || !databasePosition || !typePosition) {
    throw new ColumnProfileError(
      "MAPPING_HEADERS_INVALID",
      "Anh_xa_PostgreSQL is missing required mapping headers.",
    );
  }

  for (
    let rowNumber = HEADER_ROW_NUMBER + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    if (
      row.getCell(sourcePosition).value === column.excel_header &&
      row.getCell(databasePosition).value === column.postgresql_column
    ) {
      const declaredType = row.getCell(typePosition).value;
      if (typeof declaredType !== "string" || declaredType.length === 0) {
        break;
      }
      return declaredType;
    }
  }

  throw new ColumnProfileError(
    "MAPPING_ROW_MISSING",
    "Anh_xa_PostgreSQL has no exact mapping row for the requested column.",
  );
}

function createRawTypeCounts(): Record<RawExcelType, number> {
  return {
    blank: 0,
    boolean: 0,
    date: 0,
    error: 0,
    formula: 0,
    hyperlink: 0,
    merge: 0,
    number: 0,
    rich_text: 0,
    string: 0,
    other: 0,
  };
}

function getRawExcelType(cell: Cell): RawExcelType {
  switch (cell.type) {
    case ValueType.Null:
      return "blank";
    case ValueType.Number:
      return "number";
    case ValueType.String:
      return "string";
    case ValueType.Date:
      return "date";
    case ValueType.Hyperlink:
      return "hyperlink";
    case ValueType.Formula:
      return "formula";
    case ValueType.RichText:
      return "rich_text";
    case ValueType.Boolean:
      return "boolean";
    case ValueType.Error:
      return "error";
    case ValueType.Merge:
      return "merge";
    default:
      return "other";
  }
}

function normalizeNumberFormat(numberFormat: string | undefined): string {
  return numberFormat && numberFormat.length > 0 ? numberFormat : "General";
}

export function hasLeadingZeroNumberFormat(numberFormat: string): boolean {
  if (numberFormat.toLocaleLowerCase("en-US") === "general") return false;
  const firstSection = numberFormat.split(";")[0] ?? numberFormat;
  const withoutFormattingDirectives = firstSection
    .replace(/"[^"]*"/gu, "")
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/\\./gu, "")
    .replace(/[_*]./gu, "");
  const integerSection = withoutFormattingDirectives.split(".")[0] ?? "";
  return (integerSection.match(/0/gu)?.length ?? 0) >= 2;
}

export function cellTextDiffersFromRaw(
  rawValue: unknown,
  displayText: string,
): boolean {
  return displayText !== String(rawValue);
}

export function isOnePointZeroDisplay(
  rawValue: unknown,
  displayText: string,
  numberFormat = "General",
): boolean {
  if (rawValue !== 1) return false;
  if (/^1\.0+$/u.test(displayText)) return true;
  const firstSection = numberFormat.split(";")[0] ?? numberFormat;
  const decimalSection = firstSection.split(".")[1];
  return decimalSection !== undefined && /0/u.test(decimalSection);
}

function isScientificNotation(
  displayText: string,
  numberFormat: string,
): boolean {
  return (
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[Ee][+-]?\d+$/u.test(displayText) ||
    /[0#?](?:\.0+)?[Ee][+-]?0+/u.test(numberFormat)
  );
}

function incrementCount<T>(counts: Map<T, number>, key: T): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function assessStorageCategory(input: {
  rawTypeCounts: Record<RawExcelType, number>;
  decimalCount: number;
  outsidePostgresqlIntegerCount: number;
  leadingZeroNumberFormats: string[];
  rawDisplayDifferenceCount: number;
}): "integer" | "decimal" | "text" {
  const nonNumericCount =
    input.rawTypeCounts.string +
    input.rawTypeCounts.date +
    input.rawTypeCounts.boolean +
    input.rawTypeCounts.formula +
    input.rawTypeCounts.error +
    input.rawTypeCounts.hyperlink +
    input.rawTypeCounts.rich_text +
    input.rawTypeCounts.merge +
    input.rawTypeCounts.other;
  if (
    nonNumericCount > 0 ||
    input.leadingZeroNumberFormats.length > 0 ||
    input.rawDisplayDifferenceCount > 0
  ) {
    return "text";
  }
  if (input.decimalCount > 0 || input.outsidePostgresqlIntegerCount > 0) {
    return "decimal";
  }
  return "integer";
}

function storageRationale(category: "integer" | "decimal" | "text"): string {
  if (category === "integer") {
    return "Observed non-blank cells are integer-valued numbers within PostgreSQL integer range, with no display-format evidence requiring textual preservation.";
  }
  if (category === "decimal") {
    return "Observed numeric cells include non-integers or values outside PostgreSQL integer range.";
  }
  return "Observed cell types or display formats carry representation that an integer or decimal column would not preserve exactly.";
}

export class ColumnProfileError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ColumnProfileError";
  }
}
