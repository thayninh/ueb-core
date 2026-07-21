import { Buffer } from "node:buffer";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const STAGING_DATABASE = "ueb_core_staging";
export const STAGING_TEST_DATABASE_PREFIX = "ueb_core_staging_test_";
export const STAGING_RESTORE_DATABASE_PREFIX = "ueb_core_staging_restore_";
export const STAGING_OWNER_ROLE = "ueb_core_staging_owner";
export const STAGING_RUNTIME_ROLE = "ueb_core_staging_app";
export const STAGING_PROVISIONING_ROLE = "ueb_core_staging_provisioner";
export const STAGING_VPS_HOST = "103.200.25.54";
export const STAGING_DATABASE_HOST = "db";
export const STAGING_SSH_ALIAS = "ueb-core-staging";
export const STAGING_DEPLOYMENT_DIRECTORY = "/opt/ueb-core";
export const STAGING_PROXY_NETWORK = "ueb-core-proxy";
export const STAGING_CADDY_CONTAINER = "khtc-ueb-prod-caddy-1";
export const STAGING_BACKUP_DIRECTORY = "/var/backups/ueb-core/staging";
export const STAGING_TIMEZONE = "Asia/Ho_Chi_Minh";
export const STAGING_DOMAIN = "ueb-core-staging.cargis.vn";
export const STAGING_URL = `https://${STAGING_DOMAIN}`;
export const PRODUCTION_DOMAIN = "ueb-core.cargis.vn";

const SAFE_SUFFIX = /^[a-z0-9][a-z0-9_]{0,23}$/u;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/u;
const ROLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const LOCAL_TEST_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const PLACEHOLDER =
  /(?:example|placeholder|replace|change[_-]?me|operator.*fill|<|>)/iu;
const FORBIDDEN_DATABASES = new Set([
  "ueb_core",
  "ueb_core_uat_phase5",
  "postgres",
  "template0",
  "template1",
]);

export class SafePhase6StagingError extends Error {}

export function assertStagingUrl(
  value: string | undefined,
): typeof STAGING_URL {
  if (value !== STAGING_URL || value.includes(PRODUCTION_DOMAIN)) {
    throw new SafePhase6StagingError(
      "Staging URL must target the exact approved staging domain.",
    );
  }
  return STAGING_URL;
}

export interface StagingConnectionContract {
  readonly url: string;
  readonly database: string;
  readonly user: string;
  readonly host: string;
  readonly port: string;
  readonly disposableTest: boolean;
}

export interface StagingRoleEnvironment {
  readonly owner: StagingConnectionContract;
  readonly runtimeRole: typeof STAGING_RUNTIME_ROLE;
  readonly provisioningRole: typeof STAGING_PROVISIONING_ROLE;
}

export interface ChangeWindow {
  readonly start: Date;
  readonly end: Date;
  readonly timezone: typeof STAGING_TIMEZONE;
}

export interface BackupCommand {
  readonly expectedDatabase: string;
  readonly outputPath: string;
}

export interface RestoreCommand {
  readonly sourceDatabase: string;
  readonly targetDatabase: string;
  readonly backupPath: string;
}

export interface CleanupRestoreCommand {
  readonly targetDatabase: string;
  readonly backupPath: string;
}

export interface ClearStaleRestoreLockCommand {
  readonly targetDatabase: string;
  readonly backupPath: string;
}

export interface CleanupBackupsCommand {
  readonly backupDirectory: typeof STAGING_BACKUP_DIRECTORY;
}

export function normalizeArguments(arguments_: readonly string[]): string[] {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  if (args.includes("--")) {
    throw new SafePhase6StagingError("Invalid command separator.");
  }
  return args;
}

export function valuesFor(args: readonly string[], prefix: string): string[] {
  return args
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length))
    .filter(Boolean);
}

