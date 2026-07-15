import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Client, type ClientBase } from "pg";

import {
  inspectIdentitySource,
  loadIdentityColumnMetadata,
  loadOptionalUnitLeaderConfiguration,
  queryIdentitySourceRows,
  readRuntimeDatabaseUrl,
  type IdentityColumnMetadata,
  type IdentityInspectionReport,
  type IdentitySourceRow,
} from "./lib/identity-inspection";

const AUDIT_ROOT = resolve("infra", "audit", "phase-3");

export async function runIdentitySourceInspection(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  generatedAt = new Date(),
): Promise<{
  report: IdentityInspectionReport;
  reportPath: string;
}> {
  const databaseUrl = readRuntimeDatabaseUrl(environment);
  const [metadata, leaderConfiguration] = await Promise.all([
    loadIdentityColumnMetadata(),
    loadOptionalUnitLeaderConfiguration(),
  ]);
  const rows = await readIdentityRowsInReadOnlyTransaction(
    databaseUrl,
    metadata,
  );
  const report = inspectIdentitySource(rows, {
    metadata,
    leaderConfiguration,
    generatedAt,
  });
  const reportPath = await writeIdentityInspectionReport(report, generatedAt);
  return { report, reportPath };
}

export async function queryRowsInVerifiedReadOnlyTransaction(
  client: ClientBase,
  metadata: IdentityColumnMetadata,
): Promise<IdentitySourceRow[]> {
  await client.query(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  try {
    const transactionMode = await client.query<{
      transaction_read_only: string;
    }>(
      "SELECT current_setting('transaction_read_only') AS transaction_read_only",
    );
    if (transactionMode.rows[0]?.transaction_read_only !== "on") {
      throw new Error("Identity inspection transaction is not read-only.");
    }
    const rows = await queryIdentitySourceRows(client, metadata);
    await client.query("COMMIT");
    return rows;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function readIdentityRowsInReadOnlyTransaction(
  databaseUrl: string,
  metadata: IdentityColumnMetadata,
): Promise<IdentitySourceRow[]> {
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "ueb-core-phase-3-identity-inspection",
  });
  try {
    await client.connect();
    return await queryRowsInVerifiedReadOnlyTransaction(client, metadata);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function writeIdentityInspectionReport(
  report: IdentityInspectionReport,
  generatedAt: Date,
): Promise<string> {
  const timestamp = generatedAt
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "");
  const directory = join(AUDIT_ROOT, timestamp);
  const reportPath = join(directory, "identity-inspection.json");
  await mkdir(directory, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return reportPath;
}

async function main(): Promise<void> {
  try {
    const { report, reportPath } = await runIdentitySourceInspection();
    const output = {
      status: report.status,
      reportPath,
      blockingErrorCount: report.blocking_errors.length,
      warningCount: report.warnings.length,
    };
    if (report.status === "PASS") {
      console.log(JSON.stringify(output));
      return;
    }
    console.error(JSON.stringify(output));
    process.exitCode = 2;
  } catch {
    console.error(
      JSON.stringify({
        status: "ERROR",
        message:
          "Identity source inspection failed safely; no credential or identity value was logged.",
      }),
    );
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
