import { basename, extname } from "node:path";
import { readFile, stat } from "node:fs/promises";

import ExcelJS from "exceljs";
import type { Cell, CellValue, Row, Worksheet } from "exceljs";

import {
  SOURCE_HEADER_ROLE_ALIASES,
  SOURCE_INSPECTION_CONFIG,
  type HeaderRole,
  type SourceColumnValuePolicy,
} from "../../../config/phase-2/source-inspection";
import { sha256Bytes } from "./checksum";

const { ValueType, Workbook } = ExcelJS;

const HEADER_ROW_NUMBER = SOURCE_INSPECTION_CONFIG.headerRowNumber;
type PublicStt = string | number | boolean | null;
type CellDataType =
  "string" | "number" | "blank" | "date" | "formula" | "boolean" | "error";

export type ExpectedHeaderValue = string | number | boolean | null;

export interface WorkbookInspectionOptions {
  sheetName: string;
  expectedHeaders?: readonly ExpectedHeaderValue[];
  generatedAt?: Date;
  sourceFileName?: string;
  sourceSizeBytes?: number;
  sourceSha256?: string;
}

export interface InspectionIssue {
  sourceRowNumber: number;
  stt: PublicStt;
  issueType: string;
  rowChecksum: string;
}

export interface SourceInspectionReport {
  schemaVersion: 1;
  generatedAtUtc: string;
  raw_sha256: string;
  sheets: string[];
  selected_sheet: string;
  header_count: number;
  headers: ExpectedHeaderValue[];
  data_row_count: number;
  missing_staff_code_and_email: number;
  duplicate_business_row_groups: {
    group_count: number;
    row_count: number;
  };
  staff_name_variant_groups: number;
  course_name_variant_groups: number;
  formula_cell_count: number;
  error_cell_count: number;
  source: {
    fileName: string;
    sizeBytes: number;
    sha256: string;
    readOnly: true;
  };
  normalization: {
    sourceValuesChanged: false;
    rules: string[];
  };
  workbook: {
    sheetCount: number;
    sheetNames: string[];
    selectedSheet: string;
  };
  header: {
    rowNumber: number;
    columnCount: number;
    cells: Array<{
      columnNumber: number;
      dataType: CellDataType;
      value: ExpectedHeaderValue;
      valueChecksum: string;
    }>;
    orderChecksum: string;
    expected: {
      provided: boolean;
      columnCount: number | null;
      countMatches: boolean | null;
      orderMatches: boolean | null;
      mismatchedColumns: number[];
    };
  };
  rows: {
    lastUsedRowNumber: number;
    dataRowCount: number;
    completelyBlankRowCount: number;
  };
  cells: {
    mergedRangeCount: number;
    mergedCellCount: number;
    formulaCellCount: number;
    errorCellCount: number;
  };
  date_validation: {
    checked_cell_count: number;
    valid_date_text_count: number;
    status_text_count: number;
    blank_count: number;
    invalid_date_count: number;
    invalid_cell_anomalies: InspectionIssue[];
    columns: Array<{
      column_number: number;
      policy: Exclude<SourceColumnValuePolicy, "UNRESTRICTED">;
      checked_cell_count: number;
      valid_date_text_count: number;
      status_text_count: number;
      blank_count: number;
      invalid_date_count: number;
    }>;
  };
  stt: {
    count: number;
    distinct: number;
    minimum: number | null;
    maximum: number | null;
    missing_within_range_count: number;
    missing_within_range: number[];
    next_generated: number;
    duplicate_count: number;
    non_integer_count: number;
    min: number | null;
    max: number | null;
    distinctCount: number;
    duplicates: Array<{
      stt: PublicStt;
      occurrences: number;
      rows: InspectionIssue[];
    }>;
    nonInteger: InspectionIssue[];
    suggestedNext: number;
  };
  identity: {
    rowsMissingBothStaffCodeAndEmail: number;
    distinctStaffCodeCount: number;
    distinctEmailCount: number;
    invalidBasicEmailCount: number;
    invalidBasicEmailRows: InspectionIssue[];
    staffCodesWithMultipleNameVariants: Array<{
      variantCount: number;
      rows: InspectionIssue[];
    }>;
  };
  courses: {
    courseCodesWithMultipleNameVariants: Array<{
      variantCount: number;
      rows: InspectionIssue[];
    }>;
  };
  duplicates: {
    groupsIgnoringStt: Array<{
      occurrences: number;
      rows: InspectionIssue[];
    }>;
  };
  columnTypes: Array<{
    columnNumber: number;
    counts: Record<CellDataType, number>;
  }>;
  structure: {
    valid: boolean;
    errors: string[];
    resolvedHeaderColumns: Record<HeaderRole, number | null>;
  };
  issues: InspectionIssue[];
}

