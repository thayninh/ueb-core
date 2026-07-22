// @vitest-environment node

import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MigrationLedger } from "../../scripts/phase-6/lib/migration-ledger";
import {
  FUTURE_ROLLBACK_METADATA_INSTALL_CONTRACT,
  ROLLBACK_READINESS_CHECKS,
  buildRollbackReadinessSshArguments,
  createRollbackReadinessDryRun,
  executeRollbackReadiness,
  generateRollbackMetadataDraft,
  parseRollbackReadinessArguments,
  type RollbackReadinessReport,
  type SshExecutionRequest,
  type SshExecutionResult,
  type SshTransport,
} from "../../scripts/phase-9/lib/rollback-metadata-readiness";
import { assertCollectorReadOnly } from "../../scripts/phase-9/lib/staging-ssh-executor";

const releaseSha = "a".repeat(40);
const currentSha = "b".repeat(40);
const rollbackSha = "c".repeat(40);
const secondRollbackSha = "d".repeat(40);
const imageId = `sha256:${"e".repeat(64)}`;
const secondImageId = `sha256:${"f".repeat(64)}`;
const checksum = "9".repeat(64);
const migrationRows = [
  { name: "20260101000000_one", checksum: "1".repeat(64) },
  { name: "20260102000000_two", checksum: "2".repeat(64) },
] as const;
const fingerprint = createHash("sha256")
  .update(JSON.stringify({ version: 1, migrations: migrationRows }))
  .digest("hex");
const roots: string[] = [];
const ledger: MigrationLedger = {
  version: 1,
  count: 2,
  fingerprint,
  migrations: migrationRows,
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ueb-core-rollback-readiness-"));
  roots.push(root);
  await writeFile(join(root, "ssh-config"), "Host ueb-core-staging\n");
  await writeFile(join(root, "known-hosts"), "pinned host key\n");
  return root;
}

function executionArguments(root: string): string[] {
  return [
    "--target=staging",
    `--release-sha=${releaseSha}`,
    "--authorization-ref=P9C5-ROLLBACK-READINESS-TEST-01",
    "--ssh-alias=ueb-core-staging",
    `--ssh-config-file=${join(root, "ssh-config")}`,
    "--expected-user=deploy",
    "--expected-host=103.200.25.54",
    `--known-hosts-file=${join(root, "known-hosts")}`,
    "--connect-timeout-seconds=5",
    "--command-timeout-seconds=90",
    "--remote-root=/opt/ueb-core",
    "--remote-secret-file=/opt/ueb-core/secrets/database-owner.env",
    `--output=${join(root, "readiness.json")}`,
    "--execute-read-only",
  ];
}

function evidence(overrides: Partial<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    SERVER_TIME: "2026-07-22T10:00:00+07:00",
    CURRENT_APP_IMAGE: `TAG=ueb-core:${currentSha}\nIMAGE_ID=${imageId}\nARCHITECTURE=linux/amd64\nSOURCE_SHA=${currentSha}\nMIGRATION_COUNT=2\nMIGRATION_FINGERPRINT=${fingerprint}\nCONTAINER_ID=app-container`,
    OPERATOR_IMAGE_EVIDENCE: "OPERATOR_IMAGE_COUNT=0",
    ROLLBACK_IMAGE_INVENTORY: `CANDIDATE_COUNT=1\nCANDIDATE=ueb-core:${rollbackSha}|${imageId}|linux/amd64|${rollbackSha}|2|${fingerprint}`,
    COMPOSE_MAPPING: `SERVICE_COUNT=2\nSERVICE=app|ueb-core:${currentSha}|running|0|app-container\nSERVICE=db|postgres:18|running|0|db-container`,
    DATABASE_MIGRATION_LEDGER: `${ledger.migrations[0]!.name}|${ledger.migrations[0]!.checksum}|true\n${ledger.migrations[1]!.name}|${ledger.migrations[1]!.checksum}|true`,
    BACKUP_EVIDENCE: `IDENTIFIER=staging-predeploy-20260722\nCHECKSUM=${checksum}\nCREATED_AT=2026-07-22T09:00:00+07:00\nOFF_HOST_CHECKSUM_MATCH=YES\nCATALOG_VALIDATED=YES`,
    ROLLBACK_METADATA_PATH:
      "STATE=ABSENT\nPATH=/opt/ueb-core/evidence/rollback/approved.json",
    SCHEMA_COMPATIBILITY_INPUTS: `RELEASE_SHA=${releaseSha}\nSOURCE_MIGRATION_COUNT=2\nSOURCE_MIGRATION_FINGERPRINT=${fingerprint}\nDATABASE_POLICY=FORWARD_ONLY_NO_REVERSE_MIGRATION\nDECISION=OPERATOR_DECISION_REQUIRED`,
    MONITORING_HEALTH_READINESS:
      "HEALTH_STATUS=200\nREADINESS_STATUS=200\nMONITOR_SCRIPT_MODE=700\nMONITOR_LOG_MODE=600\nMONITOR_LOG_LINES=10",
    ...overrides,
  };
  return values;
}

