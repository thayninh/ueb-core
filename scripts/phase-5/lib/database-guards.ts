import { Buffer } from "node:buffer";
import { resolve, sep } from "node:path";

import type { ClientBase } from "pg";

export const ACCEPTANCE_DATABASE = "ueb_core";
export const RESTORE_DATABASE_PREFIX = "ueb_core_restore_";
export const DISPOSABLE_DATABASE_MARKER = "ueb-core:phase-5:disposable-restore";
export const DEFAULT_BACKUP_PATH = "infra/backup/ueb_core_phase5.dump";

const CONFIRM_BACKUP = "--confirm-backup";
const CONFIRM_CREATE = "--confirm-create-disposable-database";
const CONFIRM_DROP = "--confirm-drop-disposable-database";
const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const DATABASE_IDENTIFIER = /^[a-z][a-z0-9_]*$/u;
const ROLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/u;
const FORBIDDEN_DATABASES = new Set([
  ACCEPTANCE_DATABASE,
  "postgres",
  "template0",
  "template1",
]);

export class SafePhase5DatabaseError extends Error {}

export interface OwnerDatabaseContext {
  readonly migrationUrl: string;
  readonly sourceDatabase: string;
  readonly ownerUser: string;
  readonly runtimeRole: string;
}

export interface BackupCommand {
  readonly expectedDatabase: string;
}

export interface RestoreCommand {
  readonly backupPath: string;
  readonly targetDatabase: string;
}

export interface CleanupCommand {
  readonly targetDatabase: string;
}

export function parseBackupCommand(
  arguments_: readonly string[],
): BackupCommand {
  const args = normalizeArguments(arguments_);
  const expected = valuesFor(args, "--expected-database=");
  assertExactFlags(args, [CONFIRM_BACKUP], ["--expected-database="]);
  if (!args.includes(CONFIRM_BACKUP) || expected.length !== 1) {
    throw new SafePhase5DatabaseError(
      "Backup requires explicit confirmation and one expected database.",
    );
  }
  assertDatabaseIdentifier(expected[0]!);
  return { expectedDatabase: expected[0]! };
}

export function parseRestoreCommand(
  arguments_: readonly string[],
): RestoreCommand {
  const args = normalizeArguments(arguments_);
  const backups = valuesFor(args, "--backup=");
  const targets = valuesFor(args, "--target-database=");
  assertExactFlags(args, [CONFIRM_CREATE], ["--backup=", "--target-database="]);
  if (
    !args.includes(CONFIRM_CREATE) ||
    backups.length !== 1 ||
    targets.length !== 1
  ) {
    throw new SafePhase5DatabaseError(
      "Restore requires one backup, one target and explicit confirmation.",
    );
  }
  assertDisposableRestoreDatabase(targets[0]!);
  return { backupPath: backups[0]!, targetDatabase: targets[0]! };
}

export function parseCleanupCommand(
  arguments_: readonly string[],
): CleanupCommand {
  const args = normalizeArguments(arguments_);
  const targets = valuesFor(args, "--target-database=");
  assertExactFlags(args, [CONFIRM_DROP], ["--target-database="]);
  if (!args.includes(CONFIRM_DROP) || targets.length !== 1) {
    throw new SafePhase5DatabaseError(
      "Cleanup requires one target and explicit confirmation.",
    );
  }
  assertDisposableRestoreDatabase(targets[0]!);
  return { targetDatabase: targets[0]! };
}

export function assertDisposableRestoreDatabase(databaseName: string): void {
  if (
    FORBIDDEN_DATABASES.has(databaseName) ||
    !databaseName.startsWith(RESTORE_DATABASE_PREFIX) ||
    databaseName.length <= RESTORE_DATABASE_PREFIX.length ||
    !DATABASE_IDENTIFIER.test(databaseName) ||
    Buffer.byteLength(databaseName, "utf8") > 63
  ) {
    throw new SafePhase5DatabaseError(
      "Restore target must be a disposable Phase 5 database.",
    );
  }
}

