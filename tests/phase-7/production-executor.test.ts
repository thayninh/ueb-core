// @vitest-environment node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ClientBase } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertProductionDatabase,
  assertProductionRestoreDatabase,
  assertProductionRuntimeAclState,
  assertSourceFingerprintUnchanged,
  assertWindowState,
  grantProductionPasswordChangePrivileges,
  parseOperatorWindow,
  parseProductionExecutorCommand,
  PRODUCTION_EXECUTOR_CONTRACT,
  PRODUCTION_RUNTIME_PASSWORD_CHANGE_COLUMN_PRIVILEGES,
  readEmbeddedSourceSha,
  reconcileEmptyProductionIdentityTarget,
  runProductionExecutor,
  SafeProductionExecutorError,
  type ProductionExecutionAdapter,
  type ProductionExecutorMode,
} from "../../scripts/phase-7/lib/production-executor";
import { formatProductionExecutorFailure } from "../../scripts/phase-7/production-target";

const gitSha = "a".repeat(40);
const execFileAsync = promisify(execFile);
let directory: string;
let emailEvidence: string;
let rollbackEvidence: string;
let appArchive: string;
let operatorArchive: string;
let appChecksum: string;
let operatorChecksum: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ueb-core-phase7-executor-"));
  emailEvidence = join(directory, "email.txt");
  rollbackEvidence = join(directory, "rollback.txt");
  appArchive = join(directory, `ueb-core-${gitSha}.tar`);
  operatorArchive = join(directory, `ueb-core-operator-${gitSha}.tar`);
  await restrictedWrite(
    emailEvidence,
    [
      "EVIDENCE_TIMESTAMP_UTC=2026-07-18T18:00:00Z",
      "EMAIL_ALERT_TRANSPORT=GMAIL_SMTP",
      "SMTP_AUTH=PASS",
      "EMAIL_TEST=PASS",
      "EMAIL_ALERT_GATE=PASS",
      "SENDER_CONFIRMED=YES",
      "RECIPIENT_CONFIRMED=YES",
      "MESSAGE_CONTENT=NON_SENSITIVE",
      "CREDENTIAL_LOGGED=NO",
    ].join("\n"),
  );
  await restrictedWrite(
    rollbackEvidence,
    `ROLLBACK_IMAGE_EXISTS=YES\nROLLBACK_VERIFY=PASS\nROLLBACK_IMAGE_SHA=${PRODUCTION_EXECUTOR_CONTRACT.rollbackImageSha}\n`,
  );
  await restrictedWrite(appArchive, "immutable-app");
  await restrictedWrite(operatorArchive, "immutable-operator");
  appChecksum = sha256("immutable-app");
  operatorChecksum = sha256("immutable-operator");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Phase 7 executable production guards", () => {
  it("preserves only the runtime column updates required by forced password change", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (statement: string) => {
      statements.push(statement);
      return { rows: [] };
    });

    await grantProductionPasswordChangePrivileges(
      { query } as unknown as Pick<ClientBase, "query">,
      '"ueb_core_app"',
    );

    expect(PRODUCTION_RUNTIME_PASSWORD_CHANGE_COLUMN_PRIVILEGES).toEqual({
      auth_account: ["password", "updatedAt"],
      access_profile: [
        "must_change_password",
        "password_changed_at",
        "updated_at",
      ],
    });
    expect(statements).toEqual([
      'GRANT UPDATE ("password", "updatedAt") ON TABLE public."auth_account" TO "ueb_core_app"',
      'GRANT UPDATE ("must_change_password", "password_changed_at", "updated_at") ON TABLE public."access_profile" TO "ueb_core_app"',
    ]);
    expect(statements.join("\n")).not.toMatch(/GRANT UPDATE ON TABLE/iu);
  });

  it("verifies the exact password-change column ACL instead of broad table update", async () => {
    const source = await readFile(
      join(process.cwd(), "scripts/phase-7/lib/production-executor.ts"),
      "utf8",
    );

    for (const column of [
      "auth_account', 'password",
      "auth_account', 'updatedAt",
      "access_profile', 'must_change_password",
      "access_profile', 'password_changed_at",
      "access_profile', 'updated_at",
    ]) {
      expect(source).toContain(
        `has_column_privilege($1, 'public.${column}', 'UPDATE')`,
      );
    }
    expect(source).toContain(
      "has_table_privilege($1, 'public.auth_account', 'UPDATE')",
    );
    expect(source).toContain(
      "has_table_privilege($1, 'public.access_profile', 'UPDATE')",
    );
  });

  it("accepts the post-provision identity count for ACL reconciliation", () => {
    expect(() =>
      assertProductionRuntimeAclState({
        databaseOwner: "ueb_core_owner",
        migrations: 8,
        failedMigrations: 0,
        coreRows: 2_497,
        workflowEvents: 0,
        importRuns: 1,
        authUsers: 254,
        sessions: 2,
        runtimeSafe: true,
        provisionerSafe: true,
        runtimeAclSafe: true,
        provisionerAclSafe: true,
        rlsCoreVisible: 0,
        rlsWorkflowVisible: 0,
      }),
    ).not.toThrow();
  });

  it("rejects a pre-provision identity count for ACL reconciliation", () => {
    expect(() =>
      assertProductionRuntimeAclState({
        databaseOwner: "ueb_core_owner",
        migrations: 8,
        failedMigrations: 0,
        coreRows: 2_497,
        workflowEvents: 0,
        importRuns: 1,
        authUsers: 0,
        sessions: 0,
        runtimeSafe: true,
        provisionerSafe: true,
        runtimeAclSafe: true,
        provisionerAclSafe: true,
        rlsCoreVisible: 0,
        rlsWorkflowVisible: 0,
      }),
    ).toThrow(/PRODUCTION_RUNTIME_ACL_STATE_MISMATCH/u);
  });

  it("accepts only the exact dedicated production database", () => {
    expect(() => assertProductionDatabase("ueb_core_prod")).not.toThrow();
    for (const target of [
      "ueb_core",
      "ueb_core_staging",
      "ueb_core_uat_phase5",
      "ueb_core_restore_test",
      "postgres",
      "template0",
      "template1",
    ]) {
      expect(() => assertProductionDatabase(target)).toThrow(
        /PRODUCTION_DATABASE_FORBIDDEN/u,
      );
    }
  });

  it("requires exact production authorization", () => {
    expect(() =>
      parseProductionExecutorCommand(
        "PREFLIGHT",
        replace(
          baseArguments("PREFLIGHT"),
          "--authorization-reference=",
          "--authorization-reference=READ_ONLY",
        ),
      ),
    ).toThrow(/PRODUCTION_AUTHORIZATION_REQUIRED/u);
  });

  it("accepts the unmarked-residue acknowledgement only for guarded cleanup", () => {
    const cleanup = parseProductionExecutorCommand("CLEANUP_RESTORE", [
      ...baseArguments("CLEANUP_RESTORE"),
      "--confirm-known-unmarked-restore-residue",
    ]);
    expect(cleanup.confirmKnownUnmarkedRestoreResidue).toBe(true);
    expect(() =>
      parseProductionExecutorCommand("VERIFY", [
        ...baseArguments("VERIFY"),
        "--confirm-known-unmarked-restore-residue",
      ]),
    ).toThrow(/PRODUCTION_ARGUMENTS_INVALID/u);
  });

  it("validates active window, rejects before, after and malformed values", () => {
    const command = parseProductionExecutorCommand(
      "PREFLIGHT",
      baseArguments("PREFLIGHT"),
    );
    expect(() =>
      assertWindowState({
        command,
        now: new Date("2026-07-19T01:30:00+07:00"),
        requireActive: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertWindowState({
        command,
        now: new Date("2026-07-19T00:59:59+07:00"),
        requireActive: true,
      }),
    ).toThrow(/PRODUCTION_CHANGE_WINDOW_NOT_STARTED/u);
    expect(() =>
      assertWindowState({
        command,
        now: new Date("2026-07-19T04:00:01+07:00"),
        requireActive: true,
      }),
    ).toThrow(/PRODUCTION_CHANGE_WINDOW_EXPIRED/u);
    expect(() => parseOperatorWindow("2026-07-19T01:00:00", "bad")).toThrow(
      /PRODUCTION_CHANGE_WINDOW_INVALID/u,
    );
    expect(() =>
      parseOperatorWindow(
        "2026-07-19T01:00:00+07:00",
        "2026-07-19T05:00:01+07:00",
      ),
    ).toThrow(/PRODUCTION_CHANGE_WINDOW_INVALID/u);
  });

  it("rejects roster SHA drift", () => {
    expect(() =>
      parseProductionExecutorCommand(
        "PREFLIGHT",
        replace(
          baseArguments("PREFLIGHT"),
          "--roster-manifest-sha=",
          `--roster-manifest-sha=${"b".repeat(64)}`,
        ),
      ),
    ).toThrow(/PRODUCTION_IMMUTABLE_INPUT_MISMATCH/u);
  });

  it("bootstrap dry-run performs no database operation or side effect", async () => {
    const adapter = adapterMock();
    const result = await runProductionExecutor({
      command: parseProductionExecutorCommand(
        "BOOTSTRAP",
        baseArguments("BOOTSTRAP", true),
      ),
      environment: {},
      now: new Date("2026-07-18T18:30:00Z"),
      sourceSha: async () => gitSha,
      adapter,
    });
    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("EXECUTION_MODE=DRY_RUN");
    expect(result.report).toContain("DATABASE_CONNECTIONS=0");
    expect(result.report).toContain("DATABASE_MUTATIONS=0");
    expect(adapter.bootstrap).not.toHaveBeenCalled();
    expect(result.report).toContain("APP_START=NOT_PERFORMED");
    expect(result.report).toContain("CADDY_CHANGE=NOT_PERFORMED");
    expect(result.report).toContain("IDENTITY_PROVISIONING=NOT_PERFORMED");
  });

  it("preserves a safe pre-mutation phase and error code", async () => {
    const adapter = adapterMock();
    vi.mocked(adapter.bootstrap).mockRejectedValueOnce(
      new SafeProductionExecutorError("SOURCE_FILENAME_MISMATCH", false, {
        phase: "CANONICAL_SOURCE_PRECHECK",
        objectType: "SOURCE_FILE",
        objectName: "canonical.xlsx",
      }),
    );

    const error = await runProductionExecutor({
      command: parseProductionExecutorCommand(
        "BOOTSTRAP",
        baseArguments("BOOTSTRAP"),
      ),
      environment: {},
      now: new Date("2026-07-18T18:30:00Z"),
      sourceSha: async () => gitSha,
      adapter,
    }).catch((caught: unknown) => caught);

    const report = formatProductionExecutorFailure(error);
    expect(report).toContain("FAILED_PHASE=CANONICAL_SOURCE_PRECHECK");
    expect(report).toContain("ERROR_CODE=SOURCE_FILENAME_MISMATCH");
    expect(report).toContain("SAFE_OBJECT_TYPE=SOURCE_FILE");
    expect(report).toContain("SAFE_OBJECT_NAME=canonical.xlsx");
    expect(report).toContain("DATABASE_CONNECTIONS=0");
    expect(report).toContain("DATABASE_MUTATIONS=0");
  });

  it("exposes only safe PostgreSQL diagnostics for unexpected failures", async () => {
    const adapter = adapterMock();
    vi.mocked(adapter.bootstrap).mockRejectedValueOnce({
      code: "42501",
      table: "safe_table",
      message: "password=must-not-leak postgresql://must-not-leak",
    });

    const error = await runProductionExecutor({
      command: parseProductionExecutorCommand(
        "BOOTSTRAP",
        baseArguments("BOOTSTRAP"),
      ),
      environment: {},
      now: new Date("2026-07-18T18:30:00Z"),
      sourceSha: async () => gitSha,
      adapter,
    }).catch((caught: unknown) => caught);

    const report = formatProductionExecutorFailure(error);
    expect(report).toContain("FAILED_PHASE=PRODUCTION_BOOTSTRAP");
    expect(report).toContain(
      "ERROR_CODE=PRODUCTION_OPERATION_FAILED_RECONCILIATION_REQUIRED",
    );
    expect(report).toContain("POSTGRES_SQLSTATE=42501");
    expect(report).toContain("SAFE_OBJECT_TYPE=TABLE");
    expect(report).toContain("SAFE_OBJECT_NAME=safe_table");
    expect(report).not.toMatch(/must-not-leak|password=|postgresql:\/\//iu);
  });

  it("fails closed when dry-run is given database credentials", async () => {
    await expect(
      runProductionExecutor({
        command: parseProductionExecutorCommand(
          "BOOTSTRAP",
          baseArguments("BOOTSTRAP", true),
        ),
        environment: { MIGRATION_DATABASE_URL: "must-not-be-printed" },
        now: new Date("2026-07-18T18:30:00Z"),
        sourceSha: async () => gitSha,
      }),
    ).rejects.toThrow(/DATABASE_CREDENTIALS_FORBIDDEN_IN_DRY_RUN/u);
  });

  it("operator manifest and Dockerfile include every Phase 7 command and script", async () => {
    const [manifest, dockerfile] = await Promise.all([
      readFile("operator/package.json", "utf8"),
      readFile("Dockerfile.operator", "utf8"),
    ]);
    for (const command of [
      "phase7:preflight-production-target",
      "phase7:bootstrap-production-target",
      "phase7:verify-production-target",
      "phase7:reconcile-production-runtime-acl",
      "phase7:reconcile-production-identities",
      "phase7:apply-production-identities",
      "phase7:seed-production-organization-units",
      "phase7:backup-production-target",
      "phase7:restore-production-rehearsal",
      "phase7:cleanup-production-restore",
    ]) {
      expect(manifest).toContain(`\"${command}\"`);
    }
    expect(dockerfile).toContain("scripts/phase-7 ./scripts/phase-7");
    expect(dockerfile).toContain("scripts/phase-2 ./scripts/phase-2");
    expect(dockerfile).toContain("config/phase-2 ./config/phase-2");
    expect(dockerfile).toContain(
      "src/lib/auth/provisioning-policy.ts ./src/lib/auth/provisioning-policy.ts",
    );
    expect(dockerfile).toContain("UEB_CORE_SOURCE_GIT_SHA");
    expect(dockerfile).toContain("/operator/.source-git-sha");
    expect(dockerfile).not.toMatch(/COPY\s+(?:--\S+\s+)*\.\s+/u);
    expect(dockerfile).not.toMatch(/COPY\s+(?:--\S+\s+)*src\s+/u);
    expect(dockerfile).not.toMatch(/(?:apt-get|apk).*(?:install).*\bgit\b/u);
    expect(dockerfile).not.toMatch(/COPY\s+.*\.git/u);
  });

  it("stages the exact production secret allowlist into tmpfs before dropping privileges", async () => {
    const [entrypoint, dockerfile] = await Promise.all([
      readFile("operator/secure-entrypoint.sh", "utf8"),
      readFile("Dockerfile.operator", "utf8"),
    ]);
    await expect(
      execFileAsync("sh", ["-n", "operator/secure-entrypoint.sh"]),
    ).resolves.toBeDefined();

    for (const fileName of [
      "CSDLCore_chuan_hoa_PostgreSQL.xlsx",
      "lecturer-exceptions.json",
      "faculty-leaders.json",
      "test-identities.json",
      "production-target-state.json",
      "phase7-secrets.env",
    ]) {
      expect(entrypoint).toContain(`\"${fileName}\"`);
    }
    expect(entrypoint).toContain('source_directory="/mnt/ueb-core-secrets"');
    expect(entrypoint).toContain('target_directory="/run/ueb-core-secrets"');
    expect(entrypoint).toContain('= "700"');
    expect(entrypoint).toContain('= "600"');
    expect(entrypoint).toContain("-m 0400");
    expect(entrypoint).toContain('chmod 0500 "$target_directory"');
    expect(entrypoint).toContain('require_mount_option "$source_options" "ro"');
    expect(entrypoint).toContain('= "tmpfs"');
    expect(entrypoint).toContain(
      'require_mount_option "$target_options" "noexec"',
    );
    expect(entrypoint).toContain("OPERATOR_SECRET_FILE_SYMLINK_FORBIDDEN");
    expect(entrypoint).toContain("OPERATOR_SECRET_FILE_HARDLINK_FORBIDDEN");
    expect(entrypoint).toContain(
      "OPERATOR_SECRET_SOURCE_CONTAINS_UNEXPECTED_ENTRY",
    );
    expect(entrypoint).toContain('exec gosu "$operator_user" "$@"');
    expect(entrypoint).toContain("SECRET_LEAKAGE=0");
    expect(entrypoint).toContain("DATABASE_CONNECTIONS=0");
    expect(entrypoint).toContain("DATABASE_MUTATIONS=0");

    expect(dockerfile).toContain(
      "operator/secure-entrypoint.sh /usr/local/bin/operator-secure-entrypoint",
    );
    expect(dockerfile).toContain("USER root");
    expect(dockerfile).toContain('ENTRYPOINT ["operator-secure-entrypoint"]');
    expect(dockerfile).not.toContain("USER operator");
  });

  it("does not stage secret values in the image or command manifest", async () => {
    const [entrypoint, dockerfile, manifest] = await Promise.all([
      readFile("operator/secure-entrypoint.sh", "utf8"),
      readFile("Dockerfile.operator", "utf8"),
      readFile("operator/package.json", "utf8"),
    ]);
    const combined = `${entrypoint}\n${dockerfile}\n${manifest}`;
    expect(combined).not.toMatch(/GMAIL_APP_PASSWORD=/u);
    expect(combined).not.toMatch(
      /PRODUCTION_(?:OWNER|RUNTIME|PROVISIONER)_PASSWORD=/u,
    );
    expect(combined).not.toMatch(/postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/u);
    expect(dockerfile).not.toMatch(/COPY\s+.*(?:\.env|\.xlsx)/u);
  });

  it("packages the complete external source closure for identity apply", async () => {
    const [identitySource, dockerfile] = await Promise.all([
      readFile("scripts/phase-7/lib/production-identity.ts", "utf8"),
      readFile("Dockerfile.operator", "utf8"),
    ]);
    const externalSourceImports = [
      ...identitySource.matchAll(/from\s+"(\.\.\/\.\.\/\.\.\/src\/[^"]+)"/gu),
    ].map((match) => match[1]);

    expect(externalSourceImports).toEqual([
      "../../../src/lib/auth/provisioning-policy",
    ]);
    expect(dockerfile).toContain(
      "COPY --chown=operator:operator src/lib/auth/provisioning-policy.ts ./src/lib/auth/provisioning-policy.ts",
    );

    const policySource = await readFile(
      "src/lib/auth/provisioning-policy.ts",
      "utf8",
    );
    expect(policySource).not.toMatch(/from\s+"\.\.?\//u);
  });

  it("wires production database creation through temporary owner membership", async () => {
    const source = await readFile(
      "scripts/phase-7/lib/production-executor.ts",
      "utf8",
    );
    expect(source).toContain("withTemporaryOwnerSetRole({");
    expect(source).toContain(
      "BOOTSTRAP_CAN_SET_OWNER_BEFORE_CREATE=${ownerMembership?.canSetBeforeOperation",
    );
    expect(source).toContain(
      "TEMPORARY_MEMBERSHIP_REVOKED=${ownerMembership?.membershipRevoked",
    );
    expect(source).toContain(
      "BOOTSTRAP_CAN_SET_OWNER_AFTER_CREATE=${ownerMembership?.canSetAfterOperation",
    );
    expect(source).toContain("PRODUCTION_DATABASE_CREATE_CLEANUP_FAILED");
    expect(source).toContain("const databaseCreated = await databaseExists(");
    expect(source).not.toMatch(/WITH ADMIN TRUE/u);
  });

  it("rejects unsafe production restore targets", () => {
    expect(() =>
      assertProductionRestoreDatabase(
        "ueb_core_prod_restore_3fae396_regression",
      ),
    ).not.toThrow();
    for (const target of [
      "ueb_core_prod",
      "ueb_core",
      "ueb_core_staging",
      "ueb_core_uat_phase5",
      "ueb_core_prod_restore_",
      "ueb_core_prod_restore_UNSAFE",
    ]) {
      expect(() => assertProductionRestoreDatabase(target)).toThrow(
        /PRODUCTION_RESTORE_DATABASE_FORBIDDEN/u,
      );
    }
  });

  it("reconciles an empty identity target using the actual access-profile mapping", async () => {
    const query = vi.fn(async (statement: string) => ({
      rows: [
        {
          users: 0,
          accounts: 0,
          profiles: 0,
          roles: 0,
          scopes: 0,
          lecturer_mappings: 0,
          forced_password_profiles: 0,
          audit_events: 0,
        },
      ],
      statement,
    }));
    const command = parseProductionExecutorCommand(
      "RECONCILE_IDENTITIES",
      baseArguments("RECONCILE_IDENTITIES"),
    );

    const report = await reconcileEmptyProductionIdentityTarget(
      { query } as unknown as ClientBase,
      command,
    );
    const sql = String(query.mock.calls[0]?.[0]);

    expect(sql).toContain("FROM access_profile");
    expect(sql).toContain("lecturer_uid IS NOT NULL");
    expect(sql).toContain("must_change_password");
    expect(sql).not.toContain("lecturer_user_mapping");
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
    expect(report).toContain("ROSTER_RECONCILIATION=PASS");
    expect(report).toContain("EXPECTED_IDENTITY_CREATE_COUNT=254");
    expect(report).toContain("EXPECTED_TEST_IDENTITY_CREATE_COUNT=2");
    expect(report).toContain(
      "LECTURER_MAPPING_MODEL=access_profile.lecturer_uid",
    );
    expect(report).toContain("TEST_IDENTITY_MARKER_SOURCE=ROSTER_MANIFEST");
    expect(report).toContain("ROSTER_BLOCK_COUNT=0");
    expect(report).toContain("ROSTER_CONFLICT_COUNT=0");
    expect(report).toContain("DATABASE_WRITES=0");
  });

  it("fails closed when any identity residue exists", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          users: 0,
          accounts: 0,
          profiles: 1,
          roles: 0,
          scopes: 0,
          lecturer_mappings: 1,
          forced_password_profiles: 1,
          audit_events: 0,
        },
      ],
    }));
    const command = parseProductionExecutorCommand(
      "RECONCILE_IDENTITIES",
      baseArguments("RECONCILE_IDENTITIES"),
    );

    await expect(
      reconcileEmptyProductionIdentityTarget(
        { query } as unknown as ClientBase,
        command,
      ),
    ).rejects.toThrow(/PRODUCTION_IDENTITY_TARGET_NOT_EMPTY/u);
  });

  it("proves the source production fingerprint remains unchanged", () => {
    expect(() =>
      assertSourceFingerprintUnchanged("before", "before"),
    ).not.toThrow();
    expect(() => assertSourceFingerprintUnchanged("before", "after")).toThrow(
      /SOURCE_PRODUCTION_FINGERPRINT_CHANGED/u,
    );
  });

  it("redacted preflight output has no supplied credential material", async () => {
    const result = await runProductionExecutor({
      command: parseProductionExecutorCommand(
        "PREFLIGHT",
        baseArguments("PREFLIGHT"),
      ),
      environment: {},
      now: new Date("2026-07-18T18:30:00Z"),
      sourceSha: async () => gitSha,
    });
    expect(result.report).toContain("PRODUCTION_EXECUTOR=PASS");
    expect(result.report).not.toMatch(/PASSWORD|TOKEN|postgres(?:ql)?:\/\//iu);
  });

  it("accepts an exact immutable embedded source SHA", async () => {
    const path = join(directory, ".source-git-sha");
    await writeFile(path, `${gitSha}\n`, { mode: 0o444 });
    await chmod(path, 0o444);
    await expect(readEmbeddedSourceSha(path)).resolves.toBe(gitSha);
  });

  it("fails closed before database activity when embedded SHA differs", async () => {
    const adapter = adapterMock();
    await expect(
      runProductionExecutor({
        command: parseProductionExecutorCommand(
          "BOOTSTRAP",
          baseArguments("BOOTSTRAP"),
        ),
        environment: {},
        now: new Date("2026-07-18T18:30:00Z"),
        sourceSha: async () => "b".repeat(40),
        adapter,
      }),
    ).rejects.toThrow(/PRODUCTION_SOURCE_GIT_SHA_MISMATCH/u);
    expect(adapter.bootstrap).not.toHaveBeenCalled();
    expect(adapter.verify).not.toHaveBeenCalled();
    expect(adapter.reconcile).not.toHaveBeenCalled();
    expect(adapter.backup).not.toHaveBeenCalled();
    expect(adapter.restore).not.toHaveBeenCalled();
    expect(adapter.cleanupRestore).not.toHaveBeenCalled();
  });

  it("fails closed when embedded source SHA file is missing", async () => {
    await expect(
      readEmbeddedSourceSha(join(directory, "missing-source-sha")),
    ).rejects.toThrow(/PRODUCTION_SOURCE_GIT_SHA_MISSING/u);
  });

  it("fails closed when embedded source SHA is malformed", async () => {
    const path = join(directory, ".source-git-sha");
    await writeFile(path, "not-a-git-sha\n", { mode: 0o444 });
    await chmod(path, 0o444);
    await expect(readEmbeddedSourceSha(path)).rejects.toThrow(
      /PRODUCTION_SOURCE_GIT_SHA_INVALID/u,
    );
  });

  it("does not eagerly load dotenv-backed mutation modules for preflight", async () => {
    const dotenvPath = join(directory, ".env");
    await restrictedWrite(
      dotenvPath,
      "MIGRATION_DATABASE_URL=postgresql://must-not-load\n",
    );
    const excludedDatabaseVariables = new Set([
      "DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      "PHASE7_PROVISIONING_DATABASE_URL",
      "PRODUCTION_BOOTSTRAP_DATABASE_URL",
    ]);
    const cleanEnvironment: NodeJS.ProcessEnv = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !excludedDatabaseVariables.has(key),
        ),
      ),
      NODE_ENV: process.env.NODE_ENV ?? "test",
    };
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--eval",
        'await import("./scripts/phase-7/lib/production-executor.ts"); process.stdout.write(process.env.MIGRATION_DATABASE_URL ? "LOADED" : "CLEAN")',
      ],
      {
        cwd: process.cwd(),
        env: { ...cleanEnvironment, DOTENV_CONFIG_PATH: dotenvPath },
      },
    );
    expect(stdout).toBe("CLEAN");
  });
});

