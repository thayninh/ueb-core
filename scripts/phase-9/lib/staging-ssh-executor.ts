import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
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

export const PHASE9_REPORT_SCHEMA_VERSION = 1;
export const PHASE9_REMOTE_CHECKS = [
  "SERVER_TIME",
  "RELEASE_IMAGE",
  "COMPOSE_SERVICES",
  "HEALTH",
  "READINESS",
  "DATABASE_MIGRATION_LEDGER",
  "BACKUP_EVIDENCE",
  "ROLLBACK_METADATA",
  "CADDY_ROUTE",
  "MONITORING_ALERT",
] as const;

const EXPECTED_ALIAS = "ueb-core-staging";
const EXPECTED_HOST = "103.200.25.54";
const EXPECTED_USER = "deploy";
const EXPECTED_ROOT = "/opt/ueb-core";
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const SAFE_REMOTE_SECRET = /^\/opt\/ueb-core\/secrets\/[A-Za-z0-9._-]+$/u;
const SECRET_PATTERN =
  /(?:password|passwd|token|cookie|session|private[_ -]?key|database[_ -]?url|postgres(?:ql)?:\/\/)[^\s|,}]*/giu;
const MUTATION_PATTERN =
  /\b(?:docker\s+(?:load|pull|build|run|rm|rmi|restart)|(?:docker\s+)?compose\s+(?:up|down|restart|run)|migrate\s+(?:deploy|dev|reset|resolve)|pg_dump|pg_restore|(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b|chmod|chown|install|mv|cp|rm|sed\s+-i|caddy\s+reload|systemctl\s+(?:start|stop|restart|enable|disable)|service\s+\S+\s+restart)\b/iu;
const MAX_STDOUT = 256 * 1024;
const MAX_STDERR = 64 * 1024;

export interface ExecuteReadOnlyOptions {
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

export interface SshResolvedConfig {
  readonly hostname: string;
  readonly user: string;
  readonly proxyCommand?: string;
  readonly localCommand?: string;
  readonly permitLocalCommand?: string;
}

export interface SshExecutionRequest {
  readonly alias: string;
  readonly args: readonly string[];
  readonly collectorStdin: string;
  readonly timeoutMilliseconds: number;
}

export interface SshExecutionResult {
  readonly exitCode: number;
  readonly signal?: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
  readonly outputExceeded?: boolean;
}

export interface SshTransport {
  resolve(
    alias: string,
    configFile: string,
    knownHostsFile: string,
  ): Promise<SshResolvedConfig>;
  execute(request: SshExecutionRequest): Promise<SshExecutionResult>;
}

export interface Phase9CheckReport {
  readonly id: (typeof PHASE9_REMOTE_CHECKS)[number];
  readonly status: "PASS" | "BLOCKED" | "FAIL";
  readonly durationMs: number;
  readonly exitCode: number;
  readonly summary: string;
  readonly evidence: string;
}

export interface Phase9ExecutionReport {
  readonly reportSchemaVersion: 1;
  readonly status: "PASS" | "BLOCKED";
  readonly target: "staging";
  readonly releaseSha: string;
  readonly authorizationReference: string;
  readonly timestamp: string;
  readonly resolvedSsh: { readonly host: string; readonly user: string };
  readonly sourceMigrationCount: number;
  readonly sourceMigrationFingerprint: string;
  readonly checks: readonly Phase9CheckReport[];
  readonly failedCheck:
    Phase9CheckReport["id"] | "SSH_TRANSPORT" | "COLLECTOR_PROTOCOL" | null;
  readonly protocolParseStatus: "COMPLETE" | "PARTIAL" | "MALFORMED" | "NONE";
  readonly sshExitCode: number;
  readonly sshSignal: string | null;
  readonly mutationCommandCount: 0;
  readonly serverConnectionPerformed: boolean;
  readonly secretLeakageCount: number;
  readonly remoteSecretReferenceHash: string;
  readonly stopReason: string | null;
}

export function parseExecuteReadOnlyArguments(
  arguments_: readonly string[],
): ExecuteReadOnlyOptions {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  if (!args.includes("--execute-read-only") || args.includes("--dry-run")) {
    throw safeError("Dry-run and read-only execution are mutually exclusive.");
  }
  const allowed = new Set([
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
  ]);
  for (const argument of args) {
    if (argument === "--execute-read-only") continue;
    if (![...allowed].some((prefix) => argument.startsWith(prefix))) {
      throw safeError("Unsupported remote preflight argument.");
    }
  }
  if (
    args.filter((argument) => argument === "--execute-read-only").length !== 1
  ) {
    throw safeError("Read-only execution flag is missing or duplicated.");
  }
  const value = (prefix: string): string => singleValue(args, prefix);
  const target = value("--target=");
  const releaseSha = value("--release-sha=");
  const authorizationReference = value("--authorization-ref=");
  const sshAlias = value("--ssh-alias=");
  const sshConfigFile = value("--ssh-config-file=");
  const expectedUser = value("--expected-user=");
  const expectedHost = value("--expected-host=");
  const knownHostsFile = value("--known-hosts-file=");
  const remoteRoot = value("--remote-root=");
  const remoteSecretFile = value("--remote-secret-file=");
  const output = value("--output=");
  if (target !== "staging" || !GIT_SHA.test(releaseSha)) {
    throw safeError(
      "Only an exact staging target and release SHA are allowed.",
    );
  }
  if (!SAFE_REFERENCE.test(authorizationReference)) {
    throw safeError("Authorization reference is missing or unsafe.");
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
    throw safeError(
      "Remote secret reference is outside the approved staging path.",
    );
  }
  for (const path of [sshConfigFile, knownHostsFile, output]) {
    if (!isAbsolute(path))
      throw safeError("Local executor paths must be absolute.");
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
      "connect timeout",
    ),
    commandTimeoutSeconds: boundedInteger(
      value("--command-timeout-seconds="),
      1,
      120,
      "command timeout",
    ),
    remoteRoot,
    remoteSecretFile,
    output,
  };
}

export class RealSshTransport implements SshTransport {
  async resolve(
    alias: string,
    configFile: string,
    knownHostsFile: string,
  ): Promise<SshResolvedConfig> {
    const output = await execFilePromise("ssh", [
      "-G",
      "-F",
      configFile,
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      `UserKnownHostsFile=${knownHostsFile}`,
      "-o",
      "PermitLocalCommand=no",
      "-o",
      "ClearAllForwardings=yes",
      alias,
    ]);
    const fields = new Map(
      output
        .split("\n")
        .map((line) => line.trim().split(/\s+/u, 2) as [string, string])
        .filter((entry) => entry[0] && entry[1]),
    );
    return {
      hostname: fields.get("hostname") ?? "",
      user: fields.get("user") ?? "",
      proxyCommand: fields.get("proxycommand") ?? "none",
      localCommand: fields.get("localcommand") ?? "none",
      permitLocalCommand: fields.get("permitlocalcommand") ?? "no",
    };
  }

  async execute(request: SshExecutionRequest): Promise<SshExecutionResult> {
    return await new Promise((resolveResult) => {
      const child = spawn("ssh", [...request.args], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let outputExceeded = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, request.timeoutMilliseconds);
      const append = (
        current: string,
        chunk: Buffer,
        maximum: number,
      ): string => {
        if (Buffer.byteLength(current) + chunk.byteLength > maximum) {
          outputExceeded = true;
          child.kill("SIGKILL");
          return current;
        }
        return current + chunk.toString("utf8");
      };
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk, MAX_STDOUT);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk, MAX_STDERR);
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolveResult({
          exitCode: 255,
          stdout,
          stderr: "SSH_EXECUTION_FAILED",
        });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolveResult({
          exitCode: code ?? 255,
          signal,
          stdout,
          stderr,
          timedOut,
          outputExceeded,
        });
      });
      child.stdin.end(request.collectorStdin);
    });
  }
}

