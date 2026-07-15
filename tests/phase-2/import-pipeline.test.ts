// @vitest-environment node

import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import sourceContractJson from "../../config/phase-2/source-contract.json";
import {
  calculateDatasetChecksum,
  calculateRowChecksum,
  serializeBusinessValues,
} from "../../scripts/phase-2/lib/canonicalize";
import { sha256Bytes } from "../../scripts/phase-2/lib/checksum";
import { parsePipelineArguments } from "../../scripts/phase-2/lib/cli";
import {
  createLegacyImportRunId,
  createLegacyRecordUid,
  createLegacySnapshotId,
  createLegacyTechnicalIdentity,
} from "../../scripts/phase-2/lib/identity";
import { createDryRunImportReport } from "../../scripts/phase-2/lib/import-report";
import {
  prepareSourceBytes,
  type PreparedSource,
} from "../../scripts/phase-2/lib/row-parser";
import type { SourceContract } from "../../scripts/phase-2/lib/source-contract";
import { validateConfirmedSha } from "../../scripts/phase-2/import-source";
import {
  comparePreparedSourceToDatabase,
  type ImportDatabaseSnapshot,
} from "../../scripts/phase-2/verify-import";

const { Workbook } = ExcelJS;

const dryRunSource = readFileSync(
  new URL("../../scripts/phase-2/dry-run-import.ts", import.meta.url),
  "utf8",
);
const importSource = readFileSync(
  new URL("../../scripts/phase-2/import-source.ts", import.meta.url),
  "utf8",
);
const verifySource = readFileSync(
  new URL("../../scripts/phase-2/verify-import.ts", import.meta.url),
  "utf8",
);