export class WorkbookInspectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkbookInspectionError";
  }
}

interface DataRow {
  row: Row;
  rowNumber: number;
  rowChecksum: string;
  stt: PublicStt;
}

export async function inspectSourceFile(
  filePath: string,
  options: Omit<
    WorkbookInspectionOptions,
    "sourceFileName" | "sourceSizeBytes" | "sourceSha256"
  >,
): Promise<SourceInspectionReport> {
  if (extname(filePath).toLocaleLowerCase("en-US") !== ".xlsx") {
    throw new WorkbookInspectionError(
      "INVALID_EXTENSION",
      "Source file must use the .xlsx extension.",
    );
  }

  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    throw new WorkbookInspectionError(
      "FILE_NOT_FOUND",
      "Source file does not exist.",
    );
  }

  if (!fileStats.isFile()) {
    throw new WorkbookInspectionError(
      "NOT_A_FILE",
      "Source path is not a regular file.",
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new WorkbookInspectionError(
      "FILE_NOT_READABLE",
      "Source file cannot be read.",
    );
  }

  return inspectWorkbookBytes(bytes, {
    ...options,
    expectedHeaders:
      options.expectedHeaders ?? SOURCE_INSPECTION_CONFIG.expectedHeaders,
    sourceFileName: basename(filePath),
    sourceSizeBytes: bytes.byteLength,
    sourceSha256: sha256Bytes(bytes),
  });
}