export async function executeReadOnlyPreflight(
  arguments_: readonly string[],
  dependencies: {
    readonly transport?: SshTransport;
    readonly verifyRelease?: (sha: string) => Promise<void>;
    readonly assertClean?: () => Promise<void>;
    readonly ledger?: MigrationLedger;
    readonly collector?: string;
  } = {},
): Promise<Phase9ExecutionReport> {
  const options = parseExecuteReadOnlyArguments(arguments_);
  await (dependencies.verifyRelease ?? verifyLocalRelease)(options.releaseSha);
  await (dependencies.assertClean ?? assertCleanWorkingTree)();
  await assertRegularFile(options.sshConfigFile, "SSH config");
  await assertRegularFile(options.knownHostsFile, "known-hosts");
  await assertSafeOutput(options.output);
  const ledger = dependencies.ledger ?? (await readSourceMigrationLedger());
  const collector =
    dependencies.collector ??
    (await readFile(
      resolve(process.cwd(), "scripts/phase-9/remote-read-only-collector.sh"),
      "utf8",
    ));
  assertCollectorReadOnly(collector);
  const transport = dependencies.transport ?? new RealSshTransport();
  const resolved = await transport.resolve(
    options.sshAlias,
    options.sshConfigFile,
    options.knownHostsFile,
  );
  if (
    resolved.hostname !== options.expectedHost ||
    resolved.user !== options.expectedUser ||
    (resolved.proxyCommand ?? "none") !== "none" ||
    (resolved.localCommand ?? "none") !== "none" ||
    (resolved.permitLocalCommand ?? "no") !== "no"
  ) {
    throw safeError(
      "Resolved SSH identity or local execution policy is unsafe.",
    );
  }
  const sshArgs = buildSshArguments(options, ledger);
  const result = await transport.execute({
    alias: options.sshAlias,
    args: sshArgs,
    collectorStdin: collector,
    timeoutMilliseconds: options.commandTimeoutSeconds * 1000,
  });
  const raw = `${result.stdout}\n${result.stderr}`;
  const protocol = parseCollectorProtocol(result.stdout);
  const secretLeakageCount =
    [...raw.matchAll(SECRET_PATTERN)].length + protocol.secretLeakageCount;
  const checks = protocol.checks;
  let failedCheck: Phase9ExecutionReport["failedCheck"] = null;
  let stopReason: string | null = null;
  const firstRemoteFailure = checks.find(
    (check) => check.status !== "PASS" || check.exitCode !== 0,
  );
  if (result.timedOut) {
    failedCheck = "SSH_TRANSPORT";
    stopReason = "SSH_COMMAND_TIMEOUT";
  } else if (result.outputExceeded) {
    failedCheck = "SSH_TRANSPORT";
    stopReason = "SSH_OUTPUT_LIMIT_EXCEEDED";
  } else if (secretLeakageCount > 0) {
    failedCheck = firstRemoteFailure?.id ?? "COLLECTOR_PROTOCOL";
    stopReason = "SECRET_LEAKAGE_DETECTED";
  } else if (protocol.status === "MALFORMED") {
    failedCheck = "COLLECTOR_PROTOCOL";
    stopReason = protocol.stopReason ?? "COLLECTOR_PROTOCOL_MALFORMED";
  } else if (firstRemoteFailure) {
    failedCheck = firstRemoteFailure.id;
    stopReason = sanitize(
      `REMOTE_CHECK_${firstRemoteFailure.id}_${firstRemoteFailure.status}_${firstRemoteFailure.summary}`,
    );
  } else if (protocol.status === "NONE" && result.exitCode !== 0) {
    failedCheck = "SSH_TRANSPORT";
    stopReason = "SSH_TRANSPORT_FAILED_WITHOUT_PROTOCOL";
  } else if (protocol.status !== "COMPLETE") {
    failedCheck = "COLLECTOR_PROTOCOL";
    stopReason = "COLLECTOR_PROTOCOL_INCOMPLETE";
  } else if (result.exitCode !== 0) {
    failedCheck = "COLLECTOR_PROTOCOL";
    stopReason = "SSH_EXIT_PROTOCOL_INCONSISTENCY";
  } else {
    try {
      validateChecks(checks, options, ledger);
    } catch (error) {
      stopReason = safeMessage(error);
      failedCheck = failedCheckForValidation(stopReason);
    }
  }
  const report: Phase9ExecutionReport = {
    reportSchemaVersion: PHASE9_REPORT_SCHEMA_VERSION,
    status: stopReason === null ? "PASS" : "BLOCKED",
    target: "staging",
    releaseSha: options.releaseSha,
    authorizationReference: options.authorizationReference,
    timestamp: new Date().toISOString(),
    resolvedSsh: { host: resolved.hostname, user: resolved.user },
    sourceMigrationCount: ledger.count,
    sourceMigrationFingerprint: ledger.fingerprint,
    checks,
    failedCheck,
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
  await writeAtomicReport(options.output, report);
  return report;
}

export function buildSshArguments(
  options: ExecuteReadOnlyOptions,
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

export function assertCollectorReadOnly(collector: string): void {
  if (MUTATION_PATTERN.test(stripComments(collector))) {
    throw safeError("Remote collector contains a forbidden mutation token.");
  }
  if (!collector.includes("default_transaction_read_only=on")) {
    throw safeError("Remote database inspection is not explicitly read-only.");
  }
  if (/\bsudo\b|\beval\b|set\s+-x/iu.test(stripComments(collector))) {
    throw safeError("Remote collector contains an unsafe execution primitive.");
  }
}

interface CollectorProtocolResult {
  readonly status: "COMPLETE" | "PARTIAL" | "MALFORMED" | "NONE";
  readonly checks: readonly Phase9CheckReport[];
  readonly secretLeakageCount: number;
  readonly stopReason: string | null;
}

function parseCollectorProtocol(output: string): CollectorProtocolResult {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return {
      status: "NONE",
      checks: [],
      secretLeakageCount: 0,
      stopReason: null,
    };
  }
  const checks: Phase9CheckReport[] = [];
  let secretLeakageCount = 0;
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length !== 7 || parts[0] !== "P9B") {
      return malformedProtocol(
        checks,
        secretLeakageCount,
        "COLLECTOR_PROTOCOL_LINE_INVALID",
      );
    }
    const id = parts[1] as Phase9CheckReport["id"];
    if (
      !PHASE9_REMOTE_CHECKS.includes(id) ||
      id !== PHASE9_REMOTE_CHECKS[checks.length]
    ) {
      return malformedProtocol(
        checks,
        secretLeakageCount,
        "COLLECTOR_PROTOCOL_ORDER_INVALID",
      );
    }
    const statusValue = parts[2];
    if (
      statusValue !== "PASS" &&
      statusValue !== "BLOCKED" &&
      statusValue !== "FAIL"
    ) {
      return malformedProtocol(
        checks,
        secretLeakageCount,
        "COLLECTOR_PROTOCOL_STATUS_INVALID",
      );
    }
    const durationMs = Number(parts[3]);
    const exitCode = Number(parts[4]);
    const encodedEvidence = parts[6] ?? "";
    if (
      !Number.isSafeInteger(durationMs) ||
      durationMs < 0 ||
      !Number.isSafeInteger(exitCode) ||
      !isCanonicalBase64(encodedEvidence)
    ) {
      return malformedProtocol(
        checks,
        secretLeakageCount,
        "COLLECTOR_PROTOCOL_VALUE_INVALID",
      );
    }
    const decodedEvidence = Buffer.from(encodedEvidence, "base64").toString(
      "utf8",
    );
    secretLeakageCount += [...decodedEvidence.matchAll(SECRET_PATTERN)].length;
    const evidence = sanitize(decodedEvidence);
    if (Buffer.byteLength(evidence) > 32_768) {
      return malformedProtocol(
        checks,
        secretLeakageCount,
        "COLLECTOR_PROTOCOL_EVIDENCE_LIMIT",
      );
    }
    checks.push({
      id,
      status: statusValue,
      durationMs,
      exitCode,
      summary: sanitize(parts[5] ?? ""),
      evidence,
    });
  }
  return {
    status:
      checks.length === PHASE9_REMOTE_CHECKS.length ? "COMPLETE" : "PARTIAL",
    checks,
    secretLeakageCount,
    stopReason: null,
  };
}