describe("Phase 2 controlled import pipeline", () => {
  it("canonicalizes exact typed values without trimming or case conversion", () => {
    const values = [1, null, "", "  Đặng Văn A  ", "MiXeD"] as const;
    const serialized = serializeBusinessValues(values);

    expect(serialized).toContain("  Đặng Văn A  ");
    expect(serialized).toContain("MiXeD");
    expect(serialized).toContain('["null"]');
    expect(calculateRowChecksum(values)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("calculates dataset checksum by numeric stt order", () => {
    const rows = [
      { stt: 7, rowChecksum: "b".repeat(64) },
      { stt: -1, rowChecksum: "a".repeat(64) },
    ];

    expect(calculateDatasetChecksum(rows)).toBe(
      calculateDatasetChecksum([...rows].reverse()),
    );
  });

  it("creates deterministic UUID v5 identities with the required priority", () => {
    const staff = createLegacyTechnicalIdentity({
      staffCode: "CB-01",
      email: "Person@Example.edu",
      lecturerName: "Tên",
      approvalUnit: "Đơn vị",
    });
    const sameStaff = createLegacyTechnicalIdentity({
      staffCode: "CB-01",
      email: null,
      lecturerName: null,
      approvalUnit: null,
    });
    const emailLower = createLegacyTechnicalIdentity({
      staffCode: null,
      email: "person@example.edu",
      lecturerName: null,
      approvalUnit: null,
    });
    const emailUpper = createLegacyTechnicalIdentity({
      staffCode: null,
      email: "PERSON@EXAMPLE.EDU",
      lecturerName: null,
      approvalUnit: null,
    });

    expect(staff.lecturerUid).toBe(sameStaff.lecturerUid);
    expect(emailLower.lecturerUid).toBe(emailUpper.lecturerUid);
    expect(staff.lecturerUid).not.toBe(emailLower.lecturerUid);
    expect(createLegacyRecordUid(10)).toBe(createLegacyRecordUid(10));
    expect(createLegacySnapshotId(staff.lecturerUid)).toBe(
      createLegacySnapshotId(staff.lecturerUid),
    );
    expect(createLegacyImportRunId("a".repeat(64))).toBe(
      createLegacyImportRunId("a".repeat(64)),
    );
  });

  it("preserves blank, empty, whitespace, Unicode, and deterministic IDs", async () => {
    const fixture = await createFixture([
      {
        stt: 1,
        staffCode: "CB-01",
        email: "one@example.edu",
        lecturerName: "Đặng Văn Một",
        unit: "  Đơn vị A  ",
        emptyText: "",
      },
      {
        stt: 3,
        staffCode: "CB-02",
        email: "two@example.edu",
        lecturerName: "Nguyễn Văn Hai",
        unit: null,
      },
    ]);
    const first = await prepareSourceBytes(
      fixture.bytes,
      fixture.contract.source_filename,
      fixture.contract,
    );
    const second = await prepareSourceBytes(
      fixture.bytes,
      fixture.contract.source_filename,
      fixture.contract,
    );

    expect(first.violations).toEqual([]);
    expect(first.rows).toHaveLength(2);
    expect(first.rows[0].businessValues.don_vi).toBe("  Đơn vị A  ");
    expect(first.rows[0].businessValues.bo_mon).toBe("");
    expect(first.rows[0].businessValues.khoi_kien_thuc).toBeNull();
    expect(first.datasetChecksum).toBe(second.datasetChecksum);
    expect(first.rows.map((row) => row.lecturerUid)).toEqual(
      second.rows.map((row) => row.lecturerUid),
    );
  });

  it("rejects numeric ma_so_can_bo without converting it", async () => {
    const fixture = await createFixture([
      {
        stt: 1,
        staffCode: 123,
        email: "one@example.edu",
        lecturerName: "Lecturer",
        unit: "Unit",
      },
    ]);
    const prepared = await prepareSourceBytes(
      fixture.bytes,
      fixture.contract.source_filename,
      fixture.contract,
    );

    expect(prepared.violations).toContainEqual(
      expect.objectContaining({
        code: "STAFF_CODE_MUST_BE_STRING_OR_NULL",
        sourceRowNumber: 2,
        stt: 1,
      }),
    );
  });

  it("rejects formula cells and never uses their calculated result", async () => {
    const fixture = await createFixture([
      {
        stt: 1,
        staffCode: "CB-01",
        email: "one@example.edu",
        lecturerName: "Lecturer",
        unit: "Unit",
        formula: true,
      },
    ]);
    const prepared = await prepareSourceBytes(
      fixture.bytes,
      fixture.contract.source_filename,
      fixture.contract,
    );

    expect(prepared.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "FORMULA_CELL_REJECTED" }),
      ]),
    );
  });

  it("fails an ambiguous unresolved identity-key collision", async () => {
    const fixture = await createFixture([
      {
        stt: 1,
        staffCode: null,
        email: null,
        lecturerName: "Nguyễn Văn A",
        unit: "Đơn vị A",
      },
      {
        stt: 2,
        staffCode: null,
        email: null,
        lecturerName: "  NGUYỄN  VĂN A  ",
        unit: "ĐƠN VỊ A",
      },
    ]);
    const prepared = await prepareSourceBytes(
      fixture.bytes,
      fixture.contract.source_filename,
      fixture.contract,
    );

    expect(
      prepared.violations.filter(
        (violation) => violation.code === "UNRESOLVED_IDENTITY_KEY_COLLISION",
      ),
    ).toHaveLength(2);
  });

  it("preserves every duplicate business row without merging", async () => {
    const fixture = await createFixture([
      {
        stt: 1,
        staffCode: "CB-01",
        email: "one@example.edu",
        lecturerName: "Lecturer",
        unit: "Unit",
        courseCode: "SAME-COURSE",
        courseName: "Same Course",
      },
      {
        stt: 2,
        staffCode: "CB-01",
        email: "one@example.edu",
        lecturerName: "Lecturer",
        unit: "Unit",
        courseCode: "SAME-COURSE",
        courseName: "Same Course",
      },
    ]);
    fixture.contract.expected_warning_counts.duplicate_business_groups = 1;
    fixture.contract.expected_warning_counts.duplicate_business_rows = 2;
    const prepared = await prepareSourceBytes(
      fixture.bytes,
      fixture.contract.source_filename,
      fixture.contract,
    );

    expect(prepared.violations).toEqual([]);
    expect(prepared.rows).toHaveLength(2);
    expect(prepared.rows[0].rowChecksum).not.toBe(prepared.rows[1].rowChecksum);
  });

  it("requires explicit import SHA confirmation matching contract and raw file", () => {
    const sha = "a".repeat(64);
    expect(() => validateConfirmedSha(sha, sha, sha)).not.toThrow();
    expect(() => validateConfirmedSha("b".repeat(64), sha, sha)).toThrow(
      /confirm-sha/u,
    );
    expect(() =>
      parsePipelineArguments(["--file", "source.xlsx"], {
        requireConfirmSha: true,
      }),
    ).toThrow(/confirm-sha/u);
  });

  it("keeps dry-run database-free and import guarded by one transaction", () => {
    expect(dryRunSource).not.toMatch(/Prisma|DATABASE_URL|from "pg"/u);
    expect(importSource).toContain("MIGRATION_DATABASE_URL");
    expect(importSource).toContain("pg_advisory_xact_lock");
    expect(importSource).toContain('client.query("BEGIN")');
    expect(importSource).toContain('client.query("COMMIT")');
    expect(importSource).toContain('client.query("ROLLBACK")');
    expect(importSource).not.toContain("skipDuplicates");
    expect(importSource).not.toMatch(/\bUPDATE\b|\bDELETE\b/u);
  });

  it("makes verification read-only and uses the runtime database URL", () => {
    expect(verifySource).toContain("BEGIN TRANSACTION READ ONLY");
    expect(verifySource).toContain("environment.DATABASE_URL");
    expect(verifySource).not.toMatch(
      /client\.query\([^)]*\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/su,
    );
  });

  it("verifies every business and technical value without exposing mismatches", async () => {
    const fixture = await createFixture([
      {
        stt: 1,
        staffCode: "CB-01",
        email: "private@example.edu",
        lecturerName: "Private Name",
        unit: "Unit",
      },
    ]);
    const prepared = await prepareSourceBytes(
      fixture.bytes,
      fixture.contract.source_filename,
      fixture.contract,
    );
    const snapshot = createMatchingSnapshot(prepared, fixture.contract);

    expect(
      comparePreparedSourceToDatabase(prepared, fixture.contract, snapshot),
    ).toEqual([]);

    snapshot.coreRows[0].ten_giang_vien = "Changed Private Name";
    const anomalies = comparePreparedSourceToDatabase(
      prepared,
      fixture.contract,
      snapshot,
    );
    expect(anomalies).toContainEqual(
      expect.objectContaining({
        code: "BUSINESS_VALUE_MISMATCH",
        column: "ten_giang_vien",
        sourceRowNumber: 2,
        stt: 1,
      }),
    );
    expect(JSON.stringify(anomalies)).not.toContain("Private Name");
    expect(JSON.stringify(anomalies)).not.toContain("private@example.edu");
  });

  it("keeps dry-run reports free of business values", async () => {
    const fixture = await createFixture([
      {
        stt: 1,
        staffCode: "SECRET-CODE",
        email: "secret@example.edu",
        lecturerName: "Secret Lecturer",
        unit: "Secret Unit",
      },
    ]);
    const prepared = await prepareSourceBytes(
      fixture.bytes,
      fixture.contract.source_filename,
      fixture.contract,
    );
    const serialized = JSON.stringify(
      createDryRunImportReport(
        prepared,
        fixture.contract,
        new Date("2026-07-15T00:00:00.000Z"),
      ),
    );

    expect(serialized).not.toContain("SECRET-CODE");
    expect(serialized).not.toContain("secret@example.edu");
    expect(serialized).not.toContain("Secret Lecturer");
    expect(serialized).not.toContain("Secret Unit");
  });
});

