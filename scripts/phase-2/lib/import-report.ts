import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  CANONICALIZATION_VERSION,
  DATASET_CANONICALIZATION_VERSION,
} from "./canonicalize";
import { LEGACY_IDENTITY_NAMESPACES } from "./identity";
import type { PreparedSource, SafeSourceAnomaly } from "./row-parser";
import type { SourceContract } from "./source-contract";

export type PipelineReportKind =
  "column-profile" | "dry-run-import" | "import" | "verify-import";

export interface DryRunImportReport {
  reportVersion: 1;
  reportType: "DRY_RUN_IMPORT";
  status: "PASS" | "FAIL";
  generatedAtUtc: string;
  source: {
    fileName: string;
    rawSha256: string;
    sheetName: string;
    headerCount: number;
    dataRowCount: number;
    canonicalRowCount: number;
  };
  contract: {
    version: string;
    sourceSha256: string;
    expectedDataRowCount: number;
  };
  canonical: {
    rowVersion: string;
    datasetVersion: string;
    datasetSha256: string | null;
  };
  technicalIds: {
    deterministic: true;
    algorithm: "UUID_V5";
    namespaces: typeof LEGACY_IDENTITY_NAMESPACES;
  };
  identity: {
    unresolvedRowCount: number;
    unresolvedGroupCount: number;
  };
  warnings: {
    missingStaffCodeAndEmailRows: number;
    duplicateBusinessGroups: number;
    duplicateBusinessRows: number;
    staffNameVariantGroups: number;
    courseNameVariantGroups: number;
  };
  dateValidation: {
    checkedCellCount: number;
    validDateTextCount: number;
    statusTextCount: number;
    blankCount: number;
    invalidDateCount: number;
  };
  violations: SafeSourceAnomaly[];
  privacy: {
    containsBusinessValues: false;
    anomalyFields: string[];
  };
}

export function createDryRunImportReport(
  prepared: PreparedSource,
  contract: SourceContract,
  generatedAt = new Date(),
): DryRunImportReport {
  return {
    reportVersion: 1,
    reportType: "DRY_RUN_IMPORT",
    status: prepared.violations.length === 0 ? "PASS" : "FAIL",
    generatedAtUtc: generatedAt.toISOString(),
    source: {
      fileName: prepared.sourceFileName,
      rawSha256: prepared.sourceSha256,
      sheetName: prepared.sheetName,
      headerCount: prepared.headers.length,
      dataRowCount: prepared.inspection.data_row_count,
      canonicalRowCount: prepared.rows.length,
    },
    contract: {
      version: contract.contract_version,
      sourceSha256: contract.source_sha256,
      expectedDataRowCount: contract.expected_data_row_count,
    },
    canonical: {
      rowVersion: CANONICALIZATION_VERSION,
      datasetVersion: DATASET_CANONICALIZATION_VERSION,
      datasetSha256:
        prepared.violations.length === 0 ? prepared.datasetChecksum : null,
    },
    technicalIds: {
      deterministic: true,
      algorithm: "UUID_V5",
      namespaces: LEGACY_IDENTITY_NAMESPACES,
    },
    identity: {
      unresolvedRowCount: prepared.unresolvedRowCount,
      unresolvedGroupCount: prepared.unresolvedGroupCount,
    },
    warnings: {
      missingStaffCodeAndEmailRows:
        prepared.inspection.missing_staff_code_and_email,
      duplicateBusinessGroups:
        prepared.inspection.duplicate_business_row_groups.group_count,
      duplicateBusinessRows:
        prepared.inspection.duplicate_business_row_groups.row_count,
      staffNameVariantGroups: prepared.inspection.staff_name_variant_groups,
      courseNameVariantGroups: prepared.inspection.course_name_variant_groups,
    },
    dateValidation: {
      checkedCellCount: prepared.inspection.date_validation.checked_cell_count,
      validDateTextCount:
        prepared.inspection.date_validation.valid_date_text_count,
      statusTextCount: prepared.inspection.date_validation.status_text_count,
      blankCount: prepared.inspection.date_validation.blank_count,
      invalidDateCount: prepared.inspection.date_validation.invalid_date_count,
    },
    violations: prepared.violations,
    privacy: {
      containsBusinessValues: false,
      anomalyFields: [
        "code",
        "sourceRowNumber",
        "stt",
        "rowChecksum",
        "column",
      ],
    },
  };
}

export async function writePhase2AuditReport(
  kind: PipelineReportKind,
  report: unknown,
  generatedAt = new Date(),
  auditRoot = resolve("infra", "audit", "phase-2"),
): Promise<string> {
  const timestamp = generatedAt
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "");
  const directory = join(auditRoot, timestamp);
  const reportPath = join(directory, `${kind}.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return reportPath;
}