export async function inspectWorkbookBytes(
  bytes: Uint8Array,
  options: WorkbookInspectionOptions,
): Promise<SourceInspectionReport> {
  const workbook = new Workbook();

  try {
    await workbook.xlsx.load(
      Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new WorkbookInspectionError(
      "INVALID_WORKBOOK",
      "Source file is not a readable XLSX workbook.",
    );
  }

  const worksheet = workbook.getWorksheet(options.sheetName);
  if (!worksheet) {
    throw new WorkbookInspectionError(
      "MISSING_SHEET",
      `Required sheet ${JSON.stringify(options.sheetName)} does not exist.`,
    );
  }

  return inspectWorksheet(
    workbook.worksheets.map((sheet) => sheet.name),
    worksheet,
    bytes,
    options,
  );
}

function inspectWorksheet(
  sheetNames: string[],
  worksheet: Worksheet,
  sourceBytes: Uint8Array,
  options: WorkbookInspectionOptions,
): SourceInspectionReport {
  const headerRow = worksheet.getRow(HEADER_ROW_NUMBER);
  const headerColumnCount = headerRow.cellCount;

  if (headerColumnCount === 0 || headerRow.actualCellCount === 0) {
    throw new WorkbookInspectionError(
      "MISSING_HEADER",
      "The selected sheet has no header row.",
    );
  }

  const structureErrors: string[] = [];
  const headerCells = Array.from({ length: headerColumnCount }, (_, index) => {
    const columnNumber = index + 1;
    const cell = headerRow.getCell(columnNumber);
    if (isBlankCell(cell)) {
      structureErrors.push(`BLANK_HEADER_AT_COLUMN:${columnNumber}`);
    }

    return {
      columnNumber,
      dataType: classifyCell(cell),
      value: publicHeaderValue(cell.value),
      valueChecksum: checksumEncodedValue(encodeCell(cell)),
    };
  });

  const encodedHeaders = Array.from({ length: headerColumnCount }, (_, index) =>
    encodeCell(headerRow.getCell(index + 1)),
  );
  const expectedHeaders = options.expectedHeaders;
  const mismatchedColumns: number[] = [];

  if (expectedHeaders) {
    const comparisonLength = Math.max(
      expectedHeaders.length,
      headerColumnCount,
    );
    for (let index = 0; index < comparisonLength; index += 1) {
      const actual =
        index < headerColumnCount ? encodedHeaders[index] : undefined;
      const expected =
        index < expectedHeaders.length
          ? encodeExpectedHeader(expectedHeaders[index])
          : undefined;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        mismatchedColumns.push(index + 1);
      }
    }

    if (expectedHeaders.length !== headerColumnCount) {
      structureErrors.push("HEADER_COLUMN_COUNT_MISMATCH");
    }
    if (mismatchedColumns.length > 0) {
      structureErrors.push("HEADER_ORDER_OR_VALUE_MISMATCH");
    }
  }

  const resolvedHeaderColumns = resolveHeaderColumns(
    headerRow,
    headerColumnCount,
    structureErrors,
  );
  const columnSpan = Math.max(headerColumnCount, worksheet.columnCount);
  if (worksheet.columnCount > headerColumnCount) {
    structureErrors.push("DATA_EXTENDS_BEYOND_HEADER");
  }

  const rowByNumber = new Map<number, DataRow>();
  const dataRows: DataRow[] = [];
  let completelyBlankRowCount = 0;

  for (
    let rowNumber = HEADER_ROW_NUMBER + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    if (isRowBlank(row, columnSpan)) {
      completelyBlankRowCount += 1;
      continue;
    }

    const rowChecksum = checksumRow(row, columnSpan);
    const dataRow: DataRow = {
      row,
      rowNumber,
      rowChecksum,
      stt: publicStt(getRoleCell(row, resolvedHeaderColumns.stt)?.value),
    };
    dataRows.push(dataRow);
    rowByNumber.set(rowNumber, dataRow);
  }

  const issues: InspectionIssue[] = [];
  const issueKeys = new Set<string>();
  const addIssue = (rowNumber: number, issueType: string): InspectionIssue => {
    const key = `${rowNumber}:${issueType}`;
    const dataRow = rowByNumber.get(rowNumber);
    const issue: InspectionIssue = {
      sourceRowNumber: rowNumber,
      stt: dataRow?.stt ?? null,
      issueType,
      rowChecksum:
        dataRow?.rowChecksum ??
        checksumRow(worksheet.getRow(rowNumber), columnSpan),
    };
    if (!issueKeys.has(key)) {
      issueKeys.add(key);
      issues.push(issue);
    }
    return issue;
  };

  let mergedCellCount = 0;
  let formulaCellCount = 0;
  let errorCellCount = 0;
  const columnTypes = Array.from({ length: columnSpan }, (_, index) => ({
    columnNumber: index + 1,
    counts: emptyTypeCounts(),
  }));

  for (
    let rowNumber = HEADER_ROW_NUMBER;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    for (let columnNumber = 1; columnNumber <= columnSpan; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      if (cell.isMerged) {
        mergedCellCount += 1;
        addIssue(rowNumber, "MERGED_CELL");
      }
      if (cell.type === ValueType.Formula) {
        formulaCellCount += 1;
        addIssue(rowNumber, "FORMULA_CELL");
      }
      if (isErrorCell(cell)) {
        errorCellCount += 1;
        addIssue(rowNumber, "ERROR_CELL");
      }
      if (rowNumber > HEADER_ROW_NUMBER) {
        columnTypes[columnNumber - 1].counts[classifyCell(cell)] += 1;
      }
    }
  }

  const sttStatistics = inspectStt(
    dataRows,
    resolvedHeaderColumns.stt,
    addIssue,
  );
  const identityStatistics = inspectIdentity(
    dataRows,
    resolvedHeaderColumns,
    addIssue,
  );
  const courseStatistics = inspectNameVariants(
    dataRows,
    resolvedHeaderColumns.courseCode,
    resolvedHeaderColumns.courseName,
    "COURSE_CODE_MULTIPLE_NAME_VARIANTS",
    addIssue,
  );
  const duplicateGroups = inspectDuplicateRows(
    dataRows,
    columnSpan,
    resolvedHeaderColumns.stt,
    addIssue,
  );
  const dateValidation = inspectDatePolicies(
    dataRows,
    headerRow,
    headerColumnCount,
    addIssue,
  );

  for (const error of structureErrors) {
    addIssue(HEADER_ROW_NUMBER, `STRUCTURE:${error}`);
  }

  const expectedCountMatches = expectedHeaders
    ? expectedHeaders.length === headerColumnCount
    : null;
  const expectedOrderMatches = expectedHeaders
    ? mismatchedColumns.length === 0
    : null;
  const sourceSha256 = options.sourceSha256 ?? sha256Bytes(sourceBytes);
  const duplicateBusinessRowCount = duplicateGroups.reduce(
    (total, group) => total + group.occurrences,
    0,
  );

  return {
    schemaVersion: 1,
    generatedAtUtc: (options.generatedAt ?? new Date()).toISOString(),
    raw_sha256: sourceSha256,
    sheets: sheetNames,
    selected_sheet: worksheet.name,
    header_count: headerColumnCount,
    headers: headerCells.map((cell) => cell.value),
    data_row_count: dataRows.length,
    missing_staff_code_and_email:
      identityStatistics.rowsMissingBothStaffCodeAndEmail,
    duplicate_business_row_groups: {
      group_count: duplicateGroups.length,
      row_count: duplicateBusinessRowCount,
    },
    staff_name_variant_groups:
      identityStatistics.staffCodesWithMultipleNameVariants.length,
    course_name_variant_groups: courseStatistics.length,
    formula_cell_count: formulaCellCount,
    error_cell_count: errorCellCount,
    source: {
      fileName: options.sourceFileName ?? "<memory>.xlsx",
      sizeBytes: options.sourceSizeBytes ?? sourceBytes.byteLength,
      sha256: sourceSha256,
      readOnly: true,
    },
    normalization: {
      sourceValuesChanged: false,
      rules: [
        "No workbook cell is written, trimmed, lowercased, date-converted, or saved.",
        "Header aliases are matched internally with Unicode NFKC, outer whitespace removal, whitespace collapsing, and Vietnamese locale lowercase.",
        "Staff and course codes use the same normalization only as internal comparison keys for name-variant grouping.",
        "All distinct counts and duplicate-row checks use typed raw cell values without normalization.",
        "Dates and formulas are encoded only inside SHA-256 inputs; their source values are not changed or printed.",
        "Date validation checks exact source strings against configured policies without parsing them into replacement values.",
      ],
    },
    workbook: {
      sheetCount: sheetNames.length,
      sheetNames,
      selectedSheet: worksheet.name,
    },
    header: {
      rowNumber: HEADER_ROW_NUMBER,
      columnCount: headerColumnCount,
      cells: headerCells,
      orderChecksum: checksumEncodedValue(encodedHeaders),
      expected: {
        provided: Boolean(expectedHeaders),
        columnCount: expectedHeaders?.length ?? null,
        countMatches: expectedCountMatches,
        orderMatches: expectedOrderMatches,
        mismatchedColumns,
      },
    },
    rows: {
      lastUsedRowNumber: worksheet.rowCount,
      dataRowCount: dataRows.length,
      completelyBlankRowCount,
    },
    cells: {
      mergedRangeCount: worksheet.model.merges.length,
      mergedCellCount,
      formulaCellCount,
      errorCellCount,
    },
    date_validation: dateValidation,
    stt: sttStatistics,
    identity: identityStatistics,
    courses: {
      courseCodesWithMultipleNameVariants: courseStatistics,
    },
    duplicates: {
      groupsIgnoringStt: duplicateGroups,
    },
    columnTypes,
    structure: {
      valid: structureErrors.length === 0,
      errors: structureErrors,
      resolvedHeaderColumns,
    },
    issues,
  };
}

