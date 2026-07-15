import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";

import ExcelJS from "exceljs";
import type { Cell, Row } from "exceljs";

import { sha256Bytes } from "./checksum";
import {
  calculateDatasetChecksum,
  calculateRowChecksum,
  type CanonicalBusinessValue,
} from "./canonicalize";
import {
  createLegacyImportRunId,
  createLegacyRecordUid,
  createLegacySnapshotId,
  createLegacyTechnicalIdentity,
  unresolvedIdentitySignature,
} from "./identity";
import type { SourceColumn, SourceContract } from "./source-contract";
import { inspectWorkbookBytes, type SourceInspectionReport } from "./workbook";

const { ValueType, Workbook } = ExcelJS;
const HEADER_ROW_NUMBER = 1;

export interface SafeSourceAnomaly {
  code: string;
  sourceRowNumber?: number;
  stt?: number | null;
  rowChecksum?: string;
  column?: string;
}

export interface PreparedSourceRow {
  sourceRowNumber: number;
  stt: number;
  businessValues: Record<string, CanonicalBusinessValue>;
  orderedValues: CanonicalBusinessValue[];
  rowChecksum: string;
  lecturerUid: string;
  recordUid: string;
  snapshotId: string;
  identityStatus: "RESOLVED" | "UNRESOLVED";
  identityKey: string;
}

export interface PreparedSource {
  sourceFileName: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  sheetName: string;
  headers: string[];
  rows: PreparedSourceRow[];
  datasetChecksum: string;
  importRunId: string;
  unresolvedRowCount: number;
  unresolvedGroupCount: number;
  inspection: SourceInspectionReport;
  violations: SafeSourceAnomaly[];
}