export function assertBackupPath(
  backupPath: string,
  cwd = process.cwd(),
): string {
  const backupRoot = resolve(cwd, "infra/backup");
  const absolutePath = resolve(cwd, backupPath);
  if (
    !absolutePath.startsWith(`${backupRoot}${sep}`) ||
    !absolutePath.endsWith(".dump")
  ) {
    throw new SafePhase5DatabaseError(
      "Backup path must be a custom-format dump under infra/backup.",
    );
  }
  return absolutePath;
}

export function readOwnerDatabaseContext(
  environment: Readonly<Record<string, string | undefined>>,
  expectedDatabase = ACCEPTANCE_DATABASE,
): OwnerDatabaseContext {
  const migrationUrl = environment.MIGRATION_DATABASE_URL;
  const postgresDatabase = environment.POSTGRES_DB;
  const postgresUser = environment.POSTGRES_USER;
  const runtimeRole = environment.APP_DATABASE_USER;
  if (!migrationUrl || !postgresDatabase || !postgresUser || !runtimeRole) {
    throw new SafePhase5DatabaseError(
      "Owner database environment is incomplete.",
    );
  }

  let url: URL;
  try {
    url = new URL(migrationUrl);
  } catch {
    throw new SafePhase5DatabaseError("Migration connection is invalid.");
  }
  const sourceDatabase = decodeURIComponent(url.pathname.slice(1));
  const ownerUser = decodeURIComponent(url.username);
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    url.port !== "55432" ||
    sourceDatabase !== expectedDatabase ||
    postgresDatabase !== expectedDatabase ||
    ownerUser !== postgresUser ||
    !ROLE_IDENTIFIER.test(ownerUser) ||
    !ROLE_IDENTIFIER.test(runtimeRole) ||
    ownerUser === runtimeRole
  ) {
    throw new SafePhase5DatabaseError(
      "Owner connection does not match the guarded local database.",
    );
  }
  return { migrationUrl, sourceDatabase, ownerUser, runtimeRole };
}

export function withDatabaseName(
  databaseUrl: string,
  databaseName: string,
): string {
  assertDatabaseIdentifier(databaseName);
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function quoteIdentifier(identifier: string): string {
  if (
    !DATABASE_IDENTIFIER.test(identifier) &&
    !ROLE_IDENTIFIER.test(identifier)
  ) {
    throw new SafePhase5DatabaseError("Unsafe PostgreSQL identifier.");
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function assertMigrationRoleOwnsSource(
  client: ClientBase,
  context: OwnerDatabaseContext,
): Promise<void> {
  const result = await client.query<{
    current_user: string;
    database_owner: string;
  }>(
    `
      SELECT
        current_user,
        pg_get_userbyid(datdba) AS database_owner
      FROM pg_database
      WHERE datname = $1
    `,
    [context.sourceDatabase],
  );
  const row = result.rows[0];
  if (
    !row ||
    row.current_user !== context.ownerUser ||
    row.database_owner !== context.ownerUser
  ) {
    throw new SafePhase5DatabaseError(
      "Migration role must own the source database.",
    );
  }
}

function normalizeArguments(arguments_: readonly string[]): readonly string[] {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  if (args.includes("--")) {
    throw new SafePhase5DatabaseError("Invalid command separator.");
  }
  return args;
}

function valuesFor(args: readonly string[], prefix: string): string[] {
  return args
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length))
    .filter((value) => value.length > 0);
}

function assertExactFlags(
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
  if (unknown.length > 0 || duplicateExact) {
    throw new SafePhase5DatabaseError("Command arguments are invalid.");
  }
}

function assertDatabaseIdentifier(databaseName: string): void {
  if (
    !DATABASE_IDENTIFIER.test(databaseName) ||
    Buffer.byteLength(databaseName, "utf8") > 63
  ) {
    throw new SafePhase5DatabaseError("Database name is invalid.");
  }
}
