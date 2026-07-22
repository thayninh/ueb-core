// @vitest-environment node

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { MigrationLedger } from "../../scripts/phase-6/lib/migration-ledger";
import {
  PHASE9_POST_TRANSFER_CHECKS,
  PHASE9_REMOTE_CHECKS,
  assertCollectorReadOnly,
  buildPostTransferSshArguments,
  buildSshArguments,
  executePostTransferCandidateVerification,
  executeReadOnlyPreflight,
  parseExecuteReadOnlyArguments,
  type SshExecutionRequest,
  type SshExecutionResult,
  type SshTransport,
} from "../../scripts/phase-9/lib/staging-ssh-executor";

const releaseSha = "a".repeat(40);
const fingerprint = "b".repeat(64);
const imageId = `sha256:${"c".repeat(64)}`;
const checksum = "d".repeat(64);
const currentReleaseSha = "f".repeat(40);
const previousReleaseSha = "e".repeat(40);
const roots: string[] = [];
const ledger: MigrationLedger = {
  version: 1,
  count: 2,
  fingerprint,
  migrations: [
    { name: "20260101000000_one", checksum: "1".repeat(64) },
    { name: "20260102000000_two", checksum: "2".repeat(64) },
  ],
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function argumentsFor(root: string): string[] {
  return [
    "--target=staging",
    `--release-sha=${releaseSha}`,
    "--authorization-ref=PHASE9B-READ-ONLY-APPROVAL",
    "--ssh-alias=ueb-core-staging",
    `--ssh-config-file=${join(root, "ssh-config")}`,
    "--expected-user=deploy",
    "--expected-host=103.200.25.54",
    `--known-hosts-file=${join(root, "known-hosts")}`,
    "--connect-timeout-seconds=10",
    "--command-timeout-seconds=60",
    "--remote-root=/opt/ueb-core",
    "--remote-secret-file=/opt/ueb-core/secrets/database-owner.env",
    `--output=${join(root, "report.json")}`,
    "--execute-read-only",
  ];
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ueb-core-phase9b-"));
  roots.push(root);
  await writeFile(join(root, "ssh-config"), "Host ueb-core-staging\n");
  await writeFile(join(root, "known-hosts"), "host key\n");
  return root;
}

function result(
  overrides: Partial<SshExecutionResult> = {},
): SshExecutionResult {
  const evidence = new Map<string, string>([
    ["SERVER_TIME", "2026-07-22T09:00:00+07:00"],
    [
      "CURRENT_ROLLBACK_IMAGES",
      `CURRENT=ueb-core:${currentReleaseSha}|${imageId}|linux/amd64|app-container\nROLLBACK=ueb-core:${previousReleaseSha}|${imageId}|linux/amd64\nMETADATA_RELEASE_SHA=${releaseSha}\nMETADATA_PREVIOUS_RELEASE_SHA=${previousReleaseSha}`,
    ],
    [
      "COMPOSE_SERVICES",
      "app|ueb-core|running|0|app-container\ndb|postgres|running|0|db-container",
    ],
    ["HEALTH", "HTTP_STATUS=200"],
    ["READINESS", "HTTP_STATUS=200"],
    [
      "DATABASE_MIGRATION_LEDGER",
      `${ledger.migrations[0]!.name}|${ledger.migrations[0]!.checksum}|true\n${ledger.migrations[1]!.name}|${ledger.migrations[1]!.checksum}|true`,
    ],
    [
      "BACKUP_EVIDENCE",
      `CHECKSUM=${checksum}\nMETADATA=${JSON.stringify({ database: "ueb_core_staging", createdAt: "2026-07-22T08:00:00+07:00", tier: "daily", checksum })}\nOFF_HOST_CHECKSUM_MATCH=YES\nCATALOG_VALIDATED_BY_METADATA_CONTRACT=YES`,
    ],
    [
      "ROLLBACK_METADATA",
      JSON.stringify({
        imageId,
        architecture: "linux/amd64",
        composeService: "app",
        releaseSha,
        previousReleaseSha,
        currentImage: `ueb-core:${currentReleaseSha}`,
        previousImage: `ueb-core:${previousReleaseSha}`,
        sourceMigrationCount: 2,
        migrationLedgerFingerprint: fingerprint,
        databaseMigrationStatus: "COMPATIBLE",
        schemaCompatibilityDecision: "APPROVED",
        backupIdentifier: "staging-predeploy-20260722",
        backupChecksum: checksum,
        timestamp: "2026-07-22T08:30:00+07:00",
        operatorIdentityReference: "phase9-staging-operator",
      }),
    ],
    ["CADDY_ROUTE", "CONFIG_VALIDATE=PASS"],
    ["MONITORING_ALERT", "CRON_ENTRY_COUNT=1\nALERT_STATUS=PASS"],
  ]);
  const stdout = PHASE9_REMOTE_CHECKS.map((id) => {
    const encoded = Buffer.from(evidence.get(id) ?? "").toString("base64");
    return `P9B|${id}|PASS|1|0|CHECK_PASS|${encoded}`;
  }).join("\n");
  return { exitCode: 0, stdout, stderr: "", ...overrides };
}

function postTransferArgumentsFor(root: string): string[] {
  return argumentsFor(root).map((argument) =>
    argument === "--execute-read-only"
      ? "--execute-post-transfer-image-verify"
      : argument,
  );
}

function postTransferResult(
  overrides: Partial<SshExecutionResult> = {},
): SshExecutionResult {
  const evidence = `APP=${imageId}|linux/amd64|${releaseSha}|2|${fingerprint}\nOPERATOR=${imageId}|linux/amd64|${releaseSha}|2|${fingerprint}\nEXPECTED_COUNT=2\nEXPECTED_FINGERPRINT=${fingerprint}`;
  const stdout = `P9B|${PHASE9_POST_TRANSFER_CHECKS[0]}|PASS|1|0|CANDIDATE_IMAGES_INSPECTED|${Buffer.from(evidence).toString("base64")}`;
  return { exitCode: 0, stdout, stderr: "", ...overrides };
}

function resultWithRemoteFailure(input: {
  readonly checkId: (typeof PHASE9_REMOTE_CHECKS)[number];
  readonly checkStatus?: "BLOCKED" | "FAIL";
  readonly remoteExitCode?: number;
  readonly sshExitCode?: number;
}): SshExecutionResult {
  const base = result();
  const failedIndex = PHASE9_REMOTE_CHECKS.indexOf(input.checkId);
  const lines = base.stdout.split("\n").slice(0, failedIndex + 1);
  const parts = lines[failedIndex]!.split("|");
  parts[2] = input.checkStatus ?? "BLOCKED";
  parts[4] = String(input.remoteExitCode ?? 42);
  parts[5] = "SAFE_REMOTE_FAILURE";
  lines[failedIndex] = parts.join("|");
  return {
    ...base,
    exitCode: input.sshExitCode ?? input.remoteExitCode ?? 42,
    stdout: lines.join("\n"),
  };
}

class FakeTransport implements SshTransport {
  readonly requests: SshExecutionRequest[] = [];
  constructor(
    private readonly response: SshExecutionResult = result(),
    private readonly resolved = { hostname: "103.200.25.54", user: "deploy" },
  ) {}
  async resolve(): Promise<{ hostname: string; user: string }> {
    return this.resolved;
  }
  async execute(request: SshExecutionRequest): Promise<SshExecutionResult> {
    this.requests.push(request);
    return this.response;
  }
}

const dependencies = (transport: SshTransport) => ({
  transport,
  ledger,
  verifyRelease: async () => undefined,
  assertClean: async () => undefined,
});

describe("Phase 9B guarded argument contract", () => {
  it("requires explicit authorization and every exact argument", async () => {
    const root = await fixture();
    expect(parseExecuteReadOnlyArguments(argumentsFor(root)).target).toBe(
      "staging",
    );
    expect(() =>
      parseExecuteReadOnlyArguments(
        argumentsFor(root).filter(
          (argument) => !argument.startsWith("--authorization-ref="),
        ),
      ),
    ).toThrow(/missing or duplicated/u);
    expect(() =>
      parseExecuteReadOnlyArguments([
        ...argumentsFor(root),
        "--authorization-ref=duplicate",
      ]),
    ).toThrow(/missing or duplicated/u);
  });

  it("rejects dry-run, production, arbitrary commands and unsafe paths", async () => {
    const root = await fixture();
    expect(() =>
      parseExecuteReadOnlyArguments([...argumentsFor(root), "--dry-run"]),
    ).toThrow(/mutually exclusive/u);
    expect(() =>
      parseExecuteReadOnlyArguments(
        argumentsFor(root).map((argument) =>
          argument === "--target=staging" ? "--target=production" : argument,
        ),
      ),
    ).toThrow(/staging target/u);
    expect(() =>
      parseExecuteReadOnlyArguments([
        ...argumentsFor(root),
        "--remote-command=id",
      ]),
    ).toThrow(/Unsupported/u);
    expect(() =>
      parseExecuteReadOnlyArguments(
        argumentsFor(root).map((argument) =>
          argument.startsWith("--remote-secret-file=")
            ? "--remote-secret-file=/opt/ueb-core/secrets/../production.env"
            : argument,
        ),
      ),
    ).toThrow(/approved staging path/u);
  });

  it("bounds connect and command timeouts", async () => {
    const root = await fixture();
    expect(() =>
      parseExecuteReadOnlyArguments(
        argumentsFor(root).map((argument) =>
          argument.startsWith("--connect-timeout-seconds=")
            ? "--connect-timeout-seconds=31"
            : argument,
        ),
      ),
    ).toThrow(/outside the approved bound/u);
  });

  it("rejects consumed one-attempt authorization references", async () => {
    const root = await fixture();
    expect(() =>
      parseExecuteReadOnlyArguments(
        argumentsFor(root).map((argument) =>
          argument.startsWith("--authorization-ref=")
            ? "--authorization-ref=P9C2-READONLY-STAGING-20260722-01"
            : argument,
        ),
      ),
    ).toThrow(/missing or unsafe/u);
  });
});

describe("Phase 9B fake SSH execution", () => {
  it("uses strict SSH arguments and sends only the fixed collector over stdin", async () => {
    const root = await fixture();
    const fake = new FakeTransport();
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(fake),
    );
    expect(report.status).toBe("PASS");
    expect(report.checks).toHaveLength(10);
    expect(report.mutationCommandCount).toBe(0);
    expect(fake.requests).toHaveLength(1);
    const request = fake.requests[0]!;
    expect(request.args).toEqual(
      expect.arrayContaining([
        "BatchMode=yes",
        "StrictHostKeyChecking=yes",
        "PasswordAuthentication=no",
        "KbdInteractiveAuthentication=no",
        "ClearAllForwardings=yes",
        "-T",
      ]),
    );
    expect(request.args).not.toContain("production");
    expect(request.collectorStdin).toContain(
      "default_transaction_read_only=on",
    );
    expect(request.collectorStdin).toContain("CURRENT_ROLLBACK_IMAGES");
    expect(request.collectorStdin).not.toContain(
      'app_image="ueb-core:$release_sha"',
    );
    expect(request.collectorStdin).not.toContain("set -x");
    const saved = JSON.parse(
      await readFile(join(root, "report.json"), "utf8"),
    ) as {
      reportSchemaVersion: number;
    };
    expect(saved.reportSchemaVersion).toBe(1);
    expect((await stat(join(root, "report.json"))).mode & 0o777).toBe(0o600);
  });

  it("blocks when current or rollback image evidence mismatches metadata", async () => {
    const root = await fixture();
    const mismatch = result();
    const lines = mismatch.stdout.split("\n");
    const imageIndex = PHASE9_REMOTE_CHECKS.indexOf("CURRENT_ROLLBACK_IMAGES");
    const imageParts = lines[imageIndex]!.split("|");
    const imageEvidence = Buffer.from(imageParts[6]!, "base64")
      .toString("utf8")
      .replace(
        `ROLLBACK=ueb-core:${previousReleaseSha}`,
        `ROLLBACK=ueb-core:${"1".repeat(40)}`,
      );
    imageParts[6] = Buffer.from(imageEvidence).toString("base64");
    lines[imageIndex] = imageParts.join("|");
    const stdout = lines.join("\n");
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(new FakeTransport({ ...mismatch, stdout })),
    );
    expect(report.status).toBe("BLOCKED");
    expect(report.failedCheck).toBe("CURRENT_ROLLBACK_IMAGES");
    expect(report.stopReason).toMatch(/METADATA_MISMATCH/u);
  });

  it("fails before execution when ssh -G resolves a different user or host", async () => {
    const root = await fixture();
    const fake = new FakeTransport(result(), {
      hostname: "127.0.0.1",
      user: "root",
    });
    await expect(
      executeReadOnlyPreflight(argumentsFor(root), dependencies(fake)),
    ).rejects.toThrow(/identity or local execution policy is unsafe/u);
    expect(fake.requests).toHaveLength(0);
  });

  it("writes a blocked atomic report for timeout, SSH failure, or missing evidence", async () => {
    for (const response of [
      result({ timedOut: true }),
      result({ exitCode: 255, stderr: "connection failed" }),
      result({ stdout: result().stdout.split("\n").slice(0, -1).join("\n") }),
    ]) {
      const root = await fixture();
      const report = await executeReadOnlyPreflight(
        argumentsFor(root),
        dependencies(new FakeTransport(response)),
      );
      expect(report.status).toBe("BLOCKED");
      expect(await readFile(join(root, "report.json"), "utf8")).toContain(
        '"status": "BLOCKED"',
      );
    }
  });

  it.each(["BACKUP_EVIDENCE", "ROLLBACK_METADATA", "MONITORING_ALERT"])(
    "fails closed when %s is missing",
    async (missingCheck) => {
      const root = await fixture();
      const incomplete = result();
      const stdout = incomplete.stdout
        .split("\n")
        .filter((line) => !line.startsWith(`P9B|${missingCheck}|`))
        .join("\n");
      const report = await executeReadOnlyPreflight(
        argumentsFor(root),
        dependencies(new FakeTransport({ ...incomplete, stdout })),
      );
      expect(report.status).toBe("BLOCKED");
      expect([
        "COLLECTOR_PROTOCOL_INCOMPLETE",
        "COLLECTOR_PROTOCOL_ORDER_INVALID",
      ]).toContain(report.stopReason);
    },
  );

  it("blocks and redacts secret-shaped stdout/stderr without exposing its value", async () => {
    const root = await fixture();
    const leaked = "PASSWORD=do-not-print-this";
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(new FakeTransport(result({ stderr: leaked }))),
    );
    const saved = await readFile(join(root, "report.json"), "utf8");
    expect(report.status).toBe("BLOCKED");
    expect(report.secretLeakageCount).toBeGreaterThan(0);
    expect(report.failedCheck).toBe("COLLECTOR_PROTOCOL");
    expect(saved).not.toContain("do-not-print-this");
  });

  it("blocks oversized output without opening a real socket", async () => {
    const root = await fixture();
    const fake = new FakeTransport(result({ outputExceeded: true }));
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(fake),
    );
    expect(report.status).toBe("BLOCKED");
    expect(report.failedCheck).toBe("SSH_TRANSPORT");
    expect(fake.requests).toHaveLength(1);
    expect((await stat(join(root, "report.json"))).mode & 0o777).toBe(0o600);
  });
});

