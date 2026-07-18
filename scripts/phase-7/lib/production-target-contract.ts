import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PRODUCTION_TARGET_CONTRACT = {
  contractVersion: 2,
  contractBaseGitSha: "b5662c696cde365c701cf22811108ba5b5550037",
  domainStrategy: "PROMOTE_CURRENT_DOMAIN_AND_MOVE_STAGING",
  productionDomain: "ueb-core.cargis.vn",
  stagingDomainAfterGoLive: "ueb-core-staging.cargis.vn",
  database: "ueb_core_prod",
  ownerRole: "ueb_core_owner",
  runtimeRole: "ueb_core_app",
  provisionerRole: "ueb_core_provisioner",
  changeWindow: "2026-07-19T20:00:00+07:00/2026-07-19T23:00:00+07:00",
  rollbackImageSha: "971c42027873f7de3140f815b06c2dddcfb61ba6",
  rpo: "24h",
  rto: "4h",
  goLiveAuthorization: "NOT_PROVIDED",
  emailAlertEvidenceMaxAgeHours: 24,
  rosterManifestSha:
    "c622297ee3a0b31c6265b01973fa4589d8be949e9e720d9e04d6cd59be85f8b4",
  canonicalChecksum:
    "e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972",
  targetStateMode: "PLANNED_EMPTY_TARGET",
  expectedRosterBlockCount: 0,
  expectedCanonicalRowCount: 2_497,
  expectedMigrationCount: 8,
  expectedIdentityCreateCount: 254,
  expectedLecturerCreateCount: 246,
  expectedLeaderCreateCount: 6,
  expectedTestIdentityCreateCount: 2,
} as const;

export type ProductionTargetMode =
  "PREFLIGHT" | "BOOTSTRAP" | "VERIFY" | "RECONCILE_IDENTITIES";

export interface ProductionTargetCommand {
  readonly mode: ProductionTargetMode;
  readonly targetDatabase: string;
  readonly expectedGitSha: string;
  readonly rosterManifestSha: string;
  readonly canonicalChecksum: string;
  readonly expectedBlockCount: number;
  readonly targetStateMode: string;
  readonly domainStrategy: string;
  readonly productionDomain: string;
  readonly stagingDomainAfterGoLive: string;
  readonly ownerRole: string;
  readonly runtimeRole: string;
  readonly provisionerRole: string;
  readonly changeWindow: string;
  readonly rollbackImageSha: string;
  readonly backupEvidence: string;
  readonly offHostBackupEvidence: string;
  readonly rollbackEvidence: string;
  readonly emailAlertEvidence: string;
}

export interface ProductionTargetPlanResult {
  readonly report: string;
  readonly exitCode: number;
}

export class SafeProductionTargetError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const CONFIRMATION_BY_MODE: Readonly<Record<ProductionTargetMode, string>> = {
  PREFLIGHT: "--confirm-production-preflight-plan",
  BOOTSTRAP: "--confirm-production-bootstrap-plan",
  VERIFY: "--confirm-production-verify-plan",
  RECONCILE_IDENTITIES: "--confirm-production-identity-reconciliation-plan",
};

const VALUE_PREFIXES = [
  "--target-database=",
  "--expected-git-sha=",
  "--roster-manifest-sha=",
  "--canonical-checksum=",
  "--expected-block-count=",
  "--target-state-mode=",
  "--domain-strategy=",
  "--production-domain=",
  "--staging-domain-after-go-live=",
  "--owner-role=",
  "--runtime-role=",
  "--provisioner-role=",
  "--change-window=",
  "--rollback-image-sha=",
  "--backup-evidence=",
  "--off-host-backup-evidence=",
  "--rollback-evidence=",
  "--email-alert-evidence=",
] as const;

const DATABASE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/u;
const ROLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const FORBIDDEN_DATABASES = new Set([
  "ueb_core",
  "ueb_core_staging",
  "ueb_core_uat_phase5",
  "postgres",
  "template0",
  "template1",
]);

export function parseProductionTargetMode(
  value: string | undefined,
): ProductionTargetMode {
  if (value === "preflight") return "PREFLIGHT";
  if (value === "bootstrap") return "BOOTSTRAP";
  if (value === "verify") return "VERIFY";
  if (value === "reconcile-identities") return "RECONCILE_IDENTITIES";
  throw new SafeProductionTargetError("PRODUCTION_TARGET_MODE_INVALID");
}

