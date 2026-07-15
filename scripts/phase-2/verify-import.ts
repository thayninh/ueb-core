import "dotenv/config";

import { pathToFileURL } from "node:url";

import { Client, type ClientBase } from "pg";

import { calculateDatasetChecksum } from "./lib/canonicalize";
import { parsePipelineArguments } from "./lib/cli";
import { writePhase2AuditReport } from "./lib/import-report";
import {
  prepareSourceFile,
  type PreparedSource,
  type SafeSourceAnomaly,
} from "./lib/row-parser";
import { loadSourceContract, type SourceContract } from "./lib/source-contract";

interface ImportRunDatabaseRow {
  id: string;
  source_filename: string;
  source_sha256: string;
  source_sheet: string;
  source_contract_version: string;
  source_row_count: number;
  source_min_stt: number;
  source_max_stt: number;
  canonical_dataset_sha256: string;
  imported_at: Date;
  created_at: Date;
}

interface SequenceDatabaseState {
  start_value: string | number;
  increment_by: string | number;
  last_value: string | number | null;
}

export interface ImportDatabaseSnapshot {
  importRuns: ImportRunDatabaseRow[];
  coreRows: Array<Record<string, unknown>>;
  workflowEventCount: number;
  sequence: SequenceDatabaseState | null;
}

interface VerificationReport {
  reportVersion: 1;
  reportType: "VERIFY_IMPORT";
  status: "PASS" | "FAIL";
  generatedAtUtc: string;
  sourceSha256: string;
  sourceDatasetSha256: string;
  databaseDatasetSha256: string | null;
  expectedRowCount: number;
  databaseRowCount: number;
  verifiedBusinessColumnCount: number;
  unresolvedRowCount: { source: number; database: number };
  duplicateBusinessRows: {
    sourceGroups: number;
    sourceRows: number;
    databaseGroups: number;
    databaseRows: number;
  };
  workflowEventCount: number;
  identitySequence: {
    expectedStart: number;
    actualStart: number | null;
    lastValue: number | null;
    unconsumed: boolean;
  };
  anomalies: SafeSourceAnomaly[];
  privacy: { containsBusinessValues: false };
}

export async function runVerifyImport(filePath: string): Promise<{
  status: "PASS" | "FAIL";
  reportPath: string;
  anomalyCount: number;
}> {
  const contract = await loadSourceContract();
  const prepared = await prepareSourceFile(filePath, contract);
  const generatedAt = new Date();
  let snapshot: ImportDatabaseSnapshot = {
    importRuns: [],
    coreRows: [],
    workflowEventCount: -1,
    sequence: null,
  };
  let databaseFailure = false;

  if (prepared.violations.length === 0) {
    try {
      snapshot = await readImportDatabaseSnapshot(contract);
    } catch {
      databaseFailure = true;
    }
  }

  const anomalies = [
    ...prepared.violations,
    ...(databaseFailure
      ? [{ code: "DATABASE_READ_FAILED" }]
      : comparePreparedSourceToDatabase(prepared, contract, snapshot)),
  ];
  const databaseDatasetSha256 =
    snapshot.coreRows.length > 0
      ? calculateDatasetChecksum(
          snapshot.coreRows
            .filter(
              (row) =>
                typeof row.stt === "number" &&
                typeof row.source_row_checksum === "string",
            )
            .map((row) => ({
              stt: row.stt as number,
              rowChecksum: row.source_row_checksum as string,
            })),
        )
      : null;
  const databaseUnresolved = snapshot.coreRows.filter(
    (row) => row.identity_status === "UNRESOLVED",
  ).length;
  const databaseDuplicateMetrics = calculateDuplicateBusinessMetrics(
    snapshot.coreRows,
    contract,
  );
  const actualSequenceStart = snapshot.sequence
    ? Number(snapshot.sequence.start_value)
    : null;
  const lastValue =
    snapshot.sequence?.last_value === null || snapshot.sequence === null
      ? null
      : Number(snapshot.sequence.last_value);
  const report: VerificationReport = {
    reportVersion: 1,
    reportType: "VERIFY_IMPORT",
    status: anomalies.length === 0 ? "PASS" : "FAIL",
    generatedAtUtc: generatedAt.toISOString(),
    sourceSha256: prepared.sourceSha256,
    sourceDatasetSha256: prepared.datasetChecksum,
    databaseDatasetSha256,
    expectedRowCount: contract.expected_data_row_count,
    databaseRowCount: snapshot.coreRows.length,
    verifiedBusinessColumnCount: contract.exact_business_column_count,
    unresolvedRowCount: {
      source: prepared.unresolvedRowCount,
      database: databaseUnresolved,
    },
    duplicateBusinessRows: {
      sourceGroups:
        prepared.inspection.duplicate_business_row_groups.group_count,
      sourceRows: prepared.inspection.duplicate_business_row_groups.row_count,
      databaseGroups: databaseDuplicateMetrics.groupCount,
      databaseRows: databaseDuplicateMetrics.rowCount,
    },
    workflowEventCount: snapshot.workflowEventCount,
    identitySequence: {
      expectedStart: contract.stt.expected_next,
      actualStart: actualSequenceStart,
      lastValue,
      unconsumed: lastValue === null,
    },
    anomalies,
    privacy: { containsBusinessValues: false },
  };
  const reportPath = await writePhase2AuditReport(
    "verify-import",
    report,
    generatedAt,
  );
  return {
    status: report.status,
    reportPath,
    anomalyCount: anomalies.length,
  };
}

