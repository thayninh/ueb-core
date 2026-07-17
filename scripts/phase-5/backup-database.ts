import "dotenv/config";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "pg";

import {
  assertBackupPath,
  assertMigrationRoleOwnsSource,
  DEFAULT_BACKUP_PATH,
  parseBackupCommand,
  readOwnerDatabaseContext,
  SafePhase5DatabaseError,
  withDatabaseName,
} from "./lib/database-guards";
import {
  runDockerToolFromFile,
  runDockerToolToFile,
} from "./lib/postgres-tools";

const BACKUP_COMMAND =
  'exec pg_dump --format=custom --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"';
const CATALOG_COMMAND = "exec pg_restore --list";
const REQUIRED_CATALOG_ENTRIES = [
  "TABLE DATA public ueb_core_data",
  "TABLE DATA public import_run",
  "TABLE DATA public _prisma_migrations",
] as const;

export async function createPhase5Backup(
  environment: Readonly<Record<string, string | undefined>>,
  expectedDatabase: string,
): Promise<{ readonly checksum: string }> {
  const context = readOwnerDatabaseContext(environment, expectedDatabase);
  const backupPath = assertBackupPath(DEFAULT_BACKUP_PATH);
  const checksumPath = `${backupPath}.sha256`;
  await assertPathDoesNotExist(backupPath);
  await assertPathDoesNotExist(checksumPath);
  await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });

  const maintenance = new Client({
    connectionString: withDatabaseName(context.migrationUrl, "postgres"),
    application_name: "ueb-core-phase5-backup-guard",
  });
  try {
    await maintenance.connect();
    await assertMigrationRoleOwnsSource(maintenance, context);
  } finally {
    await maintenance.end().catch(() => undefined);
  }

  await runDockerToolToFile(BACKUP_COMMAND, backupPath);
  if ((await stat(backupPath)).size <= 0) {
    throw new SafePhase5DatabaseError("Backup archive is empty.");
  }
  const checksum = await sha256File(backupPath);
  await writeFile(checksumPath, `${checksum}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const catalog = (
    await runDockerToolFromFile({
      shellCommand: CATALOG_COMMAND,
      inputPath: backupPath,
      captureOutput: true,
    })
  ).toString("utf8");
  if (!REQUIRED_CATALOG_ENTRIES.every((entry) => catalog.includes(entry))) {
    throw new SafePhase5DatabaseError("Backup catalog validation failed.");
  }
  return { checksum };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertPathDoesNotExist(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    return;
  }
  throw new SafePhase5DatabaseError("Backup artifact already exists.");
}

async function main(): Promise<void> {
  try {
    const command = parseBackupCommand(process.argv.slice(2));
    const report = await createPhase5Backup(
      process.env,
      command.expectedDatabase,
    );
    console.log(
      [
        "BACKUP_STATUS=PASS",
        `BACKUP_CHECKSUM=${report.checksum}`,
        "BACKUP_CHECKSUM_STATUS=PASS",
        "BACKUP_CATALOG_STATUS=PASS",
      ].join("\n"),
    );
  } catch {
    console.error(
      [
        "BACKUP_STATUS=FAIL",
        "BACKUP_CHECKSUM_STATUS=FAIL",
        "BACKUP_CATALOG_STATUS=FAIL",
      ].join("\n"),
    );
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