export async function prepareSourceFile(
  filePath: string,
  contract: SourceContract,
): Promise<PreparedSource> {
  if (extname(filePath).toLocaleLowerCase("en-US") !== ".xlsx") {
    throw new SourcePreparationError(
      "SOURCE_EXTENSION_INVALID",
      "Source file must use the .xlsx extension.",
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new SourcePreparationError(
      "SOURCE_FILE_UNREADABLE",
      "Source file cannot be read.",
    );
  }

  return prepareSourceBytes(bytes, basename(filePath), contract);
}

export async function prepareSourceBytes(
  bytes: Uint8Array,
  fileName: string,
  contract: SourceContract,
): Promise<PreparedSource> {
  const sourceSha256 = sha256Bytes(bytes);
  const inspection = await inspectWorkbookBytes(bytes, {
    sheetName: contract.sheet_name,
    expectedHeaders: contract.exact_header_order,
    sourceFileName: fileName,
    sourceSizeBytes: bytes.byteLength,
    sourceSha256,
  });
  const workbook = new Workbook();

  try {
    await workbook.xlsx.load(
      Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new SourcePreparationError(
      "SOURCE_WORKBOOK_INVALID",
      "Source file is not a readable XLSX workbook.",
    );
  }

  const worksheet = workbook.getWorksheet(contract.sheet_name);
  if (!worksheet) {
    throw new SourcePreparationError(
      "SOURCE_SHEET_MISSING",
      "Contract sheet does not exist in the source workbook.",
    );
  }

  const violations: SafeSourceAnomaly[] = [];
  const violationKeys = new Set<string>();
  const addViolation = (violation: SafeSourceAnomaly): void => {
    const key = `${violation.code}:${violation.sourceRowNumber ?? "global"}:${violation.column ?? ""}`;
    if (!violationKeys.has(key)) {
      violationKeys.add(key);
      violations.push(violation);
    }
  };

  validateSourceMetadata(
    fileName,
    sourceSha256,
    inspection,
    contract,
    addViolation,
  );

  const headerRow = worksheet.getRow(HEADER_ROW_NUMBER);
  const headers = contract.column_mapping.map((column, index) => {
    const cell = headerRow.getCell(index + 1);
    return typeof cell.value === "string" ? cell.value : "";
  });
  const parsedRows: PreparedSourceRow[] = [];

  for (
    let rowNumber = HEADER_ROW_NUMBER + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    const rawRowChecksum = fingerprintRawRow(
      row,
      Math.max(contract.exact_business_column_count, worksheet.columnCount),
    );
    const isBlank = isRowBlank(
      row,
      Math.max(contract.exact_business_column_count, worksheet.columnCount),
    );
    if (isBlank) {
      addViolation({
        code: "COMPLETELY_BLANK_DATA_ROW",
        sourceRowNumber: rowNumber,
        stt: null,
        rowChecksum: rawRowChecksum,
      });
      continue;
    }

    const sttCell = row.getCell(1);
    const publicStt =
      sttCell.type === ValueType.Number &&
      typeof sttCell.value === "number" &&
      Number.isInteger(sttCell.value)
        ? sttCell.value
        : null;
    const violationCountBeforeRow = violations.length;
    const businessValues: Record<string, CanonicalBusinessValue> = {};
    const orderedValues: CanonicalBusinessValue[] = [];

    for (const column of contract.column_mapping) {
      const cell = row.getCell(column.position);
      const value = parseContractCell(
        cell,
        column,
        contract,
        rowNumber,
        publicStt,
        rawRowChecksum,
        addViolation,
      );
      businessValues[column.postgresql_column] = value;
      orderedValues.push(value);
    }

    for (
      let columnNumber = contract.exact_business_column_count + 1;
      columnNumber <= worksheet.columnCount;
      columnNumber += 1
    ) {
      if (!isBlankCell(row.getCell(columnNumber))) {
        addViolation({
          code: "DATA_BEYOND_CONTRACT_COLUMNS",
          sourceRowNumber: rowNumber,
          stt: publicStt,
          rowChecksum: rawRowChecksum,
          column: `column_${columnNumber}`,
        });
      }
    }

    if (violations.length !== violationCountBeforeRow || publicStt === null) {
      continue;
    }

    const rowChecksum = calculateRowChecksum(orderedValues);
    const identity = createLegacyTechnicalIdentity({
      staffCode: textValue(businessValues.ma_so_can_bo),
      email: textValue(businessValues.email_tai_khoan_vnu),
      lecturerName: textValue(businessValues.ten_giang_vien),
      approvalUnit: textValue(businessValues.don_vi),
    });
    parsedRows.push({
      sourceRowNumber: rowNumber,
      stt: publicStt,
      businessValues,
      orderedValues,
      rowChecksum,
      lecturerUid: identity.lecturerUid,
      recordUid: createLegacyRecordUid(publicStt),
      snapshotId: createLegacySnapshotId(identity.lecturerUid),
      identityStatus: identity.identityStatus,
      identityKey: identity.identityKey,
    });
  }

  validateUnresolvedCollisions(parsedRows, addViolation);

  const unresolvedRows = parsedRows.filter(
    (row) => row.identityStatus === "UNRESOLVED",
  );
  const unresolvedGroups = new Set(
    unresolvedRows.map((row) => row.identityKey),
  );

  return {
    sourceFileName: fileName,
    sourceSha256,
    sourceSizeBytes: bytes.byteLength,
    sheetName: worksheet.name,
    headers,
    rows: parsedRows,
    datasetChecksum: calculateDatasetChecksum(parsedRows),
    importRunId: createLegacyImportRunId(sourceSha256),
    unresolvedRowCount: unresolvedRows.length,
    unresolvedGroupCount: unresolvedGroups.size,
    inspection,
    violations,
  };
}

function validateSourceMetadata(
  fileName: string,
  sourceSha256: string,
  inspection: SourceInspectionReport,
  contract: SourceContract,
  addViolation: (violation: SafeSourceAnomaly) => void,
): void {
  const globalChecks: Array<[boolean, string]> = [
    [fileName === contract.source_filename, "SOURCE_FILENAME_MISMATCH"],
    [sourceSha256 === contract.source_sha256, "SOURCE_SHA256_MISMATCH"],
    [
      inspection.selected_sheet === contract.sheet_name,
      "SOURCE_SHEET_MISMATCH",
    ],
    [
      inspection.header_count === contract.exact_business_column_count,
      "HEADER_COUNT_MISMATCH",
    ],
    [
      JSON.stringify(inspection.headers) ===
        JSON.stringify(contract.exact_header_order),
      "HEADER_ORDER_OR_VALUE_MISMATCH",
    ],
    [
      inspection.data_row_count === contract.expected_data_row_count,
      "DATA_ROW_COUNT_MISMATCH",
    ],
    [
      inspection.stt.count === contract.expected_data_row_count,
      "STT_COUNT_MISMATCH",
    ],
    [inspection.stt.minimum === contract.stt.expected_min, "STT_MIN_MISMATCH"],
    [inspection.stt.maximum === contract.stt.expected_max, "STT_MAX_MISMATCH"],
    [
      inspection.stt.distinct === contract.stt.expected_distinct,
      "STT_DISTINCT_MISMATCH",
    ],
    [
      inspection.stt.next_generated === contract.stt.expected_next,
      "STT_NEXT_MISMATCH",
    ],
    [
      inspection.stt.duplicate_count === contract.stt.duplicate_count,
      "STT_DUPLICATE_COUNT_MISMATCH",
    ],
    [inspection.stt.non_integer_count === 0, "STT_NON_INTEGER"],
    [
      inspection.stt.missing_within_range_count ===
        contract.stt.expected_missing_within_range_count,
      "STT_MISSING_COUNT_MISMATCH",
    ],
    [
      JSON.stringify(inspection.stt.missing_within_range) ===
        JSON.stringify(contract.stt.expected_missing_within_range),
      "STT_MISSING_LIST_MISMATCH",
    ],
    [
      inspection.formula_cell_count === contract.expected_formula_cell_count,
      "FORMULA_CELL_COUNT_MISMATCH",
    ],
    [inspection.formula_cell_count === 0, "FORMULA_CELL_REJECTED"],
    [
      inspection.error_cell_count === contract.expected_error_cell_count,
      "ERROR_CELL_COUNT_MISMATCH",
    ],
    [inspection.error_cell_count === 0, "ERROR_CELL_REJECTED"],
    [
      inspection.date_validation.invalid_date_count ===
        contract.expected_invalid_date_count,
      "INVALID_DATE_COUNT_MISMATCH",
    ],
    [
      inspection.missing_staff_code_and_email ===
        contract.expected_warning_counts.missing_staff_code_and_email_rows,
      "MISSING_IDENTITY_WARNING_COUNT_MISMATCH",
    ],
    [
      inspection.duplicate_business_row_groups.group_count ===
        contract.expected_warning_counts.duplicate_business_groups,
      "DUPLICATE_GROUP_WARNING_COUNT_MISMATCH",
    ],
    [
      inspection.duplicate_business_row_groups.row_count ===
        contract.expected_warning_counts.duplicate_business_rows,
      "DUPLICATE_ROW_WARNING_COUNT_MISMATCH",
    ],
    [
      inspection.staff_name_variant_groups ===
        contract.expected_warning_counts.staff_name_variant_groups,
      "STAFF_NAME_VARIANT_WARNING_COUNT_MISMATCH",
    ],
    [
      inspection.course_name_variant_groups ===
        contract.expected_warning_counts.course_name_variant_groups,
      "COURSE_NAME_VARIANT_WARNING_COUNT_MISMATCH",
    ],
    [inspection.cells.mergedCellCount === 0, "MERGED_CELL_REJECTED"],
    [inspection.structure.valid, "WORKBOOK_STRUCTURE_INVALID"],
  ];

  for (const [passes, code] of globalChecks) {
    if (!passes) addViolation({ code });
  }
}

function parseContractCell(
  cell: Cell,
  column: SourceColumn,
  contract: SourceContract,
  sourceRowNumber: number,
  stt: number | null,
  rawRowChecksum: string,
  addViolation: (violation: SafeSourceAnomaly) => void,
): CanonicalBusinessValue {
  const anomaly = (code: string): void =>
    addViolation({
      code,
      sourceRowNumber,
      stt,
      rowChecksum: rawRowChecksum,
      column: column.postgresql_column,
    });

  if (cell.type === ValueType.Formula) {
    anomaly("FORMULA_CELL_REJECTED");
    return null;
  }
  if (cell.type === ValueType.Error) {
    anomaly("ERROR_CELL_REJECTED");
    return null;
  }
  if (cell.type === ValueType.Merge || cell.isMerged) {
    anomaly("MERGED_CELL_REJECTED");
    return null;
  }
  if (isBlankCell(cell)) {
    if (!column.nullable) anomaly("NON_NULLABLE_CELL_BLANK");
    return null;
  }

  if (column.postgresql_type === "integer") {
    if (
      cell.type !== ValueType.Number ||
      typeof cell.value !== "number" ||
      !Number.isInteger(cell.value)
    ) {
      anomaly("INTEGER_CELL_TYPE_INVALID");
      return null;
    }
    return cell.value;
  }

  if (cell.type !== ValueType.String || typeof cell.value !== "string") {
    anomaly(
      column.postgresql_column === "ma_so_can_bo"
        ? "STAFF_CODE_MUST_BE_STRING_OR_NULL"
        : "TEXT_CELL_TYPE_INVALID",
    );
    return null;
  }

  const dateOutcome = validateContractDateText(
    column.excel_header,
    cell.value,
    contract,
  );
  if (dateOutcome !== null) anomaly(dateOutcome);
  return cell.value;
}

function validateContractDateText(
  header: string,
  value: string,
  contract: SourceContract,
): string | null {
  const isDateOnly =
    contract.date_text_policy.date_only_headers.includes(header);
  const isDateOrStatus =
    contract.date_text_policy.date_or_status_headers.includes(header);
  if (!isDateOnly && !isDateOrStatus) return null;
  if (
    isDateOrStatus &&
    value === contract.date_text_policy.accepted_status_text
  ) {
    return null;
  }

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  if (!match) return "DATE_TEXT_INVALID_FORMAT";
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return "DATE_TEXT_INVALID_CALENDAR_DATE";
  }
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
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
  return day <= days[month - 1] ? null : "DATE_TEXT_INVALID_CALENDAR_DATE";
}

function validateUnresolvedCollisions(
  rows: PreparedSourceRow[],
  addViolation: (violation: SafeSourceAnomaly) => void,
): void {
  const groups = new Map<
    string,
    { signatures: Set<string>; rows: PreparedSourceRow[] }
  >();

  for (const row of rows) {
    if (row.identityStatus !== "UNRESOLVED") continue;
    const group = groups.get(row.identityKey) ?? {
      signatures: new Set<string>(),
      rows: [],
    };
    group.signatures.add(
      unresolvedIdentitySignature(
        row.businessValues.ten_giang_vien,
        row.businessValues.don_vi,
      ),
    );
    group.rows.push(row);
    groups.set(row.identityKey, group);
  }

  for (const group of groups.values()) {
    if (group.signatures.size <= 1) continue;
    for (const row of group.rows) {
      addViolation({
        code: "UNRESOLVED_IDENTITY_KEY_COLLISION",
        sourceRowNumber: row.sourceRowNumber,
        stt: row.stt,
        rowChecksum: row.rowChecksum,
      });
    }
  }
}

function textValue(value: CanonicalBusinessValue): string | null {
  return typeof value === "string" ? value : null;
}

function isBlankCell(cell: Cell): boolean {
  return (
    cell.type === ValueType.Null ||
    cell.value === null ||
    cell.value === undefined
  );
}

function isRowBlank(row: Row, columnCount: number): boolean {
  for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
    if (!isBlankCell(row.getCell(columnNumber))) return false;
  }
  return true;
}

function fingerprintRawRow(row: Row, columnCount: number): string {
  const encoded = Array.from({ length: columnCount }, (_, index) => {
    const cell = row.getCell(index + 1);
    if (isBlankCell(cell)) return ["blank"];
    if (cell.type === ValueType.Formula) return ["formula"];
    if (cell.type === ValueType.Error) return ["error"];
    if (cell.type === ValueType.Number) return ["number", cell.value];
    if (cell.type === ValueType.String) return ["string", cell.value];
    if (cell.type === ValueType.Boolean) return ["boolean", cell.value];
    if (cell.type === ValueType.Date && cell.value instanceof Date) {
      return ["date", cell.value.getTime()];
    }
    return ["unsupported"];
  });
  return sha256Bytes(Buffer.from(JSON.stringify(encoded), "utf8"));
}

export class SourcePreparationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SourcePreparationError";
  }
}