async function readImportDatabaseSnapshot(
  contract: SourceContract,
): Promise<ImportDatabaseSnapshot> {
  const databaseUrl = readRuntimeDatabaseUrl(process.env);
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "ueb-core-import-verification",
  });
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    const snapshot = await queryDatabaseSnapshot(client, contract);
    await client.query("COMMIT");
    return snapshot;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function queryDatabaseSnapshot(
  client: ClientBase,
  contract: SourceContract,
): Promise<ImportDatabaseSnapshot> {
  const businessColumns = contract.column_mapping
    .map((column) => quoteIdentifier(column.postgresql_column))
    .join(", ");
  const importRuns = await client.query<ImportRunDatabaseRow>(
    `
      SELECT
        id,
        source_filename,
        source_sha256,
        source_sheet,
        source_contract_version,
        source_row_count,
        source_min_stt,
        source_max_stt,
        canonical_dataset_sha256,
        imported_at,
        created_at
      FROM import_run
      WHERE source_sha256 = $1
    `,
    [contract.source_sha256],
  );
  const coreRows = await client.query<Record<string, unknown>>(`
    SELECT
      ${businessColumns},
      lecturer_uid,
      record_uid,
      snapshot_id,
      version_no,
      identity_status,
      source_row_number,
      source_row_checksum,
      source_import_run_id,
      source_submission_id,
      approval_unit,
      origin,
      approved_by,
      approved_at,
      created_at
    FROM ueb_core_data
    ORDER BY stt ASC
  `);
  const workflowEvents = await client.query<{ row_count: number }>(
    "SELECT count(*)::integer AS row_count FROM workflow_event",
  );
  const sequence = await client.query<SequenceDatabaseState>(`
    SELECT start_value, increment_by, last_value
    FROM pg_sequences
    WHERE schemaname = 'public'
      AND sequencename = 'ueb_core_data_stt_seq'
  `);
  return {
    importRuns: importRuns.rows,
    coreRows: coreRows.rows,
    workflowEventCount: workflowEvents.rows[0]?.row_count ?? -1,
    sequence: sequence.rows[0] ?? null,
  };
}

