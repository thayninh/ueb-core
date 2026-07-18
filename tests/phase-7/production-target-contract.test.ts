// @vitest-environment node

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertPlannedEmptyTarget,
  assertProductionDatabase,
  assertProductionRoleSeparation,
  parseProductionTargetCommand,
  PRODUCTION_TARGET_CONTRACT,
  runProductionTargetPlan,
  type ProductionTargetCommand,
  type ProductionTargetMode,
} from "../../scripts/phase-7/lib/production-target-contract";

const gitSha = "a".repeat(40);
let evidenceDirectory: string;
let backupEvidence: string;
let offHostEvidence: string;
let rollbackEvidence: string;
let emailAlertEvidence: string;

beforeEach(async () => {
  evidenceDirectory = await mkdtemp(join(tmpdir(), "ueb-core-phase7-prod-"));
  backupEvidence = join(evidenceDirectory, "backup.txt");
  offHostEvidence = join(evidenceDirectory, "off-host.txt");
  rollbackEvidence = join(evidenceDirectory, "rollback.txt");
  emailAlertEvidence = join(evidenceDirectory, "email-alert.txt");
  await writeEvidence(
    backupEvidence,
    "BACKUP_STATUS=PASS\nBACKUP_CHECKSUM_STATUS=PASS\nRESTORE_REHEARSAL_STATUS=PASS\n",
  );
  await writeEvidence(offHostEvidence, "OFF_HOST_BACKUP_STATUS=PASS\n");
  await writeEvidence(
    rollbackEvidence,
    `ROLLBACK_IMAGE_EXISTS=YES\nROLLBACK_VERIFY=PASS\nROLLBACK_IMAGE_SHA=${PRODUCTION_TARGET_CONTRACT.rollbackImageSha}\n`,
  );
  await writeEvidence(emailAlertEvidence, validEmailEvidence());
});

afterEach(async () => {
  await rm(evidenceDirectory, { recursive: true, force: true });
});

