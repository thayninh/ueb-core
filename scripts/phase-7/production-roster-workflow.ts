import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { prepareSourceFile } from "../phase-2/lib/row-parser";
import { loadSourceContract } from "../phase-2/lib/source-contract";
import {
  facultyLeaderFileSchema,
  inspectExpectedLecturerExceptions,
  lecturerExceptionFileSchema,
  parseSecretsFile,
  PHASE7_SECURE_FILE_NAMES,
  targetStateDraftSchema,
  testIdentityFileSchema,
  validateOperatorInputs,
} from "./lib/production-operator-inputs";
import {
  auditCanonicalPersonnel,
  buildProductionRoster,
  compareProductionIdentityState,
  type ProductionIdentityIssue,
} from "./lib/production-identity";

export type ProductionRosterWorkflowMode =
  "BUILD" | "VALIDATE" | "DRY_RUN" | "RECONCILE";

export interface ProductionRosterWorkflowResult {
  readonly report: string;
  readonly exitCode: number;
}

class SafeProductionRosterWorkflowError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function runProductionRosterWorkflow(input: {
  readonly mode: ProductionRosterWorkflowMode;
  readonly secureDirectory: string | undefined;
}): Promise<ProductionRosterWorkflowResult> {
  if (!input.secureDirectory) {
    return blockedReport(input.mode, ["PHASE7_SECURE_DIRECTORY"], []);
  }
  try {
    const secureDirectory = await assertSecureDirectory(input.secureDirectory);
    const paths = Object.fromEntries(
      Object.entries(PHASE7_SECURE_FILE_NAMES).map(([key, fileName]) => [
        key,
        join(secureDirectory, fileName),
      ]),
    ) as Record<keyof typeof PHASE7_SECURE_FILE_NAMES, string>;
    await Promise.all([
      assertSecureFile(paths.canonicalSource, 10 * 1024 * 1024),
      assertSecureFile(paths.lecturerExceptions, 5 * 1024 * 1024),
      assertSecureFile(paths.facultyLeaders, 5 * 1024 * 1024),
      assertSecureFile(paths.testIdentities, 5 * 1024 * 1024),
      assertSecureFile(paths.targetState, 5 * 1024 * 1024),
      assertSecureFile(paths.secrets, 1024 * 1024),
    ]);
    const [contract, lecturerRaw, leadersRaw, testsRaw, stateRaw, secretsRaw] =
      await Promise.all([
        loadSourceContract(),
        readJson(paths.lecturerExceptions),
        readJson(paths.facultyLeaders),
        readJson(paths.testIdentities),
        readJson(paths.targetState),
        readFile(paths.secrets, "utf8"),
      ]);
    const [lecturerExceptions, facultyLeaders, testIdentities, targetState] = [
      parseInput(
        lecturerExceptionFileSchema,
        lecturerRaw,
        "LECTURER_EXCEPTIONS_SCHEMA_INVALID",
      ),
      parseInput(
        facultyLeaderFileSchema,
        leadersRaw,
        "FACULTY_LEADERS_SCHEMA_INVALID",
      ),
      parseInput(
        testIdentityFileSchema,
        testsRaw,
        "TEST_IDENTITIES_SCHEMA_INVALID",
      ),
      parseInput(
        targetStateDraftSchema,
        stateRaw,
        "TARGET_STATE_SCHEMA_INVALID",
      ),
    ] as const;
    const prepared = await prepareSourceFile(paths.canonicalSource, contract);
    const expected = inspectExpectedLecturerExceptions(prepared);
    const validated = validateOperatorInputs({
      expected,
      lecturerExceptions,
      facultyLeaders,
      testIdentities,
      targetState,
      secrets: parseSecretsFile(secretsRaw),
    });
    if (
      validated.missingInputs.length > 0 ||
      validated.conflictCodes.length > 0 ||
      !validated.resolutions ||
      !validated.manifest ||
      !validated.state ||
      !validated.secrets
    ) {
      return blockedReport(
        input.mode,
        validated.missingInputs,
        validated.conflictCodes,
        {
          emailExceptionCount: expected.nonVnu.length,
          ambiguityCount: expected.ambiguousNames.length,
          leaderRecordCount: facultyLeaders.records.filter(
            ({ email, displayName, requirePasswordChange }) =>
              email && displayName && requirePasswordChange !== null,
          ).length,
          testIdentityCount: [
            testIdentities.lecturer.displayName &&
              testIdentities.lecturer.lecturerUid,
            testIdentities.leader.displayName,
          ].filter(Boolean).length,
        },
      );
    }

    const canonicalAudit = auditCanonicalPersonnel(
      prepared,
      validated.resolutions,
    );
    const roster = buildProductionRoster({
      canonicalAudit,
      manifest: validated.manifest,
      environment: validated.secrets,
    });
    const comparison = compareProductionIdentityState({
      roster,
      state: validated.state,
      mode: input.mode === "RECONCILE" ? "RECONCILE" : "DRY_RUN",
    });
    const issues = mergeIssues([...roster.issues, ...comparison.issues]);
    const blockerCount = issues
      .filter(({ severity }) => severity === "BLOCKER")
      .reduce((total, issue) => total + issue.count, 0);
    const stateEmails = new Set(
      validated.state.identities.map(({ email }) => email),
    );
    const creates = roster.identities.filter(
      ({ normalizedEmail }) => !stateEmails.has(normalizedEmail),
    );
    return {
      report: [
        `MODE=${input.mode}`,
        `STATUS=${blockerCount === 0 ? "PASS" : "BLOCKED"}`,
        `MANIFEST_SHA256=${roster.rosterSha256}`,
        `LECTURER_EXCEPTION_COUNT=${expected.nonVnu.length}`,
        `AMBIGUITY_GROUP_COUNT=${expected.ambiguousNames.length}`,
        `LEADER_RECORD_COUNT=${roster.counts.facultyLeader}`,
        `TEST_IDENTITY_COUNT=${roster.counts.testIdentity}`,
        `CREATE_COUNT=${comparison.createPlannedCount}`,
        `NOOP_COUNT=${comparison.unchangedCount}`,
        `BLOCK_COUNT=${blockerCount}`,
        `CONFLICT_COUNT=${comparison.conflictingCount}`,
        `LECTURER_CREATE_COUNT=${creates.filter(({ identityType, testIdentity }) => identityType === "LECTURER" && !testIdentity).length}`,
        `LEADER_CREATE_COUNT=${creates.filter(({ identityType, testIdentity }) => identityType === "FACULTY_LEADER" && !testIdentity).length}`,
        `TEST_CREATE_COUNT=${creates.filter(({ testIdentity }) => testIdentity).length}`,
        ...issues.flatMap((issue, index) => [
          `ISSUE_${index + 1}_CODE=${issue.code}`,
          `ISSUE_${index + 1}_COUNT=${issue.count}`,
        ]),
        "SECRET_LEAKAGE=0",
        "DATABASE_CONNECTIONS=0",
        "DATABASE_MUTATIONS=0",
      ].join("\n"),
      exitCode: blockerCount === 0 ? 0 : 2,
    };
  } catch (error) {
    const code =
      error instanceof SafeProductionRosterWorkflowError
        ? error.code
        : "PRODUCTION_ROSTER_WORKFLOW_FAILED";
    return {
      report: [
        `MODE=${input.mode}`,
        "STATUS=BLOCKED",
        `ERROR_CODE=${code}`,
        "CREATE_COUNT=0",
        "NOOP_COUNT=0",
        "BLOCK_COUNT=1",
        "CONFLICT_COUNT=0",
        "SECRET_LEAKAGE=0",
        "DATABASE_CONNECTIONS=0",
        "DATABASE_MUTATIONS=0",
      ].join("\n"),
      exitCode: 2,
    };
  }
}

