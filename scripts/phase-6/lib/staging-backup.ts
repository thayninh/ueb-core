import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";

import { Client, type ClientBase } from "pg";

import {
  fingerprintStaging,
  withTemporaryOwnerSetRole,
} from "./staging-database";
import {
  assertExternalArtifactPath,
  assertSha256,
  assertStagingRestoreDatabase,
  parseStagingConnection,
  quoteIdentifier,
  SafePhase6StagingError,
  STAGING_BACKUP_DIRECTORY,
  STAGING_DATABASE,
  STAGING_OWNER_ROLE,
  withDatabaseName,
} from "./staging-contracts";

export interface BackupEvidence {
  readonly path: string;
  readonly checksum: string;
  readonly catalogValid: true;
  readonly mode: "0600";
}

interface BackupMetadata {
  readonly database: typeof STAGING_DATABASE;
  readonly createdAt: string;
  readonly tier: "daily" | "weekly";
  readonly checksum: string;
}

export async function backupStaging(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly outputPath: string;
}): Promise<BackupEvidence> {
  const connection = parseStagingConnection({
    value: input.environment.MIGRATION_DATABASE_URL,
    expectedDatabase: STAGING_DATABASE,
    expectedUser: STAGING_OWNER_ROLE,
    environment: input.environment,
  });
  const outputPath = assertExternalArtifactPath(input.outputPath, ".dump");
  if (dirname(outputPath) !== STAGING_BACKUP_DIRECTORY) {
    throw new SafePhase6StagingError(
      "Staging backup output must use the approved backup directory.",
    );
  }
  await assertMissing(outputPath);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const child = spawnPostgresTool(
    "pg_dump",
    ["--format=custom", "--no-owner", "--dbname", connection.database],
    connection.url,
  );
  const { createWriteStream } = await import("node:fs");
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  child.stderr.resume();
  try {
    await Promise.all([waitForSuccess(child), pipeline(child.stdout, output)]);
  } catch {
    child.kill();
    throw new SafePhase6StagingError(
      "Staging backup failed safely; partial artifact was not accepted.",
    );
  }
  await chmod(outputPath, 0o600);
  const checksum = await sha256File(outputPath);
  const sidecar = `${outputPath}.sha256`;
  await writeFile(sidecar, `${checksum}  ${basename(outputPath)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await validateCatalog(outputPath);
  const metadata: BackupMetadata = {
    database: STAGING_DATABASE,
    createdAt: new Date().toISOString(),
    tier: basename(outputPath).includes("_weekly_") ? "weekly" : "daily",
    checksum,
  };
  await writeFile(`${outputPath}.meta.json`, `${JSON.stringify(metadata)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return { path: outputPath, checksum, catalogValid: true, mode: "0600" };
}

export async function verifyStagingBackup(input: {
  readonly backupPath: string;
  readonly recordOffHostCopy?: boolean;
}): Promise<BackupEvidence> {
  const backupPath = assertExternalArtifactPath(input.backupPath, ".dump");
  const artifact = await stat(backupPath).catch(() => undefined);
  const sidecar = await stat(`${backupPath}.sha256`).catch(() => undefined);
  const metadataFile = await stat(`${backupPath}.meta.json`).catch(
    () => undefined,
  );
  if (
    !artifact?.isFile() ||
    !sidecar?.isFile() ||
    !metadataFile?.isFile() ||
    (artifact.mode & 0o777) !== 0o600 ||
    (sidecar.mode & 0o777) !== 0o600 ||
    (metadataFile.mode & 0o777) !== 0o600
  ) {
    throw new SafePhase6StagingError(
      "Backup artifact or checksum sidecar is missing or has unsafe mode.",
    );
  }
  const expected = (await readFile(`${backupPath}.sha256`, "utf8"))
    .trim()
    .split(/\s+/u)[0];
  const actual = await sha256File(backupPath);
  if (!expected || expected !== actual) {
    throw new SafePhase6StagingError("Backup checksum mismatch.");
  }
  const metadata = await readMetadata(backupPath);
  if (metadata.checksum !== actual) {
    throw new SafePhase6StagingError("Backup metadata checksum mismatch.");
  }
  await validateCatalog(backupPath);
  if (input.recordOffHostCopy) {
    await writeFile(`${backupPath}.offhost-ok`, `${actual}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  }
  return {
    path: backupPath,
    checksum: actual,
    catalogValid: true,
    mode: "0600",
  };
}

export async function cleanupStagingBackups(input: {
  readonly backupDirectory: typeof STAGING_BACKUP_DIRECTORY;
}): Promise<{ readonly deleted: number; readonly retained: number }> {
  const entries = await readdir(input.backupDirectory, { withFileTypes: true });
  const backups = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".dump"))
    .map((entry) => join(input.backupDirectory, entry.name));
  const records = await Promise.all(
    backups.map(async (path) => {
      const metadata = await readMetadata(path);
      const offHostChecksum = await readFile(`${path}.offhost-ok`, "utf8").then(
        (value) => value.trim(),
        () => undefined,
      );
      const sidecarChecksum = await readFile(`${path}.sha256`, "utf8").then(
        (value) => value.trim().split(/\s+/u)[0],
        () => undefined,
      );
      return {
        path,
        metadata,
        offHost:
          offHostChecksum === metadata.checksum &&
          sidecarChecksum === metadata.checksum,
        restoreLocked: await stat(`${path}.restore-lock`).then(
          () => true,
          () => false,
        ),
      };
    }),
  );
  const sorted = records.toSorted((a, b) =>
    b.metadata.createdAt.localeCompare(a.metadata.createdAt),
  );
  const keep = new Set<string>();
  for (const tier of ["daily", "weekly"] as const) {
    const limit = tier === "daily" ? 14 : 8;
    for (const record of sorted
      .filter((item) => item.metadata.tier === tier)
      .slice(0, limit)) {
      keep.add(record.path);
    }
  }
  let deleted = 0;
  for (const record of sorted) {
    if (keep.has(record.path) || !record.offHost || record.restoreLocked)
      continue;
    await Promise.all([
      rm(record.path),
      rm(`${record.path}.sha256`),
      rm(`${record.path}.meta.json`),
      rm(`${record.path}.offhost-ok`),
    ]);
    deleted += 1;
  }
  return { deleted, retained: records.length - deleted };
}

export async function restoreStagingRehearsal(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly backupPath: string;
  readonly targetDatabase: string;
}): Promise<{
  readonly sourceFingerprint: string;
  readonly restoredFingerprint: string;
  readonly sourceFingerprintUnchanged: true;
  readonly sourceRestoreFingerprintMatch: true;
  readonly databaseOwner: typeof STAGING_OWNER_ROLE;
  readonly restoreBootstrapCanSetOwnerRoleBeforeCreate: true;
  readonly temporaryMembershipRevoked: true;
  readonly restoreBootstrapCanSetOwnerRoleAfter: false;
}> {
  assertStagingRestoreDatabase(input.targetDatabase);
  const source = parseStagingConnection({
    value: input.environment.MIGRATION_DATABASE_URL,
    expectedDatabase: STAGING_DATABASE,
    expectedUser: STAGING_OWNER_ROLE,
    environment: input.environment,
  });
  await verifyStagingBackup({ backupPath: input.backupPath });
  const sourceFingerprintBefore = await fingerprintStaging({
    environment: input.environment,
  });
  const maintenance = await connectDatabaseAdmin(
    input.environment,
    "ueb-core-phase6-restore-create",
  );
  let ownership:
    Awaited<ReturnType<typeof createStagingRestoreDatabase>> | undefined;
  try {
    const exists = (
      await maintenance.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
        [input.targetDatabase],
      )
    ).rows[0]?.exists;
    if (exists) {
      throw new SafePhase6StagingError(
        "Restore target already exists; no cleanup was attempted.",
      );
    }
    await writeFile(
      `${input.backupPath}.restore-lock`,
      `${input.targetDatabase}\n`,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    ownership = await createStagingRestoreDatabase({
      client: maintenance,
      bootstrapRole: input.environment.STAGING_AUTHORIZED_BOOTSTRAP_ROLE!,
      targetDatabase: input.targetDatabase,
    });
  } finally {
    await maintenance.end().catch(() => undefined);
  }
  if (!ownership) {
    throw new SafePhase6StagingError(
      "Restore ownership evidence is unavailable; restore was not started.",
    );
  }
  const restoreUrl = withDatabaseName(source.url, input.targetDatabase);
  const child = spawnPostgresTool(
    "pg_restore",
    [
      "--exit-on-error",
      "--no-owner",
      "--dbname",
      input.targetDatabase,
      input.backupPath,
    ],
    restoreUrl,
    `ueb-core-phase6-restore-apply:${input.targetDatabase}`,
  );
  child.stdout.resume();
  child.stderr.resume();
  await waitForSuccess(child).catch(() => {
    throw new SafePhase6StagingError(
      "Restore failed; disposable database and restore lock were preserved.",
    );
  });
  const sourceFingerprintAfter = await fingerprintStaging({
    environment: input.environment,
  });
  assertFingerprintParity(sourceFingerprintBefore, sourceFingerprintAfter);
  if (sourceFingerprintBefore.sha256 !== sourceFingerprintAfter.sha256) {
    throw new SafePhase6StagingError(
      "Source staging fingerprint changed during restore rehearsal.",
    );
  }
  const restoreEnvironment = {
    ...input.environment,
    MIGRATION_DATABASE_URL: restoreUrl,
    STAGING_EXPECTED_DATABASE: input.targetDatabase,
  };
  const restoredFingerprint = await fingerprintStaging({
    environment: restoreEnvironment,
    databaseUrl: restoreUrl,
    expectedDatabase: input.targetDatabase,
  });
  assertFingerprintParity(sourceFingerprintAfter, restoredFingerprint);
  return {
    sourceFingerprint: sourceFingerprintAfter.sha256,
    restoredFingerprint: restoredFingerprint.sha256,
    sourceFingerprintUnchanged: true,
    sourceRestoreFingerprintMatch: true,
    databaseOwner: ownership.databaseOwner,
    restoreBootstrapCanSetOwnerRoleBeforeCreate:
      ownership.restoreBootstrapCanSetOwnerRoleBeforeCreate,
    temporaryMembershipRevoked: ownership.temporaryMembershipRevoked,
    restoreBootstrapCanSetOwnerRoleAfter:
      ownership.restoreBootstrapCanSetOwnerRoleAfter,
  };
}

export async function createStagingRestoreDatabase(input: {
  readonly client: ClientBase;
  readonly bootstrapRole: string;
  readonly targetDatabase: string;
}): Promise<{
  readonly databaseOwner: typeof STAGING_OWNER_ROLE;
  readonly restoreBootstrapCanSetOwnerRoleBeforeCreate: true;
  readonly temporaryMembershipRevoked: true;
  readonly restoreBootstrapCanSetOwnerRoleAfter: false;
}> {
  assertStagingRestoreDatabase(input.targetDatabase);
  const membership = await withTemporaryOwnerSetRole({
    client: input.client,
    bootstrapRole: input.bootstrapRole,
    ownerRole: STAGING_OWNER_ROLE,
    operation: async () => {
      await input.client.query(
        `CREATE DATABASE ${quoteIdentifier(input.targetDatabase)} OWNER ${quoteIdentifier(STAGING_OWNER_ROLE)}`,
      );
    },
  });
  const databaseOwner = (
    await input.client.query<{ owner: string }>(
      `SELECT pg_get_userbyid(datdba) AS owner
       FROM pg_database WHERE datname = $1`,
      [input.targetDatabase],
    )
  ).rows[0]?.owner;
  if (databaseOwner !== STAGING_OWNER_ROLE) {
    throw new SafePhase6StagingError(
      "Restore target is not owned by the exact staging owner role.",
    );
  }
  return {
    databaseOwner,
    restoreBootstrapCanSetOwnerRoleBeforeCreate:
      membership.canSetBeforeOperation,
    temporaryMembershipRevoked: membership.membershipRevoked,
    restoreBootstrapCanSetOwnerRoleAfter: membership.canSetAfterOperation,
  };
}

export async function clearStaleStagingRestoreLock(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly targetDatabase: string;
  readonly backupPath: string;
}): Promise<void> {
  const maintenance = await connectDatabaseAdmin(
    input.environment,
    "ueb-core-phase6-restore-lock-recovery",
  );
  try {
    await clearStaleStagingRestoreLockWithClient({
      client: maintenance,
      targetDatabase: input.targetDatabase,
      backupPath: input.backupPath,
    });
  } finally {
    await maintenance.end().catch(() => undefined);
  }
}

export async function clearStaleStagingRestoreLockWithClient(input: {
  readonly client: ClientBase;
  readonly targetDatabase: string;
  readonly backupPath: string;
}): Promise<void> {
  assertStagingRestoreDatabase(input.targetDatabase);
  const backupPath = assertExternalArtifactPath(input.backupPath, ".dump");
  const lockPath = `${backupPath}.restore-lock`;
  const [backupArtifact, lockArtifact] = await Promise.all([
    stat(backupPath).catch(() => undefined),
    stat(lockPath).catch(() => undefined),
  ]);
  if (
    !backupArtifact?.isFile() ||
    !lockArtifact?.isFile() ||
    (lockArtifact.mode & 0o777) !== 0o600
  ) {
    throw new SafePhase6StagingError(
      "Stale restore lock or its backup artifact is missing or unsafe.",
    );
  }
  const lockedTarget = await readFile(lockPath, "utf8").then(
    (value) => value.trim(),
    () => undefined,
  );
  if (lockedTarget !== input.targetDatabase) {
    throw new SafePhase6StagingError(
      "Stale restore lock does not match the exact disposable target.",
    );
  }
  const state = (
    await input.client.query<{
      target_exists: boolean;
      active_restore: boolean;
    }>(
      `SELECT
         EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS target_exists,
         EXISTS (
           SELECT 1 FROM pg_stat_activity
           WHERE pid <> pg_backend_pid()
             AND (datname = $1 OR application_name = 'ueb-core-phase6-restore-create')
         ) AS active_restore`,
      [input.targetDatabase],
    )
  ).rows[0];
  if (!state || state.target_exists || state.active_restore) {
    throw new SafePhase6StagingError(
      "Stale restore lock cannot be cleared while target or restore activity exists.",
    );
  }
  await rm(lockPath);
}

export async function cleanupStagingRestore(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly targetDatabase: string;
  readonly backupPath: string;
}): Promise<void> {
  assertStagingRestoreDatabase(input.targetDatabase);
  const backupPath = assertExternalArtifactPath(input.backupPath, ".dump");
  const lockPath = `${backupPath}.restore-lock`;
  const lockedTarget = await readFile(lockPath, "utf8").then(
    (value) => value.trim(),
    () => undefined,
  );
  if (lockedTarget !== input.targetDatabase) {
    throw new SafePhase6StagingError(
      "Restore cleanup lock does not match the disposable target.",
    );
  }
  parseStagingConnection({
    value: input.environment.MIGRATION_DATABASE_URL,
    expectedDatabase: STAGING_DATABASE,
    expectedUser: STAGING_OWNER_ROLE,
    environment: input.environment,
  });
  const maintenance = await connectDatabaseAdmin(
    input.environment,
    "ueb-core-phase6-restore-cleanup",
  );
  try {
    const owner = (
      await maintenance.query<{ owner: string }>(
        `SELECT pg_get_userbyid(datdba) AS owner
         FROM pg_database WHERE datname = $1`,
        [input.targetDatabase],
      )
    ).rows[0]?.owner;
    if (owner !== STAGING_OWNER_ROLE) {
      throw new SafePhase6StagingError(
        "Restore cleanup target is absent or has an unexpected owner.",
      );
    }
    await maintenance.query(
      `DROP DATABASE ${quoteIdentifier(input.targetDatabase)} WITH (FORCE)`,
    );
  } finally {
    await maintenance.end().catch(() => undefined);
  }
  await rm(lockPath);
}

async function connectDatabaseAdmin(
  environment: Readonly<Record<string, string | undefined>>,
  applicationName: string,
): Promise<Client> {
  const authorizedRole = environment.STAGING_AUTHORIZED_BOOTSTRAP_ROLE;
  if (!authorizedRole || authorizedRole === STAGING_OWNER_ROLE) {
    throw new SafePhase6StagingError(
      "Restore requires the distinct authorized database admin role.",
    );
  }
  const admin = parseStagingConnection({
    value: environment.STAGING_ROLE_ADMIN_DATABASE_URL,
    expectedDatabase: STAGING_DATABASE,
    expectedUser: authorizedRole,
    environment,
  });
  const client = new Client({
    connectionString: withDatabaseName(admin.url, "postgres"),
    application_name: applicationName,
  });
  await client.connect();
  const attributes = (
    await client.query<{
      current_user: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(
      `SELECT current_user, rolsuper, rolcreatedb, rolcreaterole
       FROM pg_roles WHERE rolname = current_user`,
    )
  ).rows[0];
  if (
    attributes?.current_user !== authorizedRole ||
    attributes.rolsuper ||
    !attributes.rolcreatedb ||
    !attributes.rolcreaterole
  ) {
    await client.end().catch(() => undefined);
    throw new SafePhase6StagingError(
      "Authorized database admin must be non-superuser with CREATEDB and CREATEROLE.",
    );
  }
  return client;
}

function spawnPostgresTool(
  command: string,
  args: readonly string[],
  databaseUrl: string,
  applicationName?: string,
) {
  const url = new URL(databaseUrl);
  return spawn(command, [...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      ...(applicationName ? { PGAPPNAME: applicationName } : {}),
    },
  });
}

async function validateCatalog(backupPath: string): Promise<void> {
  const child = spawn("pg_restore", ["--list", backupPath], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  await waitForSuccess(child).catch(() => {
    throw new SafePhase6StagingError("Backup catalog validation failed.");
  });
}

function waitForSuccess(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("PostgreSQL tool failed."));
    });
  });
}

async function assertMissing(path: string): Promise<void> {
  if (await stat(path).catch(() => undefined)) {
    throw new SafePhase6StagingError("Backup output already exists.");
  }
  for (const suffix of [
    ".sha256",
    ".meta.json",
    ".offhost-ok",
    ".restore-lock",
  ]) {
    if (await stat(`${path}${suffix}`).catch(() => undefined)) {
      throw new SafePhase6StagingError("Backup sidecar path already exists.");
    }
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function readMetadata(path: string): Promise<BackupMetadata> {
  const parsed = JSON.parse(
    await readFile(`${path}.meta.json`, "utf8"),
  ) as Partial<BackupMetadata>;
  if (
    parsed.database !== STAGING_DATABASE ||
    !parsed.createdAt ||
    (parsed.tier !== "daily" && parsed.tier !== "weekly") ||
    !parsed.checksum ||
    !Number.isFinite(Date.parse(parsed.createdAt))
  ) {
    throw new SafePhase6StagingError("Backup metadata is invalid.");
  }
  assertSha256(parsed.checksum, "Backup metadata SHA-256");
  return parsed as BackupMetadata;
}

function assertFingerprintParity(
  source: Awaited<ReturnType<typeof fingerprintStaging>>,
  restored: Awaited<ReturnType<typeof fingerprintStaging>>,
): void {
  for (const key of [
    "migrationCount",
    "failedMigrationCount",
    "coreCount",
    "workflowCount",
    "importRunCount",
    "maxStt",
    "sequenceLastValue",
    "sequenceIsCalled",
    "authUserCount",
    "activeSessionCount",
    "runtimeFlags",
    "provisionerFlags",
  ] as const) {
    if (source[key] !== restored[key]) {
      throw new SafePhase6StagingError(
        "Restored target does not match the source fingerprint metadata.",
      );
    }
  }
}