function inspectDatePolicies(
  rows: DataRow[],
  headerRow: Row,
  headerColumnCount: number,
  addIssue: (rowNumber: number, issueType: string) => InspectionIssue,
): SourceInspectionReport["date_validation"] {
  const report: SourceInspectionReport["date_validation"] = {
    checked_cell_count: 0,
    valid_date_text_count: 0,
    status_text_count: 0,
    blank_count: 0,
    invalid_date_count: 0,
    invalid_cell_anomalies: [],
    columns: [],
  };

  for (
    let columnNumber = 1;
    columnNumber <= headerColumnCount;
    columnNumber += 1
  ) {
    const headerValue = headerRow.getCell(columnNumber).value;
    if (typeof headerValue !== "string") continue;

    const columnConfig = SOURCE_INSPECTION_CONFIG.columns.find(
      (candidate) => candidate.header === headerValue,
    );
    if (!columnConfig || columnConfig.valuePolicy === "UNRESTRICTED") continue;

    const columnSummary: SourceInspectionReport["date_validation"]["columns"][number] =
      {
        column_number: columnNumber,
        policy: columnConfig.valuePolicy,
        checked_cell_count: 0,
        valid_date_text_count: 0,
        status_text_count: 0,
        blank_count: 0,
        invalid_date_count: 0,
      };

    for (const dataRow of rows) {
      const cell = dataRow.row.getCell(columnNumber);
      report.checked_cell_count += 1;
      columnSummary.checked_cell_count += 1;

      if (isBlankCell(cell)) {
        report.blank_count += 1;
        columnSummary.blank_count += 1;
        continue;
      }

      const outcome = validateConfiguredDateCell(
        cell,
        columnConfig.valuePolicy,
      );
      if (outcome === "VALID_DATE_TEXT") {
        report.valid_date_text_count += 1;
        columnSummary.valid_date_text_count += 1;
        continue;
      }
      if (outcome === "VALID_STATUS_TEXT") {
        report.status_text_count += 1;
        columnSummary.status_text_count += 1;
        continue;
      }

      report.invalid_date_count += 1;
      columnSummary.invalid_date_count += 1;
      report.invalid_cell_anomalies.push(addIssue(dataRow.rowNumber, outcome));
    }

    report.columns.push(columnSummary);
  }

  return report;
}

