import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { Client, type ClientBase } from "pg";

import {
  APP_RUNTIME_MANAGED_IDENTITY_TABLES,
  PROVISIONING_TABLE_PRIVILEGES,
} from "../../phase-5/lib/provisioning-role";
import { prepareSourceFile } from "../../phase-2/lib/row-parser";
import { loadSourceContract } from "../../phase-2/lib/source-contract";

const execFileAsync = promisify(execFile);
const OPERATOR_SOURCE_SHA_PATH = "/operator/.source-git-sha";

export const PRODUCTION_EXECUTOR_CONTRACT = {
  database: "ueb_core_prod",
  restorePrefix: "ueb_core_prod_restore_",
  restoreMarker: "ueb-core:phase-7:production-restore",
  ownerRole: "ueb_core_owner",
  runtimeRole: "ueb_core_app",
  provisionerRole: "ueb_core_provisioner",
  authorizationPrefix: "CREATE_AND_VALIDATE_PRODUCTION_TARGET_ONLY",
  rosterManifestSha:
    "c622297ee3a0b31c6265b01973fa4589d8be949e9e720d9e04d6cd59be85f8b4",
  canonicalChecksum:
    "e276a144f5f8accb4ed6c6d2a6d7ec38a862d2e84467cb5fe43d342a95d7e972",
  canonicalRowCount: 2_497,
  migrationCount: 8,
  rollbackImageSha: "971c42027873f7de3140f815b06c2dddcfb61ba6",
  maximumWindowMilliseconds: 4 * 60 * 60 * 1000,
  expectedIdentityCount: 254,
} as const;

export type ProductionExecutorMode =
  | "PREFLIGHT"
  | "BOOTSTRAP"
  | "VERIFY"
  | "RECONCILE_IDENTITIES"
  | "BACKUP"
  | "RESTORE"
  | "CLEANUP_RESTORE";

export interface ProductionExecutorCommand {
  readonly mode: ProductionExecutorMode;
  readonly targetDatabase: string;
  readonly sourceDatabase?: string;
  readonly authorizationReference: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly expectedGitSha: string;
  readonly rosterManifestSha: string;
  readonly canonicalChecksum: string;
  readonly ownerRole: string;
  readonly runtimeRole: string;
  readonly provisionerRole: string;
  readonly emailEvidence: string;
  readonly rollbackEvidence: string;
  readonly appArchive: string;
  readonly appArchiveSha256: string;
  readonly operatorArchive: string;
  readonly operatorArchiveSha256: string;
  readonly canonicalSource?: string;
  readonly canonicalAuditDirectory?: string;
  readonly backupPath?: string;
  readonly offHostDirectory?: string;
  readonly dryRun: boolean;
}

export interface ProductionExecutorResult {
  readonly report: string;
  readonly exitCode: number;
}

export interface ProductionExecutionAdapter {
  bootstrap(command: ProductionExecutorCommand): Promise<readonly string[]>;
  verify(command: ProductionExecutorCommand): Promise<readonly string[]>;
  reconcile(command: ProductionExecutorCommand): Promise<readonly string[]>;
  backup(command: ProductionExecutorCommand): Promise<readonly string[]>;
  restore(command: ProductionExecutorCommand): Promise<readonly string[]>;
  cleanupRestore(
    command: ProductionExecutorCommand,
  ): Promise<readonly string[]>;
}