function baseArguments(mode: ProductionExecutorMode, dryRun = false): string[] {
  const confirmation: Record<ProductionExecutorMode, string> = {
    PREFLIGHT: "--confirm-production-preflight",
    BOOTSTRAP: "--confirm-create-production-target",
    VERIFY: "--confirm-production-verify",
    RECONCILE_RUNTIME_ACL: "--confirm-production-runtime-acl-reconciliation",
    RECONCILE_IDENTITIES: "--confirm-production-identity-reconciliation",
    BACKUP: "--confirm-production-backup",
    RESTORE: "--confirm-production-restore-rehearsal",
    CLEANUP_RESTORE: "--confirm-cleanup-production-restore",
  };
  const args = [
    `--target-database=${PRODUCTION_EXECUTOR_CONTRACT.database}`,
    `--authorization-reference=${PRODUCTION_EXECUTOR_CONTRACT.authorizationPrefix}_TEST`,
    "--change-window-start=2026-07-19T01:00:00+07:00",
    "--change-window-end=2026-07-19T04:00:00+07:00",
    `--expected-git-sha=${gitSha}`,
    `--roster-manifest-sha=${PRODUCTION_EXECUTOR_CONTRACT.rosterManifestSha}`,
    `--canonical-checksum=${PRODUCTION_EXECUTOR_CONTRACT.canonicalChecksum}`,
    `--owner-role=${PRODUCTION_EXECUTOR_CONTRACT.ownerRole}`,
    `--runtime-role=${PRODUCTION_EXECUTOR_CONTRACT.runtimeRole}`,
    `--provisioner-role=${PRODUCTION_EXECUTOR_CONTRACT.provisionerRole}`,
    `--email-alert-evidence=${emailEvidence}`,
    `--rollback-evidence=${rollbackEvidence}`,
    `--app-archive=${appArchive}`,
    `--app-archive-sha256=${appChecksum}`,
    `--operator-archive=${operatorArchive}`,
    `--operator-archive-sha256=${operatorChecksum}`,
  ];
  if (mode === "BOOTSTRAP") {
    args.push(
      `--canonical-source=${join(directory, "canonical.xlsx")}`,
      `--canonical-audit-directory=${join(directory, "audit")}`,
    );
  }
  if (mode === "BACKUP") {
    args.push(
      `--backup=${join(directory, "production.dump")}`,
      `--off-host-directory=${join(directory, "off-host")}`,
    );
  }
  if (mode === "RESTORE" || mode === "CLEANUP_RESTORE") {
    args[0] = "--target-database=ueb_core_prod_restore_regression";
    args.push(
      `--source-database=${PRODUCTION_EXECUTOR_CONTRACT.database}`,
      `--backup=${join(directory, "production.dump")}`,
    );
  }
  args.push(dryRun ? "--dry-run" : confirmation[mode]);
  return args;
}

function replace(
  args: readonly string[],
  prefix: string,
  value: string,
): string[] {
  return args.map((argument) =>
    argument.startsWith(prefix) ? value : argument,
  );
}

function adapterMock(): ProductionExecutionAdapter {
  return {
    bootstrap: vi.fn(async () => []),
    verify: vi.fn(async () => []),
    reconcileRuntimeAcl: vi.fn(async () => []),
    reconcile: vi.fn(async () => []),
    backup: vi.fn(async () => []),
    restore: vi.fn(async () => []),
    cleanupRestore: vi.fn(async () => []),
  };
}

async function restrictedWrite(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