interface FixtureRow {
  stt: number;
  staffCode: string | number | null;
  email: string | null;
  lecturerName: string | null;
  unit: string | null;
  emptyText?: string;
  formula?: boolean;
  courseCode?: string;
  courseName?: string;
}

async function createFixture(rows: FixtureRow[]): Promise<{
  bytes: Buffer;
  contract: SourceContract;
}> {
  const contract = structuredClone(
    sourceContractJson,
  ) as unknown as SourceContract;
  contract.source_filename = "fixture.xlsx";
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet(contract.sheet_name);
  worksheet.addRow(contract.exact_header_order);

  const position = (column: string): number =>
    contract.column_mapping.find(
      (mapping) => mapping.postgresql_column === column,
    )!.position;
  for (const fixtureRow of rows) {
    const values = Array<ExcelJS.CellValue>(
      contract.exact_business_column_count,
    ).fill(null);
    values[position("stt") - 1] = fixtureRow.stt;
    values[position("ma_hoc_phan") - 1] =
      fixtureRow.courseCode ?? `HP-${fixtureRow.stt}`;
    values[position("ten_hoc_phan") - 1] =
      fixtureRow.courseName ?? `Course ${fixtureRow.stt}`;
    values[position("ten_giang_vien") - 1] = fixtureRow.lecturerName;
    values[position("ma_so_can_bo") - 1] = fixtureRow.staffCode;
    values[position("email_tai_khoan_vnu") - 1] = fixtureRow.email;
    values[position("don_vi") - 1] = fixtureRow.unit;
    if (fixtureRow.emptyText !== undefined) {
      values[position("bo_mon") - 1] = fixtureRow.emptyText;
    }
    const row = worksheet.addRow(values);
    if (fixtureRow.formula) {
      row.getCell(position("bo_mon")).value = { formula: "1+1", result: 2 };
    }
  }

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  contract.source_sha256 = sha256Bytes(bytes);
  const sttValues = rows.map((row) => row.stt);
  const minimum = Math.min(...sttValues);
  const maximum = Math.max(...sttValues);
  const distinct = new Set(sttValues);
  const missing: number[] = [];
  for (let stt = minimum; stt <= maximum; stt += 1) {
    if (!distinct.has(stt)) missing.push(stt);
  }
  contract.expected_data_row_count = rows.length;
  contract.stt.expected_min = minimum;
  contract.stt.expected_max = maximum;
  contract.stt.expected_distinct = distinct.size;
  contract.stt.expected_missing_within_range = missing;
  contract.stt.expected_missing_within_range_count = missing.length;
  contract.stt.expected_next = maximum + 1;
  contract.stt.duplicate_count = rows.length - distinct.size;
  contract.expected_warning_counts = {
    missing_staff_code_and_email_rows: rows.filter(
      (row) => row.staffCode === null && row.email === null,
    ).length,
    duplicate_business_groups: 0,
    duplicate_business_rows: 0,
    staff_name_variant_groups: 0,
    course_name_variant_groups: 0,
  };
  return { bytes, contract };
}