type DateCellOutcome =
  | "VALID_DATE_TEXT"
  | "VALID_STATUS_TEXT"
  | "DATE_TEXT_INVALID_FORMAT"
  | "DATE_TEXT_INVALID_CALENDAR_DATE"
  | "DATE_TEXT_UNSUPPORTED_CELL_TYPE"
  | "MIXED_TC_INVALID_DATE_FORMAT"
  | "MIXED_TC_INVALID_CALENDAR_DATE"
  | "MIXED_TC_UNEXPECTED_TEXT"
  | "MIXED_TC_UNSUPPORTED_CELL_TYPE";

function validateConfiguredDateCell(
  cell: Cell,
  policy: Exclude<SourceColumnValuePolicy, "UNRESTRICTED">,
): DateCellOutcome {
  if (typeof cell.value !== "string" || cell.type !== ValueType.String) {
    return policy === "DATE_TEXT"
      ? "DATE_TEXT_UNSUPPORTED_CELL_TYPE"
      : "MIXED_TC_UNSUPPORTED_CELL_TYPE";
  }

  if (
    policy === "DATE_OR_COMPLETED" &&
    cell.value === SOURCE_INSPECTION_CONFIG.completedStatusText
  ) {
    return "VALID_STATUS_TEXT";
  }

  const dateResult = validateDateText(cell.value);
  if (dateResult === "VALID") return "VALID_DATE_TEXT";
  if (dateResult === "INVALID_CALENDAR_DATE") {
    return policy === "DATE_TEXT"
      ? "DATE_TEXT_INVALID_CALENDAR_DATE"
      : "MIXED_TC_INVALID_CALENDAR_DATE";
  }
  if (policy === "DATE_TEXT") return "DATE_TEXT_INVALID_FORMAT";

  return looksLikeDateText(cell.value)
    ? "MIXED_TC_INVALID_DATE_FORMAT"
    : "MIXED_TC_UNEXPECTED_TEXT";
}