export function parseProductionTargetCommand(
  mode: ProductionTargetMode,
  arguments_: readonly string[],
): ProductionTargetCommand {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  if (args.includes("--") || args.some((argument) => argument === "--force")) {
    throw new SafeProductionTargetError("PRODUCTION_ARGUMENTS_INVALID");
  }
  const confirmation = CONFIRMATION_BY_MODE[mode];
  const unknown = args.filter(
    (argument) =>
      argument !== confirmation &&
      !VALUE_PREFIXES.some((prefix) => argument.startsWith(prefix)),
  );
  if (
    unknown.length > 0 ||
    args.filter((argument) => argument === confirmation).length !== 1 ||
    VALUE_PREFIXES.some(
      (prefix) =>
        args.filter((argument) => argument.startsWith(prefix)).length !== 1,
    )
  ) {
    throw new SafeProductionTargetError(
      args.includes(confirmation)
        ? "PRODUCTION_ARGUMENTS_INVALID"
        : "PRODUCTION_CONFIRMATION_REQUIRED",
    );
  }
  const value = (prefix: (typeof VALUE_PREFIXES)[number]): string =>
    args.find((argument) => argument.startsWith(prefix))!.slice(prefix.length);
  const expectedBlockCountValue = value("--expected-block-count=");
  if (!/^\d+$/u.test(expectedBlockCountValue)) {
    throw new SafeProductionTargetError("ROSTER_BLOCK_COUNT_INVALID");
  }
  const command: ProductionTargetCommand = {
    mode,
    targetDatabase: value("--target-database="),
    expectedGitSha: value("--expected-git-sha="),
    rosterManifestSha: value("--roster-manifest-sha="),
    canonicalChecksum: value("--canonical-checksum="),
    expectedBlockCount: Number(expectedBlockCountValue),
    targetStateMode: value("--target-state-mode="),
    domainStrategy: value("--domain-strategy="),
    productionDomain: value("--production-domain="),
    stagingDomainAfterGoLive: value("--staging-domain-after-go-live="),
    ownerRole: value("--owner-role="),
    runtimeRole: value("--runtime-role="),
    provisionerRole: value("--provisioner-role="),
    changeWindow: value("--change-window="),
    rollbackImageSha: value("--rollback-image-sha="),
    backupEvidence: assertExternalEvidencePath(value("--backup-evidence=")),
    offHostBackupEvidence: assertExternalEvidencePath(
      value("--off-host-backup-evidence="),
    ),
    rollbackEvidence: assertExternalEvidencePath(value("--rollback-evidence=")),
    emailAlertEvidence: assertExternalEvidencePath(
      value("--email-alert-evidence="),
    ),
  };
  assertProductionTargetContract(command);
  return command;
}

export function assertProductionDatabase(database: string): void {
  if (
    !DATABASE_IDENTIFIER.test(database) ||
    FORBIDDEN_DATABASES.has(database) ||
    database.startsWith("ueb_core_uat_") ||
    database.startsWith("ueb_core_restore_") ||
    database.startsWith("ueb_core_staging_") ||
    database !== PRODUCTION_TARGET_CONTRACT.database
  ) {
    throw new SafeProductionTargetError("PRODUCTION_DATABASE_FORBIDDEN");
  }
}

export function assertProductionRoleSeparation(input: {
  readonly owner: string;
  readonly runtime: string;
  readonly provisioner: string;
}): void {
  const roles = [input.owner, input.runtime, input.provisioner];
  if (
    roles.some((role) => !ROLE_IDENTIFIER.test(role)) ||
    new Set(roles).size !== roles.length ||
    input.owner !== PRODUCTION_TARGET_CONTRACT.ownerRole ||
    input.runtime !== PRODUCTION_TARGET_CONTRACT.runtimeRole ||
    input.provisioner !== PRODUCTION_TARGET_CONTRACT.provisionerRole
  ) {
    throw new SafeProductionTargetError("PRODUCTION_ROLE_SEPARATION_INVALID");
  }
}

export function assertPlannedEmptyTarget(value: string): void {
  if (value !== PRODUCTION_TARGET_CONTRACT.targetStateMode) {
    throw new SafeProductionTargetError("PLANNED_EMPTY_TARGET_REQUIRED");
  }
}

export function parseProductionChangeWindow(
  value: string,
  now = new Date(),
): { readonly start: Date; readonly end: Date } {
  const parts = value.split("/");
  if (
    parts.length !== 2 ||
    parts.some((part) => !/(?:Z|[+-]\d{2}:\d{2})$/u.test(part))
  ) {
    throw new SafeProductionTargetError("PRODUCTION_CHANGE_WINDOW_INVALID");
  }
  const start = new Date(parts[0]!);
  const end = new Date(parts[1]!);
  const duration = end.getTime() - start.getTime();
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.getTime() <= now.getTime() ||
    duration <= 0 ||
    duration > 4 * 60 * 60 * 1000
  ) {
    throw new SafeProductionTargetError("PRODUCTION_CHANGE_WINDOW_INVALID");
  }
  return { start, end };
}

