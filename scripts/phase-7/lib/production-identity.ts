import { createHash } from "node:crypto";

import { z } from "zod";

import type { PreparedSource } from "../../phase-2/lib/row-parser";
import { isSamplePassword } from "../../../src/lib/auth/provisioning-policy";

export const PRODUCTION_UNIT_CODES = [
  "KTPT",
  "QTKD",
  "KTKDQT",
  "KTCT",
  "TCNH",
  "KTKT",
] as const;

export type ProductionUnitCode = (typeof PRODUCTION_UNIT_CODES)[number];

export const PRODUCTION_UNIT_SOURCE_VALUES: Readonly<
  Record<ProductionUnitCode, string>
> = {
  KTPT: "Khoa KTPT",
  QTKD: "Viện QTKD",
  KTKDQT: "Khoa KT&KDQT",
  KTCT: "Khoa KTCT",
  TCNH: "Khoa TCNH",
  KTKT: "Khoa KTKT",
};

export const PHASE7_SECURE_INPUT_NAMES = {
  canonicalSourceFile: "PHASE7_CANONICAL_SOURCE_FILE",
  identityManifestFile: "PHASE7_IDENTITY_MANIFEST_FILE",
  identityStateFile: "PHASE7_IDENTITY_STATE_FILE",
  lecturerPassword: "PHASE7_SHARED_LECTURER_INITIAL_PASSWORD",
  productionAdminPassword: "PHASE7_PRODUCTION_ADMIN_INITIAL_PASSWORD",
  leaderPasswords: {
    KTPT: "PHASE7_LEADER_KTPT_INITIAL_PASSWORD",
    QTKD: "PHASE7_LEADER_QTKD_INITIAL_PASSWORD",
    KTKDQT: "PHASE7_LEADER_KTKDQT_INITIAL_PASSWORD",
    KTCT: "PHASE7_LEADER_KTCT_INITIAL_PASSWORD",
    TCNH: "PHASE7_LEADER_TCNH_INITIAL_PASSWORD",
    KTKT: "PHASE7_LEADER_KTKT_INITIAL_PASSWORD",
  },
} as const;

export const TEST_LECTURER_EMAIL = "testgiangvien@vnu.edu.vn";
export const TEST_LEADER_EMAIL = "testlanhdao@vnu.edu.vn";

export type ProductionIdentityIssueSeverity = "BLOCKER" | "WARNING";

export type ProductionIdentityIssueCode =
  | "SOURCE_ROW_COUNT_MISMATCH"
  | "SOURCE_CHECKSUM_MISMATCH"
  | "SOURCE_CONTRACT_VIOLATION"
  | "BLANK_LECTURER_UID"
  | "BLANK_EMAIL"
  | "INVALID_EMAIL"
  | "NON_VNU_EMAIL"
  | "MULTIPLE_EMAILS_FOR_LECTURER"
  | "EMAIL_ASSIGNED_TO_MULTIPLE_LECTURERS"
  | "DISPLAY_NAME_AMBIGUOUS"
  | "UNIT_AMBIGUOUS"
  | "UNKNOWN_UNIT"
  | "EMAIL_NORMALIZATION_REQUIRED"
  | "UNICODE_OR_WHITESPACE_NORMALIZATION_REQUIRED"
  | "TEST_LIKE_CANONICAL_EMAIL"
  | "EMPLOYMENT_STATUS_UNAVAILABLE"
  | "MANIFEST_INVALID"
  | "MANIFEST_SOURCE_CHECKSUM_MISMATCH"
  | "LEADER_UNIT_COVERAGE_INVALID"
  | "IDENTITY_EMAIL_COLLISION"
  | "TEST_LECTURER_UID_COLLISION"
  | "SECRET_MISSING_OR_INVALID"
  | "STATE_INVALID"
  | "STATE_CORE_ROW_COUNT_MISMATCH"
  | "STATE_DUPLICATE_EMAIL"
  | "STATE_DUPLICATE_LECTURER_UID"
  | "PLANNED_EMPTY_TARGET_RECONCILIATION_UNAVAILABLE"
  | "IDENTITY_STATE_MISMATCH"
  | "UNEXPECTED_TARGET_IDENTITY"
  | "PROVISIONING_AUDIT_EVIDENCE_MISSING";