function malformedProtocol(
  checks: readonly Phase9CheckReport[],
  secretLeakageCount: number,
  stopReason: string,
): CollectorProtocolResult {
  return {
    status: "MALFORMED",
    checks,
    secretLeakageCount,
    stopReason,
  };
}

function isCanonicalBase64(value: string): boolean {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  );
}

function failedCheckForValidation(
  stopReason: string,
): Phase9ExecutionReport["failedCheck"] {
  if (stopReason.includes("RELEASE_IMAGE")) return "RELEASE_IMAGE";
  if (stopReason.includes("COMPOSE_SERVICE")) return "COMPOSE_SERVICES";
  if (stopReason.includes("migration ledger"))
    return "DATABASE_MIGRATION_LEDGER";
  if (stopReason.includes("BACKUP")) return "BACKUP_EVIDENCE";
  if (stopReason.includes("ROLLBACK")) return "ROLLBACK_METADATA";
  return "COLLECTOR_PROTOCOL";
}

function validateChecks(
  checks: readonly Phase9CheckReport[],
  options: ExecuteReadOnlyOptions,
  ledger: MigrationLedger,
): void {
  const byId = new Map(checks.map((check) => [check.id, check.evidence]));
  const image = byId.get("RELEASE_IMAGE") ?? "";
  if (
    !image.includes(
      `|${options.releaseSha}|${ledger.count}|${ledger.fingerprint}`,
    ) ||
    (image.match(/sha256:[a-f0-9]{64}\|linux\/amd64/gu) ?? []).length !== 2
  ) {
    throw safeError("RELEASE_IMAGE_CONTRACT_MISMATCH");
  }
  const services = byId.get("COMPOSE_SERVICES") ?? "";
  for (const service of ["app", "db"]) {
    if (
      !new RegExp(
        `(?:^|\\n)${service}\\|[^\\n]+\\|running\\|\\d+\\|`,
        "u",
      ).test(services)
    ) {
      throw safeError("COMPOSE_SERVICE_CONTRACT_MISMATCH");
    }
  }
  const rows = (byId.get("DATABASE_MIGRATION_LEDGER") ?? "")
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
  assertDatabaseMigrationRows(ledger, rows);
  const backup = byId.get("BACKUP_EVIDENCE") ?? "";
  const backupMetadataLine = backup
    .split("\n")
    .find((line) => line.startsWith("METADATA="));
  let backupMetadata: {
    database?: string;
    createdAt?: string;
    checksum?: string;
  } = {};
  try {
    backupMetadata = JSON.parse(
      backupMetadataLine?.slice("METADATA=".length) ?? "",
    ) as typeof backupMetadata;
  } catch {
    throw safeError("BACKUP_METADATA_INVALID");
  }
  const serverTime = Date.parse(byId.get("SERVER_TIME") ?? "");
  const backupTime = Date.parse(backupMetadata.createdAt ?? "");
  if (
    !/CHECKSUM=[a-f0-9]{64}/u.test(backup) ||
    !backup.includes("OFF_HOST_CHECKSUM_MATCH=YES") ||
    !backup.includes("CATALOG_VALIDATED_BY_METADATA_CONTRACT=YES") ||
    backupMetadata.database !== "ueb_core_staging" ||
    backupMetadata.checksum !== backup.match(/CHECKSUM=([a-f0-9]{64})/u)?.[1] ||
    !Number.isFinite(serverTime) ||
    !Number.isFinite(backupTime) ||
    backupTime > serverTime ||
    serverTime - backupTime > 48 * 60 * 60 * 1000
  ) {
    throw safeError("BACKUP_EVIDENCE_INVALID");
  }
  const rollback = byId.get("ROLLBACK_METADATA") ?? "";
  let rollbackMetadata: Record<string, unknown> = {};
  try {
    rollbackMetadata = JSON.parse(rollback) as Record<string, unknown>;
  } catch {
    throw safeError("ROLLBACK_METADATA_INVALID");
  }
  if (
    rollbackMetadata.releaseSha !== options.releaseSha ||
    rollbackMetadata.sourceMigrationCount !== ledger.count ||
    rollbackMetadata.migrationLedgerFingerprint !== ledger.fingerprint ||
    rollbackMetadata.databaseMigrationStatus !== "COMPATIBLE" ||
    rollbackMetadata.schemaCompatibilityDecision !== "APPROVED" ||
    !GIT_SHA.test(String(rollbackMetadata.previousReleaseSha ?? "")) ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(rollbackMetadata.imageId ?? "")) ||
    !/^[a-f0-9]{64}$/u.test(String(rollbackMetadata.backupChecksum ?? "")) ||
    !Number.isFinite(Date.parse(String(rollbackMetadata.timestamp ?? ""))) ||
    !SAFE_REFERENCE.test(
      String(rollbackMetadata.operatorIdentityReference ?? ""),
    )
  ) {
    throw safeError("ROLLBACK_METADATA_INVALID");
  }
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  const metadata = await lstat(path).catch(() => undefined);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw safeError(`${label} file is missing or unsafe.`);
  }
  await readFile(path).catch(() => {
    throw safeError(`${label} file is not readable.`);
  });
}