describe("Phase 7 production target guards", () => {
  it("rejects canonical, staging, UAT, restore and maintenance databases", () => {
    for (const database of [
      "ueb_core",
      "ueb_core_staging",
      "ueb_core_staging_test_guard",
      "ueb_core_uat_phase5",
      "ueb_core_uat_operator",
      "ueb_core_restore_rehearsal",
      "postgres",
      "template0",
      "template1",
    ]) {
      expect(() => assertProductionDatabase(database)).toThrow(
        /PRODUCTION_DATABASE_FORBIDDEN/u,
      );
    }
    expect(() =>
      assertProductionDatabase(PRODUCTION_TARGET_CONTRACT.database),
    ).not.toThrow();
  });

  it("requires explicit confirmation and rejects --force", () => {
    const args = baseArguments("PREFLIGHT");
    expect(() =>
      parseProductionTargetCommand(
        "PREFLIGHT",
        args.filter((value) => value !== "--confirm-production-preflight-plan"),
      ),
    ).toThrow(/PRODUCTION_CONFIRMATION_REQUIRED/u);
    expect(() =>
      parseProductionTargetCommand("PREFLIGHT", [...args, "--force"]),
    ).toThrow(/PRODUCTION_ARGUMENTS_INVALID/u);
  });

  it("rejects the wrong roster SHA and non-zero roster blockers", () => {
    expect(() =>
      parseProductionTargetCommand(
        "PREFLIGHT",
        replaceArgument(
          baseArguments("PREFLIGHT"),
          "--roster-manifest-sha=",
          `--roster-manifest-sha=${"b".repeat(64)}`,
        ),
      ),
    ).toThrow(/ROSTER_MANIFEST_SHA_MISMATCH/u);
    expect(() =>
      parseProductionTargetCommand(
        "PREFLIGHT",
        replaceArgument(
          baseArguments("PREFLIGHT"),
          "--expected-block-count=",
          "--expected-block-count=1",
        ),
      ),
    ).toThrow(/ROSTER_BLOCKERS_PRESENT/u);
  });

  it("requires exact and distinct production roles", () => {
    expect(() =>
      assertProductionRoleSeparation({
        owner: PRODUCTION_TARGET_CONTRACT.ownerRole,
        runtime: PRODUCTION_TARGET_CONTRACT.runtimeRole,
        provisioner: PRODUCTION_TARGET_CONTRACT.runtimeRole,
      }),
    ).toThrow(/PRODUCTION_ROLE_SEPARATION_INVALID/u);
    expect(() =>
      assertProductionRoleSeparation({
        owner: PRODUCTION_TARGET_CONTRACT.ownerRole,
        runtime: PRODUCTION_TARGET_CONTRACT.runtimeRole,
        provisioner: PRODUCTION_TARGET_CONTRACT.provisionerRole,
      }),
    ).not.toThrow();
  });

  it("requires explicit domain strategy and planned-empty target mode", () => {
    expect(() =>
      parseProductionTargetCommand(
        "PREFLIGHT",
        baseArguments("PREFLIGHT").filter(
          (value) => !value.startsWith("--domain-strategy="),
        ),
      ),
    ).toThrow(/PRODUCTION_ARGUMENTS_INVALID/u);
    expect(() => assertPlannedEmptyTarget("EXISTING_TARGET")).toThrow(
      /PLANNED_EMPTY_TARGET_REQUIRED/u,
    );
    expect(() =>
      assertPlannedEmptyTarget("PLANNED_EMPTY_TARGET"),
    ).not.toThrow();
  });

  it("validates email evidence while planned-empty preflight remains blocked", async () => {
    const command = parseProductionTargetCommand(
      "PREFLIGHT",
      baseArguments("PREFLIGHT"),
    );
    const result = await runPlan(command);

    expect(result.report).toContain("PLAN_STATUS=BLOCKED_EXPECTED");
    expect(result.report).toContain("PRODUCTION_PREFLIGHT=BLOCKED_EXPECTED");
    expect(result.report).toContain("EMPTY_TARGET_SUPPORT=PASS");
    expect(result.report).toContain("ROLE_SEPARATION=PASS");
    expect(result.report).toContain("DATABASE_CONNECTIONS=0");
    expect(result.report).toContain("DATABASE_MUTATIONS=0");
    expect(result.report).toContain("EMAIL_EVIDENCE_VALIDATION=PASS");
    expect(result.report).toContain("EMAIL_ALERT_GATE=PASS");
    expect(result.report).toContain("SECRET_LEAKAGE=0");
    expect(result.report).toContain("HARD_GATE=BLOCKED");
    expect(result.report).toContain(
      "BLOCKING_REASON=GO_LIVE_NOT_AUTHORIZED;PRODUCTION_DATABASE_NOT_CREATED",
    );
    expect(result.exitCode).toBe(2);
  });

  it.each([
    [
      "failed",
      () => validEmailEvidence().replace("EMAIL_TEST=PASS", "EMAIL_TEST=FAIL"),
    ],
    [
      "blocked",
      () =>
        validEmailEvidence().replace(
          "EMAIL_ALERT_GATE=PASS",
          "EMAIL_ALERT_GATE=BLOCKED",
        ),
    ],
    [
      "stale",
      () =>
        validEmailEvidence().replace(
          "2026-07-18T04:00:00Z",
          "2026-07-16T04:00:00Z",
        ),
    ],
  ])("blocks %s email evidence", async (_label, content) => {
    await writeEvidence(emailAlertEvidence, content());
    const result = await runPlan(
      parseProductionTargetCommand("PREFLIGHT", baseArguments("PREFLIGHT")),
    );

    expect(result.report).toContain("EMAIL_EVIDENCE_VALIDATION=BLOCKED");
    expect(result.report).toContain("EMAIL_ALERT_GATE=BLOCKED");
    expect(result.report).toContain("EMAIL_ALERT_EVIDENCE_INVALID");
    expect(result.exitCode).toBe(2);
  });

  it("blocks missing email evidence", async () => {
    await rm(emailAlertEvidence);
    const result = await runPlan(
      parseProductionTargetCommand("PREFLIGHT", baseArguments("PREFLIGHT")),
    );

    expect(result.report).toContain("EMAIL_EVIDENCE_VALIDATION=BLOCKED");
    expect(result.report).toContain("EMAIL_ALERT_EVIDENCE_INVALID");
  });

  it("rejects leaked email credentials without echoing them", async () => {
    const leakedSecret = "do-not-print-this-secret";
    await writeEvidence(
      emailAlertEvidence,
      `${validEmailEvidence()}GMAIL_APP_PASSWORD=${leakedSecret}\n`,
    );
    const result = await runPlan(
      parseProductionTargetCommand("PREFLIGHT", baseArguments("PREFLIGHT")),
    );

    expect(result.report).toContain("EMAIL_EVIDENCE_VALIDATION=BLOCKED");
    expect(result.report).toContain("SECRET_LEAKAGE=0");
    expect(result.report).not.toContain(leakedSecret);
  });

  it("requires the rollback image source commit and matching evidence", async () => {
    const command = parseProductionTargetCommand(
      "BOOTSTRAP",
      baseArguments("BOOTSTRAP"),
    );
    await expect(
      runProductionTargetPlan({
        command,
        environment: {},
        now: new Date("2026-07-18T12:00:00+07:00"),
        gitState: async () => ({
          head: command.expectedGitSha,
          workingTreeClean: true,
        }),
        rollbackCommitExists: async () => false,
      }),
    ).rejects.toThrow(/ROLLBACK_IMAGE_NOT_FOUND/u);
  });

  it("refuses database credentials in every local-only plan", async () => {
    const command = parseProductionTargetCommand(
      "VERIFY",
      baseArguments("VERIFY"),
    );
    await expect(
      runProductionTargetPlan({
        command,
        environment: { DATABASE_URL: "forbidden" },
        now: new Date("2026-07-18T12:00:00+07:00"),
      }),
    ).rejects.toThrow(/DATABASE_CREDENTIALS_FORBIDDEN_IN_LOCAL_PLAN/u);
  });

  it("creates an exact empty-target identity reconciliation plan", async () => {
    const command = parseProductionTargetCommand(
      "RECONCILE_IDENTITIES",
      baseArguments("RECONCILE_IDENTITIES"),
    );
    const result = await runPlan(command);

    expect(result.report).toContain("ROSTER_RECONCILIATION_PLAN=PASS");
    expect(result.report).toContain("EXPECTED_IDENTITY_CREATE_COUNT=254");
    expect(result.report).toContain("ROSTER_SHA_GUARD=PASS");
    expect(result.report).toContain("DATABASE_MUTATIONS=0");
  });
});

