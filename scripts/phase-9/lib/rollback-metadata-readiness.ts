import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  assertDatabaseMigrationRows,
  readSourceMigrationLedger,
  type MigrationLedger,
} from "../../phase-6/lib/migration-ledger";
import { SafePhase6StagingError } from "../../phase-6/lib/staging-contracts";
import {
  RealSshTransport,
  assertCollectorReadOnly,
  type SshExecutionRequest,
  type SshExecutionResult,
  type SshResolvedConfig,
  type SshTransport,
} from "./staging-ssh-executor";

export const ROLLBACK_READINESS_REPORT_SCHEMA_VERSION = 1;
export const ROLLBACK_DRAFT_SCHEMA_VERSION = 1;
export const ROLLBACK_READINESS_CHECKS = [
  "SERVER_TIME",
  "CURRENT_APP_IMAGE",
  "OPERATOR_IMAGE_EVIDENCE",
  "ROLLBACK_IMAGE_INVENTORY",
  "COMPOSE_MAPPING",
  "DATABASE_MIGRATION_LEDGER",
  "BACKUP_EVIDENCE",
  "ROLLBACK_METADATA_PATH",
  "SCHEMA_COMPATIBILITY_INPUTS",
  "MONITORING_HEALTH_READINESS",
] as const;

type ReadinessCheckId = (typeof ROLLBACK_READINESS_CHECKS)[number];
type ResolutionStatus = "RESOLVED" | "OPERATOR_DECISION_REQUIRED" | "BLOCKED";

const EXPECTED_ALIAS = "ueb-core-staging";
const EXPECTED_HOST = "103.200.25.54";
const EXPECTED_USER = "deploy";
const EXPECTED_ROOT = "/opt/ueb-core";
const APPROVED_METADATA_PATH = "/opt/ueb-core/evidence/rollback/approved.json";
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const READINESS_AUTHORIZATION =
  /^P9C5-ROLLBACK-READINESS-[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const CONSUMED_PREFLIGHT_AUTHORIZATIONS = new Set([
  "P9C-READONLY-STAGING-20260722-01",
  "P9C2-READONLY-STAGING-20260722-01",
  "P9C4-PRETRANSFER-READONLY-STAGING-20260722-01",
]);
const SAFE_REMOTE_SECRET = /^\/opt\/ueb-core\/secrets\/[A-Za-z0-9._-]+$/u;
const SECRET_PATTERN =
  /(?:password|passwd|token|cookie|session|private[_ -]?key|database[_ -]?url|postgres(?:ql)?:\/\/)[^\s|,}]*/giu;
export interface RollbackReadinessCheck {
  readonly id: ReadinessCheckId;
  readonly status: "PASS" | "BLOCKED" | "FAIL";
  readonly durationMs: number;
  readonly exitCode: number;
  readonly summary: string;
  readonly evidence: string;
}

export interface RollbackReadinessReport {
  readonly reportSchemaVersion: 1;
  readonly status: "PASS" | "BLOCKED";
  readonly target: "staging";
  readonly releaseSha: string;
  readonly authorizationReference: string;
  readonly timestamp: string;
  readonly resolvedSsh: { readonly host: string; readonly user: string };
  readonly sourceMigrationCount: number;
  readonly sourceMigrationFingerprint: string;
  readonly checks: readonly RollbackReadinessCheck[];
  readonly failedChecks: readonly ReadinessCheckId[];
  readonly protocolParseStatus: "COMPLETE" | "MALFORMED" | "NONE";
  readonly sshExitCode: number;
  readonly sshSignal: string | null;
  readonly mutationCommandCount: 0;
  readonly serverConnectionPerformed: true;
  readonly secretLeakageCount: number;
  readonly remoteSecretReferenceHash: string;
  readonly stopReason: string | null;
}

export interface RollbackReadinessOptions {
  readonly target: "staging";
  readonly releaseSha: string;
  readonly authorizationReference: string;
  readonly sshAlias: string;
  readonly sshConfigFile: string;
  readonly expectedUser: string;
  readonly expectedHost: string;
  readonly knownHostsFile: string;
  readonly connectTimeoutSeconds: number;
  readonly commandTimeoutSeconds: number;
  readonly remoteRoot: string;
  readonly remoteSecretFile: string;
  readonly output: string;
}

