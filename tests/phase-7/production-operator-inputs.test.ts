// @vitest-environment node

import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createFacultyLeaderTemplate,
  createLecturerExceptionTemplate,
  createSecretsTemplate,
  createTargetStateTemplate,
  createTestIdentityTemplate,
  parseSecretsFile,
  validateOperatorInputs,
  type ExpectedLecturerExceptionInventory,
} from "../../scripts/phase-7/lib/production-operator-inputs";
import {
  PHASE7_SECURE_INPUT_NAMES,
  PRODUCTION_UNIT_CODES,
} from "../../scripts/phase-7/lib/production-identity";
import { runProductionRosterWorkflow } from "../../scripts/phase-7/production-roster-workflow";

const expected: ExpectedLecturerExceptionInventory = {
  canonicalSourceSha256: "a".repeat(64),
  nonVnu: [
    {
      lecturerUid: "11111111-1111-4111-8111-111111111111",
      sourceRowReference: "canonical-rows:3:email",
      sourceEmail: "approved-exception@example.edu.vn",
    },
  ],
  ambiguousNames: [
    {
      lecturerUid: "22222222-2222-4222-8222-222222222222",
      sourceRowReference: "canonical-rows:4:name",
      candidateDisplayNames: ["Lecturer A", "Lecturer A Variant"],
    },
  ],
};