export function assertExactArguments(
  args: readonly string[],
  exact: readonly string[],
  prefixes: readonly string[],
): void {
  const unknown = args.filter(
    (argument) =>
      !exact.includes(argument) &&
      !prefixes.some((prefix) => argument.startsWith(prefix)),
  );
  const duplicateExact = exact.some(
    (flag) => args.filter((argument) => argument === flag).length > 1,
  );
  const duplicatePrefixes = prefixes.some(
    (prefix) =>
      args.filter((argument) => argument.startsWith(prefix)).length > 1,
  );
  if (unknown.length > 0 || duplicateExact || duplicatePrefixes) {
    throw new SafePhase6StagingError("Command arguments are invalid.");
  }
}

export function assertProductionStagingDatabase(database: string): void {
  if (database !== STAGING_DATABASE) {
    throw new SafePhase6StagingError(
      "Production staging tooling requires the exact staging database.",
    );
  }
}

export function assertStagingTestDatabase(database: string): void {
  assertDisposableDatabase(database, STAGING_TEST_DATABASE_PREFIX, "test");
}

export function assertStagingRestoreDatabase(database: string): void {
  assertDisposableDatabase(
    database,
    STAGING_RESTORE_DATABASE_PREFIX,
    "restore",
  );
}

export function assertForbiddenDatabase(database: string): void {
  if (
    FORBIDDEN_DATABASES.has(database) ||
    database.startsWith("ueb_core_uat_") ||
    database.startsWith("ueb_core_restore_") ||
    database === STAGING_DATABASE ||
    !IDENTIFIER.test(database)
  ) {
    throw new SafePhase6StagingError("Database target is forbidden.");
  }
}

export function assertRoleName(role: string): void {
  if (!ROLE_IDENTIFIER.test(role)) {
    throw new SafePhase6StagingError("PostgreSQL role name is unsafe.");
  }
}

export function assertRoleSeparation(input: {
  readonly owner: string;
  readonly runtime: string;
  readonly provisioner: string;
}): void {
  for (const role of [input.owner, input.runtime, input.provisioner]) {
    assertRoleName(role);
  }
  if (
    input.owner !== STAGING_OWNER_ROLE ||
    input.runtime !== STAGING_RUNTIME_ROLE ||
    input.provisioner !== STAGING_PROVISIONING_ROLE ||
    new Set([input.owner, input.runtime, input.provisioner]).size !== 3
  ) {
    throw new SafePhase6StagingError(
      "Staging owner, runtime and provisioner must be exact and distinct.",
    );
  }
}