async function assertSecureDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw new SafeProductionRosterWorkflowError(
      "SECURE_DIRECTORY_GUARD_FAILED",
    );
  }
  try {
    const [metadata, resolved, workspace] = await Promise.all([
      lstat(path),
      realpath(path),
      realpath(process.cwd()),
    ]);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      (metadata.mode & 0o777) !== 0o700 ||
      resolved === workspace ||
      resolved.startsWith(`${workspace}${sep}`)
    ) {
      throw new SafeProductionRosterWorkflowError(
        "SECURE_DIRECTORY_GUARD_FAILED",
      );
    }
    return resolved;
  } catch (error) {
    if (error instanceof SafeProductionRosterWorkflowError) throw error;
    throw new SafeProductionRosterWorkflowError(
      "SECURE_DIRECTORY_GUARD_FAILED",
    );
  }
}

async function assertSecureFile(
  path: string,
  maximumBytes: number,
): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.size > maximumBytes
    ) {
      throw new SafeProductionRosterWorkflowError("SECURE_FILE_GUARD_FAILED");
    }
  } catch (error) {
    if (error instanceof SafeProductionRosterWorkflowError) throw error;
    throw new SafeProductionRosterWorkflowError("SECURE_FILE_GUARD_FAILED");
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new SafeProductionRosterWorkflowError("SECURE_JSON_PARSE_FAILED");
  }
}