export interface ProductionIdentityIssue {
  readonly severity: ProductionIdentityIssueSeverity;
  readonly code: ProductionIdentityIssueCode;
  readonly count: number;
}

export interface ProductionLecturerIdentity {
  readonly sourceRowReference: string;
  readonly lecturerUid: string;
  readonly normalizedEmail: string;
  readonly displayName: string;
  readonly unitCode: ProductionUnitCode;
  readonly requirePasswordChange: true;
  readonly identityType: "LECTURER";
  readonly testIdentity: false;
}

export interface ProductionTestLecturerIdentity {
  readonly sourceRowReference: "OPERATOR_TEST_IDENTITY";
  readonly lecturerUid: string;
  readonly normalizedEmail: typeof TEST_LECTURER_EMAIL;
  readonly displayName: string;
  readonly unitCode: "KTPT";
  readonly requirePasswordChange: true;
  readonly identityType: "LECTURER";
  readonly testIdentity: true;
}

export interface ProductionFacultyLeaderIdentity {
  readonly normalizedEmail: string;
  readonly displayName: string;
  readonly unitCode: ProductionUnitCode;
  readonly requirePasswordChange: boolean;
  readonly identityType: "FACULTY_LEADER";
  readonly testIdentity: boolean;
}

export interface ProductionAdminIdentity {
  readonly normalizedEmail: string;
  readonly displayName: string;
  readonly requirePasswordChange: false;
  readonly identityType: "ADMIN";
  readonly testIdentity: false;
}

export type ProductionIdentity =
  | ProductionLecturerIdentity
  | ProductionTestLecturerIdentity
  | ProductionFacultyLeaderIdentity
  | ProductionAdminIdentity;

export interface CanonicalPersonnelAudit {
  readonly identities: readonly ProductionLecturerIdentity[];
  readonly issues: readonly ProductionIdentityIssue[];
  readonly summary: {
    readonly sourceRowCount: number;
    readonly sourceColumnCount: number;
    readonly sourceChecksum: string;
    readonly distinctLecturerUidCount: number;
    readonly distinctNormalizedEmailCount: number;
    readonly vnuLecturerCount: number;
    readonly nonVnuLecturerCount: number;
    readonly duplicateRecordGroupCount: number;
    readonly duplicateRecordRowCount: number;
    readonly employmentStatusColumnPresent: false;
  };
}

export interface CanonicalPersonnelResolutionOptions {
  readonly approvedNonVnuLecturerUids?: ReadonlySet<string>;
  readonly replacementEmailByLecturerUid?: ReadonlyMap<string, string>;
  readonly excludedLecturerUids?: ReadonlySet<string>;
  readonly displayNameByLecturerUid?: ReadonlyMap<string, string>;
}

const unitCodeSchema = z.enum(PRODUCTION_UNIT_CODES);
const normalizedEmailSchema = z.string().trim().toLowerCase().pipe(z.email());
const displayNameSchema = z.string().trim().min(1).max(256);

const leaderManifestSchema = z
  .object({
    email: normalizedEmailSchema,
    displayName: displayNameSchema,
    unitCode: unitCodeSchema,
    requirePasswordChange: z.boolean(),
    passwordSecretReference: z.string().regex(/^PHASE7_[A-Z0-9_]+$/u),
  })
  .strict();