function fakeResult(
  overrides: Partial<Record<string, string>> = {},
  statusOverrides: Partial<Record<string, "PASS" | "BLOCKED">> = {},
): SshExecutionResult {
  const values = evidence(overrides);
  let firstFailure = 0;
  const stdout = ROLLBACK_READINESS_CHECKS.map((id) => {
    const status = statusOverrides[id] ?? "PASS";
    const exitCode = status === "PASS" ? 0 : 32;
    if (exitCode && firstFailure === 0) firstFailure = exitCode;
    return `P9R|${id}|${status}|1|${exitCode}|${status === "PASS" ? "CHECK_PASS" : "CHECK_BLOCKED"}|${Buffer.from(values[id] ?? "").toString("base64")}`;
  }).join("\n");
  return { exitCode: firstFailure, stdout, stderr: "" };
}

class FakeTransport implements SshTransport {
  readonly requests: SshExecutionRequest[] = [];

  constructor(private readonly result: SshExecutionResult = fakeResult()) {}

  async resolve() {
    return { hostname: "103.200.25.54", user: "deploy" };
  }

  async execute(request: SshExecutionRequest) {
    this.requests.push(request);
    return this.result;
  }
}

function dependencies(transport: SshTransport) {
  return {
    transport,
    ledger,
    verifyRelease: async () => undefined,
    assertClean: async () => undefined,
  };
}

function report(
  overrides: Partial<Record<string, string>> = {},
  reportOverrides: Partial<RollbackReadinessReport> = {},
): RollbackReadinessReport {
  const values = evidence(overrides);
  return {
    reportSchemaVersion: 1,
    status: "PASS",
    target: "staging",
    releaseSha,
    authorizationReference: "P9C5-ROLLBACK-READINESS-TEST-01",
    timestamp: "2026-07-22T03:00:00.000Z",
    resolvedSsh: { host: "103.200.25.54", user: "deploy" },
    sourceMigrationCount: ledger.count,
    sourceMigrationFingerprint: ledger.fingerprint,
    checks: ROLLBACK_READINESS_CHECKS.map((id) => ({
      id,
      status: "PASS",
      durationMs: 1,
      exitCode: 0,
      summary: "CHECK_PASS",
      evidence: values[id] ?? "",
    })),
    failedChecks: [],
    protocolParseStatus: "COMPLETE",
    sshExitCode: 0,
    sshSignal: null,
    mutationCommandCount: 0,
    serverConnectionPerformed: true,
    secretLeakageCount: 0,
    remoteSecretReferenceHash: "7".repeat(64),
    stopReason: null,
    ...reportOverrides,
  };
}

async function writeReport(
  root: string,
  value: RollbackReadinessReport,
): Promise<string> {
  const path = join(root, "source-report.json");
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  return path;
}