function validateDateText(
  value: string,
): "VALID" | "INVALID_FORMAT" | "INVALID_CALENDAR_DATE" {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  if (!match) return "INVALID_FORMAT";

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return "INVALID_CALENDAR_DATE";
  }

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1] ? "VALID" : "INVALID_CALENDAR_DATE";
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function looksLikeDateText(value: string): boolean {
  return value.includes("/") || /\d/u.test(value);
}

function inspectStt(
  rows: DataRow[],
  sttColumn: number | null,
  addIssue: (rowNumber: number, issueType: string) => InspectionIssue,
): SourceInspectionReport["stt"] {
  const values = new Map<string, DataRow[]>();
  const integers: number[] = [];
  const distinctIntegers = new Set<number>();
  const nonInteger: InspectionIssue[] = [];
  let count = 0;

  for (const dataRow of rows) {
    const cell = getRoleCell(dataRow.row, sttColumn);
    if (!cell || isBlankCell(cell)) {
      continue;
    }

    count += 1;
    const key = JSON.stringify(encodeCell(cell));
    const matchingRows = values.get(key) ?? [];
    matchingRows.push(dataRow);
    values.set(key, matchingRows);

    if (
      cell.type === ValueType.Number &&
      typeof cell.value === "number" &&
      Number.isInteger(cell.value)
    ) {
      integers.push(cell.value);
      distinctIntegers.add(cell.value);
    } else {
      nonInteger.push(addIssue(dataRow.rowNumber, "STT_NOT_INTEGER"));
    }
  }

  const duplicates = [...values.values()]
    .filter((matchingRows) => matchingRows.length > 1)
    .map((matchingRows) => ({
      stt: matchingRows[0].stt,
      occurrences: matchingRows.length,
      rows: matchingRows.map((row) => addIssue(row.rowNumber, "DUPLICATE_STT")),
    }));
  const max = integers.length > 0 ? Math.max(...integers) : null;
  const min = integers.length > 0 ? Math.min(...integers) : null;
  const missingWithinRange: number[] = [];
  if (min !== null && max !== null) {
    for (let stt = min; stt <= max; stt += 1) {
      if (!distinctIntegers.has(stt)) missingWithinRange.push(stt);
    }
  }

  return {
    count,
    distinct: values.size,
    minimum: min,
    maximum: max,
    missing_within_range_count: missingWithinRange.length,
    missing_within_range: missingWithinRange,
    next_generated: max === null ? 1 : max + 1,
    duplicate_count: duplicates.length,
    non_integer_count: nonInteger.length,
    min,
    max,
    distinctCount: values.size,
    duplicates,
    nonInteger,
    suggestedNext: max === null ? 1 : max + 1,
  };
}

function inspectIdentity(
  rows: DataRow[],
  columns: Record<HeaderRole, number | null>,
  addIssue: (rowNumber: number, issueType: string) => InspectionIssue,
): SourceInspectionReport["identity"] {
  const staffCodes = new Set<string>();
  const emails = new Set<string>();
  const invalidBasicEmailRows: InspectionIssue[] = [];
  let rowsMissingBothStaffCodeAndEmail = 0;

  for (const dataRow of rows) {
    const staffCodeCell = getRoleCell(dataRow.row, columns.staffCode);
    const emailCell = getRoleCell(dataRow.row, columns.email);
    const staffCodeBlank = !staffCodeCell || isBlankCell(staffCodeCell);
    const emailBlank = !emailCell || isBlankCell(emailCell);

    if (staffCodeBlank && emailBlank) {
      rowsMissingBothStaffCodeAndEmail += 1;
      addIssue(dataRow.rowNumber, "MISSING_STAFF_CODE_AND_EMAIL");
    }
    if (!staffCodeBlank && staffCodeCell) {
      staffCodes.add(JSON.stringify(encodeCell(staffCodeCell)));
    }
    if (!emailBlank && emailCell) {
      emails.add(JSON.stringify(encodeCell(emailCell)));
      if (
        emailCell.type !== ValueType.String ||
        typeof emailCell.value !== "string" ||
        !isBasicEmail(emailCell.value)
      ) {
        invalidBasicEmailRows.push(
          addIssue(dataRow.rowNumber, "INVALID_BASIC_EMAIL"),
        );
      }
    }
  }

  return {
    rowsMissingBothStaffCodeAndEmail,
    distinctStaffCodeCount: staffCodes.size,
    distinctEmailCount: emails.size,
    invalidBasicEmailCount: invalidBasicEmailRows.length,
    invalidBasicEmailRows,
    staffCodesWithMultipleNameVariants: inspectNameVariants(
      rows,
      columns.staffCode,
      columns.staffName,
      "STAFF_CODE_MULTIPLE_NAME_VARIANTS",
      addIssue,
    ),
  };
}

