import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  inspectSourceFile,
  WorkbookInspectionError,
  type SourceInspectionReport,
} from "./lib/workbook";

interface CliArguments {
  filePath: string;
  sheetName: string;
}

async function main(): Promise<void> {
  let cliArguments: CliArguments;
  try {
    cliArguments = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Invalid command arguments.",
    );
    console.error("Usage: pnpm data:inspect -- --file <path> --sheet csdlcore");
    process.exitCode = 2;
    return;
  }

  try {
    const report = await inspectSourceFile(cliArguments.filePath, {
      sheetName: cliArguments.sheetName,
    });
    const outputPath = await writeReport(report);

    if (!report.structure.valid) {
      console.error(
        JSON.stringify({
          status: "STRUCTURE_ERROR",
          reportPath: outputPath,
          structureErrors: report.structure.errors,
        }),
      );
      process.exitCode = 2;
      return;
    }

    console.log(
      JSON.stringify({
        status: "SUCCESS",
        reportPath: outputPath,
        sha256: report.source.sha256,
        sheetCount: report.workbook.sheetCount,
        selectedSheet: report.workbook.selectedSheet,
        headerColumnCount: report.header.columnCount,
        dataRowCount: report.rows.dataRowCount,
        issueCount: report.issues.length,
      }),
    );
  } catch (error) {
    if (error instanceof WorkbookInspectionError) {
      console.error(
        JSON.stringify({
          status: "ERROR",
          code: error.code,
          message: error.message,
        }),
      );
    } else {
      console.error(
        JSON.stringify({
          status: "ERROR",
          code: "UNEXPECTED_ERROR",
          message: "Source inspection failed unexpectedly.",
        }),
      );
    }
    process.exitCode = 2;
  }
}

function parseArguments(argumentsList: string[]): CliArguments {
  let filePath: string | undefined;
  let sheetName: string | undefined;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--") continue;

    if (argument === "--file" || argument === "--sheet") {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}.`);
      }
      if (argument === "--file") filePath = value;
      if (argument === "--sheet") sheetName = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!filePath) throw new Error("Missing required --file argument.");
  if (!sheetName) throw new Error("Missing required --sheet argument.");

  return { filePath, sheetName };
}

async function writeReport(report: SourceInspectionReport): Promise<string> {
  const timestamp = report.generatedAtUtc
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "");
  const outputDirectory = resolve("infra", "audit", "phase-2", timestamp);
  const outputPath = resolve(outputDirectory, "source-inspection.json");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return outputPath;
}

await main();
