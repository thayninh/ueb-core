import { pathToFileURL } from "node:url";

import {
  ColumnProfileError,
  profileSourceColumnFile,
} from "./lib/column-profiler";
import { writePhase2AuditReport } from "./lib/import-report";
import { loadSourceContract } from "./lib/source-contract";

interface ProfileCliArguments {
  filePath: string;
  column: string;
}

export async function runColumnProfile(
  filePath: string,
  column: string,
): Promise<{ reportPath: string; recommendation: string }> {
  const contract = await loadSourceContract();
  const generatedAt = new Date();
  const report = await profileSourceColumnFile(
    filePath,
    contract,
    column,
    generatedAt,
  );
  const reportPath = await writePhase2AuditReport(
    "column-profile",
    report,
    generatedAt,
  );
  return {
    reportPath,
    recommendation: report.technical_assessment.recommended_storage_category,
  };
}

function parseArguments(argumentsList: string[]): ProfileCliArguments {
  let filePath: string | undefined;
  let column: string | undefined;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--") continue;
    if (argument === "--file" || argument === "--column") {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) {
        throw new ColumnProfileError(
          "CLI_ARGUMENT_MISSING",
          `Missing value for ${argument}.`,
        );
      }
      if (argument === "--file") filePath = value;
      else column = value;
      index += 1;
      continue;
    }
    throw new ColumnProfileError(
      "CLI_ARGUMENT_UNKNOWN",
      `Unknown argument: ${argument}`,
    );
  }

  if (!filePath) {
    throw new ColumnProfileError(
      "CLI_FILE_MISSING",
      "Missing required --file argument.",
    );
  }
  if (!column) {
    throw new ColumnProfileError(
      "CLI_COLUMN_MISSING",
      "Missing required --column argument.",
    );
  }
  return { filePath, column };
}

async function main(): Promise<void> {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    const result = await runColumnProfile(
      arguments_.filePath,
      arguments_.column,
    );
    console.log(JSON.stringify({ status: "SUCCESS", ...result }));
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "ERROR",
        code:
          error instanceof ColumnProfileError ? error.code : "UNEXPECTED_ERROR",
        message:
          "Column profiling failed safely without modifying the workbook or database.",
      }),
    );
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
