import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, sep } from "node:path";
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
  type ProductionIdentityManifest,
  type ProductionIdentityState,
  type ProductionRosterResult,
} from "./lib/production-identity";

export type ProductionRosterWorkflowMode =
  "BUILD" | "VALIDATE" | "DRY_RUN" | "RECONCILE";

export interface ProductionRosterWorkflowResult {
  readonly report: string;
  readonly exitCode: number;
}

export class SafeProductionRosterWorkflowError extends Error {
  constructor(
    readonly code: string,
    readonly validation?: {
      readonly missingInputs: readonly string[];
      readonly blockerCodes: readonly string[];
      readonly conflictCodes: readonly string[];
      readonly counts: Parameters<typeof blockedReport>[4];
    },
  ) {
    super(code);
  }
}

export interface LoadedProductionRoster {
  readonly roster: ProductionRosterResult;
  readonly manifest: ProductionIdentityManifest;
  readonly state: ProductionIdentityState;
  readonly secrets: Readonly<Record<string, string>>;
  readonly emailExceptionCount: number;
  readonly ambiguityCount: number;
}

export type ProductionSecureInputDelivery = "HOST" | "RUNTIME_STAGED";

export const PRODUCTION_SECURE_INPUT_CONTRACT = {
  HOST: { directoryMode: 0o700, fileMode: 0o600 },
  RUNTIME_STAGED: { directoryMode: 0o500, fileMode: 0o400 },
} as const;

interface ProductionSecureInputMetadata {
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly linkCount: number;
}

export function matchesProductionSecureInputMetadata(input: {
  readonly metadata: ProductionSecureInputMetadata;
  readonly delivery: ProductionSecureInputDelivery;
  readonly kind: "DIRECTORY" | "FILE";
  readonly expectedUid: number;
  readonly expectedGid: number;
}): boolean {
  const contract = PRODUCTION_SECURE_INPUT_CONTRACT[input.delivery];
  const expectedMode =
    input.kind === "DIRECTORY" ? contract.directoryMode : contract.fileMode;
  const expectedKind =
    input.kind === "DIRECTORY"
      ? input.metadata.isDirectory
      : input.metadata.isFile && input.metadata.linkCount === 1;
  return (
    expectedKind &&
    !input.metadata.isSymbolicLink &&
    (input.metadata.mode & 0o777) === expectedMode &&
    input.metadata.uid === input.expectedUid &&
    input.metadata.gid === input.expectedGid
  );
}

