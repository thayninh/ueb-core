import { pathToFileURL } from "node:url";

import { parsePipelineArguments, PipelineCliError } from "./lib/cli";
import {
  createDryRunImportReport,
  writePhase2AuditReport,
} from "./lib/import-report";
import { prepareSourceFile } from "./lib/row-parser";
import { loadSourceContract } from "./lib/source-contract";

export async function runDryRunImport(
  filePath: string,
  requestedSheet?: string,
): Promise<{
  status: "PASS" | "FAIL";
  reportPath: string;
  rowCount: number;
  sourceSha256: string;
  datasetChecksum: string | null;
}> {
  const contract = await loadSourceContract();
  if (requestedSheet && requestedSheet !== contract.sheet_name) {
    throw new PipelineCliError(
      "Requested sheet does not match the approved source contract.",
    );
  }
  const prepared = await prepareSourceFile(filePath, contract);
  const generatedAt = new Date();
  const report = createDryRunImportReport(prepared, contract, generatedAt);
  const reportPath = await writePhase2AuditReport(
    "dry-run-import",
    report,
    generatedAt,
  );

  return {
    status: report.status,
    reportPath,
    rowCount: prepared.inspection.data_row_count,
    sourceSha256: prepared.sourceSha256,
    datasetChecksum:
      prepared.violations.length === 0 ? prepared.datasetChecksum : null,
  };
}

async function main(): Promise<void> {
  try {
    const arguments_ = parsePipelineArguments(process.argv.slice(2), {
      requireConfirmSha: false,
      allowSheet: true,
    });
    const result = await runDryRunImport(
      arguments_.filePath,
      arguments_.sheetName,
    );
    const output = {
      status: result.status,
      reportPath: result.reportPath,
      rowCount: result.rowCount,
      sourceSha256: result.sourceSha256,
      datasetChecksum: result.datasetChecksum,
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
        message: "Dry-run failed safely. No database connection was created.",
      }),
    );
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