export interface RollbackMetadataDraft {
  readonly draftSchemaVersion: 1;
  readonly status: "OPERATOR_DECISION_REQUIRED" | "BLOCKED";
  readonly approved: false;
  readonly releaseSha: string;
  readonly generatedAt: string;
  readonly sourceReportSha256: string;
  readonly approvedTargetPath: typeof APPROVED_METADATA_PATH;
  readonly proposedMetadata: {
    readonly imageId: string | null;
    readonly architecture: "linux/amd64" | null;
    readonly composeService: "app";
    readonly releaseSha: string;
    readonly previousReleaseSha: string | null;
    readonly currentImage: string | null;
    readonly previousImage: string | null;
    readonly sourceMigrationCount: number;
    readonly migrationLedgerFingerprint: string;
    readonly databaseMigrationStatus: "COMPATIBLE" | null;
    readonly schemaCompatibilityDecision: null;
    readonly backupIdentifier: string | null;
    readonly backupChecksum: string | null;
    readonly timestamp: string;
    readonly operatorIdentityReference: null;
  };
  readonly fieldStates: Readonly<Record<string, ResolutionStatus>>;
  readonly rollbackCandidates: readonly RollbackCandidate[];
  readonly blockers: readonly string[];
  readonly operatorDecisions: readonly string[];
  readonly mutationCommandCount: 0;
  readonly secretLeakageCount: 0;
}

interface RollbackCandidate {
  readonly image: string;
  readonly imageId: string;
  readonly architecture: string;
  readonly sourceSha: string;
  readonly migrationCount: number;
  readonly migrationFingerprint: string;
}

interface CurrentImageEvidence extends RollbackCandidate {
  readonly containerId: string;
}

interface BackupEvidence {
  readonly identifier: string;
  readonly checksum: string;
  readonly createdAt: string;
  readonly offHostChecksumMatch: boolean;
  readonly catalogValidated: boolean;
}

export function createRollbackReadinessDryRun(
  arguments_: readonly string[],
  ledger: MigrationLedger,
): Readonly<Record<string, unknown>> {
  const args = normalize(arguments_);
  assertExactMode(args, "--dry-run", ["--target=", "--release-sha="]);
  const target = singleValue(args, "--target=");
  const releaseSha = singleValue(args, "--release-sha=");
  if (target !== "staging" || !GIT_SHA.test(releaseSha)) {
    throw safeError(
      "Rollback readiness dry-run target or release SHA is invalid.",
    );
  }
  return {
    status: "PASS",
    mode: "DRY_RUN",
    target,
    releaseSha,
    checks: ROLLBACK_READINESS_CHECKS,
    sourceMigrationCount: ledger.count,
    sourceMigrationFingerprint: ledger.fingerprint,
    approvedMetadataPath: APPROVED_METADATA_PATH,
    remoteMutationCommands: 0,
    serverConnectionPerformed: false,
    secretsPrinted: false,
  };
}

