import "dotenv/config";

import { pathToFileURL } from "node:url";

import { Client, type ClientBase } from "pg";

import {
  assertRequestedSheetMatchesContract,
  parsePipelineArguments,
} from "./lib/cli";
import {
  createDryRunImportReport,
  writePhase2AuditReport,
  type DryRunImportReport,
} from "./lib/import-report";
import {
  prepareSourceFile,
  type PreparedSource,
  type PreparedSourceRow,
} from "./lib/row-parser";
import { loadSourceContract, type SourceContract } from "./lib/source-contract";

const IMPORT_LOCK_NAME = "ueb-core-phase-2-legacy-import";
const INSERT_BATCH_SIZE = 200;

interface ImportExecutionReport {
  reportVersion: 1;
  reportType: "CONTROLLED_IMPORT";
  status: "COMMITTED" | "REJECTED" | "ROLLED_BACK";
  generatedAtUtc: string;
  importRunId: string;
  sourceSha256: string;
  datasetSha256: string;
  expectedRowCount: number;
  insertedRowCount: number;
  failureCode: string | null;
  dryRun: DryRunImportReport;
  privacy: { containsBusinessValues: false };
}

export interface ControlledImportResult {
  status: ImportExecutionReport["status"];
  reportPath: string;
  importRunId: string;
  insertedRowCount: number;
  failureCode: string | null;
}

export function validateConfirmedSha(
  confirmSha: string,
  contractSha: string,
  rawFileSha: string,
): void {
  if (confirmSha !== contractSha || confirmSha !== rawFileSha) {
    throw new ControlledImportError(
      "CONFIRM_SHA_MISMATCH",
      "--confirm-sha must match both the source contract and raw file.",
    );
  }
}

export async function runControlledImport(
  filePath: string,
  confirmSha: string,
  requestedSheet?: string,
): Promise<ControlledImportResult> {
  const contract = await loadSourceContract();
  assertRequestedSheetMatchesContract(requestedSheet, contract.sheet_name);
  const prepared = await prepareSourceFile(filePath, contract);
  const generatedAt = new Date();
  const dryRun = createDryRunImportReport(prepared, contract, generatedAt);

  try {
    validateConfirmedSha(
      confirmSha,
      contract.source_sha256,
      prepared.sourceSha256,
    );
  } catch (error) {
    return writeImportOutcome(
      prepared,
      contract,
      dryRun,
      generatedAt,
      "REJECTED",
      0,
      safeImportCode(error),
    );
  }

  if (prepared.violations.length > 0) {
    return writeImportOutcome(
      prepared,
      contract,
      dryRun,
      generatedAt,
      "REJECTED",
      0,
      "SOURCE_CONTRACT_VIOLATION",
    );
  }

  const migrationDatabaseUrl = readMigrationDatabaseUrl(process.env);
  const client = new Client({
    connectionString: migrationDatabaseUrl,
    application_name: "ueb-core-controlled-import",
  });
  let transactionStarted = false;

  try {
    await client.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [IMPORT_LOCK_NAME],
    );
    await assertDatabaseReadyForImport(client, prepared.sourceSha256);

    const databaseReport = createDatabaseImportRecord(
      prepared,
      contract,
      dryRun,
      generatedAt,
    );
    await insertImportRun(
      client,
      prepared,
      contract,
      generatedAt,
      databaseReport,
    );
    await insertCoreRows(client, prepared, contract, generatedAt);
    await assertInsertedRowCount(client, prepared);

    await client.query("COMMIT");
    transactionStarted = false;
    return writeImportOutcome(
      prepared,
      contract,
      dryRun,
      generatedAt,
      "COMMITTED",
      prepared.rows.length,
      null,
    );
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    return writeImportOutcome(
      prepared,
      contract,
      dryRun,
      generatedAt,
      "ROLLED_BACK",
      0,
      safeImportCode(error),
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

function readMigrationDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const value = environment.MIGRATION_DATABASE_URL;
  if (!value) {
    throw new ControlledImportError(
      "MIGRATION_DATABASE_URL_MISSING",
      "MIGRATION_DATABASE_URL is required for data:import.",
    );
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new ControlledImportError(
      "MIGRATION_DATABASE_URL_INVALID",
      "MIGRATION_DATABASE_URL must be a PostgreSQL URL.",
    );
  }
  return value;
}

async function assertDatabaseReadyForImport(
  client: ClientBase,
  sourceSha256: string,
): Promise<void> {
  const coreCount = await client.query<{ row_count: number }>(
    "SELECT count(*)::integer AS row_count FROM ueb_core_data",
  );
  if ((coreCount.rows[0]?.row_count ?? -1) !== 0) {
    throw new ControlledImportError(
      "CORE_TABLE_NOT_EMPTY",
      "ueb_core_data must be empty before the initial legacy import.",
    );
  }

  const importedSource = await client.query<{ source_exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM import_run WHERE source_sha256 = $1) AS source_exists",
    [sourceSha256],
  );
  if (importedSource.rows[0]?.source_exists) {
    throw new ControlledImportError(
      "SOURCE_ALREADY_IMPORTED",
      "The source SHA-256 already exists in import_run.",
    );
  }
}