describe("Phase 9C5 guarded rollback readiness contract", () => {
  it("creates a local dry-run with ten read-only checks", () => {
    const plan = createRollbackReadinessDryRun(
      ["--target=staging", `--release-sha=${releaseSha}`, "--dry-run"],
      ledger,
    );
    expect(plan.checks).toEqual(ROLLBACK_READINESS_CHECKS);
    expect(plan.remoteMutationCommands).toBe(0);
    expect(plan.serverConnectionPerformed).toBe(false);
  });

  it("requires a distinct readiness authorization and rejects old preflight references", async () => {
    const root = await fixture();
    expect(
      parseRollbackReadinessArguments(executionArguments(root)).target,
    ).toBe("staging");
    for (const consumed of [
      "P9C-READONLY-STAGING-20260722-01",
      "P9C2-READONLY-STAGING-20260722-01",
      "P9C4-PRETRANSFER-READONLY-STAGING-20260722-01",
    ]) {
      expect(() =>
        parseRollbackReadinessArguments(
          executionArguments(root).map((argument) =>
            argument.startsWith("--authorization-ref=")
              ? `--authorization-ref=${consumed}`
              : argument,
          ),
        ),
      ).toThrow(/distinct rollback-readiness authorization/u);
    }
  });

  it("rejects arbitrary remote commands and unsafe staging identity inputs", async () => {
    const root = await fixture();
    expect(() =>
      parseRollbackReadinessArguments([
        ...executionArguments(root),
        "--remote-command=id",
      ]),
    ).toThrow(/Unsupported/u);
    expect(() =>
      parseRollbackReadinessArguments(
        executionArguments(root).map((argument) =>
          argument === "--expected-user=deploy"
            ? "--expected-user=root"
            : argument,
        ),
      ),
    ).toThrow(/identity/u);
  });

  it("uses hardened SSH arguments and preserves current image evidence", async () => {
    const root = await fixture();
    const options = parseRollbackReadinessArguments(executionArguments(root));
    const args = buildRollbackReadinessSshArguments(options, ledger);
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args).toContain("ClearAllForwardings=yes");
    expect(args).not.toContain("sudo");
    const transport = new FakeTransport();
    const readiness = await executeRollbackReadiness(
      executionArguments(root),
      dependencies(transport),
    );
    expect(readiness.status).toBe("PASS");
    expect(readiness.mutationCommandCount).toBe(0);
    expect(readiness.secretLeakageCount).toBe(0);
    expect(
      readiness.checks.find((check) => check.id === "CURRENT_APP_IMAGE")
        ?.evidence,
    ).toContain(`SOURCE_SHA=${currentSha}`);
    expect(transport.requests).toHaveLength(1);
    expect((await stat(join(root, "readiness.json"))).mode & 0o777).toBe(0o600);
  });

  it("reports secret leakage without retaining the value", async () => {
    const root = await fixture();
    const transport = new FakeTransport(
      fakeResult({
        MONITORING_HEALTH_READINESS: ["pass", "word=do-not-retain"].join(""),
      }),
    );
    const readiness = await executeRollbackReadiness(
      executionArguments(root),
      dependencies(transport),
    );
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.secretLeakageCount).toBeGreaterThan(0);
    expect(JSON.stringify(readiness)).not.toContain("do-not-retain");
  });

  it("keeps collecting after a blocked remote check", async () => {
    const root = await fixture();
    const readiness = await executeRollbackReadiness(
      executionArguments(root),
      dependencies(
        new FakeTransport(fakeResult({}, { BACKUP_EVIDENCE: "BLOCKED" })),
      ),
    );
    expect(readiness.status).toBe("BLOCKED");
    expect(readiness.checks).toHaveLength(ROLLBACK_READINESS_CHECKS.length);
    expect(readiness.failedChecks).toEqual(["BACKUP_EVIDENCE"]);
  });

  it("keeps the collector read-only with zero mutation tokens", async () => {
    const collector = await readFile(
      join(
        process.cwd(),
        "scripts/phase-9/remote-rollback-readiness-collector.sh",
      ),
      "utf8",
    );
    expect(() => assertCollectorReadOnly(collector)).not.toThrow();
    expect(collector).toContain("default_transaction_read_only=on");
    expect(collector).not.toMatch(
      /\bsudo\b|docker\s+(?:load|pull|run|rm|rmi|restart)|\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/iu,
    );
  });
});

