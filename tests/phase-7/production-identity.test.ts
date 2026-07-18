// @vitest-environment node

import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  auditCanonicalPersonnel,
  buildProductionRoster,
  compareProductionIdentityState,
  normalizeIdentityEmail,
  PHASE7_SECURE_INPUT_NAMES,
  productionIdentityManifestSchema,
  PRODUCTION_UNIT_CODES,
  TEST_LEADER_EMAIL,
  TEST_LECTURER_EMAIL,
  type CanonicalPersonnelAudit,
  type ProductionIdentityManifest,
  type ProductionIdentityState,
} from "../../scripts/phase-7/lib/production-identity";
import { runProductionIdentityCheck } from "../../scripts/phase-7/production-identity-check";
import type { PreparedSource } from "../../scripts/phase-2/lib/row-parser";

const canonicalChecksum = "a".repeat(64);

describe("Phase 7 production identity roster", () => {
  it("normalizes only Unicode, surrounding whitespace and email case", () => {
    expect(normalizeIdentityEmail("  GIANG.VIEN@VNU.EDU.VN\u00a0")).toBe(
      "giang.vien@vnu.edu.vn",
    );
    expect(normalizeIdentityEmail("given+tag@vnu.edu.vn")).toBe(
      "given+tag@vnu.edu.vn",
    );
  });

  it("blocks ambiguous canonical names and non-VNU lecturer email without selecting a value", () => {
    const prepared = {
      sourceSha256: canonicalChecksum,
      headers: Array.from({ length: 20 }, (_, index) => `column_${index}`),
      violations: [],
      rows: [
        canonicalRow(2, "Lecturer A"),
        canonicalRow(3, "Lecturer A Variant"),
      ],
    } as unknown as PreparedSource;
    const audit = auditCanonicalPersonnel(prepared);

    expect(audit.identities).toEqual([]);
    expect(audit.summary).toMatchObject({
      distinctLecturerUidCount: 1,
      distinctNormalizedEmailCount: 1,
      nonVnuLecturerCount: 1,
      duplicateRecordGroupCount: 0,
    });
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SOURCE_ROW_COUNT_MISMATCH" }),
        expect.objectContaining({ code: "DISPLAY_NAME_AMBIGUOUS" }),
        expect.objectContaining({ code: "NON_VNU_EMAIL" }),
      ]),
    );
  });

  it("applies only explicit UID-scoped email and display-name decisions", () => {
    const lecturerUid = "11111111-1111-4111-8111-111111111111";
    const prepared = {
      sourceSha256: canonicalChecksum,
      headers: Array.from({ length: 20 }, (_, index) => `column_${index}`),
      violations: [],
      rows: [
        canonicalRow(2, "Lecturer A"),
        canonicalRow(3, "Lecturer A Variant"),
      ],
    } as unknown as PreparedSource;
    const audit = auditCanonicalPersonnel(prepared, {
      approvedNonVnuLecturerUids: new Set([lecturerUid]),
      displayNameByLecturerUid: new Map([[lecturerUid, "Lecturer A"]]),
    });

    expect(audit.identities).toHaveLength(1);
    expect(audit.identities[0]).toMatchObject({
      lecturerUid,
      normalizedEmail: "lecturer@gmail.com",
      displayName: "Lecturer A",
    });
    expect(audit.issues.map(({ code }) => code)).not.toContain("NON_VNU_EMAIL");
    expect(audit.issues.map(({ code }) => code)).not.toContain(
      "DISPLAY_NAME_AMBIGUOUS",
    );
  });

  it("builds a deterministic roster with six real leaders and two test identities", () => {
    const first = buildProductionRoster({
      canonicalAudit: canonicalAudit(),
      manifest: manifest(),
      environment: secureEnvironment(),
    });
    const second = buildProductionRoster({
      canonicalAudit: canonicalAudit(),
      manifest: {
        ...manifest(),
        facultyLeaders: [...manifest().facultyLeaders].reverse(),
      },
      environment: secureEnvironment(),
    });

    expect(first.issues).toEqual([]);
    expect(first.counts).toEqual({
      lecturer: 1,
      facultyLeader: 6,
      testIdentity: 2,
      admin: 0,
      total: 9,
    });
    expect(first.rosterSha256).toBe(second.rosterSha256);
    expect(
      first.identities.find(
        ({ normalizedEmail }) => normalizedEmail === TEST_LECTURER_EMAIL,
      ),
    ).toMatchObject({
      identityType: "LECTURER",
      testIdentity: true,
      unitCode: "KTPT",
      requirePasswordChange: true,
    });
    expect(
      first.identities.find(
        ({ normalizedEmail }) => normalizedEmail === TEST_LEADER_EMAIL,
      ),
    ).toMatchObject({
      identityType: "FACULTY_LEADER",
      testIdentity: true,
      unitCode: "KTPT",
      requirePasswordChange: true,
    });
  });

  it("requires explicit leader forced-change flags and rejects unknown manifest fields", () => {
    const missingFlag = structuredClone(manifest()) as Record<string, unknown>;
    const leaders = missingFlag.facultyLeaders as Array<
      Record<string, unknown>
    >;
    delete leaders[0]!.requirePasswordChange;
    expect(
      productionIdentityManifestSchema.safeParse(missingFlag).success,
    ).toBe(false);
    expect(
      productionIdentityManifestSchema.safeParse({
        ...manifest(),
        unexpectedField: true,
      }).success,
    ).toBe(false);
  });

  it("blocks missing leader coverage, identity collisions and missing secrets", () => {
    const invalidManifest = manifest();
    invalidManifest.facultyLeaders[5] = {
      ...invalidManifest.facultyLeaders[5]!,
      unitCode: "KTPT",
      email: TEST_LECTURER_EMAIL,
    };
    const result = buildProductionRoster({
      canonicalAudit: canonicalAudit(),
      manifest: invalidManifest,
      environment: {},
    });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "LEADER_UNIT_COVERAGE_INVALID" }),
        expect.objectContaining({ code: "IDENTITY_EMAIL_COLLISION" }),
        expect.objectContaining({
          code: "SECRET_MISSING_OR_INVALID",
          count: 7,
        }),
      ]),
    );
  });
});

