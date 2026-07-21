import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { SafePhase6StagingError } from "./staging-contracts";

const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+$/u;

export interface MigrationLedgerEntry {
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationLedger {
  readonly version: 1;
  readonly count: number;
  readonly fingerprint: string;
  readonly migrations: readonly MigrationLedgerEntry[];
}

export async function readSourceMigrationLedger(
  migrationsDirectory = resolve(process.cwd(), "prisma/migrations"),
): Promise<MigrationLedger> {
  const directory = resolve(migrationsDirectory);
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) {
    throw new SafePhase6StagingError("Source migration ledger is empty.");
  }

  const migrations: MigrationLedgerEntry[] = [];
  for (const entry of entries) {
    if (!MIGRATION_NAME.test(entry.name)) {
      throw new SafePhase6StagingError(
        "Source migration directory name is unsafe.",
      );
    }
    const migrationPath = join(directory, entry.name, "migration.sql");
    const file = await lstat(migrationPath).catch(() => undefined);
    if (!file?.isFile() || file.isSymbolicLink()) {
      throw new SafePhase6StagingError(
        "Source migration ledger contains a missing or unsafe migration file.",
      );
    }
    const content = await readFile(migrationPath);
    migrations.push({
      name: entry.name,
      checksum: createHash("sha256").update(content).digest("hex"),
    });
  }

  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ version: 1, migrations }))
    .digest("hex");
  return { version: 1, count: migrations.length, fingerprint, migrations };
}

export function assertMigrationLedgerMatches(
  source: MigrationLedger,
  candidate: Pick<MigrationLedger, "count" | "fingerprint">,
  label: string,
): void {
  if (
    candidate.count !== source.count ||
    candidate.fingerprint !== source.fingerprint
  ) {
    throw new SafePhase6StagingError(
      `${label} migration ledger does not match the approved source ledger.`,
    );
  }
}

export function assertDatabaseMigrationRows(
  source: MigrationLedger,
  rows: readonly {
    readonly migration_name: string;
    readonly checksum: string;
    readonly finished_at: Date | string | null;
    readonly rolled_back_at: Date | string | null;
  }[],
): void {
  const applied = rows.map((row) => ({
    name: row.migration_name,
    checksum: row.checksum,
    applied: row.finished_at !== null && row.rolled_back_at === null,
  }));
  if (
    rows.length !== source.count ||
    applied.length !== source.count ||
    applied.some(
      (row, index) =>
        !row.applied ||
        row.name !== source.migrations[index]?.name ||
        row.checksum !== source.migrations[index]?.checksum,
    )
  ) {
    throw new SafePhase6StagingError(
      "Database migration ledger is not compatible with the approved source ledger.",
    );
  }
}