describe("Phase 9C5 local non-approved metadata draft", () => {
  it("classifies absent metadata and creates an atomic mode-0600 non-approved draft", async () => {
    const root = await fixture();
    const source = await writeReport(root, report());
    const output = join(root, "draft.json");
    const draft = await generateRollbackMetadataDraft({
      reportPath: source,
      outputPath: output,
      releaseSha,
      now: new Date("2026-07-22T03:30:00.000Z"),
    });
    expect(draft.status).toBe("OPERATOR_DECISION_REQUIRED");
    expect(draft.approved).toBe(false);
    expect(draft.blockers).toEqual([]);
    expect(draft.proposedMetadata.currentImage).toBe(`ueb-core:${currentSha}`);
    expect(draft.proposedMetadata.previousImage).toBe(
      `ueb-core:${rollbackSha}`,
    );
    expect(draft.fieldStates.schemaCompatibilityDecision).toBe(
      "OPERATOR_DECISION_REQUIRED",
    );
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect((await readdir(root)).some((name) => name.includes(".tmp-"))).toBe(
      false,
    );
    expect(JSON.parse(await readFile(output, "utf8"))).not.toHaveProperty(
      "approved",
      true,
    );
  });

  it("blocks a symlink metadata target state", async () => {
    const root = await fixture();
    const source = await writeReport(
      root,
      report({ ROLLBACK_METADATA_PATH: "STATE=SYMLINK" }),
    );
    const draft = await generateRollbackMetadataDraft({
      reportPath: source,
      outputPath: join(root, "draft.json"),
      releaseSha,
    });
    expect(draft.status).toBe("BLOCKED");
    expect(draft.blockers).toContain("APPROVED_METADATA_PATH_SYMLINK");
  });

  it("requires an operator decision when multiple rollback candidates are compatible", async () => {
    const root = await fixture();
    const source = await writeReport(
      root,
      report({
        ROLLBACK_IMAGE_INVENTORY: `CANDIDATE_COUNT=2\nCANDIDATE=ueb-core:${rollbackSha}|${imageId}|linux/amd64|${rollbackSha}|2|${fingerprint}\nCANDIDATE=ueb-core:${secondRollbackSha}|${secondImageId}|linux/amd64|${secondRollbackSha}|2|${fingerprint}`,
      }),
    );
    const draft = await generateRollbackMetadataDraft({
      reportPath: source,
      outputPath: join(root, "draft.json"),
      releaseSha,
    });
    expect(draft.status).toBe("OPERATOR_DECISION_REQUIRED");
    expect(draft.rollbackCandidates).toHaveLength(2);
    expect(draft.proposedMetadata.previousImage).toBeNull();
    expect(draft.operatorDecisions).toContain(
      "SELECT_ROLLBACK_RELEASE_AND_IMAGE_DIGEST",
    );
  });

  it("blocks when no rollback candidate exists", async () => {
    const root = await fixture();
    const source = await writeReport(
      root,
      report({ ROLLBACK_IMAGE_INVENTORY: "CANDIDATE_COUNT=0" }),
    );
    const draft = await generateRollbackMetadataDraft({
      reportPath: source,
      outputPath: join(root, "draft.json"),
      releaseSha,
    });
    expect(draft.status).toBe("BLOCKED");
    expect(draft.blockers).toContain("ROLLBACK_CANDIDATE_MISSING");
  });

  it.each([
    ["missing", ""],
    [
      "stale",
      `IDENTIFIER=staging-predeploy-old\nCHECKSUM=${checksum}\nCREATED_AT=2026-07-19T09:00:00+07:00\nOFF_HOST_CHECKSUM_MATCH=YES\nCATALOG_VALIDATED=YES`,
    ],
    [
      "checksum mismatch",
      `IDENTIFIER=staging-predeploy-20260722\nCHECKSUM=${checksum}\nCREATED_AT=2026-07-22T09:00:00+07:00\nOFF_HOST_CHECKSUM_MATCH=NO\nCATALOG_VALIDATED=YES`,
    ],
  ])("blocks %s backup evidence", async (_label, backupEvidence) => {
    const root = await fixture();
    const source = await writeReport(
      root,
      report({ BACKUP_EVIDENCE: backupEvidence }),
    );
    const draft = await generateRollbackMetadataDraft({
      reportPath: source,
      outputPath: join(root, "draft.json"),
      releaseSha,
    });
    expect(draft.status).toBe("BLOCKED");
    expect(
      draft.blockers.some((blocker) => blocker.startsWith("BACKUP_EVIDENCE_")),
    ).toBe(true);
  });

  it("blocks database and candidate migration mismatches", async () => {
    const root = await fixture();
    const source = await writeReport(
      root,
      report({
        DATABASE_MIGRATION_LEDGER: `${ledger.migrations[0]!.name}|${ledger.migrations[0]!.checksum}|true`,
        ROLLBACK_IMAGE_INVENTORY: `CANDIDATE_COUNT=1\nCANDIDATE=ueb-core:${rollbackSha}|${imageId}|linux/amd64|${rollbackSha}|1|${"6".repeat(64)}`,
      }),
    );
    const draft = await generateRollbackMetadataDraft({
      reportPath: source,
      outputPath: join(root, "draft.json"),
      releaseSha,
    });
    expect(draft.blockers).toContain("DATABASE_MIGRATION_LEDGER_MISMATCH");
    expect(draft.blockers).toContain("ROLLBACK_CANDIDATE_MISSING");
  });

  it("refuses a report containing secret material", async () => {
    const root = await fixture();
    const unsafe = report({
      MONITORING_HEALTH_READINESS: "token=unsafe-value",
    });
    const source = await writeReport(root, unsafe);
    await expect(
      generateRollbackMetadataDraft({
        reportPath: source,
        outputPath: join(root, "draft.json"),
        releaseSha,
      }),
    ).rejects.toThrow(/secret material/u);
    expect(
      await lstat(join(root, "draft.json")).catch(() => undefined),
    ).toBeUndefined();
  });

  it("does not implement or execute remote metadata installation", () => {
    expect(FUTURE_ROLLBACK_METADATA_INSTALL_CONTRACT.implemented).toBe(false);
    expect(FUTURE_ROLLBACK_METADATA_INSTALL_CONTRACT.executableInPhase9C5).toBe(
      false,
    );
    expect(FUTURE_ROLLBACK_METADATA_INSTALL_CONTRACT.requiredInputs).toContain(
      "exact draft SHA-256",
    );
  });
});
