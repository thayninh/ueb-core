// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertDatabaseMigrationRows,
  readSourceMigrationLedger,
} from "../../scripts/phase-6/lib/migration-ledger";
import { assertOperatorImageContract } from "../../scripts/phase-6/lib/staging-deployment";
import {
  PHASE9_MUTATING_UAT_CASES,
  PHASE9_NON_MUTATING_UAT_CASES,
  PHASE9_UAT_CASES,
} from "../../scripts/phase-9/lib/uat-manifest";
import { createStagingReadOnlyPreflightPlan } from "../../scripts/phase-9/staging-read-only-preflight";
import { createUatPlan } from "../../scripts/phase-9/uat-runner";

const temporaryDirectories: string[] = [];
const releaseSha = "a".repeat(40);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function migrationDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ueb-core-phase9-ledger-"));
  temporaryDirectories.push(root);
  for (const [name, sql] of [
    ["20260101000000_one", "CREATE TABLE one(id integer);\n"],
    ["20260102000000_two", "CREATE TABLE two(id integer);\n"],
  ] as const) {
    const directory = join(root, name);
    await mkdir(directory);
    await writeFile(join(directory, "migration.sql"), sql);
  }
  return root;
}

describe("Phase 9 dynamic migration ledger", () => {
  it("derives ordered count and fingerprint from migration names and SQL", async () => {
    const directory = await migrationDirectory();
    const before = await readSourceMigrationLedger(directory);
    expect(before.count).toBe(2);
    await writeFile(
      join(directory, "20260102000000_two", "migration.sql"),
      "CREATE TABLE two(id bigint);\n",
    );
    const after = await readSourceMigrationLedger(directory);
    expect(after.count).toBe(2);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it("fails closed when database names or checksums differ", async () => {
    const ledger = await readSourceMigrationLedger(await migrationDirectory());
    const rows = ledger.migrations.map((migration) => ({
      migration_name: migration.name,
      checksum: migration.checksum,
      finished_at: new Date(),
      rolled_back_at: null,
    }));
    expect(() => assertDatabaseMigrationRows(ledger, rows)).not.toThrow();
    expect(() =>
      assertDatabaseMigrationRows(ledger, [
        ...rows.slice(0, 1),
        { ...rows[1]!, checksum: "0".repeat(64) },
      ]),
    ).toThrow(/not compatible/u);
  });
});

describe("Phase 9 staging preflight dry-run", () => {
  it("creates a staging-only machine-readable plan with no mutation command", async () => {
    const plan = await createStagingReadOnlyPreflightPlan(
      ["--target=staging", `--release-sha=${releaseSha}`, "--dry-run"],
      {
        verifyRelease: async () => undefined,
        assertClean: async () => undefined,
      },
    );
    expect(plan.target).toBe("staging");
    expect(JSON.stringify(plan)).toContain("ueb-core-staging.cargis.vn");
    expect(JSON.stringify(plan)).toContain("CURRENT_ROLLBACK_IMAGES");
    expect(JSON.stringify(plan)).not.toContain(`ueb-core:${releaseSha}`);
    expect(JSON.stringify(plan)).not.toContain("${RELEASE_SHA}");
    expect(JSON.stringify(plan)).not.toMatch(
      /docker load|compose up|migrate deploy|pg_dump|pg_restore|caddy reload/iu,
    );
  });

  it("rejects production, missing release SHA, and non-dry-run execution", async () => {
    const dependencies = {
      verifyRelease: async () => undefined,
      assertClean: async () => undefined,
    };
    await expect(
      createStagingReadOnlyPreflightPlan(
        ["--target=production", `--release-sha=${releaseSha}`, "--dry-run"],
        dependencies,
      ),
    ).rejects.toThrow();
    await expect(
      createStagingReadOnlyPreflightPlan(
        ["--target=staging", "--dry-run"],
        dependencies,
      ),
    ).rejects.toThrow();
    await expect(
      createStagingReadOnlyPreflightPlan(
        ["--target=staging", `--release-sha=${releaseSha}`],
        dependencies,
      ),
    ).rejects.toThrow();
  });

  it("keeps preflight output free of credential and mutation material", async () => {
    const plan = await createStagingReadOnlyPreflightPlan(
      ["--target=staging", `--release-sha=${releaseSha}`, "--dry-run"],
      {
        verifyRelease: async () => undefined,
        assertClean: async () => undefined,
      },
    );
    expect(JSON.stringify(plan)).not.toMatch(
      /password|token|cookie|database_url|connectionstring/iu,
    );
  });
});

describe("Phase 9 UAT manifest", () => {
  it("keeps the audited case counts and defaults to non-mutating cases", () => {
    expect(PHASE9_UAT_CASES).toHaveLength(29);
    expect(PHASE9_NON_MUTATING_UAT_CASES).toHaveLength(21);
    expect(PHASE9_MUTATING_UAT_CASES).toHaveLength(8);
    const plan = createUatPlan(["--dry-run"]);
    expect(plan.selectedCases).toHaveLength(21);
    expect(plan.selectedCases.every((testCase) => !testCase.dataMutation)).toBe(
      true,
    );
  });

  it("default-denies mutating cases and never infers authorization from env", () => {
    expect(() => createUatPlan(["--dry-run", "--case=P9-UAT-08"])).toThrow(
      /explicit command-line authorization/u,
    );
    expect(() =>
      createUatPlan(["--dry-run"], {
        PHASE9_AUTHORIZE_MUTATING_UAT: "YES",
      }),
    ).toThrow(/cannot be inferred/u);
    expect(
      createUatPlan([
        "--dry-run",
        "--case=P9-UAT-08",
        "--authorize-mutating-uat",
      ]).selectedCases,
    ).toHaveLength(1);
  });

  it("contains no real credential or test identity material", () => {
    expect(JSON.stringify(PHASE9_UAT_CASES)).not.toMatch(
      /@|bearer\s|postgresql:\/\/|(?:password|token|cookie|secret)["']?\s*[:=]/iu,
    );
  });
});

describe("Phase 9 repository contract guards", () => {
  it("requires operator source SHA and dynamic ledger build arguments", async () => {
    const dockerfile = await readFile("Dockerfile.operator", "utf8");
    expect(dockerfile).toContain("ARG UEB_CORE_SOURCE_GIT_SHA");
    expect(dockerfile).toContain("ARG UEB_CORE_MIGRATION_LEDGER_FINGERPRINT");
    expect(dockerfile).toContain("ARG UEB_CORE_MIGRATION_COUNT");
    expect(dockerfile).toContain("/operator/.source-git-sha");
    expect(dockerfile).toContain("/operator/.migration-ledger.json");
    const appDockerfile = await readFile("Dockerfile", "utf8");
    expect(appDockerfile).toContain("ARG UEB_CORE_SOURCE_GIT_SHA");
    expect(appDockerfile).toContain(
      'org.opencontainers.image.revision="${UEB_CORE_SOURCE_GIT_SHA}"',
    );
    expect(appDockerfile).toContain(
      'io.ueb-core.migration-ledger-fingerprint="${UEB_CORE_MIGRATION_LEDGER_FINGERPRINT}"',
    );
  });

  it("removes the legacy feature-branch dependency", async () => {
    const deployment = await readFile(
      "scripts/phase-6/lib/staging-deployment.ts",
      "utf8",
    );
    expect(deployment).not.toContain("feat/phase-6-staging-rollout-validation");
    expect(deployment).not.toMatch(/EXPECTED_BRANCH/u);
  });

  it("fails closed when operator source SHA or ledger evidence differs", async () => {
    const ledger = await readSourceMigrationLedger(await migrationDirectory());
    const imageContract = {
      sourceGitSha: releaseSha,
      migrationCount: ledger.count,
      migrationLedgerFingerprint: ledger.fingerprint,
    };
    expect(() =>
      assertOperatorImageContract({
        approvedReleaseSha: releaseSha,
        sourceLedger: ledger,
        imageContract,
      }),
    ).not.toThrow();
    expect(() =>
      assertOperatorImageContract({
        approvedReleaseSha: "b".repeat(40),
        sourceLedger: ledger,
        imageContract,
      }),
    ).toThrow(/source SHA/u);
    expect(() =>
      assertOperatorImageContract({
        approvedReleaseSha: releaseSha,
        sourceLedger: ledger,
        imageContract: {
          ...imageContract,
          migrationLedgerFingerprint: "0".repeat(64),
        },
      }),
    ).toThrow(/migration ledger/u);
  });
});