async function assertSafeOutput(path: string): Promise<void> {
  if (resolve(path).startsWith(`${resolve(process.cwd())}/`)) {
    throw safeError("Execution report must be outside the repository.");
  }
  const parent = await lstat(dirname(path)).catch(() => undefined);
  if (!parent?.isDirectory() || parent.isSymbolicLink()) {
    throw safeError("Execution report directory is missing or unsafe.");
  }
  const existing = await lstat(path).catch(() => undefined);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw safeError("Execution report path is unsafe.");
  }
}

async function writeAtomicReport(
  path: string,
  report: Phase9ExecutionReport,
): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
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

function sanitize(value: string): string {
  return value.replaceAll(SECRET_PATTERN, "[REDACTED]").slice(0, 32_768);
}

function stripComments(value: string): string {
  return value
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function boundedInteger(
  value: string,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw safeError(`${label} is outside the approved bound.`);
  }
  return parsed;
}

function singleValue(arguments_: readonly string[], prefix: string): string {
  const values = arguments_
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length));
  if (values.length !== 1 || !values[0]) {
    throw safeError("Remote preflight argument is missing or duplicated.");
  }
  return values[0];
}

function safeError(message: string): SafePhase6StagingError {
  return new SafePhase6StagingError(message);
}

function safeMessage(error: unknown): string {
  return sanitize(
    error instanceof Error ? error.message : "REMOTE_EXECUTION_BLOCKED",
  );
}

async function execFilePromise(
  command: string,
  args: readonly string[],
): Promise<string> {
  return await new Promise((resolveOutput, reject) => {
    execFile(
      command,
      [...args],
      { encoding: "utf8", maxBuffer: MAX_STDOUT },
      (error, stdout) => {
        if (error) reject(safeError("SSH_CONFIG_RESOLUTION_FAILED"));
        else resolveOutput(stdout);
      },
    );
  });
}

async function verifyLocalRelease(releaseSha: string): Promise<void> {
  await execFilePromise("git", [
    "cat-file",
    "-e",
    `${releaseSha}^{commit}`,
  ]).catch(() => {
    throw safeError("Release SHA is not available locally.");
  });
}

async function assertCleanWorkingTree(): Promise<void> {
  const status = await execFilePromise("git", ["status", "--porcelain"]);
  if (status.trim())
    throw safeError("Read-only execution requires a clean working tree.");
}
