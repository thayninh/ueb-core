// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  applyProductionIdentitiesAtomically,
  formatProductionIdentityApplyFailure,
  parseProductionIdentityApplyCommand,
  PRODUCTION_IDENTITY_APPLY_CONTRACT,
  runProductionIdentityApply,
  SafeProductionIdentityApplyError,
  type ExistingProductionIdentity,
  type PreparedProductionIdentity,
  type ProductionIdentityApplyDatabase,
  type ProductionIdentityApplyTransaction,
  type ProductionIdentityStateSnapshot,
} from "../../scripts/phase-7/lib/production-identity-apply";
import {
  PHASE7_SECURE_INPUT_NAMES,
  PRODUCTION_UNIT_CODES,
  type ProductionIdentity,
  type ProductionIdentityManifest,
  type ProductionRosterResult,
} from "../../scripts/phase-7/lib/production-identity";

const gitSha = "a".repeat(40);
const passwordValue = "must-not-leak-password";

describe("Phase 7 guarded production identity apply", () => {
  it("requires explicit confirmation", () => {
    expect(() =>
      parseProductionIdentityApplyCommand(
        baseArguments().filter(
          (argument) => argument !== "--confirm-production-identity-apply",
        ),
      ),
    ).toThrow(/PRODUCTION_IDENTITY_CONFIRMATION_REQUIRED/u);
  });

  it("rejects wrong database and roster SHA", () => {
    expect(() =>
      parseProductionIdentityApplyCommand(
        replace(
          baseArguments(),
          "--target-database=",
          "--target-database=ueb_core",
        ),
      ),
    ).toThrow(/PRODUCTION_IDENTITY_DATABASE_FORBIDDEN/u);
    expect(() =>
      parseProductionIdentityApplyCommand(
        replace(
          baseArguments(),
          "--roster-manifest-sha=",
          `--roster-manifest-sha=${"b".repeat(64)}`,
        ),
      ),
    ).toThrow(/PRODUCTION_IDENTITY_IMMUTABLE_INPUT_MISMATCH/u);
  });

  it("blocks malformed and inactive change windows before database access", async () => {
    expect(() =>
      parseProductionIdentityApplyCommand(
        replace(
          baseArguments(),
          "--change-window-start=",
          "--change-window-start=not-a-date",
        ),
      ),
    ).toThrow(/PRODUCTION_CHANGE_WINDOW_INVALID/u);
    const database = fakeDatabase();
    await expect(
      runProductionIdentityApply({
        command: parseProductionIdentityApplyCommand(baseArguments()),
        environment: { PHASE7_SECURE_DIRECTORY: "/secure" },
        now: new Date("2026-07-19T00:59:59+07:00"),
        sourceSha: async () => gitSha,
        database,
      }),
    ).rejects.toThrow(/PRODUCTION_CHANGE_WINDOW_NOT_STARTED/u);
    expect(database.transactionCount()).toBe(0);
  });

  it("fails closed on a dry-run blocker or conflict without opening a transaction", async () => {
    const database = fakeDatabase();
    const loadRoster = vi.fn(async () => {
      throw new SafeProductionIdentityApplyError("ROSTER_BLOCK_OR_CONFLICT");
    });
    await expect(
      runProductionIdentityApply({
        command: parseProductionIdentityApplyCommand(baseArguments()),
        environment: { PHASE7_SECURE_DIRECTORY: "/secure" },
        now: new Date("2026-07-19T02:00:00+07:00"),
        sourceSha: async () => gitSha,
        loadRoster: loadRoster as never,
        database,
      }),
    ).rejects.toThrow(/PRODUCTION_IDENTITY_DRY_RUN_OR_RECONCILIATION_BLOCKED/u);
    expect(database.transactionCount()).toBe(0);
  });

  it("rolls back the complete batch on one create failure", async () => {
    const roster = productionRoster();
    const database = fakeDatabase({ failAtCreate: 18 });
    const error = await applyProductionIdentitiesAtomically({
      database,
      command: parseProductionIdentityApplyCommand(baseArguments()),
      roster,
      prepared: prepare(roster),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SafeProductionIdentityApplyError);
    expect((error as Error).message).toMatch(
      /PRODUCTION_IDENTITY_TRANSACTION_ROLLED_BACK/u,
    );
    expect(formatProductionIdentityApplyFailure(error)).toContain(
      "DATABASE_MUTATIONS=0",
    );
    expect(database.committedState().identities).toHaveLength(0);
  });

  it("creates all expected identities atomically and reruns as an idempotent NOOP", async () => {
    const roster = productionRoster();
    const database = fakeDatabase();
    const command = parseProductionIdentityApplyCommand(baseArguments());
    const first = await applyProductionIdentitiesAtomically({
      database,
      command,
      roster,
      prepared: prepare(roster),
    });
    const second = await applyProductionIdentitiesAtomically({
      database,
      command,
      roster,
      prepared: prepare(roster),
    });
    expect(first.mode).toBe("CREATED");
    expect(second.mode).toBe("NOOP");
    expect(database.committedState().identities).toHaveLength(254);
    expect(database.createCount()).toBe(254);
  });

  it("reports exact aggregate counts without roster or secret leakage", async () => {
    const roster = productionRoster();
    const database = fakeDatabase();
    const result = await runProductionIdentityApply({
      command: parseProductionIdentityApplyCommand(baseArguments()),
      environment: { PHASE7_SECURE_DIRECTORY: "/secure" },
      now: new Date("2026-07-19T02:00:00+07:00"),
      sourceSha: async () => gitSha,
      loadRoster: (async () => ({
        roster,
        manifest: productionManifest(),
        state: {
          targetMode: "PLANNED_EMPTY_TARGET",
          snapshotVersion: 1,
          transactionMode: "READ_ONLY",
          targetEnvironment: "PRODUCTION",
          targetFingerprint: null,
          canonicalCoreRowCount: null,
          identities: [],
        },
        secrets: secretEnvironment(),
        emailExceptionCount: 1,
        ambiguityCount: 5,
      })) as never,
      passwordHasher: async () => "supported-password-hash",
      database,
    });
    expect(result.report).toContain("AUTH_USER_COUNT=254");
    expect(result.report).toContain("ACCESS_PROFILE_COUNT=254");
    expect(result.report).toContain("LECTURER_MAPPING_COUNT=247");
    expect(result.report).toContain("LEADER_ROLE_COUNT=7");
    expect(result.report).toContain("LEADER_SCOPE_COUNT=7");
    expect(result.report).toContain("MUST_CHANGE_PASSWORD_COUNT=254");
    expect(result.report).toContain("ADMIN_ROLE_COUNT=0");
    expect(result.report).toContain("ACTIVE_SESSION_COUNT=0");
    expect(result.report).not.toContain(passwordValue);
    expect(result.report).not.toMatch(/@example\.invalid|@vnu\.edu\.vn/u);
  });

  it("redacts unknown failures and never renders credentials", () => {
    const report = formatProductionIdentityApplyFailure(
      new Error(`postgresql://user:${passwordValue}@host/database`),
    );
    expect(report).toContain("PRODUCTION_IDENTITY_APPLY=BLOCKED");
    expect(report).not.toContain(passwordValue);
    expect(report).not.toContain("postgresql://");
  });
});

function baseArguments(): string[] {
  return [
    `--target-database=${PRODUCTION_IDENTITY_APPLY_CONTRACT.database}`,
    `--authorization-reference=${PRODUCTION_IDENTITY_APPLY_CONTRACT.authorization}`,
    "--change-window-start=2026-07-19T01:00:00+07:00",
    "--change-window-end=2026-07-19T05:00:00+07:00",
    `--expected-git-sha=${gitSha}`,
    `--roster-manifest-sha=${PRODUCTION_IDENTITY_APPLY_CONTRACT.rosterManifestSha}`,
    `--canonical-checksum=${PRODUCTION_IDENTITY_APPLY_CONTRACT.canonicalChecksum}`,
    "--confirm-production-identity-apply",
  ];
}

function replace(
  args: readonly string[],
  prefix: string,
  replacement: string,
): string[] {
  return args.map((argument) =>
    argument.startsWith(prefix) ? replacement : argument,
  );
}

function productionRoster(): ProductionRosterResult {
  const lecturers: ProductionIdentity[] = Array.from(
    { length: 246 },
    (_, index) => ({
      sourceRowReference: `opaque-${index}`,
      lecturerUid: uuid(index + 1),
      normalizedEmail: `lecturer-${index}@example.invalid`,
      displayName: `Lecturer ${index}`,
      unitCode: PRODUCTION_UNIT_CODES[index % PRODUCTION_UNIT_CODES.length]!,
      requirePasswordChange: true,
      identityType: "LECTURER",
      testIdentity: false,
    }),
  );
  const leaders: ProductionIdentity[] = PRODUCTION_UNIT_CODES.map(
    (unitCode, index) => ({
      normalizedEmail: `leader-${index}@example.invalid`,
      displayName: `Leader ${index}`,
      unitCode,
      requirePasswordChange: true,
      identityType: "FACULTY_LEADER",
      testIdentity: false,
    }),
  );
  const identities: ProductionIdentity[] = [
    ...lecturers,
    {
      sourceRowReference: "OPERATOR_TEST_IDENTITY",
      lecturerUid: uuid(500),
      normalizedEmail: "testgiangvien@vnu.edu.vn",
      displayName: "Test Lecturer",
      unitCode: "KTPT",
      requirePasswordChange: true,
      identityType: "LECTURER",
      testIdentity: true,
    },
    ...leaders,
    {
      normalizedEmail: "testlanhdao@vnu.edu.vn",
      displayName: "Test Leader",
      unitCode: "KTPT",
      requirePasswordChange: true,
      identityType: "FACULTY_LEADER",
      testIdentity: true,
    },
  ];
  return {
    identities,
    issues: [],
    rosterSha256: PRODUCTION_IDENTITY_APPLY_CONTRACT.rosterManifestSha,
    counts: {
      lecturer: 246,
      facultyLeader: 6,
      testIdentity: 2,
      admin: 0,
      total: 254,
    },
  };
}

function productionManifest(): ProductionIdentityManifest {
  return {
    manifestVersion: 1,
    changeReference: "TEST",
    canonicalSourceSha256: PRODUCTION_IDENTITY_APPLY_CONTRACT.canonicalChecksum,
    facultyLeaders: PRODUCTION_UNIT_CODES.map((unitCode, index) => ({
      email: `leader-${index}@example.invalid`,
      displayName: `Leader ${index}`,
      unitCode,
      requirePasswordChange: true,
      passwordSecretReference:
        PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode],
    })),
    testLecturer: {
      email: "testgiangvien@vnu.edu.vn",
      displayName: "Test Lecturer",
      lecturerUid: uuid(500),
      requirePasswordChange: true,
      passwordSecretReference: PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
    },
    testLeader: {
      email: "testlanhdao@vnu.edu.vn",
      displayName: "Test Leader",
      unitCode: "KTPT",
      requirePasswordChange: true,
      passwordSecretReference: PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
    },
  };
}