describe("Phase 7 production identity reconciliation", () => {
  it("plans creates in dry-run without treating an absent target row as drift", () => {
    const roster = buildProductionRoster({
      canonicalAudit: canonicalAudit(),
      manifest: manifest(),
      environment: secureEnvironment(),
    });
    const comparison = compareProductionIdentityState({
      roster,
      state: state([]),
      mode: "DRY_RUN",
    });

    expect(comparison.createPlannedCount).toBe(9);
    expect(comparison.issues).toEqual([]);
  });

  it("supports a planned empty target without a fake fingerprint and blocks reconciliation", () => {
    const roster = buildProductionRoster({
      canonicalAudit: canonicalAudit(),
      manifest: manifest(),
      environment: secureEnvironment(),
    });
    const plannedState: ProductionIdentityState = {
      snapshotVersion: 1,
      transactionMode: "READ_ONLY",
      targetEnvironment: "PRODUCTION",
      targetMode: "PLANNED_EMPTY_TARGET",
      targetFingerprint: null,
      canonicalCoreRowCount: null,
      identities: [],
    };

    const dryRun = compareProductionIdentityState({
      roster,
      state: plannedState,
      mode: "DRY_RUN",
    });
    expect(dryRun.createPlannedCount).toBe(9);
    expect(dryRun.issues).toEqual([]);

    const reconciliation = compareProductionIdentityState({
      roster,
      state: plannedState,
      mode: "RECONCILE",
    });
    expect(reconciliation.issues).toContainEqual(
      expect.objectContaining({
        code: "PLANNED_EMPTY_TARGET_RECONCILIATION_UNAVAILABLE",
      }),
    );
  });

  it("requires exact mapping, role, scope, forced-change flag and audit evidence", () => {
    const roster = buildProductionRoster({
      canonicalAudit: canonicalAudit(),
      manifest: manifest(),
      environment: secureEnvironment(),
    });
    const identities: ProductionIdentityState["identities"] =
      roster.identities.map((identity) => ({
        email: identity.normalizedEmail,
        displayName: identity.displayName,
        status: "ACTIVE" as const,
        lecturerUid:
          identity.identityType === "LECTURER" ? identity.lecturerUid : null,
        mustChangePassword: identity.requirePasswordChange,
        activeRoles: [identity.identityType],
        activeUnitCodes:
          identity.identityType === "FACULTY_LEADER" ? [identity.unitCode] : [],
        provisioningAuditEventCount: 1,
        testIdentityMarker: identity.testIdentity,
      }));
    const passing = compareProductionIdentityState({
      roster,
      state: state(identities),
      mode: "RECONCILE",
    });
    expect(passing.issues).toEqual([]);
    expect(passing.unchangedCount).toBe(9);

    const drifted = identities.map((identity, index) =>
      index === 0
        ? {
            ...identity,
            activeRoles: [...identity.activeRoles, "ADMIN" as const],
            provisioningAuditEventCount: 0,
          }
        : identity,
    );
    const blocked = compareProductionIdentityState({
      roster,
      state: state(drifted),
      mode: "RECONCILE",
    });
    expect(blocked.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "IDENTITY_STATE_MISMATCH" }),
      ]),
    );
  });

  it("reports only missing secure input names when inputs are unavailable", async () => {
    const result = await runProductionIdentityCheck({
      mode: "DRY_RUN",
      environment: {},
    });

    expect(result.exitCode).toBe(2);
    expect(result.report).toContain(
      `MISSING_INPUT_1=${PHASE7_SECURE_INPUT_NAMES.canonicalSourceFile}`,
    );
    expect(result.report).toContain("DATABASE_CONNECTIONS=0");
    expect(result.report).not.toContain("undefined");
  });
});