function createDatabaseImportRecord(
  prepared: PreparedSource,
  contract: SourceContract,
  dryRun: DryRunImportReport,
  generatedAt: Date,
): ImportExecutionReport {
  return {
    reportVersion: 1,
    reportType: "CONTROLLED_IMPORT",
    status: "COMMITTED",
    generatedAtUtc: generatedAt.toISOString(),
    importRunId: prepared.importRunId,
    sourceSha256: prepared.sourceSha256,
    datasetSha256: prepared.datasetChecksum,
    expectedRowCount: contract.expected_data_row_count,
    insertedRowCount: prepared.rows.length,
    failureCode: null,
    dryRun,
    privacy: { containsBusinessValues: false },
  };
}

async function insertImportRun(
  client: ClientBase,
  prepared: PreparedSource,
  contract: SourceContract,
  importTimestamp: Date,
  report: ImportExecutionReport,
): Promise<void> {
  await client.query(
    `
      INSERT INTO import_run (
        id,
        source_filename,
        source_sha256,
        source_sheet,
        source_contract_version,
        source_row_count,
        source_min_stt,
        source_max_stt,
        canonical_dataset_sha256,
        report,
        imported_at,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $11)
    `,
    [
      prepared.importRunId,
      prepared.sourceFileName,
      prepared.sourceSha256,
      prepared.sheetName,
      contract.contract_version,
      prepared.rows.length,
      contract.stt.expected_min,
      contract.stt.expected_max,
      prepared.datasetChecksum,
      JSON.stringify(report),
      importTimestamp,
    ],
  );
}

async function insertCoreRows(
  client: ClientBase,
  prepared: PreparedSource,
  contract: SourceContract,
  importTimestamp: Date,
): Promise<void> {
  const businessColumns = contract.column_mapping.map(
    (column) => column.postgresql_column,
  );
  const technicalColumns = [
    "lecturer_uid",
    "record_uid",
    "snapshot_id",
    "version_no",
    "identity_status",
    "source_row_number",
    "source_row_checksum",
    "source_import_run_id",
    "source_submission_id",
    "approval_unit",
    "origin",
    "approved_by",
    "approved_at",
    "created_at",
  ];
  const allColumns = [...businessColumns, ...technicalColumns];
  const quotedColumns = allColumns.map(quoteIdentifier).join(", ");

  for (
    let offset = 0;
    offset < prepared.rows.length;
    offset += INSERT_BATCH_SIZE
  ) {
    const batch = prepared.rows.slice(offset, offset + INSERT_BATCH_SIZE);
    const values: unknown[] = [];
    const tuples = batch.map((row) => {
      const rowValues = coreRowValues(
        row,
        contract,
        prepared.importRunId,
        importTimestamp,
      );
      const placeholders = rowValues.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });

    await client.query(
      `INSERT INTO ueb_core_data (${quotedColumns}) VALUES ${tuples.join(", ")}`,
      values,
    );
  }
}