export async function loadValidatedProductionRoster(
  secureDirectoryInput: string,
  delivery: ProductionSecureInputDelivery = "HOST",
): Promise<LoadedProductionRoster> {
  const secureDirectory = await assertSecureDirectory(
    secureDirectoryInput,
    delivery,
  );
  const paths = Object.fromEntries(
    Object.entries(PHASE7_SECURE_FILE_NAMES).map(([key, fileName]) => [
      key,
      join(secureDirectory, fileName),
    ]),
  ) as Record<keyof typeof PHASE7_SECURE_FILE_NAMES, string>;
  await Promise.all([
    assertSecureFile(
      paths.canonicalSource,
      10 * 1024 * 1024,
      delivery,
      secureDirectory,
    ),
    assertSecureFile(
      paths.lecturerExceptions,
      5 * 1024 * 1024,
      delivery,
      secureDirectory,
    ),
    assertSecureFile(
      paths.facultyLeaders,
      5 * 1024 * 1024,
      delivery,
      secureDirectory,
    ),
    assertSecureFile(
      paths.testIdentities,
      5 * 1024 * 1024,
      delivery,
      secureDirectory,
    ),
    assertSecureFile(
      paths.targetState,
      5 * 1024 * 1024,
      delivery,
      secureDirectory,
    ),
    assertSecureFile(paths.secrets, 1024 * 1024, delivery, secureDirectory),
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
    parseInput(targetStateDraftSchema, stateRaw, "TARGET_STATE_SCHEMA_INVALID"),
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
    validated.blockerCodes.length > 0 ||
    validated.conflictCodes.length > 0 ||
    !validated.resolutions ||
    !validated.manifest ||
    !validated.state ||
    !validated.secrets
  ) {
    const code =
      validated.blockerCodes[0] ??
      validated.missingInputs[0] ??
      validated.conflictCodes[0] ??
      "PRODUCTION_ROSTER_VALIDATION_BLOCKED";
    throw new SafeProductionRosterWorkflowError(code, {
      missingInputs: validated.missingInputs,
      blockerCodes: validated.blockerCodes,
      conflictCodes: validated.conflictCodes,
      counts: {
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
        targetStateMode: targetState.targetMode,
      },
    });
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
  const blocker = roster.issues.find(({ severity }) => severity === "BLOCKER");
  if (blocker) throw new SafeProductionRosterWorkflowError(blocker.code);
  return {
    roster,
    manifest: validated.manifest,
    state: validated.state,
    secrets: validated.secrets,
    emailExceptionCount: expected.nonVnu.length,
    ambiguityCount: expected.ambiguousNames.length,
  };
}

export async function runProductionRosterWorkflow(input: {
  readonly mode: ProductionRosterWorkflowMode;
  readonly secureDirectory: string | undefined;
}): Promise<ProductionRosterWorkflowResult> {
  if (!input.secureDirectory) {
    return blockedReport(input.mode, ["PHASE7_SECURE_DIRECTORY"], [], []);
  }
  try {
    const loaded = await loadValidatedProductionRoster(input.secureDirectory);
    const { roster } = loaded;
    const comparison = compareProductionIdentityState({
      roster,
      state: loaded.state,
      mode: input.mode === "RECONCILE" ? "RECONCILE" : "DRY_RUN",
    });
    const issues = mergeIssues([...roster.issues, ...comparison.issues]);
    const blockerCount = issues
      .filter(({ severity }) => severity === "BLOCKER")
      .reduce((total, issue) => total + issue.count, 0);
    const stateEmails = new Set(
      loaded.state.identities.map(({ email }) => email),
    );
    const creates = roster.identities.filter(
      ({ normalizedEmail }) => !stateEmails.has(normalizedEmail),
    );
    return {
      report: [
        `MODE=${input.mode}`,
        `STATUS=${blockerCount === 0 ? "PASS" : "BLOCKED"}`,
        `TARGET_STATE_MODE=${loaded.state.targetMode}`,
        `MANIFEST_SHA256=${roster.rosterSha256}`,
        `LECTURER_EXCEPTION_COUNT=${loaded.emailExceptionCount}`,
        `AMBIGUITY_GROUP_COUNT=${loaded.ambiguityCount}`,
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
    if (
      error instanceof SafeProductionRosterWorkflowError &&
      error.validation
    ) {
      return blockedReport(
        input.mode,
        error.validation.missingInputs,
        error.validation.blockerCodes,
        error.validation.conflictCodes,
        error.validation.counts,
      );
    }
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

export async function assertSecureDirectory(
  path: string,
  delivery: ProductionSecureInputDelivery,
): Promise<string> {
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
    const expectedUid = process.getuid?.();
    const expectedGid = process.getgid?.();
    if (
      expectedUid === undefined ||
      expectedGid === undefined ||
      !matchesProductionSecureInputMetadata({
        metadata: {
          mode: metadata.mode,
          uid: metadata.uid,
          gid: metadata.gid,
          isFile: metadata.isFile(),
          isDirectory: metadata.isDirectory(),
          isSymbolicLink: metadata.isSymbolicLink(),
          linkCount: metadata.nlink,
        },
        delivery,
        kind: "DIRECTORY",
        expectedUid,
        expectedGid,
      }) ||
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

export async function assertSecureFile(
  path: string,
  maximumBytes: number,
  delivery: ProductionSecureInputDelivery,
  secureDirectory: string,
): Promise<void> {
  try {
    const [metadata, resolved] = await Promise.all([
      lstat(path),
      realpath(path),
    ]);
    const expectedUid = process.getuid?.();
    const expectedGid = process.getgid?.();
    if (
      expectedUid === undefined ||
      expectedGid === undefined ||
      !matchesProductionSecureInputMetadata({
        metadata: {
          mode: metadata.mode,
          uid: metadata.uid,
          gid: metadata.gid,
          isFile: metadata.isFile(),
          isDirectory: metadata.isDirectory(),
          isSymbolicLink: metadata.isSymbolicLink(),
          linkCount: metadata.nlink,
        },
        delivery,
        kind: "FILE",
        expectedUid,
        expectedGid,
      }) ||
      dirname(resolved) !== secureDirectory ||
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

export function blockedReport(
  mode: ProductionRosterWorkflowMode,
  missingInputs: readonly string[],
  blockerCodes: readonly string[],
  conflictCodes: readonly string[],
  counts: {
    readonly emailExceptionCount?: number;
    readonly ambiguityCount?: number;
    readonly leaderRecordCount?: number;
    readonly testIdentityCount?: number;
    readonly targetStateMode?: "EXISTING_TARGET" | "PLANNED_EMPTY_TARGET";
  } = {},
): ProductionRosterWorkflowResult {
  const blockCount =
    missingInputs.length + blockerCodes.length + conflictCodes.length;
  const blockingReason =
    blockerCodes[0] ?? missingInputs[0] ?? conflictCodes[0] ?? "UNKNOWN";
  return {
    report: [
      `MODE=${mode}`,
      "STATUS=BLOCKED",
      `LECTURER_EXCEPTION_COUNT=${counts.emailExceptionCount ?? 0}`,
      `AMBIGUITY_GROUP_COUNT=${counts.ambiguityCount ?? 0}`,
      `LEADER_RECORD_COUNT=${counts.leaderRecordCount ?? 0}`,
      `TEST_IDENTITY_COUNT=${counts.testIdentityCount ?? 0}`,
      `TARGET_STATE_MODE=${counts.targetStateMode ?? "UNKNOWN"}`,
      "CREATE_COUNT=0",
      "NOOP_COUNT=0",
      `BLOCK_COUNT=${Math.max(1, blockCount)}`,
      `CONFLICT_COUNT=${conflictCodes.length}`,
      `BLOCKING_REASON=${blockingReason}`,
      ...missingInputs.map(
        (name, index) => `MISSING_INPUT_${index + 1}=${name}`,
      ),
      ...blockerCodes.map((code, index) => `BLOCKER_${index + 1}=${code}`),
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
