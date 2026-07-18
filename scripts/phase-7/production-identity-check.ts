import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { prepareSourceFile } from "../phase-2/lib/row-parser";
import { loadSourceContract } from "../phase-2/lib/source-contract";
import {
  auditCanonicalPersonnel,
  buildProductionRoster,
  compareProductionIdentityState,
  PHASE7_SECURE_INPUT_NAMES,
  productionIdentityManifestSchema,
  productionIdentityStateSchema,
  PRODUCTION_UNIT_CODES,
  type ProductionIdentityIssue,
  type ProductionIdentityManifest,
  type ProductionIdentityState,
} from "./lib/production-identity";

const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_CANONICAL_BYTES = 10 * 1024 * 1024;

export type ProductionIdentityCheckMode = "DRY_RUN" | "RECONCILE";

export interface ProductionIdentityCheckResult {
  readonly report: string;
  readonly exitCode: number;
}

class SafeProductionIdentityInputError extends Error {
  constructor(
    readonly inputName: string,
    readonly code:
      | "MISSING_INPUT"
      | "SECURE_FILE_GUARD_FAILED"
      | "INPUT_PARSE_FAILED"
      | "INPUT_SCHEMA_INVALID",
  ) {
    super(code);
  }
}

export async function runProductionIdentityCheck(input: {
  readonly mode: ProductionIdentityCheckMode;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}): Promise<ProductionIdentityCheckResult> {
  const cwd = input.cwd ?? process.cwd();
  const requiredNames = requiredSecureInputNames();
  const missingNames = requiredNames.filter(
    (name) => !input.environment[name]?.trim(),
  );
  if (missingNames.length > 0) {
    return {
      report: formatMissingInputReport(input.mode, missingNames),
      exitCode: 2,
    };
  }

  try {
    const canonicalPath = await assertSecureExternalFile({
      inputName: PHASE7_SECURE_INPUT_NAMES.canonicalSourceFile,
      path: input.environment[PHASE7_SECURE_INPUT_NAMES.canonicalSourceFile]!,
      extension: ".xlsx",
      maximumBytes: MAX_CANONICAL_BYTES,
      cwd,
    });
    const manifestPath = await assertSecureExternalFile({
      inputName: PHASE7_SECURE_INPUT_NAMES.identityManifestFile,
      path: input.environment[PHASE7_SECURE_INPUT_NAMES.identityManifestFile]!,
      extension: ".json",
      maximumBytes: MAX_JSON_BYTES,
      cwd,
    });
    const statePath = await assertSecureExternalFile({
      inputName: PHASE7_SECURE_INPUT_NAMES.identityStateFile,
      path: input.environment[PHASE7_SECURE_INPUT_NAMES.identityStateFile]!,
      extension: ".json",
      maximumBytes: MAX_JSON_BYTES,
      cwd,
    });
    const [contract, manifest, state] = await Promise.all([
      loadSourceContract(),
      readManifest(manifestPath),
      readState(statePath),
    ]);
    if (
      manifest.productionAdmin &&
      !input.environment[
        PHASE7_SECURE_INPUT_NAMES.productionAdminPassword
      ]?.trim()
    ) {
      return {
        report: formatMissingInputReport(input.mode, [
          PHASE7_SECURE_INPUT_NAMES.productionAdminPassword,
        ]),
        exitCode: 2,
      };
    }
    const prepared = await prepareSourceFile(canonicalPath, contract);
    const canonicalAudit = auditCanonicalPersonnel(prepared);
    const roster = buildProductionRoster({
      canonicalAudit,
      manifest,
      environment: input.environment,
    });
    const comparison = compareProductionIdentityState({
      roster,
      state,
      mode: input.mode,
    });
    const issues = mergeIssues([...roster.issues, ...comparison.issues]);
    const blockerCount = issues
      .filter(({ severity }) => severity === "BLOCKER")
      .reduce((total, { count }) => total + count, 0);
    return {
      report: formatCheckReport({
        mode: input.mode,
        canonicalAudit,
        roster,
        comparison,
        issues,
        targetMode: state.targetMode,
        targetFingerprint: state.targetFingerprint,
      }),
      exitCode: blockerCount === 0 ? 0 : 2,
    };
  } catch (error) {
    const safeError =
      error instanceof SafeProductionIdentityInputError
        ? error
        : new SafeProductionIdentityInputError(
            "PHASE7_SECURE_INPUT",
            "INPUT_PARSE_FAILED",
          );
    return {
      report: formatInputFailureReport(input.mode, safeError),
      exitCode: 2,
    };
  }
}

