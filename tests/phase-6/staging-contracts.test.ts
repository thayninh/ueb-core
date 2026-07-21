// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assertForbiddenDatabase,
  assertImageTag,
  assertMonitoringEmail,
  assertRoleSeparation,
  assertStagingUrl,
  parseChangeWindow,
  parseClearStaleRestoreLockCommand,
  parseCleanupRestoreCommand,
  parseConfirmedTargetCommand,
  parseRestoreCommand,
  parseStagingConnection,
  STAGING_DATABASE,
  STAGING_OWNER_ROLE,
  STAGING_PROVISIONING_ROLE,
  STAGING_RUNTIME_ROLE,
  STAGING_URL,
} from "../../scripts/phase-6/lib/staging-contracts";

const productionEnvironment = {
  STAGING_TARGET_HOST: "103.200.25.54",
  STAGING_DATABASE_HOST: "db",
  STAGING_DATABASE_PORT: "5432",
};
const stagingOwnerUrl =
  "postgresql://ueb_core_staging_owner:test-only-password@db:5432/ueb_core_staging";

describe("Phase 6 staging target contracts", () => {
  it("blocks canonical, UAT, maintenance, Phase 5 restore, and unsafe targets", () => {
    for (const database of [
      "ueb_core",
      "ueb_core_uat_phase5",
      "ueb_core_uat_operator",
      "ueb_core_restore_rehearsal",
      "postgres",
      "template0",
      "template1",
      "unsafe-target",
    ]) {
      expect(() => assertForbiddenDatabase(database)).toThrow();
    }
  });

  it("accepts only the exact production staging target and endpoint", () => {
    expect(
      parseStagingConnection({
        value: stagingOwnerUrl,
        expectedDatabase: STAGING_DATABASE,
        expectedUser: STAGING_OWNER_ROLE,
        environment: productionEnvironment,
      }),
    ).toMatchObject({
      database: STAGING_DATABASE,
      user: STAGING_OWNER_ROLE,
      host: "db",
      port: "5432",
      disposableTest: false,
    });
  });

  it("accepts disposable tests only on the isolated local endpoint", () => {
    const database = "ueb_core_staging_test_guard_01";
    expect(
      parseStagingConnection({
        value: `postgresql://${STAGING_OWNER_ROLE}:test-only-password@127.0.0.1:55432/${database}`,
        expectedDatabase: database,
        expectedUser: STAGING_OWNER_ROLE,
        environment: {},
        allowTest: true,
      }),
    ).toMatchObject({ database, host: "127.0.0.1", port: "55432" });
    const containerUrl = `postgresql://${STAGING_OWNER_ROLE}:test-only-password@phase6-test-db:5432/${database}`;
    expect(() =>
      parseStagingConnection({
        value: containerUrl,
        expectedDatabase: database,
        expectedUser: STAGING_OWNER_ROLE,
        environment: {},
        allowTest: true,
      }),
    ).toThrow();
    expect(
      parseStagingConnection({
        value: containerUrl,
        expectedDatabase: database,
        expectedUser: STAGING_OWNER_ROLE,
        environment: {
          PHASE6_STAGING_INTEGRATION: "1",
          PHASE6_TEST_DATABASE_HOST: "phase6-test-db",
          PHASE6_TEST_DATABASE_PORT: "5432",
        },
        allowTest: true,
      }),
    ).toMatchObject({ database, host: "phase6-test-db", port: "5432" });
  });

  it("blocks a wrong production host or port", () => {
    for (const value of [
      stagingOwnerUrl.replace("@db:", "@wrong-host:"),
      stagingOwnerUrl.replace(":5432", ":55432"),
    ]) {
      expect(() =>
        parseStagingConnection({
          value,
          expectedDatabase: STAGING_DATABASE,
          expectedUser: STAGING_OWNER_ROLE,
          environment: productionEnvironment,
        }),
      ).toThrow();
    }
  });

  it("requires the exact destructive-operation confirmation", () => {
    expect(() =>
      parseConfirmedTargetCommand({
        arguments_: [`--expected-database=${STAGING_DATABASE}`],
        confirmation: "--confirm-create-staging-database",
      }),
    ).toThrow();
    expect(
      parseConfirmedTargetCommand({
        arguments_: [
          `--expected-database=${STAGING_DATABASE}`,
          "--confirm-create-staging-database",
        ],
        confirmation: "--confirm-create-staging-database",
      }),
    ).toEqual({ expectedDatabase: STAGING_DATABASE });
  });

  it("blocks owner, runtime, and provisioner collisions or aliases", () => {
    expect(() =>
      assertRoleSeparation({
        owner: STAGING_OWNER_ROLE,
        runtime: STAGING_RUNTIME_ROLE,
        provisioner: STAGING_RUNTIME_ROLE,
      }),
    ).toThrow();
    expect(() =>
      assertRoleSeparation({
        owner: STAGING_OWNER_ROLE,
        runtime: "shared_app",
        provisioner: STAGING_PROVISIONING_ROLE,
      }),
    ).toThrow();
  });

  it("allows restore only to the disposable Phase 6 restore namespace", () => {
    const base = [
      `--source-database=${STAGING_DATABASE}`,
      "--backup=/tmp/phase6-test.dump",
      "--confirm-create-staging-restore",
    ];
    for (const target of [
      STAGING_DATABASE,
      "ueb_core",
      "ueb_core_uat_phase5",
      "ueb_core_staging_restore_unsafe-target",
    ])
      expect(() =>
        parseRestoreCommand([...base, `--target-database=${target}`]),
      ).toThrow();
    expect(
      parseRestoreCommand([
        ...base,
        "--target-database=ueb_core_staging_restore_guard_01",
      ]).targetDatabase,
    ).toBe("ueb_core_staging_restore_guard_01");
  });

  it("requires exact confirmation for stale restore-lock recovery", () => {
    const args = [
      "--target-database=ueb_core_staging_restore_guard_01",
      "--backup=/tmp/phase6-test.dump",
    ];
    expect(() => parseClearStaleRestoreLockCommand(args)).toThrow();
    expect(
      parseClearStaleRestoreLockCommand([
        ...args,
        "--confirm-clear-stale-restore-lock",
      ]),
    ).toEqual({
      targetDatabase: "ueb_core_staging_restore_guard_01",
      backupPath: "/tmp/phase6-test.dump",
    });
    for (const target of [
      STAGING_DATABASE,
      "ueb_core",
      "ueb_core_uat_phase5",
      "ueb_core_staging_restore_unsafe-target",
    ]) {
      expect(() =>
        parseClearStaleRestoreLockCommand([
          `--target-database=${target}`,
          "--backup=/tmp/phase6-test.dump",
          "--confirm-clear-stale-restore-lock",
        ]),
      ).toThrow();
    }
  });

  it("allows cleanup only for an exact disposable restore target", () => {
    const args = [
      "--target-database=ueb_core_staging_restore_cleanup_01",
      "--backup=/tmp/phase6-test.dump",
    ];
    expect(() => parseCleanupRestoreCommand(args)).toThrow();
    expect(
      parseCleanupRestoreCommand([...args, "--confirm-drop-staging-restore"]),
    ).toEqual({
      targetDatabase: "ueb_core_staging_restore_cleanup_01",
      backupPath: "/tmp/phase6-test.dump",
    });
    for (const target of [
      STAGING_DATABASE,
      "ueb_core",
      "ueb_core_uat_phase5",
      "postgres",
      "template0",
      "template1",
      "ueb_core_staging_restore_unsafe-target",
    ]) {
      expect(() =>
        parseCleanupRestoreCommand([
          `--target-database=${target}`,
          "--backup=/tmp/phase6-test.dump",
          "--confirm-drop-staging-restore",
        ]),
      ).toThrow();
    }
  });
});