describe("Phase 7 split operator inputs", () => {
  it("creates templates with fixed identities/references and no secret values", () => {
    const lecturerExceptions = createLecturerExceptionTemplate(expected);
    const leaders = createFacultyLeaderTemplate();
    const tests = createTestIdentityTemplate();
    const state = createTargetStateTemplate();

    expect(lecturerExceptions.emailExceptions).toHaveLength(1);
    expect(lecturerExceptions.emailExceptions[0]?.decision).toBeNull();
    expect(lecturerExceptions.displayNameResolutions).toHaveLength(1);
    expect(leaders.records.map(({ unitCode }) => unitCode)).toEqual(
      PRODUCTION_UNIT_CODES,
    );
    expect(leaders.records.every(({ email }) => email === null)).toBe(true);
    expect(tests.lecturer.roles).toEqual(["LECTURER"]);
    expect(tests.leader.roles).toEqual(["FACULTY_LEADER"]);
    expect(tests.leader.unitScopes).toEqual(["KTPT"]);
    expect(state.snapshotStatus).toBe("OPERATOR_INPUT_REQUIRED");
    expect(state.targetMode).toBe("EXISTING_TARGET");
    expect(parseSecretsFile(createSecretsTemplate())).toEqual(
      Object.fromEntries(
        [
          PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
          ...PRODUCTION_UNIT_CODES.map(
            (unitCode) => PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode],
          ),
        ].map((name) => [name, ""]),
      ),
    );
  });

  it("records pending verification as an explicit fail-closed decision", () => {
    const lecturerExceptions = createLecturerExceptionTemplate(expected);
    lecturerExceptions.emailExceptions[0] = {
      ...lecturerExceptions.emailExceptions[0]!,
      decision: "KEEP_BLOCKED_PENDING_VERIFICATION",
      justification: "Pending authoritative personnel-directory verification",
    };
    const result = validateOperatorInputs({
      expected,
      lecturerExceptions,
      facultyLeaders: createFacultyLeaderTemplate(),
      testIdentities: createTestIdentityTemplate(),
      targetState: createTargetStateTemplate(),
      secrets: parseSecretsFile(createSecretsTemplate()),
    });

    expect(result.conflictCodes).toContain(
      "LECTURER_EMAIL_EXCEPTION_PENDING_VERIFICATION",
    );
    expect(result.missingInputs).not.toContain(
      "lecturer-exceptions.json.emailExceptions.canonical-rows:3:email.decision",
    );
  });

  it("reports every missing operator decision without inventing values", () => {
    const result = validateOperatorInputs({
      expected,
      lecturerExceptions: createLecturerExceptionTemplate(expected),
      facultyLeaders: createFacultyLeaderTemplate(),
      testIdentities: createTestIdentityTemplate(),
      targetState: createTargetStateTemplate(),
      secrets: parseSecretsFile(createSecretsTemplate()),
    });

    expect(result.conflictCodes).toEqual([]);
    expect(result.missingInputs).toEqual(
      expect.arrayContaining([
        "lecturer-exceptions.json.emailExceptions.canonical-rows:3:email.decision",
        "lecturer-exceptions.json.displayNameResolutions.canonical-rows:4:name.selectedDisplayName",
        "faculty-leaders.json.KTPT.email",
        "faculty-leaders.json.KTPT.requirePasswordChange",
        "faculty-leaders.json.changeReference",
        "test-identities.json.lecturer.lecturerUid",
        "production-target-state.json.snapshotStatus",
        `phase7-secrets.env.${PHASE7_SECURE_INPUT_NAMES.lecturerPassword}`,
      ]),
    );
    expect(result.manifest).toBeUndefined();
  });

  it("builds typed resolutions only after all explicit inputs are complete", () => {
    const lecturerExceptions = createLecturerExceptionTemplate(expected);
    lecturerExceptions.emailExceptions[0] = {
      ...lecturerExceptions.emailExceptions[0]!,
      decision: "APPROVE_EXCEPTION",
      justification: "Approved external institutional identity",
    };
    lecturerExceptions.displayNameResolutions[0] = {
      ...lecturerExceptions.displayNameResolutions[0]!,
      selectedDisplayName: "Lecturer A",
    };
    const facultyLeaders = createFacultyLeaderTemplate();
    facultyLeaders.changeReference = "PHASE7-CHANGE-REFERENCE";
    facultyLeaders.records = facultyLeaders.records.map((record) => ({
      ...record,
      email: `${record.unitCode.toLowerCase()}-leader@example.edu.vn`,
      displayName: `${record.unitCode} Leader`,
      requirePasswordChange: true,
    }));
    const testIdentities = createTestIdentityTemplate();
    testIdentities.lecturer.displayName = "KTPT Test Lecturer";
    testIdentities.lecturer.lecturerUid =
      "33333333-3333-4333-8333-333333333333";
    testIdentities.leader.displayName = "KTPT Test Leader";
    const targetState = createTargetStateTemplate();
    targetState.snapshotStatus = "READY";
    targetState.targetFingerprint = "b".repeat(64);
    targetState.canonicalCoreRowCount = 2_497;
    const secrets: Record<string, string> = {};
    for (const name of [
      PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
      ...PRODUCTION_UNIT_CODES.map(
        (unitCode) => PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode],
      ),
    ]) {
      secrets[name] = `${randomBytes(24).toString("base64url")}Aa1!`;
    }

    const result = validateOperatorInputs({
      expected,
      lecturerExceptions,
      facultyLeaders,
      testIdentities,
      targetState,
      secrets,
    });

    expect(result.missingInputs).toEqual([]);
    expect(result.conflictCodes).toEqual([]);
    expect(result.manifest?.facultyLeaders).toHaveLength(6);
    expect(
      result.resolutions?.approvedNonVnuLecturerUids?.has(
        expected.nonVnu[0]!.lecturerUid,
      ),
    ).toBe(true);
    expect(result.state?.canonicalCoreRowCount).toBe(2_497);

    const plannedEmptyResult = validateOperatorInputs({
      expected,
      lecturerExceptions,
      facultyLeaders,
      testIdentities,
      targetState: {
        ...targetState,
        targetMode: "PLANNED_EMPTY_TARGET",
        targetFingerprint: null,
        canonicalCoreRowCount: null,
        identities: [],
      },
      secrets,
    });
    expect(plannedEmptyResult.missingInputs).toEqual([]);
    expect(plannedEmptyResult.conflictCodes).toEqual([]);
    expect(plannedEmptyResult.state).toMatchObject({
      targetMode: "PLANNED_EMPTY_TARGET",
      targetFingerprint: null,
      canonicalCoreRowCount: null,
      identities: [],
    });
  });

  it("fails closed before reading files when the secure directory is missing", async () => {
    const result = await runProductionRosterWorkflow({
      mode: "DRY_RUN",
      secureDirectory: undefined,
    });
    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("MISSING_INPUT_1=PHASE7_SECURE_DIRECTORY");
    expect(result.report).toContain("DATABASE_MUTATIONS=0");
  });
});