async function assertSecureExternalFile(input: {
  readonly inputName: string;
  readonly path: string;
  readonly extension: ".json" | ".xlsx";
  readonly maximumBytes: number;
  readonly cwd: string;
}): Promise<string> {
  if (!isAbsolute(input.path) || extname(input.path) !== input.extension) {
    throw new SafeProductionIdentityInputError(
      input.inputName,
      "SECURE_FILE_GUARD_FAILED",
    );
  }
  try {
    const [workspace, candidateMetadata, candidate, parentMetadata, parent] =
      await Promise.all([
        realpath(input.cwd),
        lstat(input.path),
        realpath(input.path),
        lstat(dirname(input.path)),
        realpath(dirname(input.path)),
      ]);
    const fileMode = candidateMetadata.mode & 0o777;
    const directoryMode = parentMetadata.mode & 0o777;
    if (
      candidateMetadata.isSymbolicLink() ||
      !candidateMetadata.isFile() ||
      candidateMetadata.size > input.maximumBytes ||
      fileMode !== 0o600 ||
      parentMetadata.isSymbolicLink() ||
      !parentMetadata.isDirectory() ||
      directoryMode !== 0o700 ||
      candidate === workspace ||
      candidate.startsWith(`${workspace}${sep}`) ||
      parent === workspace ||
      parent.startsWith(`${workspace}${sep}`)
    ) {
      throw new SafeProductionIdentityInputError(
        input.inputName,
        "SECURE_FILE_GUARD_FAILED",
      );
    }
    return candidate;
  } catch (error) {
    if (error instanceof SafeProductionIdentityInputError) throw error;
    throw new SafeProductionIdentityInputError(
      input.inputName,
      "SECURE_FILE_GUARD_FAILED",
    );
  }
}

async function readManifest(path: string): Promise<ProductionIdentityManifest> {
  const raw = await readJson(
    path,
    PHASE7_SECURE_INPUT_NAMES.identityManifestFile,
  );
  const parsed = productionIdentityManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SafeProductionIdentityInputError(
      PHASE7_SECURE_INPUT_NAMES.identityManifestFile,
      "INPUT_SCHEMA_INVALID",
    );
  }
  return parsed.data;
}

async function readState(path: string): Promise<ProductionIdentityState> {
  const raw = await readJson(path, PHASE7_SECURE_INPUT_NAMES.identityStateFile);
  const parsed = productionIdentityStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SafeProductionIdentityInputError(
      PHASE7_SECURE_INPUT_NAMES.identityStateFile,
      "INPUT_SCHEMA_INVALID",
    );
  }
  return parsed.data;
}

async function readJson(path: string, inputName: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new SafeProductionIdentityInputError(inputName, "INPUT_PARSE_FAILED");
  }
}

function requiredSecureInputNames(): string[] {
  return [
    PHASE7_SECURE_INPUT_NAMES.canonicalSourceFile,
    PHASE7_SECURE_INPUT_NAMES.identityManifestFile,
    PHASE7_SECURE_INPUT_NAMES.identityStateFile,
    PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
    ...PRODUCTION_UNIT_CODES.map(
      (unitCode) => PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode],
    ),
  ];
}

function formatMissingInputReport(
  mode: ProductionIdentityCheckMode,
  missingNames: readonly string[],
): string {
  return [
    `MODE=${mode}`,
    "STATUS=BLOCKED",
    ...missingNames.map((name, index) => `MISSING_INPUT_${index + 1}=${name}`),
    "DATABASE_CONNECTIONS=0",
    "DATABASE_WRITES=0",
    "SENSITIVE_VALUES_OUTPUT=0",
  ].join("\n");
}

function formatInputFailureReport(
  mode: ProductionIdentityCheckMode,
  error: SafeProductionIdentityInputError,
): string {
  return [
    `MODE=${mode}`,
    "STATUS=BLOCKED",
    `INVALID_INPUT_NAME=${error.inputName}`,
    `INVALID_INPUT_CODE=${error.code}`,
    "DATABASE_CONNECTIONS=0",
    "DATABASE_WRITES=0",
    "SENSITIVE_VALUES_OUTPUT=0",
  ].join("\n");
}

