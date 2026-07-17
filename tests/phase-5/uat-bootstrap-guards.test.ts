// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertUatDatabase,
  parseBootstrapUatCommand,
  parseCleanupUatCommand,
  parseRestoreCommand,
  parseRevokeUatSessionsCommand,
  readUatOwnerDatabaseContext,
} from "../../scripts/phase-5/lib/database-guards";
import {
  assertUatTargetDoesNotExist,
  validateUatBackupArtifact,
} from "../../scripts/phase-5/lib/uat-database";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Phase 5 UAT bootstrap guards", () => {
  it("accepts only the explicit UAT bootstrap contract", () => {
    expect(
      parseBootstrapUatCommand([
        "--backup=/secure/ueb-core.dump",
        "--target-database=ueb_core_uat_phase5",
        "--confirm-create-uat-database",
        "--expected-source-database=ueb_core",
      ]),
    ).toEqual({
      backupPath: "/secure/ueb-core.dump",
      targetDatabase: "ueb_core_uat_phase5",
      expectedSourceDatabase: "ueb_core",
    });
  });

  it.each(["ueb_core", "postgres", "template0", "template1"])(
    "rejects forbidden target %s before database work",
    (target) => {
      expect(() => assertUatDatabase(target)).toThrow();
    },
  );

  it("keeps restore rehearsal and UAT prefixes separate", () => {
    expect(() => assertUatDatabase("ueb_core_restore_phase5")).toThrow();
    expect(() =>
      parseRestoreCommand([
        "--backup=infra/backup/ueb_core_phase5.dump",
        "--target-database=ueb_core_uat_phase5",
        "--confirm-create-disposable-database",
      ]),
    ).toThrow();
  });

  it.each([
    "ueb_core_uat_",
    "ueb_core_uat_bad-name",
    "UEB_CORE_UAT_PHASE5",
    "ueb_core_uat_phase5;drop",
  ])("rejects unsafe or incomplete UAT name %s", (target) => {
    expect(() => assertUatDatabase(target)).toThrow();
  });

  it("requires bootstrap confirmation", () => {
    expect(() =>
      parseBootstrapUatCommand([
        "--backup=/secure/ueb-core.dump",
        "--target-database=ueb_core_uat_phase5",
        "--expected-source-database=ueb_core",
      ]),
    ).toThrow();
  });

  it("rejects remote owner hosts and non-standard ports", () => {
    const base = {
      POSTGRES_USER: "owner",
      APP_DATABASE_USER: "runtime",
    };
    expect(() =>
      readUatOwnerDatabaseContext(
        {
          ...base,
          MIGRATION_DATABASE_URL:
            "postgresql://owner:secret@database.example:55432/ueb_core_uat_phase5",
        },
        "ueb_core_uat_phase5",
      ),
    ).toThrow();
    expect(() =>
      readUatOwnerDatabaseContext(
        {
          ...base,
          MIGRATION_DATABASE_URL:
            "postgresql://owner:secret@127.0.0.1:5432/ueb_core_uat_phase5",
        },
        "ueb_core_uat_phase5",
      ),
    ).toThrow();
  });

  it("rejects a missing checksum sidecar", async () => {
    const directory = await makeTemporaryDirectory();
    const backup = join(directory, "backup.dump");
    await writeFile(backup, "not-a-real-backup", { mode: 0o600 });
    await expect(validateUatBackupArtifact(backup)).rejects.toThrow();
  });

  it("rejects a checksum mismatch", async () => {
    const directory = await makeTemporaryDirectory();
    const backup = join(directory, "backup.dump");
    await writeFile(backup, "not-the-accepted-backup", { mode: 0o600 });
    await writeFile(`${backup}.sha256`, `${"0".repeat(64)}\n`, {
      mode: 0o600,
    });
    await expect(validateUatBackupArtifact(backup)).rejects.toThrow();
  });

  it("refuses an existing target instead of overwriting it", () => {
    expect(() => assertUatTargetDoesNotExist(true)).toThrow();
    expect(() => assertUatTargetDoesNotExist(false)).not.toThrow();
  });

  it("guards session revocation and UAT cleanup independently", () => {
    expect(() =>
      parseRevokeUatSessionsCommand(["--target-database=ueb_core_uat_phase5"]),
    ).toThrow();
    expect(
      parseRevokeUatSessionsCommand([
        "--target-database=ueb_core_uat_phase5",
        "--confirm-revoke-copied-sessions",
      ]),
    ).toEqual({ targetDatabase: "ueb_core_uat_phase5" });
    expect(() =>
      parseCleanupUatCommand([
        "--target-database=ueb_core",
        "--confirm-drop-uat-database",
      ]),
    ).toThrow();
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ueb-core-phase5-uat-"));
  temporaryDirectories.push(directory);
  return directory;
}