describe("Phase 6 operator approval contracts", () => {
  it("requires a non-placeholder monitoring email", () => {
    for (const value of [
      undefined,
      "not-an-email",
      "operator@example.invalid",
      "replace-me@company.vn",
    ]) {
      expect(() => assertMonitoringEmail(value)).toThrow();
    }
    expect(assertMonitoringEmail("ops@sample.test")).toBe("ops@sample.test");
  });

  it("rejects invalid, past, reversed, and overlong change windows", () => {
    const now = new Date("2026-07-17T00:00:00.000Z");
    const environment = {
      STAGING_TIMEZONE: "Asia/Ho_Chi_Minh",
      STAGING_CHANGE_WINDOW_START: "2026-07-17T08:00:00+07:00",
      STAGING_CHANGE_WINDOW_END: "2026-07-17T10:00:00+07:00",
    };
    expect(parseChangeWindow(environment, now).timezone).toBe(
      "Asia/Ho_Chi_Minh",
    );
    for (const invalid of [
      { ...environment, STAGING_CHANGE_WINDOW_START: "not-a-date" },
      {
        ...environment,
        STAGING_CHANGE_WINDOW_START: "2026-07-16T08:00:00+07:00",
        STAGING_CHANGE_WINDOW_END: "2026-07-16T10:00:00+07:00",
      },
      {
        ...environment,
        STAGING_CHANGE_WINDOW_END: "2026-07-17T07:00:00+07:00",
      },
      {
        ...environment,
        STAGING_CHANGE_WINDOW_END: "2026-07-17T13:00:01+07:00",
      },
    ]) {
      expect(() => parseChangeWindow(invalid, now)).toThrow();
    }
  });

  it("blocks latest, malformed Git SHA, and image-tag SHA mismatches", () => {
    const sha = "a".repeat(40);
    expect(() => assertImageTag("ueb-core:latest", sha)).toThrow();
    expect(() => assertImageTag(`ueb-core:${"b".repeat(40)}`, sha)).toThrow();
    expect(() => assertImageTag("ueb-core:a", "a")).toThrow();
    expect(() => assertImageTag(`ueb-core:${sha}`, sha)).not.toThrow();
  });

  it("accepts only the staging domain and rejects the production domain", () => {
    expect(assertStagingUrl(STAGING_URL)).toBe(STAGING_URL);
    expect(() => assertStagingUrl("https://ueb-core.cargis.vn")).toThrow(
      /staging domain/u,
    );
  });
});