export function parseRollbackReadinessArguments(
  arguments_: readonly string[],
): RollbackReadinessOptions {
  const args = normalize(arguments_);
  const executionFlag = "--execute-read-only";
  const prefixes = [
    "--target=",
    "--release-sha=",
    "--authorization-ref=",
    "--ssh-alias=",
    "--ssh-config-file=",
    "--expected-user=",
    "--expected-host=",
    "--known-hosts-file=",
    "--connect-timeout-seconds=",
    "--command-timeout-seconds=",
    "--remote-root=",
    "--remote-secret-file=",
    "--output=",
  ];
  assertExactMode(args, executionFlag, prefixes);
  const value = (prefix: string) => singleValue(args, prefix);
  const target = value("--target=");
  const releaseSha = value("--release-sha=");
  const authorizationReference = value("--authorization-ref=");
  const sshAlias = value("--ssh-alias=");
  const expectedUser = value("--expected-user=");
  const expectedHost = value("--expected-host=");
  const remoteRoot = value("--remote-root=");
  const remoteSecretFile = value("--remote-secret-file=");
  const sshConfigFile = value("--ssh-config-file=");
  const knownHostsFile = value("--known-hosts-file=");
  const output = value("--output=");
  if (target !== "staging" || !GIT_SHA.test(releaseSha)) {
    throw safeError(
      "Only an exact staging target and release SHA are allowed.",
    );
  }
  if (
    !READINESS_AUTHORIZATION.test(authorizationReference) ||
    CONSUMED_PREFLIGHT_AUTHORIZATIONS.has(authorizationReference)
  ) {
    throw safeError("A distinct rollback-readiness authorization is required.");
  }
  if (
    sshAlias !== EXPECTED_ALIAS ||
    expectedUser !== EXPECTED_USER ||
    expectedHost !== EXPECTED_HOST ||
    remoteRoot !== EXPECTED_ROOT
  ) {
    throw safeError(
      "SSH staging identity does not match the approved contract.",
    );
  }
  if (
    !SAFE_REMOTE_SECRET.test(remoteSecretFile) ||
    remoteSecretFile.includes("..") ||
    /production/iu.test(remoteSecretFile)
  ) {
    throw safeError("Remote secret reference is outside the staging contract.");
  }
  for (const path of [sshConfigFile, knownHostsFile, output]) {
    if (!isAbsolute(path)) throw safeError("Local paths must be absolute.");
  }
  return {
    target,
    releaseSha,
    authorizationReference,
    sshAlias,
    sshConfigFile,
    expectedUser,
    expectedHost,
    knownHostsFile,
    connectTimeoutSeconds: boundedInteger(
      value("--connect-timeout-seconds="),
      1,
      30,
    ),
    commandTimeoutSeconds: boundedInteger(
      value("--command-timeout-seconds="),
      1,
      120,
    ),
    remoteRoot,
    remoteSecretFile,
    output,
  };
}

export async function executeRollbackReadiness(
  arguments_: readonly string[],
  dependencies: {
    readonly transport?: SshTransport;
    readonly verifyRelease?: (sha: string) => Promise<void>;
    readonly assertClean?: () => Promise<void>;
    readonly ledger?: MigrationLedger;
    readonly collector?: string;
  } = {},
): Promise<RollbackReadinessReport> {
  const options = parseRollbackReadinessArguments(arguments_);
  await (dependencies.verifyRelease ?? verifyLocalRelease)(options.releaseSha);
  await (dependencies.assertClean ?? assertCleanWorkingTree)();
  await assertRegularFile(options.sshConfigFile, "SSH config");
  await assertRegularFile(options.knownHostsFile, "known-hosts");
  await assertSafeOutput(options.output);
  const ledger = dependencies.ledger ?? (await readSourceMigrationLedger());
  const collector =
    dependencies.collector ??
    (await readFile(
      resolve(
        process.cwd(),
        "scripts/phase-9/remote-rollback-readiness-collector.sh",
      ),
      "utf8",
    ));
  assertCollectorReadOnly(collector);
  const transport = dependencies.transport ?? new RealSshTransport();
  const resolvedSsh = await transport.resolve(
    options.sshAlias,
    options.sshConfigFile,
    options.knownHostsFile,
  );
  assertResolvedSsh(resolvedSsh, options);
  const result = await transport.execute({
    alias: options.sshAlias,
    args: buildRollbackReadinessSshArguments(options, ledger),
    collectorStdin: collector,
    timeoutMilliseconds: options.commandTimeoutSeconds * 1000,
  });
  const protocol = parseProtocol(result.stdout);
  const secretLeakageCount =
    countSecrets(`${result.stdout}\n${result.stderr}`) +
    protocol.secretLeakageCount;
  const failedChecks = protocol.checks
    .filter((check) => check.status !== "PASS" || check.exitCode !== 0)
    .map((check) => check.id);
  let stopReason: string | null = null;
  if (result.timedOut) stopReason = "SSH_COMMAND_TIMEOUT";
  else if (result.outputExceeded) stopReason = "SSH_OUTPUT_LIMIT_EXCEEDED";
  else if (secretLeakageCount > 0) stopReason = "SECRET_LEAKAGE_DETECTED";
  else if (protocol.status !== "COMPLETE")
    stopReason = protocol.stopReason ?? "COLLECTOR_PROTOCOL_INCOMPLETE";
  else if (failedChecks.length > 0)
    stopReason = `REMOTE_READINESS_CHECKS_BLOCKED_${failedChecks.join("_")}`;
  else if (result.exitCode !== 0)
    stopReason = "SSH_EXIT_PROTOCOL_INCONSISTENCY";
  else {
    try {
      validateReadinessEvidence(protocol.checks, ledger);
    } catch (error) {
      stopReason = safeMessage(error);
    }
  }
  const report: RollbackReadinessReport = {
    reportSchemaVersion: ROLLBACK_READINESS_REPORT_SCHEMA_VERSION,
    status: stopReason === null ? "PASS" : "BLOCKED",
    target: "staging",
    releaseSha: options.releaseSha,
    authorizationReference: options.authorizationReference,
    timestamp: new Date().toISOString(),
    resolvedSsh: { host: resolvedSsh.hostname, user: resolvedSsh.user },
    sourceMigrationCount: ledger.count,
    sourceMigrationFingerprint: ledger.fingerprint,
    checks: protocol.checks,
    failedChecks,
    protocolParseStatus: protocol.status,
    sshExitCode: result.exitCode,
    sshSignal: result.signal ?? null,
    mutationCommandCount: 0,
    serverConnectionPerformed: true,
    secretLeakageCount,
    remoteSecretReferenceHash: createHash("sha256")
      .update(options.remoteSecretFile)
      .digest("hex"),
    stopReason,
  };
  await writeAtomicJson(options.output, report);
  return report;
}