export function parseStagingConnection(input: {
  readonly value: string | undefined;
  readonly expectedDatabase: string;
  readonly expectedUser?: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly allowTest?: boolean;
  readonly allowRestore?: boolean;
}): StagingConnectionContract {
  if (!input.value) {
    throw new SafePhase6StagingError(
      "Required database connection is missing.",
    );
  }
  let url: URL;
  try {
    url = new URL(input.value);
  } catch {
    throw new SafePhase6StagingError("Database connection is invalid.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new SafePhase6StagingError("Database protocol is invalid.");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  const user = decodeURIComponent(url.username);
  const disposableTest = database.startsWith(STAGING_TEST_DATABASE_PREFIX);
  const disposableRestore = database.startsWith(
    STAGING_RESTORE_DATABASE_PREFIX,
  );
  if (database !== input.expectedDatabase || !user || !url.password) {
    throw new SafePhase6StagingError(
      "Database connection does not match the expected target.",
    );
  }
  if (input.expectedUser && user !== input.expectedUser) {
    throw new SafePhase6StagingError(
      "Database connection does not use the expected dedicated role.",
    );
  }
  if (disposableTest) {
    if (!input.allowTest) assertProductionStagingDatabase(database);
    assertStagingTestDatabase(database);
    const explicitContainerTestEndpoint =
      input.environment.PHASE6_STAGING_INTEGRATION === "1" &&
      input.environment.PHASE6_TEST_DATABASE_HOST === url.hostname &&
      input.environment.PHASE6_TEST_DATABASE_PORT === url.port;
    if (
      (!LOCAL_TEST_HOSTS.has(url.hostname) || url.port !== "55432") &&
      !explicitContainerTestEndpoint
    ) {
      throw new SafePhase6StagingError(
        "Disposable staging tests require the isolated local database endpoint.",
      );
    }
  } else if (disposableRestore) {
    if (!input.allowRestore) assertProductionStagingDatabase(database);
    assertStagingRestoreDatabase(database);
    assertProductionEndpoint(url, input.environment);
  } else {
    assertProductionStagingDatabase(database);
    assertProductionEndpoint(url, input.environment);
  }
  return {
    url: url.toString(),
    database,
    user,
    host: url.hostname,
    port: url.port,
    disposableTest,
  };
}

export function readStagingRoleEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  options: {
    readonly allowTest?: boolean;
    readonly allowRestore?: boolean;
  } = {},
): StagingRoleEnvironment {
  const expectedDatabase =
    environment.STAGING_EXPECTED_DATABASE ?? STAGING_DATABASE;
  const runtimeRole = environment.APP_DATABASE_USER;
  const provisioningRole = environment.PHASE6_PROVISIONING_USER;
  assertRoleSeparation({
    owner: environment.STAGING_MIGRATION_OWNER_ROLE ?? STAGING_OWNER_ROLE,
    runtime: runtimeRole ?? "",
    provisioner: provisioningRole ?? "",
  });
  const owner = parseStagingConnection({
    value: environment.MIGRATION_DATABASE_URL,
    expectedDatabase,
    expectedUser: STAGING_OWNER_ROLE,
    environment,
    allowTest: options.allowTest,
    allowRestore: options.allowRestore,
  });
  if (
    expectedDatabase === STAGING_DATABASE &&
    owner.user !== STAGING_OWNER_ROLE
  ) {
    throw new SafePhase6StagingError("Owner connection role is invalid.");
  }
  return {
    owner,
    runtimeRole: STAGING_RUNTIME_ROLE,
    provisioningRole: STAGING_PROVISIONING_ROLE,
  };
}

export function parseConfirmedTargetCommand(input: {
  readonly arguments_: readonly string[];
  readonly confirmation: string;
  readonly allowTest?: boolean;
}): { readonly expectedDatabase: string } {
  const args = normalizeArguments(input.arguments_);
  assertExactArguments(args, [input.confirmation], ["--expected-database="]);
  const databases = valuesFor(args, "--expected-database=");
  if (!args.includes(input.confirmation) || databases.length !== 1) {
    throw new SafePhase6StagingError(
      "Exact database and explicit confirmation are required.",
    );
  }
  if (
    input.allowTest &&
    databases[0]!.startsWith(STAGING_TEST_DATABASE_PREFIX)
  ) {
    assertStagingTestDatabase(databases[0]!);
  } else {
    assertProductionStagingDatabase(databases[0]!);
  }
  return { expectedDatabase: databases[0]! };
}

export function parseBackupCommand(
  arguments_: readonly string[],
): BackupCommand {
  const args = normalizeArguments(arguments_);
  const confirmation = "--confirm-staging-backup";
  assertExactArguments(
    args,
    [confirmation],
    ["--expected-database=", "--output="],
  );
  const databases = valuesFor(args, "--expected-database=");
  const outputs = valuesFor(args, "--output=");
  if (
    !args.includes(confirmation) ||
    databases.length !== 1 ||
    outputs.length !== 1
  ) {
    throw new SafePhase6StagingError(
      "Staging backup requires exact target, output and confirmation.",
    );
  }
  assertProductionStagingDatabase(databases[0]!);
  return {
    expectedDatabase: databases[0]!,
    outputPath: assertExternalArtifactPath(outputs[0]!, ".dump"),
  };
}

export function parseRestoreCommand(
  arguments_: readonly string[],
): RestoreCommand {
  const args = normalizeArguments(arguments_);
  const confirmation = "--confirm-create-staging-restore";
  assertExactArguments(
    args,
    [confirmation],
    ["--source-database=", "--target-database=", "--backup="],
  );
  const sources = valuesFor(args, "--source-database=");
  const targets = valuesFor(args, "--target-database=");
  const backups = valuesFor(args, "--backup=");
  if (
    !args.includes(confirmation) ||
    sources.length !== 1 ||
    targets.length !== 1 ||
    backups.length !== 1
  ) {
    throw new SafePhase6StagingError(
      "Restore requires exact source, disposable target, backup and confirmation.",
    );
  }
  assertProductionStagingDatabase(sources[0]!);
  assertStagingRestoreDatabase(targets[0]!);
  return {
    sourceDatabase: sources[0]!,
    targetDatabase: targets[0]!,
    backupPath: assertExternalArtifactPath(backups[0]!, ".dump"),
  };
}

export function parseCleanupRestoreCommand(
  arguments_: readonly string[],
): CleanupRestoreCommand {
  const args = normalizeArguments(arguments_);
  const confirmation = "--confirm-drop-staging-restore";
  assertExactArguments(
    args,
    [confirmation],
    ["--target-database=", "--backup="],
  );
  const targets = valuesFor(args, "--target-database=");
  const backups = valuesFor(args, "--backup=");
  if (
    !args.includes(confirmation) ||
    targets.length !== 1 ||
    backups.length !== 1
  ) {
    throw new SafePhase6StagingError(
      "Restore cleanup requires a disposable target and confirmation.",
    );
  }
  assertStagingRestoreDatabase(targets[0]!);
  return {
    targetDatabase: targets[0]!,
    backupPath: assertExternalArtifactPath(backups[0]!, ".dump"),
  };
}

export function parseClearStaleRestoreLockCommand(
  arguments_: readonly string[],
): ClearStaleRestoreLockCommand {
  const args = normalizeArguments(arguments_);
  const confirmation = "--confirm-clear-stale-restore-lock";
  assertExactArguments(
    args,
    [confirmation],
    ["--target-database=", "--backup="],
  );
  const targets = valuesFor(args, "--target-database=");
  const backups = valuesFor(args, "--backup=");
  if (
    !args.includes(confirmation) ||
    targets.length !== 1 ||
    backups.length !== 1
  ) {
    throw new SafePhase6StagingError(
      "Stale restore-lock cleanup requires an exact disposable target and explicit confirmation.",
    );
  }
  assertStagingRestoreDatabase(targets[0]!);
  return {
    targetDatabase: targets[0]!,
    backupPath: assertExternalArtifactPath(backups[0]!, ".dump"),
  };
}

export function parseCleanupBackupsCommand(
  arguments_: readonly string[],
): CleanupBackupsCommand {
  const args = normalizeArguments(arguments_);
  const confirmation = "--confirm-cleanup-staging-backups";
  assertExactArguments(args, [confirmation], ["--backup-directory="]);
  const directories = valuesFor(args, "--backup-directory=");
  if (!args.includes(confirmation) || directories.length !== 1) {
    throw new SafePhase6StagingError(
      "Backup cleanup requires exact directory and confirmation.",
    );
  }
  if (resolve(directories[0]!) !== STAGING_BACKUP_DIRECTORY) {
    throw new SafePhase6StagingError(
      "Backup cleanup directory is not approved.",
    );
  }
  return { backupDirectory: STAGING_BACKUP_DIRECTORY };
}

export function assertExternalArtifactPath(
  path: string,
  extension: string,
  cwd = process.cwd(),
): string {
  if (!isAbsolute(path) || !path.endsWith(extension)) {
    throw new SafePhase6StagingError(
      "Artifact must be an absolute path with the required extension.",
    );
  }
  const absolute = resolve(path);
  const repository = resolve(cwd);
  const repositoryRelative = relative(repository, absolute);
  if (
    repositoryRelative === "" ||
    (repositoryRelative !== ".." &&
      !repositoryRelative.startsWith(`..${sep}`) &&
      !isAbsolute(repositoryRelative))
  ) {
    throw new SafePhase6StagingError(
      "Artifact must remain outside repository.",
    );
  }
  return absolute;
}

export function assertSha256(value: string, label = "SHA-256"): string {
  if (!SHA256.test(value)) {
    throw new SafePhase6StagingError(`${label} is invalid.`);
  }
  return value;
}

export function assertImageId(value: string): string {
  if (!IMAGE_ID.test(value)) {
    throw new SafePhase6StagingError("Docker image ID is invalid.");
  }
  return value;
}

export function assertMonitoringEmail(value: string | undefined): string {
  if (
    !value ||
    value.length > 254 ||
    PLACEHOLDER.test(value) ||
    value.toLowerCase().endsWith(".invalid") ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
  ) {
    throw new SafePhase6StagingError(
      "STAGING_MONITORING_EMAIL must be a non-placeholder valid address.",
    );
  }
  return value;
}

export function parseChangeWindow(
  environment: Readonly<Record<string, string | undefined>>,
  now = new Date(),
): ChangeWindow {
  if (environment.STAGING_TIMEZONE !== STAGING_TIMEZONE) {
    throw new SafePhase6StagingError("Staging timezone is invalid.");
  }
  const startValue = environment.STAGING_CHANGE_WINDOW_START;
  const endValue = environment.STAGING_CHANGE_WINDOW_END;
  if (
    !startValue ||
    !endValue ||
    !/(?:Z|[+-]\d{2}:\d{2})$/u.test(startValue) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/u.test(endValue)
  ) {
    throw new SafePhase6StagingError(
      "Change window requires ISO timestamps with explicit offsets.",
    );
  }
  const start = new Date(startValue);
  const end = new Date(endValue);
  const duration = end.getTime() - start.getTime();
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.getTime() <= now.getTime() ||
    duration <= 0 ||
    duration > 4 * 60 * 60 * 1000
  ) {
    throw new SafePhase6StagingError(
      "Change window is invalid, past or too long.",
    );
  }
  return { start, end, timezone: STAGING_TIMEZONE };
}

