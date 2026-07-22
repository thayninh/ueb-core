// @vitest-environment node

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { MigrationLedger } from "../../scripts/phase-6/lib/migration-ledger";
import {
  PHASE9_REMOTE_CHECKS,
  assertCollectorReadOnly,
  buildSshArguments,
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
      "RELEASE_IMAGE",
      `APP=${imageId}|linux/amd64\nOPERATOR=${imageId}|linux/amd64|${releaseSha}|2|${fingerprint}`,
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
        previousReleaseSha: "e".repeat(40),
        currentImage: `ueb-core:${releaseSha}`,
        previousImage: `ueb-core:${"e".repeat(40)}`,
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
    expect(request.collectorStdin).not.toContain("set -x");
    const saved = JSON.parse(
      await readFile(join(root, "report.json"), "utf8"),
    ) as {
      reportSchemaVersion: number;
    };
    expect(saved.reportSchemaVersion).toBe(1);
    expect((await stat(join(root, "report.json"))).mode & 0o777).toBe(0o600);
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
      expect(report.stopReason).toMatch(/CHECK_SET_INCOMPLETE/u);
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
    expect(fake.requests).toHaveLength(1);
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