export function buildRollbackReadinessSshArguments(
  options: RollbackReadinessOptions,
  ledger: MigrationLedger,
): readonly string[] {
  return [
    "-F",
    options.sshConfigFile,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${options.knownHostsFile}`,
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=no",
    "-o",
    "ChallengeResponseAuthentication=no",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    `ConnectTimeout=${options.connectTimeoutSeconds}`,
    "-T",
    options.sshAlias,
    "--",
    "sh",
    "-s",
    "--",
    options.releaseSha,
    options.remoteRoot,
    options.remoteSecretFile,
    String(ledger.count),
    ledger.fingerprint,
  ];
}

export async function generateRollbackMetadataDraft(input: {
  readonly reportPath: string;
  readonly outputPath: string;
  readonly releaseSha: string;
  readonly now?: Date;
}): Promise<RollbackMetadataDraft> {
  if (!GIT_SHA.test(input.releaseSha))
    throw safeError("Draft release SHA is invalid.");
  for (const path of [input.reportPath, input.outputPath]) {
    if (!isAbsolute(path)) throw safeError("Draft paths must be absolute.");
  }
  await assertRegularFile(input.reportPath, "Readiness report");
  await assertSafeOutput(input.outputPath);
  const raw = await readFile(input.reportPath, "utf8");
  if (countSecrets(raw) > 0)
    throw safeError("Readiness report contains secret material.");
  let report: RollbackReadinessReport;
  try {
    report = JSON.parse(raw) as RollbackReadinessReport;
  } catch {
    throw safeError("Readiness report JSON is malformed.");
  }
  if (
    report.reportSchemaVersion !== ROLLBACK_READINESS_REPORT_SCHEMA_VERSION ||
    report.releaseSha !== input.releaseSha ||
    report.target !== "staging" ||
    report.mutationCommandCount !== 0 ||
    report.secretLeakageCount !== 0
  ) {
    throw safeError("Readiness report contract is invalid.");
  }
  const evidence = new Map(
    report.checks.map((check) => [check.id, check.evidence]),
  );
  const current = parseCurrentImage(evidence.get("CURRENT_APP_IMAGE") ?? "");
  const candidates = parseCandidates(
    evidence.get("ROLLBACK_IMAGE_INVENTORY") ?? "",
  );
  const backup = parseBackup(evidence.get("BACKUP_EVIDENCE") ?? "");
  const serverTime = Date.parse(evidence.get("SERVER_TIME") ?? "");
  const backupTime = Date.parse(backup?.createdAt ?? "");
  const backupFresh =
    backup !== null &&
    Number.isFinite(serverTime) &&
    Number.isFinite(backupTime) &&
    backupTime <= serverTime &&
    serverTime - backupTime <= 48 * 60 * 60 * 1000;
  const metadataState = parseKeyValues(
    evidence.get("ROLLBACK_METADATA_PATH") ?? "",
  ).get("STATE");
  const databaseCompatible = databaseLedgerCompatible(
    evidence.get("DATABASE_MIGRATION_LEDGER") ?? "",
    report,
  );
  const compatibleCandidates = candidates.filter(
    (candidate) =>
      candidate.architecture === "linux/amd64" &&
      candidate.migrationCount === report.sourceMigrationCount &&
      candidate.migrationFingerprint === report.sourceMigrationFingerprint,
  );
  const blockers: string[] = [];
  if (!current) blockers.push("CURRENT_IMAGE_EVIDENCE_MISSING");
  if (compatibleCandidates.length === 0)
    blockers.push("ROLLBACK_CANDIDATE_MISSING");
  if (!backup) blockers.push("BACKUP_EVIDENCE_INVALID");
  else if (!backupFresh) blockers.push("BACKUP_EVIDENCE_STALE");
  if (!databaseCompatible) blockers.push("DATABASE_MIGRATION_LEDGER_MISMATCH");
  if (metadataState === "SYMLINK")
    blockers.push("APPROVED_METADATA_PATH_SYMLINK");
  if (
    metadataState !== "ABSENT" &&
    metadataState !== "FILE" &&
    metadataState !== "SYMLINK"
  )
    blockers.push("APPROVED_METADATA_PATH_STATE_UNKNOWN");
  const operatorDecisions = [
    "SELECT_ROLLBACK_RELEASE_AND_IMAGE_DIGEST",
    "APPROVE_SCHEMA_COMPATIBILITY",
    "PROVIDE_OPERATOR_CHANGE_REFERENCE",
  ];
  if (compatibleCandidates.length === 1) {
    operatorDecisions[0] = "CONFIRM_ROLLBACK_RELEASE_AND_IMAGE_DIGEST";
  }
  const selected =
    compatibleCandidates.length === 1 ? compatibleCandidates[0]! : null;
  const timestamp = (input.now ?? new Date()).toISOString();
  const fieldStates: Record<string, ResolutionStatus> = {
    imageId: selected
      ? "OPERATOR_DECISION_REQUIRED"
      : blockers.length
        ? "BLOCKED"
        : "OPERATOR_DECISION_REQUIRED",
    architecture: selected ? "RESOLVED" : "BLOCKED",
    composeService: "RESOLVED",
    releaseSha: "RESOLVED",
    previousReleaseSha: selected ? "OPERATOR_DECISION_REQUIRED" : "BLOCKED",
    currentImage: current ? "RESOLVED" : "BLOCKED",
    previousImage: selected ? "OPERATOR_DECISION_REQUIRED" : "BLOCKED",
    sourceMigrationCount: "RESOLVED",
    migrationLedgerFingerprint: "RESOLVED",
    databaseMigrationStatus: databaseCompatible ? "RESOLVED" : "BLOCKED",
    schemaCompatibilityDecision: "OPERATOR_DECISION_REQUIRED",
    backupIdentifier: backupFresh ? "RESOLVED" : "BLOCKED",
    backupChecksum: backupFresh ? "RESOLVED" : "BLOCKED",
    timestamp: "RESOLVED",
    operatorIdentityReference: "OPERATOR_DECISION_REQUIRED",
  };
  const draft: RollbackMetadataDraft = {
    draftSchemaVersion: ROLLBACK_DRAFT_SCHEMA_VERSION,
    status: blockers.length > 0 ? "BLOCKED" : "OPERATOR_DECISION_REQUIRED",
    approved: false,
    releaseSha: input.releaseSha,
    generatedAt: timestamp,
    sourceReportSha256: createHash("sha256").update(raw).digest("hex"),
    approvedTargetPath: APPROVED_METADATA_PATH,
    proposedMetadata: {
      imageId: selected?.imageId ?? null,
      architecture: selected ? "linux/amd64" : null,
      composeService: "app",
      releaseSha: input.releaseSha,
      previousReleaseSha: selected?.sourceSha ?? null,
      currentImage: current?.image ?? null,
      previousImage: selected?.image ?? null,
      sourceMigrationCount: report.sourceMigrationCount,
      migrationLedgerFingerprint: report.sourceMigrationFingerprint,
      databaseMigrationStatus: databaseCompatible ? "COMPATIBLE" : null,
      schemaCompatibilityDecision: null,
      backupIdentifier: backupFresh ? backup.identifier : null,
      backupChecksum: backupFresh ? backup.checksum : null,
      timestamp,
      operatorIdentityReference: null,
    },
    fieldStates,
    rollbackCandidates: compatibleCandidates,
    blockers,
    operatorDecisions,
    mutationCommandCount: 0,
    secretLeakageCount: 0,
  };
  await writeAtomicJson(input.outputPath, draft);
  return draft;
}

export const FUTURE_ROLLBACK_METADATA_INSTALL_CONTRACT = Object.freeze({
  implemented: false,
  executableInPhase9C5: false,
  requiredInputs: [
    "distinct authorization reference",
    "exact draft SHA-256",
    "exact current release",
    "explicit rollback release and immutable image digest",
    "explicit backup identifier and checksum",
    "APPROVED schema compatibility decision",
    "operator/change reference",
    `exact target ${APPROVED_METADATA_PATH}`,
  ],
  writeContract: [
    "atomic temporary file plus rename",
    "regular non-symlink target",
    "restrictive ownership and mode 0600",
    "post-write read-only verification",
  ],
});

function validateReadinessEvidence(
  checks: readonly RollbackReadinessCheck[],
  ledger: MigrationLedger,
): void {
  const byId = new Map(checks.map((check) => [check.id, check.evidence]));
  if (!Number.isFinite(Date.parse(byId.get("SERVER_TIME") ?? "")))
    throw safeError("SERVER_TIME_INVALID");
  const current = parseCurrentImage(byId.get("CURRENT_APP_IMAGE") ?? "");
  if (!current) throw safeError("CURRENT_IMAGE_EVIDENCE_INVALID");
  const rows = parseDatabaseRows(byId.get("DATABASE_MIGRATION_LEDGER") ?? "");
  assertDatabaseMigrationRows(ledger, rows);
  const schema = parseKeyValues(byId.get("SCHEMA_COMPATIBILITY_INPUTS") ?? "");
  if (
    schema.get("SOURCE_MIGRATION_COUNT") !== String(ledger.count) ||
    schema.get("SOURCE_MIGRATION_FINGERPRINT") !== ledger.fingerprint
  ) {
    throw safeError("SCHEMA_COMPATIBILITY_INPUTS_INVALID");
  }
  const metadataState = parseKeyValues(
    byId.get("ROLLBACK_METADATA_PATH") ?? "",
  ).get("STATE");
  if (!metadataState || !["ABSENT", "FILE", "SYMLINK"].includes(metadataState))
    throw safeError("ROLLBACK_METADATA_PATH_STATE_INVALID");
}

function parseProtocol(output: string): {
  readonly status: "COMPLETE" | "MALFORMED" | "NONE";
  readonly checks: readonly RollbackReadinessCheck[];
  readonly secretLeakageCount: number;
  readonly stopReason: string | null;
} {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0)
    return {
      status: "NONE",
      checks: [],
      secretLeakageCount: 0,
      stopReason: null,
    };
  const checks: RollbackReadinessCheck[] = [];
  let secretLeakageCount = 0;
  for (const line of lines) {
    const parts = line.split("|");
    const id = parts[1] as ReadinessCheckId;
    if (
      parts.length !== 7 ||
      parts[0] !== "P9R" ||
      id !== ROLLBACK_READINESS_CHECKS[checks.length] ||
      !["PASS", "BLOCKED", "FAIL"].includes(parts[2] ?? "") ||
      !isCanonicalBase64(parts[6] ?? "")
    ) {
      return {
        status: "MALFORMED",
        checks,
        secretLeakageCount,
        stopReason: "ROLLBACK_READINESS_PROTOCOL_INVALID",
      };
    }
    const durationMs = Number(parts[3]);
    const exitCode = Number(parts[4]);
    if (
      !Number.isSafeInteger(durationMs) ||
      durationMs < 0 ||
      !Number.isSafeInteger(exitCode)
    ) {
      return {
        status: "MALFORMED",
        checks,
        secretLeakageCount,
        stopReason: "ROLLBACK_READINESS_PROTOCOL_VALUE_INVALID",
      };
    }
    const decoded = Buffer.from(parts[6]!, "base64").toString("utf8");
    secretLeakageCount += countSecrets(decoded);
    checks.push({
      id,
      status: parts[2] as "PASS" | "BLOCKED" | "FAIL",
      durationMs,
      exitCode,
      summary: sanitize(parts[5] ?? ""),
      evidence: sanitize(decoded),
    });
  }
  return {
    status:
      checks.length === ROLLBACK_READINESS_CHECKS.length
        ? "COMPLETE"
        : "MALFORMED",
    checks,
    secretLeakageCount,
    stopReason:
      checks.length === ROLLBACK_READINESS_CHECKS.length
        ? null
        : "ROLLBACK_READINESS_PROTOCOL_INCOMPLETE",
  };
}

function parseCurrentImage(value: string): CurrentImageEvidence | null {
  const fields = parseKeyValues(value);
  const migrationCount = Number(fields.get("MIGRATION_COUNT"));
  const candidate: CurrentImageEvidence = {
    image: fields.get("TAG") ?? "",
    imageId: fields.get("IMAGE_ID") ?? "",
    architecture: fields.get("ARCHITECTURE") ?? "",
    sourceSha: fields.get("SOURCE_SHA") ?? "",
    migrationCount,
    migrationFingerprint: fields.get("MIGRATION_FINGERPRINT") ?? "",
    containerId: fields.get("CONTAINER_ID") ?? "",
  };
  return isCandidate(candidate) && candidate.containerId ? candidate : null;
}

function parseCandidates(value: string): RollbackCandidate[] {
  const candidates: RollbackCandidate[] = [];
  for (const line of value.split("\n")) {
    if (!line.startsWith("CANDIDATE=")) continue;
    const [image, imageId, architecture, sourceSha, count, fingerprint] = line
      .slice("CANDIDATE=".length)
      .split("|");
    const candidate: RollbackCandidate = {
      image: image ?? "",
      imageId: imageId ?? "",
      architecture: architecture ?? "",
      sourceSha: sourceSha ?? "",
      migrationCount: Number(count),
      migrationFingerprint: fingerprint ?? "",
    };
    if (isCandidate(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function isCandidate(candidate: RollbackCandidate): boolean {
  return (
    new RegExp(`^ueb-core:${candidate.sourceSha}$`, "u").test(
      candidate.image,
    ) &&
    GIT_SHA.test(candidate.sourceSha) &&
    IMAGE_ID.test(candidate.imageId) &&
    Number.isSafeInteger(candidate.migrationCount) &&
    SHA256.test(candidate.migrationFingerprint)
  );
}

function parseBackup(value: string): BackupEvidence | null {
  const fields = parseKeyValues(value);
  const backup = {
    identifier: fields.get("IDENTIFIER") ?? "",
    checksum: fields.get("CHECKSUM") ?? "",
    createdAt: fields.get("CREATED_AT") ?? "",
    offHostChecksumMatch: fields.get("OFF_HOST_CHECKSUM_MATCH") === "YES",
    catalogValidated: fields.get("CATALOG_VALIDATED") === "YES",
  };
  return SAFE_REFERENCE.test(backup.identifier) &&
    SHA256.test(backup.checksum) &&
    Number.isFinite(Date.parse(backup.createdAt)) &&
    backup.offHostChecksumMatch &&
    backup.catalogValidated
    ? backup
    : null;
}

function databaseLedgerCompatible(
  value: string,
  report: RollbackReadinessReport,
): boolean {
  try {
    const migrations = parseDatabaseRows(value).map((row) => ({
      name: row.migration_name,
      checksum: row.checksum,
    }));
    return (
      migrations.length === report.sourceMigrationCount &&
      createHash("sha256")
        .update(JSON.stringify({ version: 1, migrations }))
        .digest("hex") === report.sourceMigrationFingerprint
    );
  } catch {
    return false;
  }
}

function parseDatabaseRows(value: string) {
  return value
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [migration_name, checksum, applied] = line.split("|");
      return {
        migration_name: migration_name ?? "",
        checksum: checksum ?? "",
        finished_at: applied === "true" ? "APPLIED" : null,
        rolled_back_at: null,
      };
    });
}

function parseKeyValues(value: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of value.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    result.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return result;
}

function assertResolvedSsh(
  resolvedSsh: SshResolvedConfig,
  options: RollbackReadinessOptions,
): void {
  if (
    resolvedSsh.hostname !== options.expectedHost ||
    resolvedSsh.user !== options.expectedUser ||
    (resolvedSsh.proxyCommand ?? "none") !== "none" ||
    (resolvedSsh.localCommand ?? "none") !== "none" ||
    (resolvedSsh.permitLocalCommand ?? "no") !== "no"
  ) {
    throw safeError(
      "Resolved SSH identity or local execution policy is unsafe.",
    );
  }
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  const metadata = await lstat(path).catch(() => undefined);
  if (!metadata?.isFile() || metadata.isSymbolicLink())
    throw safeError(`${label} is missing or unsafe.`);
  await readFile(path).catch(() => {
    throw safeError(`${label} is not readable.`);
  });
}

async function assertSafeOutput(path: string): Promise<void> {
  if (resolve(path).startsWith(`${resolve(process.cwd())}/`))
    throw safeError("Output must be outside the repository.");
  const parent = await lstat(dirname(path)).catch(() => undefined);
  if (!parent?.isDirectory() || parent.isSymbolicLink())
    throw safeError("Output directory is missing or unsafe.");
  const existing = await lstat(path).catch(() => undefined);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile()))
    throw safeError("Output path is unsafe.");
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function assertExactMode(
  args: readonly string[],
  mode: string,
  prefixes: readonly string[],
): void {
  if (args.filter((argument) => argument === mode).length !== 1)
    throw safeError("Rollback readiness mode is missing or duplicated.");
  for (const argument of args) {
    if (argument === mode) continue;
    if (!prefixes.some((prefix) => argument.startsWith(prefix)))
      throw safeError("Unsupported rollback readiness argument.");
  }
}

function normalize(arguments_: readonly string[]): string[] {
  return arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
}

function singleValue(arguments_: readonly string[], prefix: string): string {
  const values = arguments_
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length));
  if (values.length !== 1 || !values[0])
    throw safeError("Rollback readiness argument is missing or duplicated.");
  return values[0];
}

function boundedInteger(
  value: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw safeError(
      "Rollback readiness timeout is outside the approved bound.",
    );
  return parsed;
}

function isCanonicalBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  );
}

function countSecrets(value: string): number {
  return [...value.matchAll(SECRET_PATTERN)].length;
}

function sanitize(value: string): string {
  return value.replaceAll(SECRET_PATTERN, "[REDACTED]").slice(0, 32_768);
}

function safeMessage(error: unknown): string {
  return sanitize(
    error instanceof Error ? error.message : "ROLLBACK_READINESS_BLOCKED",
  );
}

function safeError(message: string): SafePhase6StagingError {
  return new SafePhase6StagingError(message);
}

async function verifyLocalRelease(releaseSha: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolvePromise, reject) => {
    execFile("git", ["cat-file", "-e", `${releaseSha}^{commit}`], (error) => {
      if (error) reject(safeError("Release SHA is not available locally."));
      else resolvePromise();
    });
  });
}

async function assertCleanWorkingTree(): Promise<void> {
  const { execFile } = await import("node:child_process");
  const status = await new Promise<string>((resolvePromise, reject) => {
    execFile("git", ["status", "--porcelain"], (error, stdout) => {
      if (error) reject(safeError("Working-tree inspection failed."));
      else resolvePromise(stdout);
    });
  });
  if (status.trim())
    throw safeError("Read-only execution requires a clean tree.");
}

export type { SshExecutionRequest, SshExecutionResult, SshTransport };