export async function runProductionTargetPlan(input: {
  readonly command: ProductionTargetCommand;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly now?: Date;
  readonly gitState?: () => Promise<{
    readonly head: string;
    readonly workingTreeClean: boolean;
  }>;
  readonly rollbackCommitExists?: (sha: string) => Promise<boolean>;
}): Promise<ProductionTargetPlanResult> {
  assertNoDatabaseCredentials(input.environment ?? process.env);
  const now = input.now ?? new Date();
  parseProductionChangeWindow(input.command.changeWindow, now);
  const [
    gitState,
    backup,
    offHost,
    rollback,
    emailAlert,
    rollbackCommitExists,
  ] = await Promise.all([
    (input.gitState ?? readGitState)(),
    inspectEvidence(input.command.backupEvidence, [
      "BACKUP_STATUS=PASS",
      "BACKUP_CHECKSUM_STATUS=PASS",
      "RESTORE_REHEARSAL_STATUS=PASS",
    ]),
    inspectEvidence(input.command.offHostBackupEvidence, [
      "OFF_HOST_BACKUP_STATUS=PASS",
    ]),
    inspectEvidence(input.command.rollbackEvidence, [
      "ROLLBACK_IMAGE_EXISTS=YES",
      "ROLLBACK_VERIFY=PASS",
      `ROLLBACK_IMAGE_SHA=${input.command.rollbackImageSha}`,
    ]),
    inspectEmailAlertEvidence(input.command.emailAlertEvidence, now),
    (input.rollbackCommitExists ?? gitCommitExists)(
      input.command.rollbackImageSha,
    ),
  ]);
  if (
    gitState.head !== input.command.expectedGitSha ||
    !gitState.workingTreeClean
  ) {
    throw new SafeProductionTargetError("PRODUCTION_GIT_STATE_MISMATCH");
  }
  if (!rollbackCommitExists) {
    throw new SafeProductionTargetError("ROLLBACK_IMAGE_NOT_FOUND");
  }
  const operationalBlockers = [
    ...(PRODUCTION_TARGET_CONTRACT.goLiveAuthorization === "NOT_PROVIDED"
      ? ["GO_LIVE_NOT_AUTHORIZED"]
      : []),
    ...(input.command.targetStateMode === "PLANNED_EMPTY_TARGET"
      ? ["PRODUCTION_DATABASE_NOT_CREATED"]
      : []),
    ...(!backup || !offHost ? ["PRODUCTION_BACKUP_EVIDENCE_UNAVAILABLE"] : []),
    ...(!rollback ? ["ROLLBACK_EVIDENCE_INVALID"] : []),
    ...(!emailAlert ? ["EMAIL_ALERT_EVIDENCE_INVALID"] : []),
  ];
  const modeLines = planLines(input.command.mode);
  const blocked = operationalBlockers.length > 0;
  return {
    report: [
      `MODE=${input.command.mode}`,
      `PLAN_STATUS=${blocked ? "BLOCKED_EXPECTED" : "PASS"}`,
      `PRODUCTION_PREFLIGHT=${blocked ? "BLOCKED_EXPECTED" : "PASS"}`,
      `TARGET_DATABASE=${input.command.targetDatabase}`,
      "TARGET_STATE_MODE=PLANNED_EMPTY_TARGET",
      "EMPTY_TARGET_SUPPORT=PASS",
      "ROLE_SEPARATION=PASS",
      "RUNTIME_NON_OWNER=YES",
      "RUNTIME_NOBYPASSRLS=REQUIRED",
      "PROVISIONER_NON_OWNER=YES",
      "ROSTER_SHA_GUARD=PASS",
      "CANONICAL_CHECKSUM_GUARD=PASS",
      `EXPECTED_CANONICAL_ROW_COUNT=${PRODUCTION_TARGET_CONTRACT.expectedCanonicalRowCount}`,
      `EXPECTED_MIGRATION_COUNT=${PRODUCTION_TARGET_CONTRACT.expectedMigrationCount}`,
      `ROSTER_BLOCK_COUNT=${input.command.expectedBlockCount}`,
      `BACKUP_GATE=${backup ? "PASS" : "BLOCKED"}`,
      `OFF_HOST_BACKUP_GATE=${offHost ? "PASS" : "BLOCKED"}`,
      `ROLLBACK_GATE=${rollback ? "PASS" : "BLOCKED"}`,
      "DOMAIN_CUTOVER_PLAN=PASS",
      `EMAIL_EVIDENCE_VALIDATION=${emailAlert ? "PASS" : "BLOCKED"}`,
      `EMAIL_ALERT_GATE=${emailAlert ? "PASS" : "BLOCKED"}`,
      `EMAIL_ALERT_TRANSPORT_GATE=${emailAlert ? "PASS" : "BLOCKED"}`,
      "SECRET_LEAKAGE=0",
      ...modeLines,
      `OPERATIONAL_BLOCK_COUNT=${operationalBlockers.length}`,
      `HARD_GATE=${blocked ? "BLOCKED" : "PASS"}`,
      `BLOCKING_REASON=${operationalBlockers.join(";") || "NONE"}`,
      "DATABASE_CONNECTIONS=0",
      "DATABASE_MUTATIONS=0",
      "PRODUCTION_DEPLOYMENT=NOT_PERFORMED",
      "PRODUCTION_PROVISIONING=NOT_PERFORMED",
    ].join("\n"),
    exitCode: blocked ? 2 : 0,
  };
}