export const productionIdentityManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    changeReference: z.string().trim().min(1).max(128),
    canonicalSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    facultyLeaders: z.array(leaderManifestSchema).length(6),
    testLecturer: z
      .object({
        email: z.literal(TEST_LECTURER_EMAIL),
        displayName: displayNameSchema,
        lecturerUid: z.uuid(),
        requirePasswordChange: z.literal(true),
        passwordSecretReference: z.literal(
          PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
        ),
      })
      .strict(),
    testLeader: z
      .object({
        email: z.literal(TEST_LEADER_EMAIL),
        displayName: displayNameSchema,
        unitCode: z.literal("KTPT"),
        requirePasswordChange: z.literal(true),
        passwordSecretReference: z.literal(
          PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
        ),
      })
      .strict(),
    productionAdmin: z
      .object({
        email: normalizedEmailSchema,
        displayName: displayNameSchema,
        requirePasswordChange: z.literal(false),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ProductionIdentityManifest = z.infer<
  typeof productionIdentityManifestSchema
>;

const stateIdentitySchema = z
  .object({
    email: normalizedEmailSchema,
    displayName: displayNameSchema,
    status: z.enum(["ACTIVE", "DISABLED", "PENDING_MAPPING"]),
    lecturerUid: z.uuid().nullable(),
    mustChangePassword: z.boolean(),
    activeRoles: z.array(z.enum(["LECTURER", "FACULTY_LEADER", "ADMIN"])),
    activeUnitCodes: z.array(unitCodeSchema),
    provisioningAuditEventCount: z.number().int().nonnegative(),
    testIdentityMarker: z.boolean(),
  })
  .strict();

const existingProductionIdentityStateSchema = z
  .object({
    snapshotVersion: z.literal(1),
    transactionMode: z.literal("READ_ONLY"),
    targetEnvironment: z.literal("PRODUCTION"),
    targetMode: z.literal("EXISTING_TARGET"),
    targetFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    canonicalCoreRowCount: z.number().int().nonnegative(),
    identities: z.array(stateIdentitySchema),
  })
  .strict();

const plannedEmptyProductionIdentityStateSchema = z
  .object({
    snapshotVersion: z.literal(1),
    transactionMode: z.literal("READ_ONLY"),
    targetEnvironment: z.literal("PRODUCTION"),
    targetMode: z.literal("PLANNED_EMPTY_TARGET"),
    targetFingerprint: z.null(),
    canonicalCoreRowCount: z.null(),
    identities: z.array(stateIdentitySchema).length(0),
  })
  .strict();

export const productionIdentityStateSchema = z.preprocess(
  (value) => {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      !("targetMode" in value)
    ) {
      return { ...value, targetMode: "EXISTING_TARGET" };
    }
    return value;
  },
  z.discriminatedUnion("targetMode", [
    existingProductionIdentityStateSchema,
    plannedEmptyProductionIdentityStateSchema,
  ]),
);

export type ProductionIdentityState = z.infer<
  typeof productionIdentityStateSchema
>;

export interface ProductionRosterResult {
  readonly identities: readonly ProductionIdentity[];
  readonly issues: readonly ProductionIdentityIssue[];
  readonly rosterSha256: string;
  readonly counts: {
    readonly lecturer: number;
    readonly facultyLeader: number;
    readonly testIdentity: number;
    readonly admin: number;
    readonly total: number;
  };
}

export interface ProductionIdentityComparison {
  readonly issues: readonly ProductionIdentityIssue[];
  readonly createPlannedCount: number;
  readonly unchangedCount: number;
  readonly conflictingCount: number;
  readonly unexpectedIdentityCount: number;
}

export function normalizeIdentityText(value: string): string {
  return value.normalize("NFC").trim();
}

export function normalizeIdentityEmail(value: string): string {
  return normalizeIdentityText(value).toLocaleLowerCase("en-US");
}

export function auditCanonicalPersonnel(
  prepared: PreparedSource,
  resolutions: CanonicalPersonnelResolutionOptions = {},
): CanonicalPersonnelAudit {
  const issueCounts = new Map<
    string,
    { severity: ProductionIdentityIssueSeverity; count: number }
  >();
  const addIssue = (
    code: ProductionIdentityIssueCode,
    severity: ProductionIdentityIssueSeverity,
    count = 1,
  ): void => {
    const current = issueCounts.get(code);
    issueCounts.set(code, {
      severity,
      count: (current?.count ?? 0) + count,
    });
  };

  if (prepared.rows.length !== 2_497) {
    addIssue("SOURCE_ROW_COUNT_MISMATCH", "BLOCKER");
  }
  if (prepared.violations.length > 0) {
    addIssue(
      "SOURCE_CONTRACT_VIOLATION",
      "BLOCKER",
      prepared.violations.length,
    );
  }

  interface LecturerGroup {
    readonly rowNumbers: number[];
    readonly emails: Set<string>;
    readonly names: Set<string>;
    readonly units: Set<string>;
  }
  const groups = new Map<string, LecturerGroup>();
  const lecturerUidsByEmail = new Map<string, Set<string>>();
  const recordCounts = new Map<string, number>();
  let emailNormalizationCount = 0;
  let textNormalizationCount = 0;

  for (const row of prepared.rows) {
    if (row.lecturerUid.trim().length === 0) {
      addIssue("BLANK_LECTURER_UID", "BLOCKER");
      continue;
    }
    const group = groups.get(row.lecturerUid) ?? {
      rowNumbers: [],
      emails: new Set<string>(),
      names: new Set<string>(),
      units: new Set<string>(),
    };
    group.rowNumbers.push(row.sourceRowNumber);
    const rawEmail = textBusinessValue(row.businessValues.email_tai_khoan_vnu);
    const rawName = textBusinessValue(row.businessValues.ten_giang_vien);
    const rawUnit = textBusinessValue(row.businessValues.don_vi);
    const normalizedEmail = rawEmail ? normalizeIdentityEmail(rawEmail) : "";
    const normalizedName = rawName ? normalizeIdentityText(rawName) : "";
    const normalizedUnit = rawUnit ? normalizeIdentityText(rawUnit) : "";

    if (!normalizedEmail) addIssue("BLANK_EMAIL", "BLOCKER");
    else {
      group.emails.add(normalizedEmail);
      const lecturerUids =
        lecturerUidsByEmail.get(normalizedEmail) ?? new Set();
      lecturerUids.add(row.lecturerUid);
      lecturerUidsByEmail.set(normalizedEmail, lecturerUids);
      if (!isValidEmail(normalizedEmail)) addIssue("INVALID_EMAIL", "BLOCKER");
      if (isTestLikeEmail(normalizedEmail)) {
        addIssue("TEST_LIKE_CANONICAL_EMAIL", "BLOCKER");
      }
      if (rawEmail !== normalizedEmail) emailNormalizationCount += 1;
    }
    if (normalizedName) group.names.add(normalizedName);
    if (normalizedUnit) group.units.add(normalizedUnit);
    if (
      (rawName !== null && rawName !== normalizedName) ||
      (rawUnit !== null && rawUnit !== normalizedUnit)
    ) {
      textNormalizationCount += 1;
    }
    groups.set(row.lecturerUid, group);

    // STT is a unique technical source key. Duplicate business rows are
    // therefore compared across the remaining canonical columns.
    const recordKey = JSON.stringify(row.orderedValues.slice(1));
    recordCounts.set(recordKey, (recordCounts.get(recordKey) ?? 0) + 1);
  }

  if (emailNormalizationCount > 0) {
    addIssue(
      "EMAIL_NORMALIZATION_REQUIRED",
      "WARNING",
      emailNormalizationCount,
    );
  }
  if (textNormalizationCount > 0) {
    addIssue(
      "UNICODE_OR_WHITESPACE_NORMALIZATION_REQUIRED",
      "WARNING",
      textNormalizationCount,
    );
  }
  addIssue("EMPLOYMENT_STATUS_UNAVAILABLE", "WARNING");

  for (const lecturerUids of lecturerUidsByEmail.values()) {
    if (lecturerUids.size > 1) {
      addIssue("EMAIL_ASSIGNED_TO_MULTIPLE_LECTURERS", "BLOCKER");
    }
  }

  const sourceUnitToCode = new Map(
    Object.entries(PRODUCTION_UNIT_SOURCE_VALUES).map(([code, sourceValue]) => [
      sourceValue,
      code as ProductionUnitCode,
    ]),
  );
  const identities: ProductionLecturerIdentity[] = [];
  let vnuLecturerCount = 0;
  let nonVnuLecturerCount = 0;
  for (const [lecturerUid, group] of groups) {
    if (group.emails.size !== 1) {
      addIssue("MULTIPLE_EMAILS_FOR_LECTURER", "BLOCKER");
      continue;
    }
    const sourceEmail = first(group.emails);
    if (sourceEmail.endsWith("@vnu.edu.vn")) vnuLecturerCount += 1;
    else {
      nonVnuLecturerCount += 1;
    }
    if (resolutions.excludedLecturerUids?.has(lecturerUid)) continue;
    const replacementEmail =
      resolutions.replacementEmailByLecturerUid?.get(lecturerUid);
    const normalizedEmail = replacementEmail
      ? normalizeIdentityEmail(replacementEmail)
      : sourceEmail;
    if (
      !normalizedEmail.endsWith("@vnu.edu.vn") &&
      !resolutions.approvedNonVnuLecturerUids?.has(lecturerUid)
    ) {
      addIssue("NON_VNU_EMAIL", "BLOCKER");
    }
    const selectedDisplayName =
      resolutions.displayNameByLecturerUid?.get(lecturerUid);
    if (
      group.names.size !== 1 &&
      (!selectedDisplayName || !group.names.has(selectedDisplayName))
    ) {
      addIssue("DISPLAY_NAME_AMBIGUOUS", "BLOCKER");
      continue;
    }
    if (group.units.size !== 1) {
      addIssue("UNIT_AMBIGUOUS", "BLOCKER");
      continue;
    }
    const displayName = selectedDisplayName ?? first(group.names);
    const sourceUnit = first(group.units);
    const unitCode = sourceUnitToCode.get(sourceUnit);
    if (!unitCode) {
      addIssue("UNKNOWN_UNIT", "BLOCKER");
      continue;
    }
    const rowNumbers = [...group.rowNumbers].sort(
      (left, right) => left - right,
    );
    identities.push({
      sourceRowReference: createSourceRowReference(rowNumbers),
      lecturerUid,
      normalizedEmail,
      displayName,
      unitCode,
      requirePasswordChange: true,
      identityType: "LECTURER",
      testIdentity: false,
    });
  }

  const effectiveLecturersByEmail = new Map<string, Set<string>>();
  for (const identity of identities) {
    const lecturerUids =
      effectiveLecturersByEmail.get(identity.normalizedEmail) ?? new Set();
    lecturerUids.add(identity.lecturerUid);
    effectiveLecturersByEmail.set(identity.normalizedEmail, lecturerUids);
  }
  for (const lecturerUids of effectiveLecturersByEmail.values()) {
    if (lecturerUids.size > 1) {
      addIssue("EMAIL_ASSIGNED_TO_MULTIPLE_LECTURERS", "BLOCKER");
    }
  }

  identities.sort(compareIdentities);
  const duplicateGroups = [...recordCounts.values()].filter(
    (count) => count > 1,
  );
  return {
    identities,
    issues: mapIssues(issueCounts),
    summary: {
      sourceRowCount: prepared.rows.length,
      sourceColumnCount: prepared.headers.length,
      sourceChecksum: prepared.sourceSha256,
      distinctLecturerUidCount: groups.size,
      distinctNormalizedEmailCount: lecturerUidsByEmail.size,
      vnuLecturerCount,
      nonVnuLecturerCount,
      duplicateRecordGroupCount: duplicateGroups.length,
      duplicateRecordRowCount: duplicateGroups.reduce(
        (total, count) => total + count,
        0,
      ),
      employmentStatusColumnPresent: false,
    },
  };
}

export function buildProductionRoster(input: {
  readonly canonicalAudit: CanonicalPersonnelAudit;
  readonly manifest: ProductionIdentityManifest;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): ProductionRosterResult {
  const issues = [...input.canonicalAudit.issues];
  const { manifest } = input;
  if (
    manifest.canonicalSourceSha256 !==
    input.canonicalAudit.summary.sourceChecksum
  ) {
    issues.push(issue("MANIFEST_SOURCE_CHECKSUM_MISMATCH", "BLOCKER"));
  }
  const leaderUnits = manifest.facultyLeaders.map(({ unitCode }) => unitCode);
  if (
    new Set(leaderUnits).size !== PRODUCTION_UNIT_CODES.length ||
    PRODUCTION_UNIT_CODES.some((unitCode) => !leaderUnits.includes(unitCode)) ||
    manifest.facultyLeaders.some(
      ({ unitCode, passwordSecretReference }) =>
        passwordSecretReference !==
        PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode],
    )
  ) {
    issues.push(issue("LEADER_UNIT_COVERAGE_INVALID", "BLOCKER"));
  }

  const leaders: ProductionFacultyLeaderIdentity[] = manifest.facultyLeaders
    .map((leader) => ({
      normalizedEmail: normalizeIdentityEmail(leader.email),
      displayName: normalizeIdentityText(leader.displayName),
      unitCode: leader.unitCode,
      requirePasswordChange: leader.requirePasswordChange,
      identityType: "FACULTY_LEADER" as const,
      testIdentity: false,
    }))
    .sort(compareIdentities);
  const testLecturer: ProductionTestLecturerIdentity = {
    sourceRowReference: "OPERATOR_TEST_IDENTITY",
    lecturerUid: manifest.testLecturer.lecturerUid,
    normalizedEmail: TEST_LECTURER_EMAIL,
    displayName: normalizeIdentityText(manifest.testLecturer.displayName),
    unitCode: "KTPT",
    requirePasswordChange: true,
    identityType: "LECTURER",
    testIdentity: true,
  };
  const testLeader: ProductionFacultyLeaderIdentity = {
    normalizedEmail: TEST_LEADER_EMAIL,
    displayName: normalizeIdentityText(manifest.testLeader.displayName),
    unitCode: "KTPT",
    requirePasswordChange: true,
    identityType: "FACULTY_LEADER",
    testIdentity: true,
  };
  const admin: ProductionAdminIdentity | undefined = manifest.productionAdmin
    ? {
        normalizedEmail: normalizeIdentityEmail(manifest.productionAdmin.email),
        displayName: normalizeIdentityText(
          manifest.productionAdmin.displayName,
        ),
        requirePasswordChange: false,
        identityType: "ADMIN",
        testIdentity: false,
      }
    : undefined;

  const identities: ProductionIdentity[] = [
    ...input.canonicalAudit.identities,
    ...leaders,
    testLecturer,
    testLeader,
    ...(admin ? [admin] : []),
  ].sort(compareIdentities);
  if (
    new Set(identities.map(({ normalizedEmail }) => normalizedEmail)).size !==
    identities.length
  ) {
    issues.push(issue("IDENTITY_EMAIL_COLLISION", "BLOCKER"));
  }
  if (
    input.canonicalAudit.identities.some(
      ({ lecturerUid }) => lecturerUid === testLecturer.lecturerUid,
    )
  ) {
    issues.push(issue("TEST_LECTURER_UID_COLLISION", "BLOCKER"));
  }

  const requiredSecretNames = [
    PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
    ...PRODUCTION_UNIT_CODES.map(
      (unitCode) => PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode],
    ),
    ...(manifest.productionAdmin
      ? [PHASE7_SECURE_INPUT_NAMES.productionAdminPassword]
      : []),
  ];
  const invalidSecretCount = requiredSecretNames.filter(
    (name) => !isValidInitialPassword(input.environment[name]),
  ).length;
  if (invalidSecretCount > 0) {
    issues.push(
      issue("SECRET_MISSING_OR_INVALID", "BLOCKER", invalidSecretCount),
    );
  }

  const rosterPayload = identities.map(toRosterDigestRecord);
  return {
    identities,
    issues: mergeIssues(issues),
    rosterSha256: createHash("sha256")
      .update(JSON.stringify(rosterPayload), "utf8")
      .digest("hex"),
    counts: {
      lecturer: identities.filter(
        ({ identityType, testIdentity }) =>
          identityType === "LECTURER" && !testIdentity,
      ).length,
      facultyLeader: identities.filter(
        ({ identityType, testIdentity }) =>
          identityType === "FACULTY_LEADER" && !testIdentity,
      ).length,
      testIdentity: identities.filter(({ testIdentity }) => testIdentity)
        .length,
      admin: identities.filter(({ identityType }) => identityType === "ADMIN")
        .length,
      total: identities.length,
    },
  };
}