describe("Phase 9C1 remote failure diagnostics", () => {
  it("preserves preceding PASS checks and the first BLOCKED check before SSH exit handling", async () => {
    const root = await fixture();
    const response = resultWithRemoteFailure({
      checkId: "BACKUP_EVIDENCE",
      remoteExitCode: 33,
      sshExitCode: 33,
    });
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(new FakeTransport(response)),
    );
    expect(report.status).toBe("BLOCKED");
    expect(report.failedCheck).toBe("BACKUP_EVIDENCE");
    expect(report.checks).toHaveLength(7);
    expect(report.checks.at(-1)).toMatchObject({
      id: "BACKUP_EVIDENCE",
      status: "BLOCKED",
      exitCode: 33,
      summary: "SAFE_REMOTE_FAILURE",
    });
    expect(report.sshExitCode).toBe(33);
    expect(report.stopReason).toContain("REMOTE_CHECK_BACKUP_EVIDENCE_BLOCKED");
  });

  it("preserves a first-check BLOCKED result instead of UNAVAILABLE", async () => {
    const root = await fixture();
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(
        new FakeTransport(
          resultWithRemoteFailure({
            checkId: "SERVER_TIME",
            remoteExitCode: 11,
          }),
        ),
      ),
    );
    expect(report.failedCheck).toBe("SERVER_TIME");
    expect(report.checks).toHaveLength(1);
    expect(report.stopReason).not.toContain("UNAVAILABLE");
  });

  it("classifies SSH exit 255 without protocol as SSH_TRANSPORT", async () => {
    const root = await fixture();
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(
        new FakeTransport({
          exitCode: 255,
          stdout: "",
          stderr: "transport closed",
        }),
      ),
    );
    expect(report.failedCheck).toBe("SSH_TRANSPORT");
    expect(report.protocolParseStatus).toBe("NONE");
    expect(report.stopReason).toBe("SSH_TRANSPORT_FAILED_WITHOUT_PROTOCOL");
  });

  it("classifies malformed protocol and preserves checks parsed before it", async () => {
    const root = await fixture();
    const validFirst = result().stdout.split("\n")[0]!;
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(
        new FakeTransport({
          exitCode: 2,
          stdout: `${validFirst}\nnot-a-protocol-line`,
          stderr: "",
        }),
      ),
    );
    expect(report.failedCheck).toBe("COLLECTOR_PROTOCOL");
    expect(report.protocolParseStatus).toBe("MALFORMED");
    expect(report.checks).toHaveLength(1);
  });

  it("blocks protocol failure even when SSH exits zero", async () => {
    const root = await fixture();
    const response = resultWithRemoteFailure({
      checkId: "HEALTH",
      remoteExitCode: 17,
      sshExitCode: 0,
    });
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(new FakeTransport(response)),
    );
    expect(report.status).toBe("BLOCKED");
    expect(report.failedCheck).toBe("HEALTH");
  });

  it("fails closed when SSH is non-zero but the complete protocol is PASS", async () => {
    const root = await fixture();
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(new FakeTransport(result({ exitCode: 9 }))),
    );
    expect(report.failedCheck).toBe("COLLECTOR_PROTOCOL");
    expect(report.protocolParseStatus).toBe("COMPLETE");
    expect(report.stopReason).toBe("SSH_EXIT_PROTOCOL_INCONSISTENCY");
  });

  it("retains timeout and signal metadata in the atomic report", async () => {
    const root = await fixture();
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(
        new FakeTransport(
          result({ exitCode: 255, signal: "SIGKILL", timedOut: true }),
        ),
      ),
    );
    expect(report.failedCheck).toBe("SSH_TRANSPORT");
    expect(report.sshSignal).toBe("SIGKILL");
    expect(report.sshExitCode).toBe(255);
    const saved = JSON.parse(
      await readFile(join(root, "report.json"), "utf8"),
    ) as {
      sshSignal: string;
    };
    expect(saved.sshSignal).toBe("SIGKILL");
  });

  it("preserves valid partial PASS checks without guessing the missing failure", async () => {
    const root = await fixture();
    const partial = result().stdout.split("\n").slice(0, 2).join("\n");
    const report = await executeReadOnlyPreflight(
      argumentsFor(root),
      dependencies(
        new FakeTransport({ exitCode: 0, stdout: partial, stderr: "" }),
      ),
    );
    expect(report.checks).toHaveLength(2);
    expect(report.failedCheck).toBe("COLLECTOR_PROTOCOL");
    expect(report.protocolParseStatus).toBe("PARTIAL");
  });
});

