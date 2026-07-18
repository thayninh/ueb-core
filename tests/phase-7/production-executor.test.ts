// @vitest-environment node

import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertProductionDatabase,
  assertWindowState,
  parseOperatorWindow,
  parseProductionExecutorCommand,
  PRODUCTION_EXECUTOR_CONTRACT,
  runProductionExecutor,
  type ProductionExecutionAdapter,
  type ProductionExecutorMode,
} from "../../scripts/phase-7/lib/production-executor";

const gitSha = "a".repeat(40);
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
      gitState: async () => ({ head: gitSha, clean: true }),
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

  it("fails closed when dry-run is given database credentials", async () => {
    await expect(
      runProductionExecutor({
        command: parseProductionExecutorCommand(
          "BOOTSTRAP",
          baseArguments("BOOTSTRAP", true),
        ),
        environment: { MIGRATION_DATABASE_URL: "must-not-be-printed" },
        now: new Date("2026-07-18T18:30:00Z"),
        gitState: async () => ({ head: gitSha, clean: true }),
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
      "phase7:reconcile-production-identities",
      "phase7:backup-production-target",
      "phase7:restore-production-rehearsal",
      "phase7:cleanup-production-restore",
    ]) {
      expect(manifest).toContain(`\"${command}\"`);
    }
    expect(dockerfile).toContain("scripts/phase-7 ./scripts/phase-7");
    expect(dockerfile).toContain("scripts/phase-2 ./scripts/phase-2");
    expect(dockerfile).toContain("config/phase-2 ./config/phase-2");
  });

  it("redacted preflight output has no supplied credential material", async () => {
    const result = await runProductionExecutor({
      command: parseProductionExecutorCommand(
        "PREFLIGHT",
        baseArguments("PREFLIGHT"),
      ),
      environment: {},
      now: new Date("2026-07-18T18:30:00Z"),
      gitState: async () => ({ head: gitSha, clean: true }),
    });
    expect(result.report).toContain("PRODUCTION_EXECUTOR=PASS");
    expect(result.report).not.toMatch(/PASSWORD|TOKEN|postgres(?:ql)?:\/\//iu);
  });
});

function baseArguments(mode: ProductionExecutorMode, dryRun = false): string[] {
  const confirmation: Record<ProductionExecutorMode, string> = {
    PREFLIGHT: "--confirm-production-preflight",
    BOOTSTRAP: "--confirm-create-production-target",
    VERIFY: "--confirm-production-verify",
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
