import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  validateIdentityInputDocuments,
  type IdentityInputErrorCode,
  type IdentityInputValidationSummary,
} from "./lib/identity-input-schema";
import { formatIdentityValidationReport } from "./lib/redacted-report";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;

interface IdentityInputCommand {
  readonly lecturersPath: string;
  readonly leadersPath: string;
}

class SafeIdentityInputError extends Error {
  constructor(readonly code: IdentityInputErrorCode) {
    super(code);
  }
}

export function parseIdentityInputCommand(
  arguments_: readonly string[],
): IdentityInputCommand {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  const lecturers = valuesFor(args, "--lecturers=");
  const leaders = valuesFor(args, "--leaders=");
  const unknown = args.filter(
    (argument) =>
      !argument.startsWith("--lecturers=") &&
      !argument.startsWith("--leaders="),
  );
  if (
    args.includes("--") ||
    unknown.length > 0 ||
    lecturers.length !== 1 ||
    leaders.length !== 1 ||
    lecturers[0] === leaders[0]
  ) {
    throw new SafeIdentityInputError("INPUT_FILE_GUARD_FAILED");
  }
  return { lecturersPath: lecturers[0]!, leadersPath: leaders[0]! };
}

export async function validateApprovedIdentityFiles(input: {
  readonly lecturersPath: string;
  readonly leadersPath: string;
  readonly cwd?: string;
}): Promise<{
  readonly summary: IdentityInputValidationSummary;
  readonly checksum: string;
}> {
  const cwd = input.cwd ?? process.cwd();
  const lecturersPath = await assertExternalInputFile(input.lecturersPath, cwd);
  const leadersPath = await assertExternalInputFile(input.leadersPath, cwd);
  if (lecturersPath === leadersPath) {
    throw new SafeIdentityInputError("INPUT_FILE_GUARD_FAILED");
  }
  const [lecturerBytes, leaderBytes] = await Promise.all([
    readFile(lecturersPath),
    readFile(leadersPath),
  ]);
  if (
    lecturerBytes.length > MAX_INPUT_BYTES ||
    leaderBytes.length > MAX_INPUT_BYTES
  ) {
    throw new SafeIdentityInputError("INPUT_FILE_GUARD_FAILED");
  }
  const checksum = calculateInputChecksum(lecturerBytes, leaderBytes);
  let lecturerDocument: unknown;
  let leaderDocument: unknown;
  try {
    lecturerDocument = JSON.parse(lecturerBytes.toString("utf8"));
    leaderDocument = JSON.parse(leaderBytes.toString("utf8"));
  } catch {
    throw new SafeIdentityInputError("INPUT_PARSE_FAILED");
  }
  return {
    summary: validateIdentityInputDocuments(lecturerDocument, leaderDocument),
    checksum,
  };
}

export function calculateInputChecksum(
  lecturerBytes: Uint8Array,
  leaderBytes: Uint8Array,
): string {
  return createHash("sha256")
    .update("UEB_CORE_PHASE5_LECTURERS\0", "utf8")
    .update(lecturerBytes)
    .update("\0UEB_CORE_PHASE5_LEADERS\0", "utf8")
    .update(leaderBytes)
    .digest("hex");
}

async function assertExternalInputFile(
  inputPath: string,
  cwd: string,
): Promise<string> {
  if (!isAbsolute(inputPath) || !inputPath.endsWith(".json")) {
    throw new SafeIdentityInputError("INPUT_FILE_GUARD_FAILED");
  }
  try {
    const [workspacePath, resolvedPath, metadata] = await Promise.all([
      realpath(resolve(cwd)),
      realpath(inputPath),
      lstat(inputPath),
    ]);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      resolvedPath === workspacePath ||
      resolvedPath.startsWith(`${workspacePath}${sep}`)
    ) {
      throw new SafeIdentityInputError("INPUT_FILE_GUARD_FAILED");
    }
    return resolvedPath;
  } catch (error) {
    if (error instanceof SafeIdentityInputError) throw error;
    throw new SafeIdentityInputError("INPUT_FILE_GUARD_FAILED");
  }
}

function valuesFor(args: readonly string[], prefix: string): string[] {
  return args
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length))
    .filter((value) => value.length > 0);
}

function failureSummary(
  code: IdentityInputErrorCode,
): IdentityInputValidationSummary {
  return {
    approvalBatchCount: 0,
    lecturerRecordCount: 0,
    leaderRecordCount: 0,
    unitScopeCount: 0,
    duplicateEmailCount: 0,
    duplicateLecturerUidCount: 0,
    duplicateRoleCount: 0,
    duplicateScopeCount: 0,
    unknownUnitCount: 0,
    unresolvedAmbiguityCount: 1,
    issues: [{ source: "BATCH", rowNumber: 0, code }],
  };
}

async function main(): Promise<void> {
  try {
    const command = parseIdentityInputCommand(process.argv.slice(2));
    const result = await validateApprovedIdentityFiles(command);
    const report = formatIdentityValidationReport(
      result.summary,
      result.checksum,
    );
    if (result.summary.unresolvedAmbiguityCount === 0) {
      console.log(report);
      return;
    }
    console.error(report);
    process.exitCode = 2;
  } catch (error) {
    const code =
      error instanceof SafeIdentityInputError
        ? error.code
        : "INPUT_FILE_GUARD_FAILED";
    console.error(
      formatIdentityValidationReport(failureSummary(code), "UNAVAILABLE"),
    );
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