describe("Phase 9B mutation prevention", () => {
  it("rejects mutation tokens and requires explicit read-only SQL", () => {
    expect(() =>
      assertCollectorReadOnly("set -eu\ndocker run image\n"),
    ).toThrow(/mutation token/u);
    expect(() => assertCollectorReadOnly("set -eu\nprintf ok\n")).toThrow(
      /not explicitly/u,
    );
  });

  it("builds a positional, non-shell-concatenated SSH invocation", async () => {
    const root = await fixture();
    const options = parseExecuteReadOnlyArguments(argumentsFor(root));
    const args = buildSshArguments(options, ledger);
    expect(args.slice(-8)).toEqual([
      "sh",
      "-s",
      "--",
      releaseSha,
      "/opt/ueb-core",
      "/opt/ueb-core/secrets/database-owner.env",
      "2",
      fingerprint,
    ]);
  });
});

describe("Phase 9C3 post-transfer candidate verification", () => {
  it("requires candidate images only in the separate post-transfer gate", async () => {
    const root = await fixture();
    const fake = new FakeTransport(postTransferResult());
    const report = await executePostTransferCandidateVerification(
      postTransferArgumentsFor(root),
      dependencies(fake),
    );
    expect(report.status).toBe("PASS");
    expect(report.checks.map((check) => check.id)).toEqual([
      "CANDIDATE_IMAGES",
    ]);
    expect(fake.requests[0]!.collectorStdin).not.toContain(
      "default_transaction_read_only=on",
    );
    expect(fake.requests[0]!.collectorStdin).not.toContain(
      "CURRENT_ROLLBACK_IMAGES",
    );
    expect(report.mutationCommandCount).toBe(0);
  });

  it("fails closed when a candidate image is absent or metadata differs", async () => {
    const root = await fixture();
    const missing = postTransferResult({
      exitCode: 61,
      stdout: `P9B|CANDIDATE_IMAGES|BLOCKED|1|61|CANDIDATE_APP_IMAGE_MISSING|`,
    });
    const missingReport = await executePostTransferCandidateVerification(
      postTransferArgumentsFor(root),
      dependencies(new FakeTransport(missing)),
    );
    expect(missingReport.failedCheck).toBe("CANDIDATE_IMAGES");
    expect(missingReport.status).toBe("BLOCKED");

    const secondRoot = await fixture();
    const mismatchEvidence = `APP=${imageId}|linux/amd64|${"f".repeat(40)}|2|${fingerprint}\nOPERATOR=${imageId}|linux/amd64|${releaseSha}|2|${fingerprint}\nEXPECTED_COUNT=2\nEXPECTED_FINGERPRINT=${fingerprint}`;
    const mismatch = postTransferResult({
      stdout: `P9B|CANDIDATE_IMAGES|PASS|1|0|CANDIDATE_IMAGES_INSPECTED|${Buffer.from(mismatchEvidence).toString("base64")}`,
    });
    const mismatchReport = await executePostTransferCandidateVerification(
      postTransferArgumentsFor(secondRoot),
      dependencies(new FakeTransport(mismatch)),
    );
    expect(mismatchReport.status).toBe("BLOCKED");
    expect(mismatchReport.failedCheck).toBe("CANDIDATE_IMAGES");
    expect(mismatchReport.stopReason).toMatch(/CONTRACT_MISMATCH/u);
  });

  it("uses a positional collector contract with no secret path", async () => {
    const root = await fixture();
    const options = parseExecuteReadOnlyArguments(
      postTransferArgumentsFor(root),
      "--execute-post-transfer-image-verify",
    );
    const args = buildPostTransferSshArguments(options, ledger);
    expect(args.slice(-6)).toEqual([
      "sh",
      "-s",
      "--",
      releaseSha,
      "2",
      fingerprint,
    ]);
    expect(args).not.toContain("/opt/ueb-core/secrets/database-owner.env");
  });
});