export class SafeProductionExecutorError extends Error {
  constructor(
    readonly code: string,
    readonly mutationPossible = false,
  ) {
    super(code);
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/u;
const CONFIRMATIONS: Readonly<Record<ProductionExecutorMode, string>> = {
  PREFLIGHT: "--confirm-production-preflight",
  BOOTSTRAP: "--confirm-create-production-target",
  VERIFY: "--confirm-production-verify",
  RECONCILE_IDENTITIES: "--confirm-production-identity-reconciliation",
  BACKUP: "--confirm-production-backup",
  RESTORE: "--confirm-production-restore-rehearsal",
  CLEANUP_RESTORE: "--confirm-cleanup-production-restore",
};
const COMMON_PREFIXES = [
  "--target-database=",
  "--authorization-reference=",
  "--change-window-start=",
  "--change-window-end=",
  "--expected-git-sha=",
  "--roster-manifest-sha=",
  "--canonical-checksum=",
  "--owner-role=",
  "--runtime-role=",
  "--provisioner-role=",
  "--email-alert-evidence=",
  "--rollback-evidence=",
  "--app-archive=",
  "--app-archive-sha256=",
  "--operator-archive=",
  "--operator-archive-sha256=",
] as const;
const MODE_PREFIXES: Readonly<
  Record<ProductionExecutorMode, readonly string[]>
> = {
  PREFLIGHT: [],
  BOOTSTRAP: ["--canonical-source=", "--canonical-audit-directory="],
  VERIFY: [],
  RECONCILE_IDENTITIES: [],
  BACKUP: ["--backup=", "--off-host-directory="],
  RESTORE: ["--source-database=", "--backup="],
  CLEANUP_RESTORE: ["--source-database=", "--backup="],
};

export function parseProductionExecutorMode(
  value: string | undefined,
): ProductionExecutorMode {
  if (value === "preflight") return "PREFLIGHT";
  if (value === "bootstrap") return "BOOTSTRAP";
  if (value === "verify") return "VERIFY";
  if (value === "reconcile-identities") return "RECONCILE_IDENTITIES";
  if (value === "backup") return "BACKUP";
  if (value === "restore") return "RESTORE";
  if (value === "cleanup-restore") return "CLEANUP_RESTORE";
  throw new SafeProductionExecutorError("PRODUCTION_EXECUTOR_MODE_INVALID");
}

export function parseProductionExecutorCommand(
  mode: ProductionExecutorMode,
  arguments_: readonly string[],
): ProductionExecutorCommand {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  if (args.includes("--") || args.includes("--force")) {
    throw new SafeProductionExecutorError("PRODUCTION_ARGUMENTS_INVALID");
  }
  const prefixes = [...COMMON_PREFIXES, ...MODE_PREFIXES[mode]];
  const confirmation = CONFIRMATIONS[mode];
  const dryRun = args.includes("--dry-run");
  const allowedExact = new Set([
    confirmation,
    ...(mode === "BOOTSTRAP" ? ["--dry-run"] : []),
  ]);
  if (
    args.some(
      (argument) =>
        !allowedExact.has(argument) &&
        !prefixes.some((prefix) => argument.startsWith(prefix)),
    ) ||
    prefixes.some(
      (prefix) =>
        args.filter((argument) => argument.startsWith(prefix)).length !== 1,
    ) ||
    args.filter((argument) => argument === confirmation).length > 1 ||
    (dryRun && args.includes(confirmation)) ||
    (!dryRun &&
      args.filter((argument) => argument === confirmation).length !== 1)
  ) {
    throw new SafeProductionExecutorError(
      dryRun || args.includes(confirmation)
        ? "PRODUCTION_ARGUMENTS_INVALID"
        : "PRODUCTION_CONFIRMATION_REQUIRED",
    );
  }
  const value = (prefix: string): string =>
    args.find((argument) => argument.startsWith(prefix))!.slice(prefix.length);
  const optional = (prefix: string): string | undefined => {
    const argument = args.find((candidate) => candidate.startsWith(prefix));
    return argument?.slice(prefix.length);
  };
  const command: ProductionExecutorCommand = {
    mode,
    targetDatabase: value("--target-database="),
    authorizationReference: value("--authorization-reference="),
    windowStart: value("--change-window-start="),
    windowEnd: value("--change-window-end="),
    expectedGitSha: value("--expected-git-sha="),
    rosterManifestSha: value("--roster-manifest-sha="),
    canonicalChecksum: value("--canonical-checksum="),
    ownerRole: value("--owner-role="),
    runtimeRole: value("--runtime-role="),
    provisionerRole: value("--provisioner-role="),
    emailEvidence: assertExternalPath(value("--email-alert-evidence=")),
    rollbackEvidence: assertExternalPath(value("--rollback-evidence=")),
    appArchive: assertExternalPath(value("--app-archive=")),
    appArchiveSha256: value("--app-archive-sha256="),
    operatorArchive: assertExternalPath(value("--operator-archive=")),
    operatorArchiveSha256: value("--operator-archive-sha256="),
    canonicalSource: optional("--canonical-source=")
      ? assertExternalPath(optional("--canonical-source=")!)
      : undefined,
    canonicalAuditDirectory: optional("--canonical-audit-directory=")
      ? assertExternalPath(optional("--canonical-audit-directory=")!)
      : undefined,
    sourceDatabase: optional("--source-database="),
    backupPath: optional("--backup=")
      ? assertExternalPath(optional("--backup=")!)
      : undefined,
    offHostDirectory: optional("--off-host-directory=")
      ? assertExternalPath(optional("--off-host-directory=")!)
      : undefined,
    dryRun,
  };
  assertProductionExecutorContract(command);
  return command;
}

export function assertProductionExecutorContract(
  command: ProductionExecutorCommand,
): void {
  if (
    !command.authorizationReference.startsWith(
      PRODUCTION_EXECUTOR_CONTRACT.authorizationPrefix,
    )
  ) {
    throw new SafeProductionExecutorError("PRODUCTION_AUTHORIZATION_REQUIRED");
  }
  if (
    command.ownerRole !== PRODUCTION_EXECUTOR_CONTRACT.ownerRole ||
    command.runtimeRole !== PRODUCTION_EXECUTOR_CONTRACT.runtimeRole ||
    command.provisionerRole !== PRODUCTION_EXECUTOR_CONTRACT.provisionerRole ||
    new Set([command.ownerRole, command.runtimeRole, command.provisionerRole])
      .size !== 3
  ) {
    throw new SafeProductionExecutorError("PRODUCTION_ROLE_SEPARATION_INVALID");
  }
  if (
    command.rosterManifestSha !==
      PRODUCTION_EXECUTOR_CONTRACT.rosterManifestSha ||
    command.canonicalChecksum !==
      PRODUCTION_EXECUTOR_CONTRACT.canonicalChecksum ||
    !SHA256.test(command.rosterManifestSha) ||
    !SHA256.test(command.canonicalChecksum) ||
    !SHA256.test(command.appArchiveSha256) ||
    !SHA256.test(command.operatorArchiveSha256) ||
    !GIT_SHA.test(command.expectedGitSha)
  ) {
    throw new SafeProductionExecutorError(
      "PRODUCTION_IMMUTABLE_INPUT_MISMATCH",
    );
  }
  const restoreMode =
    command.mode === "RESTORE" || command.mode === "CLEANUP_RESTORE";
  if (restoreMode) {
    assertProductionRestoreDatabase(command.targetDatabase);
    if (command.sourceDatabase !== PRODUCTION_EXECUTOR_CONTRACT.database) {
      throw new SafeProductionExecutorError(
        "PRODUCTION_RESTORE_SOURCE_INVALID",
      );
    }
  } else {
    assertProductionDatabase(command.targetDatabase);
  }
  if (command.mode === "BOOTSTRAP") {
    if (!command.canonicalSource || !command.canonicalAuditDirectory) {
      throw new SafeProductionExecutorError("CANONICAL_IMPORT_INPUT_REQUIRED");
    }
  }
  if ((command.mode === "BACKUP" || restoreMode) && !command.backupPath) {
    throw new SafeProductionExecutorError("PRODUCTION_BACKUP_PATH_REQUIRED");
  }
  parseOperatorWindow(command.windowStart, command.windowEnd);
}

export function assertProductionDatabase(database: string): void {
  if (database !== PRODUCTION_EXECUTOR_CONTRACT.database) {
    throw new SafeProductionExecutorError("PRODUCTION_DATABASE_FORBIDDEN");
  }
}

export function assertProductionRestoreDatabase(database: string): void {
  if (
    !IDENTIFIER.test(database) ||
    !database.startsWith(PRODUCTION_EXECUTOR_CONTRACT.restorePrefix) ||
    database.length <= PRODUCTION_EXECUTOR_CONTRACT.restorePrefix.length
  ) {
    throw new SafeProductionExecutorError(
      "PRODUCTION_RESTORE_DATABASE_FORBIDDEN",
    );
  }
}

export function parseOperatorWindow(
  startValue: string,
  endValue: string,
): { readonly start: Date; readonly end: Date } {
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/u;
  if (!zoned.test(startValue) || !zoned.test(endValue)) {
    throw new SafeProductionExecutorError("PRODUCTION_CHANGE_WINDOW_INVALID");
  }
  const start = new Date(startValue);
  const end = new Date(endValue);
  const duration = end.getTime() - start.getTime();
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    duration <= 0 ||
    duration > PRODUCTION_EXECUTOR_CONTRACT.maximumWindowMilliseconds
  ) {
    throw new SafeProductionExecutorError("PRODUCTION_CHANGE_WINDOW_INVALID");
  }
  return { start, end };
}

export function assertWindowState(input: {
  readonly command: ProductionExecutorCommand;
  readonly now: Date;
  readonly requireActive: boolean;
}): void {
  const { start, end } = parseOperatorWindow(
    input.command.windowStart,
    input.command.windowEnd,
  );
  if (input.requireActive) {
    if (input.now < start)
      throw new SafeProductionExecutorError(
        "PRODUCTION_CHANGE_WINDOW_NOT_STARTED",
      );
    if (input.now > end)
      throw new SafeProductionExecutorError("PRODUCTION_CHANGE_WINDOW_EXPIRED");
  } else if (input.now > end) {
    throw new SafeProductionExecutorError("PRODUCTION_CHANGE_WINDOW_EXPIRED");
  }
}

export async function runProductionExecutor(input: {
  readonly command: ProductionExecutorCommand;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly now?: Date;
  readonly sourceSha?: () => Promise<string>;
  readonly adapter?: ProductionExecutionAdapter;
}): Promise<ProductionExecutorResult> {
  const command = input.command;
  const now = input.now ?? new Date();
  const mutation = !command.dryRun && command.mode !== "PREFLIGHT";
  assertWindowState({ command, now, requireActive: mutation });
  const environment = input.environment ?? process.env;
  if (!mutation) assertNoDatabaseCredentials(environment);
  const sourceSha = await (input.sourceSha ?? readEmbeddedSourceSha)();
  if (sourceSha !== command.expectedGitSha) {
    throw new SafeProductionExecutorError("PRODUCTION_SOURCE_GIT_SHA_MISMATCH");
  }
  await Promise.all([
    verifyArtifact(
      command.appArchive,
      command.appArchiveSha256,
      command.expectedGitSha,
    ),
    verifyArtifact(
      command.operatorArchive,
      command.operatorArchiveSha256,
      command.expectedGitSha,
    ),
    verifyEmailEvidence(command.emailEvidence, now),
    verifyRollbackEvidence(command.rollbackEvidence),
  ]);
  const base = [
    `MODE=${command.mode}`,
    `TARGET_DATABASE=${command.targetDatabase}`,
    "AUTHORIZATION_GATE=PASS",
    "CHANGE_WINDOW_CONTRACT=PASS",
    "ARTIFACT_CHECKSUMS=PASS",
    "ROSTER_SHA_GUARD=PASS",
    "EMAIL_ALERT_GATE=PASS",
    "ROLLBACK_GATE=PASS",
    "APP_START=NOT_PERFORMED",
    "CADDY_CHANGE=NOT_PERFORMED",
    "IDENTITY_PROVISIONING=NOT_PERFORMED",
  ];
  if (command.mode === "PREFLIGHT" || command.dryRun) {
    return {
      report: [
        ...base,
        `EXECUTION_MODE=${command.dryRun ? "DRY_RUN" : "READ_ONLY"}`,
        "DATABASE_CONNECTIONS=0",
        "DATABASE_MUTATIONS=0",
        "PRODUCTION_EXECUTOR=PASS",
      ].join("\n"),
      exitCode: 0,
    };
  }
  const adapter =
    input.adapter ?? createProductionExecutionAdapter(environment);
  let operationLines: readonly string[];
  try {
    operationLines = await executeAdapter(command, adapter);
  } catch {
    throw new SafeProductionExecutorError(
      "PRODUCTION_OPERATION_FAILED_RECONCILIATION_REQUIRED",
      true,
    );
  }
  return {
    report: [
      ...base,
      "EXECUTION_MODE=APPLY",
      ...operationLines,
      "PRODUCTION_EXECUTOR=PASS",
    ].join("\n"),
    exitCode: 0,
  };
}

function executeAdapter(
  command: ProductionExecutorCommand,
  adapter: ProductionExecutionAdapter,
): Promise<readonly string[]> {
  if (command.mode === "BOOTSTRAP") return adapter.bootstrap(command);
  if (command.mode === "VERIFY") return adapter.verify(command);
  if (command.mode === "RECONCILE_IDENTITIES")
    return adapter.reconcile(command);
  if (command.mode === "BACKUP") return adapter.backup(command);
  if (command.mode === "RESTORE") return adapter.restore(command);
  if (command.mode === "CLEANUP_RESTORE")
    return adapter.cleanupRestore(command);
  throw new SafeProductionExecutorError("PRODUCTION_EXECUTOR_MODE_INVALID");
}

export function createProductionExecutionAdapter(
  environment: Readonly<Record<string, string | undefined>>,
): ProductionExecutionAdapter {
  return {
    bootstrap: (command) => bootstrapProduction(command, environment),
    verify: (command) => verifyProduction(command, environment),
    reconcile: (command) => reconcileProduction(command, environment),
    backup: (command) => backupProduction(command, environment),
    restore: (command) => restoreProduction(command, environment),
    cleanupRestore: (command) => cleanupProductionRestore(command, environment),
  };
}

async function bootstrapProduction(
  command: ProductionExecutorCommand,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<readonly string[]> {
  const connections = readProductionConnections(environment, command, true);
  const passwords = readRolePasswords(environment);
  const contract = await loadSourceContract();
  const prepared = await prepareSourceFile(command.canonicalSource!, contract);
  if (
    prepared.sourceSha256 !== command.canonicalChecksum ||
    prepared.rows.length !== PRODUCTION_EXECUTOR_CONTRACT.canonicalRowCount ||
    prepared.violations.length !== 0
  ) {
    throw new SafeProductionExecutorError("CANONICAL_SOURCE_PRECHECK_FAILED");
  }
  await mkdir(command.canonicalAuditDirectory!, {
    recursive: true,
    mode: 0o700,
  });
  await chmod(command.canonicalAuditDirectory!, 0o700);
  const maintenance = new Client({
    connectionString: connections.bootstrap,
    application_name: "ueb-core-phase7-production-bootstrap",
  });
  await maintenance.connect();
  try {
    await assertBootstrapRole(maintenance, connections.bootstrapUser);
    if (await databaseExists(maintenance, command.targetDatabase)) {
      throw new SafeProductionExecutorError(
        "PRODUCTION_DATABASE_ALREADY_EXISTS",
      );
    }
    for (const role of [
      command.ownerRole,
      command.runtimeRole,
      command.provisionerRole,
    ]) {
      if (await roleExists(maintenance, role)) {
        throw new SafeProductionExecutorError("PRODUCTION_ROLE_ALREADY_EXISTS");
      }
    }
    await createRestrictedRole(maintenance, command.ownerRole, passwords.owner);
    try {
      await maintenance.query(
        `CREATE DATABASE ${quoteIdentifier(command.targetDatabase)} OWNER ${quoteIdentifier(command.ownerRole)} TEMPLATE template0`,
      );
    } catch {
      await maintenance
        .query(`DROP ROLE ${quoteIdentifier(command.ownerRole)}`)
        .catch(() => undefined);
      throw new SafeProductionExecutorError(
        "PRODUCTION_DATABASE_CREATE_FAILED",
      );
    }
    await createRestrictedRole(
      maintenance,
      command.runtimeRole,
      passwords.runtime,
    );
    await createRestrictedRole(
      maintenance,
      command.provisionerRole,
      passwords.provisioner,
    );
  } finally {
    await maintenance.end().catch(() => undefined);
  }
  await runPrismaMigrateDeploy(connections.owner);
  await assertMigrationCount(connections.owner);
  const previousAuditRoot = process.env.PHASE2_AUDIT_ROOT;
  const previousMigrationUrl = process.env.MIGRATION_DATABASE_URL;
  process.env.PHASE2_AUDIT_ROOT = command.canonicalAuditDirectory;
  process.env.MIGRATION_DATABASE_URL = connections.owner;
  try {
    const { runControlledImport } = await import("../../phase-2/import-source");
    const imported = await runControlledImport(
      command.canonicalSource!,
      command.canonicalChecksum,
    );
    if (
      imported.status !== "COMMITTED" ||
      imported.insertedRowCount !==
        PRODUCTION_EXECUTOR_CONTRACT.canonicalRowCount
    ) {
      throw new SafeProductionExecutorError("CANONICAL_IMPORT_FAILED");
    }
  } finally {
    if (previousAuditRoot === undefined) delete process.env.PHASE2_AUDIT_ROOT;
    else process.env.PHASE2_AUDIT_ROOT = previousAuditRoot;
    if (previousMigrationUrl === undefined)
      delete process.env.MIGRATION_DATABASE_URL;
    else process.env.MIGRATION_DATABASE_URL = previousMigrationUrl;
  }
  const [
    { grantAuthRuntimePermissions },
    { reconcileWorkflowRuntimePermissions },
  ] = await Promise.all([
    import("../../phase-3/grant-auth-runtime-permissions"),
    import("../../phase-4/grant-workflow-runtime-permissions"),
  ]);
  await grantAuthRuntimePermissions({
    MIGRATION_DATABASE_URL: connections.owner,
    DATABASE_URL: connections.runtime,
  });
  await reconcileWorkflowRuntimePermissions({
    environment: {
      MIGRATION_DATABASE_URL: connections.owner,
      APP_DATABASE_USER: command.runtimeRole,
    },
    expectedDatabase: command.targetDatabase,
  });
  await reconcileProductionProvisioner(connections.owner, command);
  const report = await readProductionState(connections, command);
  assertProductionState(report, true);
  return [
    "PRODUCTION_DATABASE_CREATED=YES",
    `MIGRATIONS_APPLIED=${report.migrations}`,
    `CANONICAL_IMPORT_ROW_COUNT=${report.coreRows}`,
    "ROLE_SEPARATION=PASS",
    "RLS_DEFAULT_DENY=PASS",
    "DATABASE_MUTATIONS=AUTHORIZED_TARGET_ONLY",
  ];
}

async function verifyProduction(
  command: ProductionExecutorCommand,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<readonly string[]> {
  const connections = readProductionConnections(environment, command, false);
  const report = await readProductionState(connections, command);
  assertProductionState(report, true);
  return [
    `CORE_ROW_COUNT=${report.coreRows}`,
    `MIGRATIONS_APPLIED=${report.migrations}`,
    `WORKFLOW_EVENT_COUNT=${report.workflowEvents}`,
    "ROLE_SEPARATION=PASS",
    "RLS_DEFAULT_DENY=PASS",
    "DATABASE_WRITES=0",
    "SECURITY_VERIFY=PASS",
  ];
}

async function reconcileProduction(
  command: ProductionExecutorCommand,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<readonly string[]> {
  const connections = readProductionConnections(environment, command, false);
  const owner = await connect(
    connections.owner,
    "ueb-core-phase7-roster-reconcile",
  );
  try {
    const counts = await owner.query<{
      users: number;
      accounts: number;
      roles: number;
      scopes: number;
      mappings: number;
    }>(`SELECT
      (SELECT count(*)::integer FROM auth_user) AS users,
      (SELECT count(*)::integer FROM auth_account) AS accounts,
      (SELECT count(*)::integer FROM role_assignment) AS roles,
      (SELECT count(*)::integer FROM unit_scope_assignment) AS scopes,
      (SELECT count(*)::integer FROM lecturer_user_mapping) AS mappings`);
    const row = counts.rows[0];
    if (!row || Object.values(row).some((count) => count !== 0)) {
      throw new SafeProductionExecutorError(
        "PRODUCTION_IDENTITY_TARGET_NOT_EMPTY",
      );
    }
    return [
      "ROSTER_RECONCILIATION=PASS",
      `ROSTER_MANIFEST_SHA256=${command.rosterManifestSha}`,
      `EXPECTED_IDENTITY_CREATE_COUNT=${PRODUCTION_EXECUTOR_CONTRACT.expectedIdentityCount}`,
      "CURRENT_IDENTITY_COUNT=0",
      "DATABASE_WRITES=0",
    ];
  } finally {
    await owner.end().catch(() => undefined);
  }
}

async function backupProduction(
  command: ProductionExecutorCommand,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<readonly string[]> {
  const connections = readProductionConnections(environment, command, false);
  const output = command.backupPath!;
  await assertAbsent(output);
  await assertAbsent(`${output}.sha256`);
  const tool = postgresToolConnection(connections.owner, environment);
  await execFileAsync(
    "pg_dump",
    [
      "--format=custom",
      "--file",
      output,
      "--host",
      tool.host,
      "--port",
      tool.port,
      "--username",
      tool.user,
      "--dbname",
      tool.database,
    ],
    { env: tool.environment },
  );
  await chmod(output, 0o600);
  const checksum = await sha256File(output);
  await writeFile(`${output}.sha256`, `${checksum}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  const { stdout: catalog } = await execFileAsync("pg_restore", [
    "--list",
    output,
  ]);
  assertBackupCatalog(catalog);
  let offHost = "NOT_REQUESTED";
  if (command.offHostDirectory) {
    const directory = command.offHostDirectory;
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || (metadata.mode & 0o777) !== 0o700) {
      throw new SafeProductionExecutorError("OFF_HOST_DIRECTORY_INVALID");
    }
    const destination = resolve(directory, output.split("/").at(-1)!);
    await assertAbsent(destination);
    await copyFile(output, destination);
    await chmod(destination, 0o600);
    if ((await sha256File(destination)) !== checksum) {
      throw new SafeProductionExecutorError(
        "OFF_HOST_BACKUP_CHECKSUM_MISMATCH",
      );
    }
    offHost = "PASS";
  }
  return [
    "PRODUCTION_BACKUP=PASS",
    `BACKUP_SHA256=${checksum}`,
    "BACKUP_CATALOG=PASS",
    `OFF_HOST_BACKUP=${offHost}`,
  ];
}

async function restoreProduction(
  command: ProductionExecutorCommand,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<readonly string[]> {
  const sourceCommand = { ...command, targetDatabase: command.sourceDatabase! };
  const connections = readProductionConnections(
    environment,
    sourceCommand,
    true,
  );
  const backup = command.backupPath!;
  await verifyBackupChecksum(backup);
  const maintenance = await connect(
    connections.bootstrap,
    "ueb-core-phase7-production-restore-create",
  );
  try {
    await assertBootstrapRole(maintenance, connections.bootstrapUser);
    if (await databaseExists(maintenance, command.targetDatabase)) {
      throw new SafeProductionExecutorError(
        "PRODUCTION_RESTORE_ALREADY_EXISTS",
      );
    }
    await maintenance.query(
      `CREATE DATABASE ${quoteIdentifier(command.targetDatabase)} OWNER ${quoteIdentifier(command.ownerRole)} TEMPLATE template0`,
    );
    await maintenance.query(
      `COMMENT ON DATABASE ${quoteIdentifier(command.targetDatabase)} IS '${PRODUCTION_EXECUTOR_CONTRACT.restoreMarker}'`,
    );
  } finally {
    await maintenance.end().catch(() => undefined);
  }
  const restoreUrl = withDatabase(connections.owner, command.targetDatabase);
  const restoreTool = postgresToolConnection(restoreUrl, environment);
  await execFileAsync(
    "pg_restore",
    [
      "--exit-on-error",
      "--no-owner",
      "--host",
      restoreTool.host,
      "--port",
      restoreTool.port,
      "--username",
      restoreTool.user,
      "--dbname",
      restoreTool.database,
      backup,
    ],
    { env: restoreTool.environment },
  );
  const restoredConnections = {
    ...connections,
    owner: restoreUrl,
    runtime: withDatabase(connections.runtime, command.targetDatabase),
    provisioner: withDatabase(connections.provisioner, command.targetDatabase),
  };
  const report = await readProductionState(restoredConnections, command);
  assertProductionState(report, false);
  return [
    "RESTORE_REHEARSAL=PASS",
    `RESTORE_CORE_ROW_COUNT=${report.coreRows}`,
    `RESTORE_MIGRATION_COUNT=${report.migrations}`,
    `RESTORE_FINGERPRINT=${fingerprintState(report)}`,
  ];
}

async function cleanupProductionRestore(
  command: ProductionExecutorCommand,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<readonly string[]> {
  const sourceCommand = { ...command, targetDatabase: command.sourceDatabase! };
  const connections = readProductionConnections(
    environment,
    sourceCommand,
    true,
  );
  const maintenance = await connect(
    connections.bootstrap,
    "ueb-core-phase7-production-restore-cleanup",
  );
  try {
    const state = await maintenance.query<{
      marker: string | null;
      connections: number;
    }>(
      `SELECT description.description AS marker,
         (SELECT count(*)::integer FROM pg_stat_activity WHERE datname = database.datname) AS connections
       FROM pg_database database
       LEFT JOIN pg_shdescription description ON description.objoid = database.oid
       WHERE database.datname = $1`,
      [command.targetDatabase],
    );
    const row = state.rows[0];
    if (
      !row ||
      row.marker !== PRODUCTION_EXECUTOR_CONTRACT.restoreMarker ||
      row.connections !== 0
    ) {
      throw new SafeProductionExecutorError(
        "PRODUCTION_RESTORE_CLEANUP_GUARD_FAILED",
      );
    }
    await maintenance.query(
      `DROP DATABASE ${quoteIdentifier(command.targetDatabase)}`,
    );
    return ["RESTORE_CLEANUP=PASS", "SOURCE_PRODUCTION_DATABASE=UNCHANGED"];
  } finally {
    await maintenance.end().catch(() => undefined);
  }
}

interface ProductionConnections {
  readonly bootstrap: string;
  readonly bootstrapUser: string;
  readonly owner: string;
  readonly runtime: string;
  readonly provisioner: string;
}

function readProductionConnections(
  environment: Readonly<Record<string, string | undefined>>,
  command: ProductionExecutorCommand,
  requireBootstrap: boolean,
): ProductionConnections {
  const owner = parseConnection(
    environment.MIGRATION_DATABASE_URL,
    command.targetDatabase,
    command.ownerRole,
    environment,
  );
  const runtime = parseConnection(
    environment.DATABASE_URL,
    command.targetDatabase,
    command.runtimeRole,
    environment,
  );
  const provisioner = parseConnection(
    environment.PHASE7_PROVISIONING_DATABASE_URL,
    command.targetDatabase,
    command.provisionerRole,
    environment,
  );
  const bootstrapValue = environment.PRODUCTION_BOOTSTRAP_DATABASE_URL;
  const bootstrap = requireBootstrap
    ? parseConnection(
        bootstrapValue,
        "postgres",
        environment.PRODUCTION_AUTHORIZED_BOOTSTRAP_ROLE,
        environment,
      )
    : undefined;
  const users = [owner.user, runtime.user, provisioner.user];
  if (bootstrap) users.push(bootstrap.user);
  if (new Set(users).size !== users.length) {
    throw new SafeProductionExecutorError("PRODUCTION_ROLE_SEPARATION_INVALID");
  }
  return {
    bootstrap: bootstrap?.url ?? "",
    bootstrapUser: bootstrap?.user ?? "",
    owner: owner.url,
    runtime: runtime.url,
    provisioner: provisioner.url,
  };
}

function parseConnection(
  value: string | undefined,
  database: string,
  expectedUser: string | undefined,
  environment: Readonly<Record<string, string | undefined>>,
): { readonly url: string; readonly user: string } {
  if (!value || !expectedUser) {
    throw new SafeProductionExecutorError(
      "PRODUCTION_DATABASE_CREDENTIAL_MISSING",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeProductionExecutorError("PRODUCTION_DATABASE_URL_INVALID");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.pathname.slice(1)) !== database ||
    decodeURIComponent(url.username) !== expectedUser ||
    !url.password ||
    url.hostname !== environment.PRODUCTION_DATABASE_HOST ||
    environment.PRODUCTION_DATABASE_PUBLIC_PORT !== "NO"
  ) {
    throw new SafeProductionExecutorError("PRODUCTION_DATABASE_URL_MISMATCH");
  }
  return { url: url.toString(), user: expectedUser };
}

function readRolePasswords(
  environment: Readonly<Record<string, string | undefined>>,
): {
  readonly owner: string;
  readonly runtime: string;
  readonly provisioner: string;
} {
  const result = {
    owner: environment.PRODUCTION_OWNER_PASSWORD,
    runtime: environment.PRODUCTION_RUNTIME_PASSWORD,
    provisioner: environment.PRODUCTION_PROVISIONER_PASSWORD,
  };
  if (Object.values(result).some((value) => !value || value.length < 20)) {
    throw new SafeProductionExecutorError("PRODUCTION_ROLE_PASSWORD_INVALID");
  }
  if (new Set(Object.values(result)).size !== 3) {
    throw new SafeProductionExecutorError(
      "PRODUCTION_ROLE_PASSWORD_REUSE_FORBIDDEN",
    );
  }
  return result as { owner: string; runtime: string; provisioner: string };
}

interface ProductionState {
  readonly databaseOwner: string;
  readonly migrations: number;
  readonly failedMigrations: number;
  readonly coreRows: number;
  readonly workflowEvents: number;
  readonly importRuns: number;
  readonly authUsers: number;
  readonly sessions: number;
  readonly runtimeSafe: boolean;
  readonly provisionerSafe: boolean;
  readonly runtimeAclSafe: boolean;
  readonly provisionerAclSafe: boolean;
  readonly rlsCoreVisible: number;
  readonly rlsWorkflowVisible: number;
}

async function readProductionState(
  connections: ProductionConnections,
  command: ProductionExecutorCommand,
): Promise<ProductionState> {
  const owner = await connect(
    connections.owner,
    "ueb-core-phase7-production-verify",
  );
  const runtime = await connect(
    connections.runtime,
    "ueb-core-phase7-production-rls-verify",
  );
  try {
    const [state, roles, acls, coreVisible, workflowVisible] =
      await Promise.all([
        owner.query<
          Omit<
            ProductionState,
            | "runtimeSafe"
            | "provisionerSafe"
            | "runtimeAclSafe"
            | "provisionerAclSafe"
            | "rlsCoreVisible"
            | "rlsWorkflowVisible"
          >
        >(
          `SELECT
          pg_get_userbyid(database.datdba) AS "databaseOwner",
          (SELECT count(*)::integer FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migrations,
          (SELECT count(*)::integer FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS "failedMigrations",
          (SELECT count(*)::integer FROM ueb_core_data) AS "coreRows",
          (SELECT count(*)::integer FROM workflow_event) AS "workflowEvents",
          (SELECT count(*)::integer FROM import_run) AS "importRuns",
          (SELECT count(*)::integer FROM auth_user) AS "authUsers",
          (SELECT count(*)::integer FROM auth_session) AS sessions
         FROM pg_database database WHERE database.datname = current_database()`,
        ),
        owner.query<{ rolname: string; safe: boolean }>(
          `SELECT rolname,
          (rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) AS safe
         FROM pg_roles WHERE rolname = ANY($1::text[])`,
          [[command.runtimeRole, command.provisionerRole]],
        ),
        owner.query<{ runtime_safe: boolean; provisioner_safe: boolean }>(
          `SELECT
          NOT (
            has_table_privilege($1, 'public.ueb_core_data', 'UPDATE') OR
            has_table_privilege($1, 'public.ueb_core_data', 'DELETE') OR
            has_table_privilege($1, 'public.ueb_core_data', 'TRUNCATE') OR
            has_table_privilege($1, 'public.workflow_event', 'UPDATE') OR
            has_table_privilege($1, 'public.workflow_event', 'DELETE') OR
            has_table_privilege($1, 'public.workflow_event', 'TRUNCATE')
          ) AS runtime_safe,
          NOT (
            has_table_privilege($2, 'public.ueb_core_data', 'INSERT') OR
            has_table_privilege($2, 'public.ueb_core_data', 'UPDATE') OR
            has_table_privilege($2, 'public.ueb_core_data', 'DELETE') OR
            has_table_privilege($2, 'public.ueb_core_data', 'TRUNCATE') OR
            has_table_privilege($2, 'public.workflow_event', 'SELECT') OR
            has_table_privilege($2, 'public.workflow_event', 'INSERT') OR
            has_table_privilege($2, 'public.workflow_event', 'UPDATE') OR
            has_table_privilege($2, 'public.workflow_event', 'DELETE') OR
            has_table_privilege($2, 'public.workflow_event', 'TRUNCATE')
          ) AS provisioner_safe`,
          [command.runtimeRole, command.provisionerRole],
        ),
        runtime.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM ueb_core_data",
        ),
        runtime.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM workflow_event",
        ),
      ]);
    const row = state.rows[0];
    const acl = acls.rows[0];
    const byRole = new Map(roles.rows.map((role) => [role.rolname, role.safe]));
    if (!row) throw new SafeProductionExecutorError("PRODUCTION_VERIFY_FAILED");
    return {
      ...row,
      runtimeSafe: byRole.get(command.runtimeRole) === true,
      provisionerSafe: byRole.get(command.provisionerRole) === true,
      runtimeAclSafe: acl?.runtime_safe === true,
      provisionerAclSafe: acl?.provisioner_safe === true,
      rlsCoreVisible: coreVisible.rows[0]?.count ?? -1,
      rlsWorkflowVisible: workflowVisible.rows[0]?.count ?? -1,
    };
  } finally {
    await Promise.all([
      owner.end().catch(() => undefined),
      runtime.end().catch(() => undefined),
    ]);
  }
}

function assertProductionState(
  state: ProductionState,
  requireOwner: boolean,
): void {
  if (
    (requireOwner &&
      state.databaseOwner !== PRODUCTION_EXECUTOR_CONTRACT.ownerRole) ||
    state.migrations !== PRODUCTION_EXECUTOR_CONTRACT.migrationCount ||
    state.failedMigrations !== 0 ||
    state.coreRows !== PRODUCTION_EXECUTOR_CONTRACT.canonicalRowCount ||
    state.workflowEvents !== 0 ||
    state.importRuns !== 1 ||
    state.authUsers !== 0 ||
    state.sessions !== 0 ||
    !state.runtimeSafe ||
    !state.provisionerSafe ||
    !state.runtimeAclSafe ||
    !state.provisionerAclSafe ||
    state.rlsCoreVisible !== 0 ||
    state.rlsWorkflowVisible !== 0
  ) {
    throw new SafeProductionExecutorError(
      "PRODUCTION_SECURITY_BASELINE_MISMATCH",
    );
  }
}

async function reconcileProductionProvisioner(
  ownerUrl: string,
  command: ProductionExecutorCommand,
): Promise<void> {
  const client = await connect(
    ownerUrl,
    "ueb-core-phase7-production-provisioner-acl",
  );
  try {
    await client.query("BEGIN");
    const database = quoteIdentifier(command.targetDatabase);
    const role = quoteIdentifier(command.provisionerRole);
    await client.query(
      `REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${role}`,
    );
    await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${role}`);
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`,
    );
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
    );
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    for (const [table, privileges] of Object.entries(
      PROVISIONING_TABLE_PRIVILEGES,
    )) {
      await client.query(
        `GRANT ${privileges.join(", ")} ON TABLE public.${quoteIdentifier(table)} TO ${role}`,
      );
    }
    const runtime = quoteIdentifier(command.runtimeRole);
    for (const table of APP_RUNTIME_MANAGED_IDENTITY_TABLES) {
      await client.query(
        `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.${quoteIdentifier(table)} FROM ${runtime}`,
      );
      await client.query(
        `GRANT SELECT ON TABLE public.${quoteIdentifier(table)} TO ${runtime}`,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function assertBootstrapRole(
  client: ClientBase,
  role: string,
): Promise<void> {
  const result = await client.query<{
    current_user: string;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolbypassrls: boolean;
  }>(`SELECT current_user, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
      FROM pg_roles WHERE rolname = current_user`);
  const row = result.rows[0];
  if (
    !row ||
    row.current_user !== role ||
    row.rolsuper ||
    !row.rolcreatedb ||
    !row.rolcreaterole ||
    row.rolbypassrls
  ) {
    throw new SafeProductionExecutorError("PRODUCTION_BOOTSTRAP_ROLE_UNSAFE");
  }
}

async function createRestrictedRole(
  client: ClientBase,
  role: string,
  password: string,
): Promise<void> {
  const quotedPassword = (
    await client.query<{ value: string }>("SELECT quote_literal($1) AS value", [
      password,
    ])
  ).rows[0]?.value;
  if (!quotedPassword)
    throw new SafeProductionExecutorError("ROLE_PASSWORD_QUOTE_FAILED");
  await client.query(
    `CREATE ROLE ${quoteIdentifier(role)} WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quotedPassword}`,
  );
}

async function runPrismaMigrateDeploy(ownerUrl: string): Promise<void> {
  await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
  });
}

async function assertMigrationCount(ownerUrl: string): Promise<void> {
  const client = await connect(ownerUrl, "ueb-core-phase7-migration-verify");
  try {
    const result = await client.query<{ applied: number; failed: number }>(
      `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::integer AS applied,
              count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::integer AS failed
       FROM _prisma_migrations`,
    );
    if (
      result.rows[0]?.applied !== PRODUCTION_EXECUTOR_CONTRACT.migrationCount ||
      result.rows[0]?.failed !== 0
    ) {
      throw new SafeProductionExecutorError(
        "PRODUCTION_MIGRATION_STATE_INVALID",
      );
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function verifyArtifact(
  path: string,
  checksum: string,
  expectedGitSha: string,
): Promise<void> {
  const metadata = await lstat(path).catch(() => undefined);
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600 ||
    !path.split("/").at(-1)?.includes(expectedGitSha) ||
    path.toLowerCase().includes("latest") ||
    (await sha256File(path)) !== checksum
  ) {
    throw new SafeProductionExecutorError("PRODUCTION_ARTIFACT_INVALID");
  }
}

async function verifyEmailEvidence(path: string, now: Date): Promise<void> {
  const content = await readRestrictedEvidence(path);
  const required = [
    "EMAIL_ALERT_TRANSPORT=GMAIL_SMTP",
    "SMTP_AUTH=PASS",
    "EMAIL_TEST=PASS",
    "EMAIL_ALERT_GATE=PASS",
    "SENDER_CONFIRMED=YES",
    "RECIPIENT_CONFIRMED=YES",
    "MESSAGE_CONTENT=NON_SENSITIVE",
    "CREDENTIAL_LOGGED=NO",
  ];
  if (
    required.some((line) => !content.split(/\r?\n/u).includes(line)) ||
    /(?:PASSWORD|TOKEN|DATABASE_URL)\s*=/iu.test(content)
  ) {
    throw new SafeProductionExecutorError("EMAIL_ALERT_EVIDENCE_INVALID");
  }
  const timestamp = content
    .split(/\r?\n/u)
    .find((line) => line.startsWith("EVIDENCE_TIMESTAMP_UTC="));
  const value = new Date(
    timestamp?.slice("EVIDENCE_TIMESTAMP_UTC=".length) ?? "",
  );
  const age = now.getTime() - value.getTime();
  if (Number.isNaN(value.getTime()) || age < -300_000 || age > 86_400_000) {
    throw new SafeProductionExecutorError("EMAIL_ALERT_EVIDENCE_STALE");
  }
}

async function verifyRollbackEvidence(path: string): Promise<void> {
  const content = await readRestrictedEvidence(path);
  if (
    !content.includes("ROLLBACK_IMAGE_EXISTS=YES") ||
    !content.includes("ROLLBACK_VERIFY=PASS") ||
    !content.includes(
      `ROLLBACK_IMAGE_SHA=${PRODUCTION_EXECUTOR_CONTRACT.rollbackImageSha}`,
    )
  ) {
    throw new SafeProductionExecutorError("ROLLBACK_EVIDENCE_INVALID");
  }
}

async function readRestrictedEvidence(path: string): Promise<string> {
  const metadata = await lstat(path).catch(() => undefined);
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.size > 1024 * 1024
  ) {
    throw new SafeProductionExecutorError("PRODUCTION_EVIDENCE_INVALID");
  }
  return readFile(path, "utf8");
}

async function verifyBackupChecksum(path: string): Promise<void> {
  const checksum = (await readFile(`${path}.sha256`, "utf8")).trim();
  if (!SHA256.test(checksum) || checksum !== (await sha256File(path))) {
    throw new SafeProductionExecutorError("PRODUCTION_BACKUP_CHECKSUM_INVALID");
  }
  const { stdout } = await execFileAsync("pg_restore", ["--list", path]);
  assertBackupCatalog(stdout);
}

function assertBackupCatalog(catalog: string): void {
  for (const entry of [
    "TABLE DATA public ueb_core_data",
    "TABLE DATA public import_run",
    "TABLE DATA public _prisma_migrations",
  ]) {
    if (!catalog.includes(entry)) {
      throw new SafeProductionExecutorError(
        "PRODUCTION_BACKUP_CATALOG_INVALID",
      );
    }
  }
}

function assertNoDatabaseCredentials(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  for (const key of [
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "PHASE7_PROVISIONING_DATABASE_URL",
    "PRODUCTION_BOOTSTRAP_DATABASE_URL",
  ]) {
    if (environment[key]) {
      throw new SafeProductionExecutorError(
        "DATABASE_CREDENTIALS_FORBIDDEN_IN_DRY_RUN",
      );
    }
  }
}

function assertExternalPath(path: string): string {
  if (!isAbsolute(path)) {
    throw new SafeProductionExecutorError("PRODUCTION_EXTERNAL_PATH_REQUIRED");
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
    throw new SafeProductionExecutorError("PRODUCTION_EXTERNAL_PATH_REQUIRED");
  }
  return absolute;
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new SafeProductionExecutorError("PRODUCTION_IDENTIFIER_INVALID");
  }
  return `"${value}"`;
}

async function connect(url: string, applicationName: string): Promise<Client> {
  const client = new Client({
    connectionString: url,
    application_name: applicationName,
  });
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => undefined);
    throw new SafeProductionExecutorError(
      "PRODUCTION_DATABASE_CONNECTION_FAILED",
    );
  }
}

async function databaseExists(
  client: ClientBase,
  database: string,
): Promise<boolean> {
  return (
    (
      await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
        [database],
      )
    ).rows[0]?.exists === true
  );
}

async function roleExists(client: ClientBase, role: string): Promise<boolean> {
  return (
    (
      await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
        [role],
      )
    ).rows[0]?.exists === true
  );
}

function withDatabase(value: string, database: string): string {
  const url = new URL(value);
  url.pathname = `/${database}`;
  return url.toString();
}

function postgresToolConnection(
  connection: string,
  environment: Readonly<Record<string, string | undefined>>,
): {
  readonly host: string;
  readonly port: string;
  readonly user: string;
  readonly database: string;
  readonly environment: NodeJS.ProcessEnv;
} {
  const url = new URL(connection);
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    database: decodeURIComponent(url.pathname.slice(1)),
    environment: { ...process.env, ...environment, PGPASSWORD: url.password },
  };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function fingerprintState(state: ProductionState): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        migrations: state.migrations,
        coreRows: state.coreRows,
        workflowEvents: state.workflowEvents,
        importRuns: state.importRuns,
        authUsers: state.authUsers,
        sessions: state.sessions,
      }),
    )
    .digest("hex");
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new SafeProductionExecutorError("PRODUCTION_OUTPUT_ALREADY_EXISTS");
}

export async function readEmbeddedSourceSha(
  path = OPERATOR_SOURCE_SHA_PATH,
): Promise<string> {
  const metadata = await lstat(path).catch(() => undefined);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new SafeProductionExecutorError("PRODUCTION_SOURCE_GIT_SHA_MISSING");
  }
  if ((metadata.mode & 0o777) !== 0o444 || metadata.size > 128) {
    throw new SafeProductionExecutorError("PRODUCTION_SOURCE_GIT_SHA_INVALID");
  }
  const value = (await readFile(path, "utf8")).trim();
  if (!GIT_SHA.test(value)) {
    throw new SafeProductionExecutorError("PRODUCTION_SOURCE_GIT_SHA_INVALID");
  }
  return value;
}