function inspectNameVariants(
  rows: DataRow[],
  codeColumn: number | null,
  nameColumn: number | null,
  issueType: string,
  addIssue: (rowNumber: number, issueType: string) => InspectionIssue,
): Array<{ variantCount: number; rows: InspectionIssue[] }> {
  const groups = new Map<string, { names: Set<string>; rows: DataRow[] }>();

  for (const dataRow of rows) {
    const codeCell = getRoleCell(dataRow.row, codeColumn);
    const nameCell = getRoleCell(dataRow.row, nameColumn);
    if (
      !codeCell ||
      !nameCell ||
      isBlankCell(codeCell) ||
      isBlankCell(nameCell)
    ) {
      continue;
    }

    const codeKey = internalComparisonKey(codeCell);
    const group = groups.get(codeKey) ?? { names: new Set<string>(), rows: [] };
    group.names.add(JSON.stringify(encodeCell(nameCell)));
    group.rows.push(dataRow);
    groups.set(codeKey, group);
  }

  return [...groups.values()]
    .filter((group) => group.names.size > 1)
    .map((group) => ({
      variantCount: group.names.size,
      rows: group.rows.map((row) => addIssue(row.rowNumber, issueType)),
    }));
}

function inspectDuplicateRows(
  rows: DataRow[],
  columnSpan: number,
  sttColumn: number | null,
  addIssue: (rowNumber: number, issueType: string) => InspectionIssue,
): SourceInspectionReport["duplicates"]["groupsIgnoringStt"] {
  const groups = new Map<string, DataRow[]>();

  for (const dataRow of rows) {
    const encodedBusinessCells = [];
    for (let columnNumber = 1; columnNumber <= columnSpan; columnNumber += 1) {
      if (columnNumber !== sttColumn) {
        encodedBusinessCells.push(
          encodeCell(dataRow.row.getCell(columnNumber)),
        );
      }
    }
    const key = checksumEncodedValue(encodedBusinessCells);
    const group = groups.get(key) ?? [];
    group.push(dataRow);
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      occurrences: group.length,
      rows: group.map((row) =>
        addIssue(row.rowNumber, "DUPLICATE_BUSINESS_ROW_IGNORING_STT"),
      ),
    }));
}

function resolveHeaderColumns(
  headerRow: Row,
  columnCount: number,
  structureErrors: string[],
): Record<HeaderRole, number | null> {
  const resolved = Object.fromEntries(
    (Object.keys(SOURCE_HEADER_ROLE_ALIASES) as HeaderRole[]).map((role) => [
      role,
      null,
    ]),
  ) as Record<HeaderRole, number | null>;

  for (const role of Object.keys(SOURCE_HEADER_ROLE_ALIASES) as HeaderRole[]) {
    const aliases = new Set(
      SOURCE_HEADER_ROLE_ALIASES[role].map(normalizeComparisonText),
    );
    const matches: number[] = [];
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      const value = headerRow.getCell(columnNumber).value;
      if (
        typeof value === "string" &&
        aliases.has(normalizeComparisonText(value))
      ) {
        matches.push(columnNumber);
      }
    }

    if (matches.length === 1) {
      resolved[role] = matches[0];
    } else if (matches.length === 0) {
      structureErrors.push(`MISSING_REQUIRED_HEADER_ROLE:${role}`);
    } else {
      structureErrors.push(`AMBIGUOUS_HEADER_ROLE:${role}`);
    }
  }

  return resolved;
}