function baseArguments(mode: ProductionTargetMode): string[] {
  const confirmation: Record<ProductionTargetMode, string> = {
    PREFLIGHT: "--confirm-production-preflight-plan",
    BOOTSTRAP: "--confirm-production-bootstrap-plan",
    VERIFY: "--confirm-production-verify-plan",
    RECONCILE_IDENTITIES: "--confirm-production-identity-reconciliation-plan",
  };
  return [
    `--target-database=${PRODUCTION_TARGET_CONTRACT.database}`,
    `--expected-git-sha=${gitSha}`,
    `--roster-manifest-sha=${PRODUCTION_TARGET_CONTRACT.rosterManifestSha}`,
    `--canonical-checksum=${PRODUCTION_TARGET_CONTRACT.canonicalChecksum}`,
    "--expected-block-count=0",
    `--target-state-mode=${PRODUCTION_TARGET_CONTRACT.targetStateMode}`,
    `--domain-strategy=${PRODUCTION_TARGET_CONTRACT.domainStrategy}`,
    `--production-domain=${PRODUCTION_TARGET_CONTRACT.productionDomain}`,
    `--staging-domain-after-go-live=${PRODUCTION_TARGET_CONTRACT.stagingDomainAfterGoLive}`,
    `--owner-role=${PRODUCTION_TARGET_CONTRACT.ownerRole}`,
    `--runtime-role=${PRODUCTION_TARGET_CONTRACT.runtimeRole}`,
    `--provisioner-role=${PRODUCTION_TARGET_CONTRACT.provisionerRole}`,
    `--change-window=${PRODUCTION_TARGET_CONTRACT.changeWindow}`,
    `--rollback-image-sha=${PRODUCTION_TARGET_CONTRACT.rollbackImageSha}`,
    `--backup-evidence=${backupEvidence}`,
    `--off-host-backup-evidence=${offHostEvidence}`,
    `--rollback-evidence=${rollbackEvidence}`,
    `--email-alert-evidence=${emailAlertEvidence}`,
    confirmation[mode],
  ];
}

async function runPlan(command: ProductionTargetCommand) {
  return runProductionTargetPlan({
    command,
    environment: {},
    now: new Date("2026-07-18T12:00:00+07:00"),
    gitState: async () => ({
      head: command.expectedGitSha,
      workingTreeClean: true,
    }),
    rollbackCommitExists: async () => true,
  });
}

function replaceArgument(
  args: readonly string[],
  prefix: string,
  replacement: string,
): string[] {
  return args.map((value) => (value.startsWith(prefix) ? replacement : value));
}

async function writeEvidence(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

function validEmailEvidence(): string {
  return [
    "EVIDENCE_TIMESTAMP_UTC=2026-07-18T04:00:00Z",
    "EMAIL_ALERT_TRANSPORT=GMAIL_SMTP",
    "SMTP_AUTH=PASS",
    "EMAIL_TEST=PASS",
    "EMAIL_ALERT_GATE=PASS",
    "SENDER_CONFIRMED=YES",
    "RECIPIENT_CONFIRMED=YES",
    "MESSAGE_CONTENT=NON_SENSITIVE",
    "CREDENTIAL_LOGGED=NO",
    "",
  ].join("\n");
}