function parseInput<T>(
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
  value: unknown,
  code: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SafeProductionRosterWorkflowError(code);
  return parsed.data;
}

function blockedReport(
  mode: ProductionRosterWorkflowMode,
  missingInputs: readonly string[],
  conflictCodes: readonly string[],
  counts: {
    readonly emailExceptionCount?: number;
    readonly ambiguityCount?: number;
    readonly leaderRecordCount?: number;
    readonly testIdentityCount?: number;
  } = {},
): ProductionRosterWorkflowResult {
  const blockCount = missingInputs.length + conflictCodes.length;
  return {
    report: [
      `MODE=${mode}`,
      "STATUS=BLOCKED",
      `LECTURER_EXCEPTION_COUNT=${counts.emailExceptionCount ?? 0}`,
      `AMBIGUITY_GROUP_COUNT=${counts.ambiguityCount ?? 0}`,
      `LEADER_RECORD_COUNT=${counts.leaderRecordCount ?? 0}`,
      `TEST_IDENTITY_COUNT=${counts.testIdentityCount ?? 0}`,
      "CREATE_COUNT=0",
      "NOOP_COUNT=0",
      `BLOCK_COUNT=${Math.max(1, blockCount)}`,
      `CONFLICT_COUNT=${conflictCodes.length}`,
      ...missingInputs.map(
        (name, index) => `MISSING_INPUT_${index + 1}=${name}`,
      ),
      ...conflictCodes.map((code, index) => `CONFLICT_${index + 1}=${code}`),
      "SECRET_LEAKAGE=0",
      "DATABASE_CONNECTIONS=0",
      "DATABASE_MUTATIONS=0",
    ].join("\n"),
    exitCode: 2,
  };
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

function parseMode(value: string | undefined): ProductionRosterWorkflowMode {
  if (value === "build") return "BUILD";
  if (value === "validate") return "VALIDATE";
  if (value === "dry-run") return "DRY_RUN";
  if (value === "reconcile") return "RECONCILE";
  throw new SafeProductionRosterWorkflowError("WORKFLOW_MODE_INVALID");
}

async function main(): Promise<void> {
  try {
    const mode = parseMode(process.argv[2]);
    const result = await runProductionRosterWorkflow({
      mode,
      secureDirectory: process.env.PHASE7_SECURE_DIRECTORY,
    });
    if (result.exitCode === 0) console.log(result.report);
    else console.error(result.report);
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(
      `MODE=UNKNOWN\nSTATUS=BLOCKED\nERROR_CODE=${error instanceof SafeProductionRosterWorkflowError ? error.code : "WORKFLOW_MODE_INVALID"}\nCREATE_COUNT=0\nNOOP_COUNT=0\nBLOCK_COUNT=1\nCONFLICT_COUNT=0\nSECRET_LEAKAGE=0\nDATABASE_CONNECTIONS=0\nDATABASE_MUTATIONS=0`,
    );
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