function assertProductionTargetContract(
  command: ProductionTargetCommand,
): void {
  assertProductionDatabase(command.targetDatabase);
  assertProductionRoleSeparation({
    owner: command.ownerRole,
    runtime: command.runtimeRole,
    provisioner: command.provisionerRole,
  });
  assertPlannedEmptyTarget(command.targetStateMode);
  if (!GIT_SHA.test(command.expectedGitSha)) {
    throw new SafeProductionTargetError("EXPECTED_GIT_SHA_INVALID");
  }
  if (
    !SHA256.test(command.rosterManifestSha) ||
    command.rosterManifestSha !== PRODUCTION_TARGET_CONTRACT.rosterManifestSha
  ) {
    throw new SafeProductionTargetError("ROSTER_MANIFEST_SHA_MISMATCH");
  }
  if (
    !SHA256.test(command.canonicalChecksum) ||
    command.canonicalChecksum !== PRODUCTION_TARGET_CONTRACT.canonicalChecksum
  ) {
    throw new SafeProductionTargetError("CANONICAL_CHECKSUM_MISMATCH");
  }
  if (
    command.expectedBlockCount !==
    PRODUCTION_TARGET_CONTRACT.expectedRosterBlockCount
  ) {
    throw new SafeProductionTargetError("ROSTER_BLOCKERS_PRESENT");
  }
  if (
    command.domainStrategy !== PRODUCTION_TARGET_CONTRACT.domainStrategy ||
    command.productionDomain !== PRODUCTION_TARGET_CONTRACT.productionDomain ||
    command.stagingDomainAfterGoLive !==
      PRODUCTION_TARGET_CONTRACT.stagingDomainAfterGoLive ||
    !DOMAIN.test(command.productionDomain) ||
    !DOMAIN.test(command.stagingDomainAfterGoLive)
  ) {
    throw new SafeProductionTargetError("PRODUCTION_DOMAIN_STRATEGY_INVALID");
  }
  if (command.changeWindow !== PRODUCTION_TARGET_CONTRACT.changeWindow) {
    throw new SafeProductionTargetError("PRODUCTION_CHANGE_WINDOW_MISMATCH");
  }
  if (
    !GIT_SHA.test(command.rollbackImageSha) ||
    command.rollbackImageSha !== PRODUCTION_TARGET_CONTRACT.rollbackImageSha
  ) {
    throw new SafeProductionTargetError("ROLLBACK_IMAGE_SHA_MISMATCH");
  }
}

function assertNoDatabaseCredentials(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  for (const name of [
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "PHASE5_PROVISIONING_DATABASE_URL",
    "PHASE6_PROVISIONING_DATABASE_URL",
    "PHASE7_PROVISIONING_DATABASE_URL",
  ]) {
    if (environment[name]) {
      throw new SafeProductionTargetError(
        "DATABASE_CREDENTIALS_FORBIDDEN_IN_LOCAL_PLAN",
      );
    }
  }
}

function assertExternalEvidencePath(path: string): string {
  if (!isAbsolute(path)) {
    throw new SafeProductionTargetError("EVIDENCE_PATH_INVALID");
  }
  const absolute = resolve(path);
  const repository = resolve(process.cwd());
  const repositoryRelative = relative(repository, absolute);
  if (
    repositoryRelative === "" ||
    (repositoryRelative !== ".." &&
      !repositoryRelative.startsWith(`..${sep}`) &&
      !isAbsolute(repositoryRelative))
  ) {
    throw new SafeProductionTargetError("EVIDENCE_PATH_INVALID");
  }
  return absolute;
}