function createMatchingSnapshot(
  prepared: PreparedSource,
  contract: SourceContract,
): ImportDatabaseSnapshot {
  const importedAt = new Date("2026-07-15T00:00:00.000Z");
  return {
    importRuns: [
      {
        id: prepared.importRunId,
        source_filename: prepared.sourceFileName,
        source_sha256: prepared.sourceSha256,
        source_sheet: prepared.sheetName,
        source_contract_version: contract.contract_version,
        source_row_count: prepared.rows.length,
        source_min_stt: contract.stt.expected_min,
        source_max_stt: contract.stt.expected_max,
        canonical_dataset_sha256: prepared.datasetChecksum,
        imported_at: importedAt,
        created_at: importedAt,
      },
    ],
    coreRows: prepared.rows.map((row) => ({
      ...row.businessValues,
      lecturer_uid: row.lecturerUid,
      record_uid: row.recordUid,
      snapshot_id: row.snapshotId,
      version_no: 1,
      identity_status: row.identityStatus,
      source_row_number: row.sourceRowNumber,
      source_row_checksum: row.rowChecksum,
      source_import_run_id: prepared.importRunId,
      source_submission_id: null,
      approval_unit: row.businessValues.don_vi,
      origin: "LEGACY_IMPORT",
      approved_by: null,
      approved_at: importedAt,
      created_at: importedAt,
    })),
    workflowEventCount: 0,
    sequence: {
      start_value: contract.stt.expected_next,
      increment_by: 1,
      last_value: null,
    },
  };
}