export function assertImageTag(imageTag: string, gitSha: string): void {
  if (
    !/^[a-f0-9]{40}$/u.test(gitSha) ||
    imageTag !== `ueb-core:${gitSha}` ||
    /(?:^|:)latest$/u.test(imageTag)
  ) {
    throw new SafePhase6StagingError(
      "Image tag must contain the exact Git SHA and must not use latest.",
    );
  }
}

export function assertSafeSuffix(value: string): void {
  if (!SAFE_SUFFIX.test(value)) {
    throw new SafePhase6StagingError("Disposable database suffix is unsafe.");
  }
}

export function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER.test(identifier) && !ROLE_IDENTIFIER.test(identifier)) {
    throw new SafePhase6StagingError("PostgreSQL identifier is unsafe.");
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function withDatabaseName(
  databaseUrl: string,
  database: string,
): string {
  if (!IDENTIFIER.test(database)) {
    throw new SafePhase6StagingError("Database name is unsafe.");
  }
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function assertDisposableDatabase(
  database: string,
  prefix: string,
  kind: string,
): void {
  assertForbiddenDatabase(database);
  if (!database.startsWith(prefix)) {
    throw new SafePhase6StagingError(
      `Target must be a disposable staging ${kind} database.`,
    );
  }
  const suffix = database.slice(prefix.length);
  assertSafeSuffix(suffix);
  if (Buffer.byteLength(database, "utf8") > 63) {
    throw new SafePhase6StagingError(
      "Database identifier exceeds PostgreSQL limit.",
    );
  }
}

function assertProductionEndpoint(
  url: URL,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (
    environment.STAGING_TARGET_HOST !== STAGING_VPS_HOST ||
    environment.STAGING_DATABASE_HOST !== STAGING_DATABASE_HOST ||
    environment.STAGING_DATABASE_PORT !== "5432" ||
    url.hostname !== STAGING_DATABASE_HOST ||
    url.port !== environment.STAGING_DATABASE_PORT
  ) {
    throw new SafePhase6StagingError(
      "Database endpoint does not match the explicit staging host contract.",
    );
  }
}