export function compareProductionIdentityState(input: {
  readonly roster: ProductionRosterResult;
  readonly state: ProductionIdentityState;
  readonly mode: "DRY_RUN" | "RECONCILE";
}): ProductionIdentityComparison {
  const issues: ProductionIdentityIssue[] = [];
  if (
    input.state.targetMode === "EXISTING_TARGET" &&
    input.state.canonicalCoreRowCount !== 2_497
  ) {
    issues.push(issue("STATE_CORE_ROW_COUNT_MISMATCH", "BLOCKER"));
  }
  if (
    input.state.targetMode === "PLANNED_EMPTY_TARGET" &&
    input.mode === "RECONCILE"
  ) {
    issues.push(
      issue("PLANNED_EMPTY_TARGET_RECONCILIATION_UNAVAILABLE", "BLOCKER"),
    );
  }
  const stateByEmail = new Map<
    string,
    (typeof input.state.identities)[number]
  >();
  const lecturerUids = new Set<string>();
  let duplicateEmailCount = 0;
  let duplicateLecturerUidCount = 0;
  for (const identity of input.state.identities) {
    const email = normalizeIdentityEmail(identity.email);
    if (stateByEmail.has(email)) duplicateEmailCount += 1;
    stateByEmail.set(email, identity);
    if (identity.lecturerUid) {
      if (lecturerUids.has(identity.lecturerUid))
        duplicateLecturerUidCount += 1;
      lecturerUids.add(identity.lecturerUid);
    }
  }
  if (duplicateEmailCount > 0) {
    issues.push(issue("STATE_DUPLICATE_EMAIL", "BLOCKER", duplicateEmailCount));
  }
  if (duplicateLecturerUidCount > 0) {
    issues.push(
      issue(
        "STATE_DUPLICATE_LECTURER_UID",
        "BLOCKER",
        duplicateLecturerUidCount,
      ),
    );
  }

  let createPlannedCount = 0;
  let unchangedCount = 0;
  let conflictingCount = 0;
  let missingAuditCount = 0;
  const rosterEmails = new Set<string>();
  for (const expected of input.roster.identities) {
    rosterEmails.add(expected.normalizedEmail);
    const actual = stateByEmail.get(expected.normalizedEmail);
    if (!actual) {
      createPlannedCount += 1;
      continue;
    }
    if (!identityStateMatches(expected, actual)) {
      conflictingCount += 1;
      continue;
    }
    unchangedCount += 1;
    if (input.mode === "RECONCILE" && actual.provisioningAuditEventCount < 1) {
      missingAuditCount += 1;
    }
  }
  if (conflictingCount > 0) {
    issues.push(issue("IDENTITY_STATE_MISMATCH", "BLOCKER", conflictingCount));
  }
  if (input.mode === "RECONCILE" && createPlannedCount > 0) {
    issues.push(
      issue("IDENTITY_STATE_MISMATCH", "BLOCKER", createPlannedCount),
    );
  }
  if (missingAuditCount > 0) {
    issues.push(
      issue(
        "PROVISIONING_AUDIT_EVIDENCE_MISSING",
        "BLOCKER",
        missingAuditCount,
      ),
    );
  }
  const unexpectedIdentityCount = input.state.identities.filter(
    ({ email }) => !rosterEmails.has(normalizeIdentityEmail(email)),
  ).length;
  if (unexpectedIdentityCount > 0) {
    issues.push(
      issue("UNEXPECTED_TARGET_IDENTITY", "BLOCKER", unexpectedIdentityCount),
    );
  }
  return {
    issues: mergeIssues(issues),
    createPlannedCount,
    unchangedCount,
    conflictingCount,
    unexpectedIdentityCount,
  };
}