function canonicalAudit(): CanonicalPersonnelAudit {
  return {
    identities: [
      {
        sourceRowReference: "canonical-rows:1:opaque",
        lecturerUid: "11111111-1111-4111-8111-111111111111",
        normalizedEmail: "lecturer@vnu.edu.vn",
        displayName: "Lecturer One",
        unitCode: "KTPT",
        requirePasswordChange: true,
        identityType: "LECTURER",
        testIdentity: false,
      },
    ],
    issues: [],
    summary: {
      sourceRowCount: 2_497,
      sourceColumnCount: 20,
      sourceChecksum: canonicalChecksum,
      distinctLecturerUidCount: 1,
      distinctNormalizedEmailCount: 1,
      vnuLecturerCount: 1,
      nonVnuLecturerCount: 0,
      duplicateRecordGroupCount: 0,
      duplicateRecordRowCount: 0,
      employmentStatusColumnPresent: false,
    },
  };
}

function manifest(): ProductionIdentityManifest {
  return {
    manifestVersion: 1,
    changeReference: "CHANGE-OPAQUE-001",
    canonicalSourceSha256: canonicalChecksum,
    facultyLeaders: PRODUCTION_UNIT_CODES.map((unitCode, index) => ({
      email: `leader-${index + 1}@example.edu.vn`,
      displayName: `Leader ${index + 1}`,
      unitCode,
      requirePasswordChange: index % 2 === 0,
      passwordSecretReference:
        PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode],
    })),
    testLecturer: {
      email: TEST_LECTURER_EMAIL,
      displayName: "KTPT Test Lecturer",
      lecturerUid: "22222222-2222-4222-8222-222222222222",
      requirePasswordChange: true,
      passwordSecretReference: PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
    },
    testLeader: {
      email: TEST_LEADER_EMAIL,
      displayName: "KTPT Test Leader",
      unitCode: "KTPT",
      requirePasswordChange: true,
      passwordSecretReference: PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
    },
  };
}

function secureEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {
    [PHASE7_SECURE_INPUT_NAMES.lecturerPassword]: randomInitialPassword(),
  };
  for (const unitCode of PRODUCTION_UNIT_CODES) {
    environment[PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode]] =
      randomInitialPassword();
  }
  return environment;
}

function randomInitialPassword(): string {
  return `${randomBytes(24).toString("base64url")}Aa1!`;
}

function state(
  identities: ProductionIdentityState["identities"],
): ProductionIdentityState {
  return {
    snapshotVersion: 1,
    transactionMode: "READ_ONLY",
    targetEnvironment: "PRODUCTION",
    targetMode: "EXISTING_TARGET",
    targetFingerprint: "b".repeat(64),
    canonicalCoreRowCount: 2_497,
    identities,
  };
}

function canonicalRow(sourceRowNumber: number, displayName: string): object {
  return {
    sourceRowNumber,
    lecturerUid: "11111111-1111-4111-8111-111111111111",
    businessValues: {
      email_tai_khoan_vnu: "lecturer@gmail.com",
      ten_giang_vien: displayName,
      don_vi: "Khoa KTPT",
    },
    orderedValues: [sourceRowNumber, displayName, "lecturer@gmail.com"],
  };
}