function formatCheckReport(input: {
  readonly mode: ProductionIdentityCheckMode;
  readonly canonicalAudit: ReturnType<typeof auditCanonicalPersonnel>;
  readonly roster: ReturnType<typeof buildProductionRoster>;
  readonly comparison: ReturnType<typeof compareProductionIdentityState>;
  readonly issues: readonly ProductionIdentityIssue[];
  readonly targetMode: ProductionIdentityState["targetMode"];
  readonly targetFingerprint: string | null;
}): string {
  const blockerCount = input.issues
    .filter(({ severity }) => severity === "BLOCKER")
    .reduce((total, { count }) => total + count, 0);
  const warningCount = input.issues
    .filter(({ severity }) => severity === "WARNING")
    .reduce((total, { count }) => total + count, 0);
  return [
    `MODE=${input.mode}`,
    `STATUS=${blockerCount === 0 ? "PASS" : "BLOCKED"}`,
    `TARGET_STATE_MODE=${input.targetMode}`,
    `TARGET_FINGERPRINT=${input.targetFingerprint ?? "NOT_APPLICABLE"}`,
    `CANONICAL_SOURCE_SHA256=${input.canonicalAudit.summary.sourceChecksum}`,
    `CANONICAL_SOURCE_ROW_COUNT=${input.canonicalAudit.summary.sourceRowCount}`,
    `CANONICAL_SOURCE_COLUMN_COUNT=${input.canonicalAudit.summary.sourceColumnCount}`,
    `DISTINCT_LECTURER_UID_COUNT=${input.canonicalAudit.summary.distinctLecturerUidCount}`,
    `DISTINCT_NORMALIZED_EMAIL_COUNT=${input.canonicalAudit.summary.distinctNormalizedEmailCount}`,
    `VNU_LECTURER_COUNT=${input.canonicalAudit.summary.vnuLecturerCount}`,
    `NON_VNU_LECTURER_COUNT=${input.canonicalAudit.summary.nonVnuLecturerCount}`,
    `DUPLICATE_BUSINESS_GROUP_COUNT=${input.canonicalAudit.summary.duplicateRecordGroupCount}`,
    `DUPLICATE_BUSINESS_ROW_COUNT=${input.canonicalAudit.summary.duplicateRecordRowCount}`,
    `EMPLOYMENT_STATUS_COLUMN_PRESENT=${input.canonicalAudit.summary.employmentStatusColumnPresent ? "YES" : "NO"}`,
    `ROSTER_SHA256=${input.roster.rosterSha256}`,
    `LECTURER_IDENTITY_COUNT=${input.roster.counts.lecturer}`,
    `FACULTY_LEADER_IDENTITY_COUNT=${input.roster.counts.facultyLeader}`,
    `TEST_IDENTITY_COUNT=${input.roster.counts.testIdentity}`,
    `ADMIN_IDENTITY_COUNT=${input.roster.counts.admin}`,
    `CREATE_PLANNED_COUNT=${input.comparison.createPlannedCount}`,
    `UNCHANGED_COUNT=${input.comparison.unchangedCount}`,
    `CONFLICTING_COUNT=${input.comparison.conflictingCount}`,
    `UNEXPECTED_IDENTITY_COUNT=${input.comparison.unexpectedIdentityCount}`,
    `BLOCKER_COUNT=${blockerCount}`,
    `WARNING_COUNT=${warningCount}`,
    ...input.issues.flatMap((issue, index) => [
      `ISSUE_${index + 1}_SEVERITY=${issue.severity}`,
      `ISSUE_${index + 1}_CODE=${issue.code}`,
      `ISSUE_${index + 1}_COUNT=${issue.count}`,
    ]),
    "DATABASE_CONNECTIONS=0",
    "DATABASE_WRITES=0",
    "ROSTER_VALUES_OUTPUT=0",
    "CREDENTIAL_VALUES_OUTPUT=0",
  ].join("\n");
}

function mergeIssues(
  issues: readonly ProductionIdentityIssue[],
): ProductionIdentityIssue[] {
  const merged = new Map<string, ProductionIdentityIssue>();
  for (const issue of issues) {
    const current = merged.get(issue.code);
    merged.set(issue.code, {
      code: issue.code,
      severity:
        current?.severity === "BLOCKER" || issue.severity === "BLOCKER"
          ? "BLOCKER"
          : "WARNING",
      count: (current?.count ?? 0) + issue.count,
    });
  }
  return [...merged.values()].sort((left, right) =>
    left.code.localeCompare(right.code, "en-US"),
  );
}

async function main(): Promise<void> {
  const argument = process.argv[2];
  const mode = argument === "reconcile" ? "RECONCILE" : "DRY_RUN";
  if (argument !== "dry-run" && argument !== "reconcile") {
    console.error(
      "MODE=UNKNOWN\nSTATUS=BLOCKED\nINVALID_INPUT_NAME=COMMAND\nINVALID_INPUT_CODE=INPUT_SCHEMA_INVALID\nDATABASE_CONNECTIONS=0\nDATABASE_WRITES=0\nSENSITIVE_VALUES_OUTPUT=0",
    );
    process.exitCode = 2;
    return;
  }
  const result = await runProductionIdentityCheck({
    mode,
    environment: process.env,
  });
  if (result.exitCode === 0) console.log(result.report);
  else console.error(result.report);
  process.exitCode = result.exitCode;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