function identityStateMatches(
  expected: ProductionIdentity,
  actual: ProductionIdentityState["identities"][number],
): boolean {
  const expectedRole = expected.identityType;
  const expectedLecturerUid =
    expected.identityType === "LECTURER" ? expected.lecturerUid : null;
  const expectedUnitCodes =
    expected.identityType === "FACULTY_LEADER" ? [expected.unitCode] : [];
  return (
    normalizeIdentityText(actual.displayName) === expected.displayName &&
    actual.status === "ACTIVE" &&
    actual.lecturerUid === expectedLecturerUid &&
    actual.mustChangePassword === expected.requirePasswordChange &&
    sameStringSet(actual.activeRoles, [expectedRole]) &&
    sameStringSet(actual.activeUnitCodes, expectedUnitCodes) &&
    actual.testIdentityMarker === expected.testIdentity
  );
}

function isValidInitialPassword(value: string | undefined): boolean {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    value.length <= 128 &&
    !isSamplePassword(value)
  );
}

function isValidEmail(value: string): boolean {
  return z.email().safeParse(value).success;
}

function isTestLikeEmail(value: string): boolean {
  const localPart = value.slice(0, value.lastIndexOf("@"));
  return /(?:test|demo|sample|fake)/iu.test(localPart);
}

function textBusinessValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function first(values: ReadonlySet<string>): string {
  return values.values().next().value ?? "";
}