export function comparePreparedSourceToDatabase(
  prepared: PreparedSource,
  contract: SourceContract,
  snapshot: ImportDatabaseSnapshot,
): SafeSourceAnomaly[] {
  const anomalies: SafeSourceAnomaly[] = [];
  const add = (anomaly: SafeSourceAnomaly): void => {
    anomalies.push(anomaly);
  };
  const importRun = snapshot.importRuns[0];

  if (snapshot.importRuns.length !== 1)
    add({ code: "IMPORT_RUN_COUNT_MISMATCH" });
  if (!importRun) {
    add({ code: "IMPORT_RUN_MISSING" });
  } else {
    const metadataChecks: Array<[boolean, string]> = [
      [importRun.id === prepared.importRunId, "IMPORT_RUN_ID_MISMATCH"],
      [
        importRun.source_filename === prepared.sourceFileName,
        "IMPORT_RUN_FILENAME_MISMATCH",
      ],
      [
        importRun.source_sha256 === prepared.sourceSha256,
        "IMPORT_RUN_SOURCE_SHA_MISMATCH",
      ],
      [
        importRun.source_sheet === prepared.sheetName,
        "IMPORT_RUN_SHEET_MISMATCH",
      ],
      [
        importRun.source_contract_version === contract.contract_version,
        "IMPORT_RUN_CONTRACT_VERSION_MISMATCH",
      ],
      [
        importRun.source_row_count === prepared.rows.length,
        "IMPORT_RUN_ROW_COUNT_MISMATCH",
      ],
      [
        importRun.source_min_stt === contract.stt.expected_min,
        "IMPORT_RUN_MIN_STT_MISMATCH",
      ],
      [
        importRun.source_max_stt === contract.stt.expected_max,
        "IMPORT_RUN_MAX_STT_MISMATCH",
      ],
      [
        importRun.canonical_dataset_sha256 === prepared.datasetChecksum,
        "IMPORT_RUN_DATASET_SHA_MISMATCH",
      ],
      [
        importRun.imported_at.getTime() === importRun.created_at.getTime(),
        "IMPORT_RUN_TIMESTAMP_MISMATCH",
      ],
    ];
    for (const [passes, code] of metadataChecks) if (!passes) add({ code });
  }

  if (snapshot.coreRows.length !== prepared.rows.length) {
    add({ code: "DATABASE_ROW_COUNT_MISMATCH" });
  }
  const sourceByStt = new Map(prepared.rows.map((row) => [row.stt, row]));
  const databaseByStt = new Map<number, Record<string, unknown>>();
  for (const databaseRow of snapshot.coreRows) {
    if (typeof databaseRow.stt !== "number") {
      add({ code: "DATABASE_STT_TYPE_INVALID" });
      continue;
    }
    databaseByStt.set(databaseRow.stt, databaseRow);
  }

  for (const sourceRow of prepared.rows) {
    const databaseRow = databaseByStt.get(sourceRow.stt);
    const reference = {
      sourceRowNumber: sourceRow.sourceRowNumber,
      stt: sourceRow.stt,
      rowChecksum: sourceRow.rowChecksum,
    };
    if (!databaseRow) {
      add({ code: "DATABASE_ROW_MISSING", ...reference });
      continue;
    }

    for (const column of contract.column_mapping) {
      if (
        databaseRow[column.postgresql_column] !==
        sourceRow.businessValues[column.postgresql_column]
      ) {
        add({
          code: "BUSINESS_VALUE_MISMATCH",
          column: column.postgresql_column,
          ...reference,
        });
      }
    }

    const technicalChecks: Array<[boolean, string]> = [
      [
        databaseRow.source_row_checksum === sourceRow.rowChecksum,
        "ROW_CHECKSUM_MISMATCH",
      ],
      [
        databaseRow.source_row_number === sourceRow.sourceRowNumber,
        "SOURCE_ROW_NUMBER_MISMATCH",
      ],
      [
        databaseRow.lecturer_uid === sourceRow.lecturerUid,
        "LECTURER_UID_MISMATCH",
      ],
      [databaseRow.record_uid === sourceRow.recordUid, "RECORD_UID_MISMATCH"],
      [
        databaseRow.snapshot_id === sourceRow.snapshotId,
        "SNAPSHOT_ID_MISMATCH",
      ],
      [databaseRow.version_no === 1, "VERSION_NO_MISMATCH"],
      [
        databaseRow.identity_status === sourceRow.identityStatus,
        "IDENTITY_STATUS_MISMATCH",
      ],
      [
        databaseRow.source_import_run_id === prepared.importRunId,
        "SOURCE_IMPORT_RUN_ID_MISMATCH",
      ],
      [databaseRow.source_submission_id === null, "SOURCE_SUBMISSION_NOT_NULL"],
      [
        databaseRow.approval_unit === sourceRow.businessValues.don_vi,
        "APPROVAL_UNIT_MISMATCH",
      ],
      [databaseRow.origin === "LEGACY_IMPORT", "ORIGIN_MISMATCH"],
      [databaseRow.approved_by === null, "APPROVED_BY_NOT_NULL"],
    ];
    if (importRun) {
      technicalChecks.push(
        [
          databaseRow.approved_at instanceof Date &&
            databaseRow.approved_at.getTime() ===
              importRun.imported_at.getTime(),
          "APPROVED_AT_MISMATCH",
        ],
        [
          databaseRow.created_at instanceof Date &&
            databaseRow.created_at.getTime() ===
              importRun.imported_at.getTime(),
          "CREATED_AT_MISMATCH",
        ],
      );
    }
    for (const [passes, code] of technicalChecks) {
      if (!passes) add({ code, ...reference });
    }
  }

  for (const [stt, databaseRow] of databaseByStt) {
    if (!sourceByStt.has(stt)) {
      add({
        code: "DATABASE_ROW_NOT_IN_SOURCE",
        stt,
        rowChecksum:
          typeof databaseRow.source_row_checksum === "string"
            ? databaseRow.source_row_checksum
            : undefined,
      });
    }
  }

  const databaseDatasetChecksum = calculateDatasetChecksum(
    snapshot.coreRows
      .filter(
        (row) =>
          typeof row.stt === "number" &&
          typeof row.source_row_checksum === "string",
      )
      .map((row) => ({
        stt: row.stt as number,
        rowChecksum: row.source_row_checksum as string,
      })),
  );
  if (databaseDatasetChecksum !== prepared.datasetChecksum) {
    add({ code: "DATABASE_DATASET_SHA_MISMATCH" });
  }
  const duplicateMetrics = calculateDuplicateBusinessMetrics(
    snapshot.coreRows,
    contract,
  );
  if (
    duplicateMetrics.groupCount !==
    contract.expected_warning_counts.duplicate_business_groups
  ) {
    add({ code: "DATABASE_DUPLICATE_GROUP_COUNT_MISMATCH" });
  }
  if (
    duplicateMetrics.rowCount !==
    contract.expected_warning_counts.duplicate_business_rows
  ) {
    add({ code: "DATABASE_DUPLICATE_ROW_COUNT_MISMATCH" });
  }
  if (snapshot.workflowEventCount !== 0) {
    add({ code: "WORKFLOW_EVENT_NOT_EMPTY" });
  }
  if (!snapshot.sequence) {
    add({ code: "IDENTITY_SEQUENCE_MISSING" });
  } else {
    if (Number(snapshot.sequence.start_value) !== contract.stt.expected_next) {
      add({ code: "IDENTITY_SEQUENCE_START_MISMATCH" });
    }
    if (Number(snapshot.sequence.increment_by) !== 1) {
      add({ code: "IDENTITY_SEQUENCE_INCREMENT_MISMATCH" });
    }
    if (snapshot.sequence.last_value !== null) {
      add({ code: "IDENTITY_SEQUENCE_ALREADY_CONSUMED" });
    }
  }
  return anomalies;
}