function coreRowValues(
  row: PreparedSourceRow,
  contract: SourceContract,
  importRunId: string,
  importTimestamp: Date,
): unknown[] {
  return [
    ...contract.column_mapping.map(
      (column) => row.businessValues[column.postgresql_column],
    ),
    row.lecturerUid,
    row.recordUid,
    row.snapshotId,
    1,
    row.identityStatus,
    row.sourceRowNumber,
    row.rowChecksum,
    importRunId,
    null,
    row.businessValues.don_vi,
    "LEGACY_IMPORT",
    null,
    importTimestamp,
    importTimestamp,
  ];
}

async function assertInsertedRowCount(
  client: ClientBase,
  prepared: PreparedSource,
): Promise<void> {
  const result = await client.query<{ row_count: number }>(
    `
      SELECT count(*)::integer AS row_count
      FROM ueb_core_data
      WHERE source_import_run_id = $1
    `,
    [prepared.importRunId],
  );
  if (result.rows[0]?.row_count !== prepared.rows.length) {
    throw new ControlledImportError(
      "INSERTED_ROW_COUNT_MISMATCH",
      "Inserted row count does not match the validated source.",
    );
  }
}

async function writeImportOutcome(
  prepared: PreparedSource,
  contract: SourceContract,
  dryRun: DryRunImportReport,
  generatedAt: Date,
  status: ImportExecutionReport["status"],
  insertedRowCount: number,
  failureCode: string | null,
): Promise<ControlledImportResult> {
  const report: ImportExecutionReport = {
    reportVersion: 1,
    reportType: "CONTROLLED_IMPORT",
    status,
    generatedAtUtc: generatedAt.toISOString(),
    importRunId: prepared.importRunId,
    sourceSha256: prepared.sourceSha256,
    datasetSha256: prepared.datasetChecksum,
    expectedRowCount: contract.expected_data_row_count,
    insertedRowCount,
    failureCode,
    dryRun,
    privacy: { containsBusinessValues: false },
  };
  const reportPath = await writePhase2AuditReport(
    "import",
    report,
    generatedAt,
  );
  return {
    status,
    reportPath,
    importRunId: prepared.importRunId,
    insertedRowCount,
    failureCode,
  };
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(identifier)) {
    throw new ControlledImportError(
      "UNSAFE_DATABASE_IDENTIFIER",
      "Source contract contains an unsafe PostgreSQL identifier.",
    );
  }
  return `"${identifier}"`;
}

function safeImportCode(error: unknown): string {
  return error instanceof ControlledImportError
    ? error.code
    : "DATABASE_OPERATION_FAILED";
}

export class ControlledImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ControlledImportError";
  }
}

async function main(): Promise<void> {
  try {
    const arguments_ = parsePipelineArguments(process.argv.slice(2), {
      requireConfirmSha: true,
      allowSheet: true,
    });
    const result = await runControlledImport(
      arguments_.filePath,
      arguments_.confirmSha!,
      arguments_.sheetName,
    );
    const output = {
      status: result.status,
      reportPath: result.reportPath,
      importRunId: result.importRunId,
      insertedRowCount: result.insertedRowCount,
      failureCode: result.failureCode,
    };
    if (result.status === "COMMITTED") {
      console.log(JSON.stringify(output));
      return;
    }
    console.error(JSON.stringify(output));
    process.exitCode = 2;
  } catch {
    console.error(
      JSON.stringify({
        status: "ERROR",
        message: "Controlled import failed safely; no credential was logged.",
      }),
    );
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