function getRoleCell(row: Row, columnNumber: number | null): Cell | null {
  return columnNumber === null ? null : row.getCell(columnNumber);
}

function isRowBlank(row: Row, columnSpan: number): boolean {
  for (let columnNumber = 1; columnNumber <= columnSpan; columnNumber += 1) {
    if (!isBlankCell(row.getCell(columnNumber))) {
      return false;
    }
  }
  return true;
}

function isBlankCell(cell: Cell): boolean {
  return (
    cell.type === ValueType.Null ||
    cell.value === null ||
    cell.value === undefined
  );
}

function isErrorCell(cell: Cell): boolean {
  if (cell.type === ValueType.Error) return true;
  if (
    cell.type !== ValueType.Formula ||
    !cell.value ||
    typeof cell.value !== "object"
  ) {
    return false;
  }

  const formulaValue = cell.value as unknown as Record<string, unknown>;
  const result = formulaValue.result;
  return Boolean(
    result &&
    typeof result === "object" &&
    typeof (result as Record<string, unknown>).error === "string",
  );
}

function isBasicEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function normalizeComparisonText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("vi-VN");
}

function internalComparisonKey(cell: Cell): string {
  return typeof cell.value === "string"
    ? `string:${normalizeComparisonText(cell.value)}`
    : JSON.stringify(encodeCell(cell));
}

function publicStt(value: CellValue): PublicStt {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : null;
}

function publicHeaderValue(value: CellValue): ExpectedHeaderValue {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : null;
}

function emptyTypeCounts(): Record<CellDataType, number> {
  return {
    string: 0,
    number: 0,
    blank: 0,
    date: 0,
    formula: 0,
    boolean: 0,
    error: 0,
  };
}

function classifyCell(cell: Cell): CellDataType {
  if (cell.type === ValueType.Formula) return "formula";
  if (cell.type === ValueType.Error) return "error";
  if (cell.type === ValueType.Merge) return classifyCell(cell.master);
  if (cell.type === ValueType.Null) return "blank";
  if (cell.type === ValueType.Number) return "number";
  if (cell.type === ValueType.Date) return "date";
  if (cell.type === ValueType.Boolean) return "boolean";
  return "string";
}

function checksumRow(row: Row, columnSpan: number): string {
  const values = Array.from({ length: columnSpan }, (_, index) =>
    encodeCell(row.getCell(index + 1)),
  );
  return checksumEncodedValue(values);
}

function checksumEncodedValue(value: unknown): string {
  return sha256Bytes(Buffer.from(JSON.stringify(value), "utf8"));
}

function encodeExpectedHeader(value: ExpectedHeaderValue): unknown {
  if (value === null) return ["blank"];
  return [typeof value, value];
}

function encodeCell(cell: Cell): unknown {
  if (cell.type === ValueType.Merge) {
    return ["merge", encodeCell(cell.master)];
  }
  if (cell.type === ValueType.Formula) {
    const value = cell.value;
    if (value && typeof value === "object") {
      const formulaValue = value as unknown as Record<string, unknown>;
      const formula =
        typeof formulaValue.formula === "string"
          ? formulaValue.formula
          : typeof formulaValue.sharedFormula === "string"
            ? formulaValue.sharedFormula
            : null;
      return ["formula", formula, encodeLooseValue(formulaValue.result)];
    }
    return ["formula", null, null];
  }
  return encodeLooseValue(cell.value);
}

function encodeLooseValue(value: CellValue | unknown): unknown {
  if (value === null || value === undefined) return ["blank"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "number") return ["number", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (value instanceof Date) return ["date", value.getTime()];
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (typeof objectValue.error === "string")
      return ["error", objectValue.error];
    if (Array.isArray(objectValue.richText)) {
      return [
        "richText",
        objectValue.richText.map((part) =>
          part && typeof part === "object" && "text" in part ? part.text : null,
        ),
      ];
    }
    if (typeof objectValue.hyperlink === "string") {
      return ["hyperlink", objectValue.text, objectValue.hyperlink];
    }
  }
  return ["unknown"];
}
