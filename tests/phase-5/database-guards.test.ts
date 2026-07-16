// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assertBackupPath,
  assertDisposableRestoreDatabase,
  parseBackupCommand,
  parseCleanupCommand,
  parseRestoreCommand,
  readOwnerDatabaseContext,
} from "../../scripts/phase-5/lib/database-guards";

describe("Phase 5 backup and restore database guards", () => {
  it("accepts the exact guarded backup contract", () => {
    expect(
      parseBackupCommand(["--confirm-backup", "--expected-database=ueb_core"]),
    ).toEqual({ expectedDatabase: "ueb_core" });
  });

  it("requires explicit backup confirmation", () => {
    expect(() =>
      parseBackupCommand(["--expected-database=ueb_core"]),
    ).toThrow();
  });

  it.each(["ueb_core", "postgres", "template0", "template1"])(
    "rejects forbidden restore target %s",
    (target) => {
      expect(() => assertDisposableRestoreDatabase(target)).toThrow();
    },
  );

  it.each(["ueb_core_restore", "other_restore_phase5", "UEB_CORE_RESTORE_X"])(
    "rejects target without exact disposable prefix: %s",
    (target) => {
      expect(() => assertDisposableRestoreDatabase(target)).toThrow();
    },
  );

  it("accepts a new disposable restore target", () => {
    expect(() =>
      assertDisposableRestoreDatabase("ueb_core_restore_phase5"),
    ).not.toThrow();
  });

  it("validates restore before accepting the command", () => {
    expect(
      parseRestoreCommand([
        "--backup=infra/backup/ueb_core_phase5.dump",
        "--target-database=ueb_core_restore_phase5",
        "--confirm-create-disposable-database",
      ]),
    ).toEqual({
      backupPath: "infra/backup/ueb_core_phase5.dump",
      targetDatabase: "ueb_core_restore_phase5",
    });
    expect(() =>
      parseRestoreCommand([
        "--backup=infra/backup/ueb_core_phase5.dump",
        "--target-database=ueb_core",
        "--confirm-create-disposable-database",
      ]),
    ).toThrow();
  });

  it("requires cleanup confirmation and a disposable target", () => {
    expect(
      parseCleanupCommand([
        "--target-database=ueb_core_restore_phase5",
        "--confirm-drop-disposable-database",
      ]),
    ).toEqual({ targetDatabase: "ueb_core_restore_phase5" });
    expect(() =>
      parseCleanupCommand(["--target-database=ueb_core_restore_phase5"]),
    ).toThrow();
  });

  it("keeps backup input under the ignored backup directory", () => {
    expect(assertBackupPath("infra/backup/ueb_core_phase5.dump", "/repo")).toBe(
      "/repo/infra/backup/ueb_core_phase5.dump",
    );
    expect(() => assertBackupPath("../outside.dump", "/repo")).toThrow();
  });

  it("requires split owner and runtime identities on exact local acceptance", () => {
    expect(
      readOwnerDatabaseContext({
        MIGRATION_DATABASE_URL:
          "postgresql://owner:secret@127.0.0.1:55432/ueb_core",
        POSTGRES_DB: "ueb_core",
        POSTGRES_USER: "owner",
        APP_DATABASE_USER: "runtime",
      }),
    ).toMatchObject({
      sourceDatabase: "ueb_core",
      ownerUser: "owner",
      runtimeRole: "runtime",
    });
    expect(() =>
      readOwnerDatabaseContext({
        MIGRATION_DATABASE_URL:
          "postgresql://runtime:secret@127.0.0.1:55432/ueb_core",
        POSTGRES_DB: "ueb_core",
        POSTGRES_USER: "runtime",
        APP_DATABASE_USER: "runtime",
      }),
    ).toThrow();
  });
});