function secretEnvironment(): Record<string, string> {
  return {
    [PHASE7_SECURE_INPUT_NAMES.lecturerPassword]: passwordValue,
    ...Object.fromEntries(
      PRODUCTION_UNIT_CODES.map((unitCode) => [
        PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode],
        `${passwordValue}-${unitCode}`,
      ]),
    ),
  };
}

function prepare(roster: ProductionRosterResult): PreparedProductionIdentity[] {
  return roster.identities.map((identity) => ({
    identity,
    passwordHash: "supported-password-hash",
  }));
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

function fakeDatabase(
  options: { readonly failAtCreate?: number } = {},
): ProductionIdentityApplyDatabase & {
  committedState(): ProductionIdentityStateSnapshot;
  transactionCount(): number;
  createCount(): number;
} {
  let committed: ProductionIdentityStateSnapshot = emptyState();
  let transactions = 0;
  let creates = 0;
  return {
    async serializable<T>(
      operation: (
        transaction: ProductionIdentityApplyTransaction,
      ) => Promise<T>,
    ): Promise<T> {
      transactions += 1;
      const working: ProductionIdentityStateSnapshot = {
        ...committed,
        identities: [...committed.identities],
        activeUnitIdsByCode: new Map(committed.activeUnitIdsByCode),
      };
      const transaction: ProductionIdentityApplyTransaction = {
        async readState() {
          return working;
        },
        async createIdentity({ prepared, unitId }) {
          creates += 1;
          if (options.failAtCreate === creates) throw new Error("injected");
          const identity = prepared.identity;
          const userId = uuid(10_000 + creates);
          const activeUnitCodes =
            identity.identityType === "FACULTY_LEADER"
              ? [identity.unitCode]
              : [];
          if (identity.identityType === "FACULTY_LEADER" && !unitId) {
            throw new Error("missing-unit");
          }
          const actual: ExistingProductionIdentity = {
            userId,
            email: identity.normalizedEmail,
            displayName: identity.displayName,
            credentialAccountCount: 1,
            credentialPasswordPresent: true,
            profileStatus: "ACTIVE",
            lecturerUid:
              identity.identityType === "LECTURER"
                ? identity.lecturerUid
                : null,
            mustChangePassword: identity.requirePasswordChange,
            createdBySelf: true,
            activeRoles: [identity.identityType],
            roleGrantProvenanceSelf: true,
            activeUnitCodes,
            scopeGrantProvenanceSelf: true,
            matchingAuditEvidenceCount: 1,
            testIdentityMarker: identity.testIdentity,
          };
          (working.identities as ExistingProductionIdentity[]).push(actual);
        },
      };
      const result = await operation(transaction);
      committed = working;
      return result;
    },
    async close() {},
    committedState: () => committed,
    transactionCount: () => transactions,
    createCount: () => creates,
  };
}

function emptyState(): ProductionIdentityStateSnapshot {
  return {
    identities: [],
    activeSessionCount: 0,
    activeUnitIdsByCode: new Map(
      PRODUCTION_UNIT_CODES.map((unitCode, index) => [
        unitCode,
        uuid(900 + index),
      ]),
    ),
  };
}