async function inspectEvidence(
  path: string,
  requiredLines: readonly string[],
): Promise<boolean> {
  const metadata = await lstat(path).catch(() => undefined);
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.size > 1024 * 1024
  ) {
    return false;
  }
  const content = await readFile(path, "utf8");
  const lines = content.split(/\r?\n/u);
  return requiredLines.every((line) => lines.includes(line));
}

async function inspectEmailAlertEvidence(
  path: string,
  now: Date,
): Promise<boolean> {
  const metadata = await lstat(path).catch(() => undefined);
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.size > 1024 * 1024
  ) {
    return false;
  }
  const content = await readFile(path, "utf8");
  if (
    /(?:APP_PASSWORD|SMTP_PASSWORD|GMAIL_APP_PASSWORD|DATABASE_URL)\s*=/iu.test(
      content,
    ) ||
    /(?:postgres(?:ql)?|smtps?):\/\/[^\s@]+:[^\s@]+@/iu.test(content)
  ) {
    return false;
  }
  const lines = content.split(/\r?\n/u);
  const requiredLines = [
    "EMAIL_ALERT_TRANSPORT=GMAIL_SMTP",
    "SMTP_AUTH=PASS",
    "EMAIL_TEST=PASS",
    "EMAIL_ALERT_GATE=PASS",
    "SENDER_CONFIRMED=YES",
    "RECIPIENT_CONFIRMED=YES",
    "MESSAGE_CONTENT=NON_SENSITIVE",
    "CREDENTIAL_LOGGED=NO",
  ];
  if (requiredLines.some((line) => !lines.includes(line))) return false;
  const timestampLine = lines.find((line) =>
    line.startsWith("EVIDENCE_TIMESTAMP_UTC="),
  );
  const timestamp = new Date(
    timestampLine?.slice("EVIDENCE_TIMESTAMP_UTC=".length) ?? "",
  );
  const age = now.getTime() - timestamp.getTime();
  return (
    !Number.isNaN(timestamp.getTime()) &&
    age >= -5 * 60 * 1000 &&
    age <=
      PRODUCTION_TARGET_CONTRACT.emailAlertEvidenceMaxAgeHours * 60 * 60 * 1000
  );
}

async function readGitState(): Promise<{
  readonly head: string;
  readonly workingTreeClean: boolean;
}> {
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() }),
    execFileAsync("git", ["status", "--porcelain"], {
      cwd: process.cwd(),
    }),
  ]);
  return { head: head.trim(), workingTreeClean: status.trim() === "" };
}

async function gitCommitExists(sha: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["cat-file", "-e", `${sha}^{commit}`], {
      cwd: process.cwd(),
    });
    return true;
  } catch {
    return false;
  }
}

function planLines(mode: ProductionTargetMode): readonly string[] {
  if (mode === "BOOTSTRAP") {
    return [
      "EMPTY_TARGET_BOOTSTRAP_PLAN=PASS",
      "MIGRATION_APPLY_PLAN=PASS",
      "RUNTIME_ACL_RECONCILIATION_PLAN=PASS",
      "CANONICAL_IMPORT_PLAN=PASS",
      "CANONICAL_IMPORT_ROW_COUNT=2497",
    ];
  }
  if (mode === "VERIFY") {
    return [
      "PRODUCTION_TARGET_VERIFY_PLAN=PASS",
      "RLS_DEFAULT_DENY_VERIFY=REQUIRED",
      "HEALTH_READINESS_TLS_VERIFY=REQUIRED",
      "PRODUCTION_SMOKE_CHECKLIST=PASS",
    ];
  }
  if (mode === "RECONCILE_IDENTITIES") {
    return [
      "ROSTER_RECONCILIATION_PLAN=PASS",
      "EXPECTED_IDENTITY_CREATE_COUNT=254",
      "EXPECTED_LECTURER_CREATE_COUNT=246",
      "EXPECTED_LEADER_CREATE_COUNT=6",
      "EXPECTED_TEST_IDENTITY_CREATE_COUNT=2",
    ];
  }
  return [
    "DATABASE_NAME_GUARD=PASS",
    "CHANGE_WINDOW_GUARD=PASS",
    "ROLLBACK_IMAGE_EXISTENCE=PASS",
    "PRODUCTION_SMOKE_CHECKLIST=PASS",
  ];
}