function calculateDuplicateBusinessMetrics(
  rows: Array<Record<string, unknown>>,
  contract: SourceContract,
): { groupCount: number; rowCount: number } {
  const columns = contract.column_mapping.filter(
    (column) => column.postgresql_column !== "stt",
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    const encoded = columns.map((column) => {
      const value = row[column.postgresql_column];
      if (value === null) return ["null"];
      return [typeof value, value];
    });
    const key = JSON.stringify(encoded);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicateCounts = [...counts.values()].filter((count) => count > 1);
  return {
    groupCount: duplicateCounts.length,
    rowCount: duplicateCounts.reduce((total, count) => total + count, 0),
  };
}

function readRuntimeDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const value = environment.DATABASE_URL;
  if (!value) throw new Error("Runtime DATABASE_URL is required.");
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Runtime DATABASE_URL must use PostgreSQL.");
  }
  return value;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(identifier)) {
    throw new Error("Unsafe source-contract PostgreSQL identifier.");
  }
  return `"${identifier}"`;
}

async function main(): Promise<void> {
  try {
    const arguments_ = parsePipelineArguments(process.argv.slice(2), {
      requireConfirmSha: false,
    });
    const result = await runVerifyImport(arguments_.filePath);
    const output = {
      status: result.status,
      reportPath: result.reportPath,
      anomalyCount: result.anomalyCount,
    };
    if (result.status === "PASS") {
      console.log(JSON.stringify(output));
      return;
    }
    console.error(JSON.stringify(output));
    process.exitCode = 2;
  } catch {
    console.error(
      JSON.stringify({
        status: "ERROR",
        message: "Import verification failed safely; no credential was logged.",
      }),
    );
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