export function createSourceRowReference(
  rowNumbers: readonly number[],
): string {
  const digest = createHash("sha256")
    .update(rowNumbers.join(","), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `canonical-rows:${rowNumbers.length}:${digest}`;
}

function compareIdentities(
  left: Pick<ProductionIdentity, "normalizedEmail">,
  right: Pick<ProductionIdentity, "normalizedEmail">,
): number {
  return left.normalizedEmail.localeCompare(right.normalizedEmail, "en-US");
}

function issue(
  code: ProductionIdentityIssueCode,
  severity: ProductionIdentityIssueSeverity,
  count = 1,
): ProductionIdentityIssue {
  return { code, severity, count };
}

function mapIssues(
  issues: ReadonlyMap<
    string,
    { severity: ProductionIdentityIssueSeverity; count: number }
  >,
): ProductionIdentityIssue[] {
  return [...issues.entries()]
    .map(([code, value]) => ({
      code: code as ProductionIdentityIssueCode,
      severity: value.severity,
      count: value.count,
    }))
    .sort((left, right) => left.code.localeCompare(right.code, "en-US"));
}

function mergeIssues(
  issues: readonly ProductionIdentityIssue[],
): ProductionIdentityIssue[] {
  const merged = new Map<
    ProductionIdentityIssueCode,
    ProductionIdentityIssue
  >();
  for (const value of issues) {
    const current = merged.get(value.code);
    merged.set(value.code, {
      code: value.code,
      severity:
        current?.severity === "BLOCKER" || value.severity === "BLOCKER"
          ? "BLOCKER"
          : "WARNING",
      count: (current?.count ?? 0) + value.count,
    });
  }
  return [...merged.values()].sort((left, right) =>
    left.code.localeCompare(right.code, "en-US"),
  );
}

function sameStringSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    new Set(actual).size === actual.length &&
    new Set(expected).size === expected.length &&
    [...actual].sort().join("\0") === [...expected].sort().join("\0")
  );
}

function toRosterDigestRecord(identity: ProductionIdentity): object {
  if (identity.identityType === "LECTURER") {
    return {
      identityType: identity.identityType,
      normalizedEmail: identity.normalizedEmail,
      displayName: identity.displayName,
      lecturerUid: identity.lecturerUid,
      unitCode: identity.unitCode,
      requirePasswordChange: identity.requirePasswordChange,
      testIdentity: identity.testIdentity,
    };
  }
  if (identity.identityType === "FACULTY_LEADER") {
    return {
      identityType: identity.identityType,
      normalizedEmail: identity.normalizedEmail,
      displayName: identity.displayName,
      unitCode: identity.unitCode,
      requirePasswordChange: identity.requirePasswordChange,
      testIdentity: identity.testIdentity,
    };
  }
  return {
    identityType: identity.identityType,
    normalizedEmail: identity.normalizedEmail,
    displayName: identity.displayName,
    requirePasswordChange: identity.requirePasswordChange,
    testIdentity: identity.testIdentity,
  };
}
