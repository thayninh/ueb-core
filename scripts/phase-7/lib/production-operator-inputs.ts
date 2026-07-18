import { z } from "zod";

import type { PreparedSource } from "../../phase-2/lib/row-parser";
import {
  createSourceRowReference,
  normalizeIdentityEmail,
  normalizeIdentityText,
  PHASE7_SECURE_INPUT_NAMES,
  productionIdentityManifestSchema,
  productionIdentityStateSchema,
  PRODUCTION_UNIT_CODES,
  TEST_LEADER_EMAIL,
  TEST_LECTURER_EMAIL,
  type CanonicalPersonnelResolutionOptions,
  type ProductionIdentityManifest,
  type ProductionIdentityState,
} from "./production-identity";

export const PHASE7_SECURE_FILE_NAMES = {
  canonicalSource: "CSDLCore_chuan_hoa_PostgreSQL.xlsx",
  lecturerExceptions: "lecturer-exceptions.json",
  facultyLeaders: "faculty-leaders.json",
  testIdentities: "test-identities.json",
  targetState: "production-target-state.json",
  secrets: "phase7-secrets.env",
} as const;

const nullableText = z.string().nullable();

export const lecturerExceptionFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    canonicalSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    emailExceptions: z.array(
      z
        .object({
          lecturerUid: z.uuid(),
          sourceRowReference: z.string().min(1),
          sourceEmail: z.string().email(),
          decision: z
            .enum([
              "APPROVE_EXCEPTION",
              "REPLACE_WITH_AUTHORIZED_VNU_EMAIL",
              "EXCLUDE_WITH_JUSTIFICATION",
              "KEEP_BLOCKED_PENDING_VERIFICATION",
            ])
            .nullable(),
          authorizedVnuEmail: nullableText,
          justification: nullableText,
        })
        .strict(),
    ),
    displayNameResolutions: z.array(
      z
        .object({
          lecturerUid: z.uuid(),
          sourceRowReference: z.string().min(1),
          candidateDisplayNames: z.array(z.string().min(1)).min(2),
          selectedDisplayName: nullableText,
        })
        .strict(),
    ),
  })
  .strict();

export type LecturerExceptionFile = z.infer<typeof lecturerExceptionFileSchema>;

const facultyLeaderDraftSchema = z
  .object({
    email: nullableText,
    displayName: nullableText,
    unitCode: z.enum(PRODUCTION_UNIT_CODES),
    requirePasswordChange: z.boolean().nullable(),
    passwordSecretReference: z.string().min(1),
  })
  .strict();

export const facultyLeaderFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    changeReference: nullableText.optional(),
    records: z.array(facultyLeaderDraftSchema).length(6),
  })
  .strict();

export type FacultyLeaderFile = z.infer<typeof facultyLeaderFileSchema>;

export const testIdentityFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    lecturer: z
      .object({
        email: z.literal(TEST_LECTURER_EMAIL),
        displayName: nullableText,
        lecturerUid: z.uuid().nullable(),
        requirePasswordChange: z.literal(true),
        passwordSecretReference: z.literal(
          PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
        ),
        roles: z.tuple([z.literal("LECTURER")]),
        unitScopes: z.tuple([]),
        testIdentity: z.literal(true),
      })
      .strict(),
    leader: z
      .object({
        email: z.literal(TEST_LEADER_EMAIL),
        displayName: nullableText,
        lecturerUid: z.null(),
        unitCode: z.literal("KTPT"),
        requirePasswordChange: z.literal(true),
        passwordSecretReference: z.literal(
          PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
        ),
        roles: z.tuple([z.literal("FACULTY_LEADER")]),
        unitScopes: z.tuple([z.literal("KTPT")]),
        testIdentity: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type TestIdentityFile = z.infer<typeof testIdentityFileSchema>;

export const targetStateDraftSchema = z
  .object({
    snapshotVersion: z.literal(1),
    snapshotStatus: z.enum(["OPERATOR_INPUT_REQUIRED", "READY"]),
    transactionMode: z.literal("READ_ONLY"),
    targetEnvironment: z.literal("PRODUCTION"),
    targetMode: z
      .enum(["EXISTING_TARGET", "PLANNED_EMPTY_TARGET"])
      .default("EXISTING_TARGET"),
    targetFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    canonicalCoreRowCount: z.number().int().nonnegative().nullable(),
    identities: z.array(
      z
        .object({
          email: z.string().trim().toLowerCase().pipe(z.email()),
          displayName: z.string().trim().min(1),
          status: z.enum(["ACTIVE", "DISABLED", "PENDING_MAPPING"]),
          lecturerUid: z.uuid().nullable(),
          activeRoles: z.array(z.enum(["LECTURER", "FACULTY_LEADER", "ADMIN"])),
          activeUnitCodes: z.array(z.enum(PRODUCTION_UNIT_CODES)),
          mustChangePassword: z.boolean(),
          provisioningAuditEventCount: z.number().int().nonnegative(),
          testIdentityMarker: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.targetMode !== "PLANNED_EMPTY_TARGET") return;
    if (value.targetFingerprint !== null) {
      context.addIssue({
        code: "custom",
        path: ["targetFingerprint"],
        message: "PLANNED_EMPTY_TARGET_FINGERPRINT_FORBIDDEN",
      });
    }
    if (value.canonicalCoreRowCount !== null) {
      context.addIssue({
        code: "custom",
        path: ["canonicalCoreRowCount"],
        message: "PLANNED_EMPTY_TARGET_CORE_COUNT_FORBIDDEN",
      });
    }
    if (value.identities.length !== 0) {
      context.addIssue({
        code: "custom",
        path: ["identities"],
        message: "PLANNED_EMPTY_TARGET_IDENTITIES_FORBIDDEN",
      });
    }
  });

export type TargetStateDraft = z.infer<typeof targetStateDraftSchema>;

export interface ExpectedLecturerExceptionInventory {
  readonly canonicalSourceSha256: string;
  readonly nonVnu: readonly {
    lecturerUid: string;
    sourceRowReference: string;
    sourceEmail: string;
  }[];
  readonly ambiguousNames: readonly {
    lecturerUid: string;
    sourceRowReference: string;
    candidateDisplayNames: readonly string[];
  }[];
}

export interface OperatorInputValidationResult {
  readonly missingInputs: readonly string[];
  readonly conflictCodes: readonly string[];
  readonly resolutions?: CanonicalPersonnelResolutionOptions;
  readonly manifest?: ProductionIdentityManifest;
  readonly state?: ProductionIdentityState;
  readonly secrets?: Readonly<Record<string, string>>;
}

export function inspectExpectedLecturerExceptions(
  prepared: PreparedSource,
): ExpectedLecturerExceptionInventory {
  const groups = new Map<
    string,
    {
      rowNumbers: number[];
      emails: Set<string>;
      names: Set<string>;
    }
  >();
  for (const row of prepared.rows) {
    const group = groups.get(row.lecturerUid) ?? {
      rowNumbers: [],
      emails: new Set<string>(),
      names: new Set<string>(),
    };
    group.rowNumbers.push(row.sourceRowNumber);
    const email = row.businessValues.email_tai_khoan_vnu;
    const name = row.businessValues.ten_giang_vien;
    if (typeof email === "string" && email.trim()) {
      group.emails.add(normalizeIdentityEmail(email));
    }
    if (typeof name === "string" && name.trim()) {
      group.names.add(normalizeIdentityText(name));
    }
    groups.set(row.lecturerUid, group);
  }

  const nonVnu: ExpectedLecturerExceptionInventory["nonVnu"][number][] = [];
  const ambiguousNames: ExpectedLecturerExceptionInventory["ambiguousNames"][number][] =
    [];
  for (const [lecturerUid, group] of groups) {
    const sourceRowReference = createSourceRowReference(
      [...group.rowNumbers].sort((left, right) => left - right),
    );
    if (group.emails.size === 1) {
      const sourceEmail = group.emails.values().next().value!;
      if (!sourceEmail.endsWith("@vnu.edu.vn")) {
        nonVnu.push({ lecturerUid, sourceRowReference, sourceEmail });
      }
    }
    if (group.names.size > 1) {
      ambiguousNames.push({
        lecturerUid,
        sourceRowReference,
        candidateDisplayNames: [...group.names].sort((left, right) =>
          left.localeCompare(right, "vi-VN"),
        ),
      });
    }
  }
  const byUid = <T extends { lecturerUid: string }>(
    left: T,
    right: T,
  ): number => left.lecturerUid.localeCompare(right.lecturerUid, "en-US");
  return {
    canonicalSourceSha256: prepared.sourceSha256,
    nonVnu: nonVnu.sort(byUid),
    ambiguousNames: ambiguousNames.sort(byUid),
  };
}

export function createLecturerExceptionTemplate(
  inventory: ExpectedLecturerExceptionInventory,
): LecturerExceptionFile {
  return {
    schemaVersion: 1,
    canonicalSourceSha256: inventory.canonicalSourceSha256,
    emailExceptions: inventory.nonVnu.map((entry) => ({
      ...entry,
      decision: null,
      authorizedVnuEmail: null,
      justification: null,
    })),
    displayNameResolutions: inventory.ambiguousNames.map((entry) => ({
      ...entry,
      candidateDisplayNames: [...entry.candidateDisplayNames],
      selectedDisplayName: null,
    })),
  };
}

export function createFacultyLeaderTemplate(): FacultyLeaderFile {
  return {
    schemaVersion: 1,
    changeReference: null,
    records: PRODUCTION_UNIT_CODES.map((unitCode) => ({
      email: null,
      displayName: null,
      unitCode,
      requirePasswordChange: null,
      passwordSecretReference:
        PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode],
    })),
  };
}

export function createTestIdentityTemplate(): TestIdentityFile {
  return {
    schemaVersion: 1,
    lecturer: {
      email: TEST_LECTURER_EMAIL,
      displayName: null,
      lecturerUid: null,
      requirePasswordChange: true,
      passwordSecretReference: PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
      roles: ["LECTURER"],
      unitScopes: [],
      testIdentity: true,
    },
    leader: {
      email: TEST_LEADER_EMAIL,
      displayName: null,
      lecturerUid: null,
      unitCode: "KTPT",
      requirePasswordChange: true,
      passwordSecretReference: PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
      roles: ["FACULTY_LEADER"],
      unitScopes: ["KTPT"],
      testIdentity: true,
    },
  };
}

export function createTargetStateTemplate(): TargetStateDraft {
  return {
    snapshotVersion: 1,
    snapshotStatus: "OPERATOR_INPUT_REQUIRED",
    transactionMode: "READ_ONLY",
    targetEnvironment: "PRODUCTION",
    targetMode: "EXISTING_TARGET",
    targetFingerprint: null,
    canonicalCoreRowCount: null,
    identities: [],
  };
}

export function createSecretsTemplate(): string {
  const names = [
    PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
    ...PRODUCTION_UNIT_CODES.map(
      (unitCode) => PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode],
    ),
  ];
  return `${names.map((name) => `${name}=`).join("\n")}\n`;
}

export function parseSecretsFile(
  raw: string,
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]+$/u.test(name)) continue;
    values[name] = line.slice(separator + 1);
  }
  return values;
}

export function validateOperatorInputs(input: {
  readonly expected: ExpectedLecturerExceptionInventory;
  readonly lecturerExceptions: LecturerExceptionFile;
  readonly facultyLeaders: FacultyLeaderFile;
  readonly testIdentities: TestIdentityFile;
  readonly targetState: TargetStateDraft;
  readonly secrets: Readonly<Record<string, string>>;
}): OperatorInputValidationResult {
  const missing = new Set<string>();
  const conflicts = new Set<string>();
  const approvedNonVnu = new Set<string>();
  const replacements = new Map<string, string>();
  const exclusions = new Set<string>();
  const displayNames = new Map<string, string>();

  if (
    input.lecturerExceptions.canonicalSourceSha256 !==
    input.expected.canonicalSourceSha256
  ) {
    conflicts.add("LECTURER_EXCEPTION_CHECKSUM_MISMATCH");
  }
  validateEmailExceptions({
    expected: input.expected.nonVnu,
    actual: input.lecturerExceptions.emailExceptions,
    missing,
    conflicts,
    approvedNonVnu,
    replacements,
    exclusions,
  });
  validateDisplayNameResolutions({
    expected: input.expected.ambiguousNames,
    actual: input.lecturerExceptions.displayNameResolutions,
    missing,
    conflicts,
    displayNames,
  });

  const leaderByUnit = new Map(
    input.facultyLeaders.records.map((record) => [record.unitCode, record]),
  );
  if (!input.facultyLeaders.changeReference?.trim()) {
    missing.add("faculty-leaders.json.changeReference");
  }
  if (leaderByUnit.size !== PRODUCTION_UNIT_CODES.length) {
    conflicts.add("FACULTY_LEADER_UNIT_COVERAGE_INVALID");
  }
  for (const unitCode of PRODUCTION_UNIT_CODES) {
    const record = leaderByUnit.get(unitCode);
    if (!record) {
      missing.add(`faculty-leaders.json.${unitCode}`);
      continue;
    }
    if (!record.email?.trim())
      missing.add(`faculty-leaders.json.${unitCode}.email`);
    else if (!z.email().safeParse(normalizeIdentityEmail(record.email)).success)
      conflicts.add(`FACULTY_LEADER_${unitCode}_EMAIL_INVALID`);
    if (!record.displayName?.trim())
      missing.add(`faculty-leaders.json.${unitCode}.displayName`);
    if (record.requirePasswordChange === null) {
      missing.add(`faculty-leaders.json.${unitCode}.requirePasswordChange`);
    }
    if (
      record.passwordSecretReference !==
      PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode]
    ) {
      conflicts.add(`FACULTY_LEADER_${unitCode}_SECRET_REFERENCE_INVALID`);
    }
  }
  if (!input.testIdentities.lecturer.displayName?.trim()) {
    missing.add("test-identities.json.lecturer.displayName");
  }
  if (!input.testIdentities.lecturer.lecturerUid) {
    missing.add("test-identities.json.lecturer.lecturerUid");
  }
  if (!input.testIdentities.leader.displayName?.trim()) {
    missing.add("test-identities.json.leader.displayName");
  }
  if (input.targetState.snapshotStatus !== "READY") {
    missing.add("production-target-state.json.snapshotStatus");
  }
  if (input.targetState.targetMode === "EXISTING_TARGET") {
    if (!input.targetState.targetFingerprint) {
      missing.add("production-target-state.json.targetFingerprint");
    }
    if (input.targetState.canonicalCoreRowCount === null) {
      missing.add("production-target-state.json.canonicalCoreRowCount");
    }
  }

  const requiredSecrets = [
    PHASE7_SECURE_INPUT_NAMES.lecturerPassword,
    ...PRODUCTION_UNIT_CODES.map(
      (unitCode) => PHASE7_SECURE_INPUT_NAMES.leaderPasswords[unitCode],
    ),
  ];
  for (const secretName of requiredSecrets) {
    if (!input.secrets[secretName]) {
      missing.add(`phase7-secrets.env.${secretName}`);
    }
  }

  if (missing.size > 0 || conflicts.size > 0) {
    return {
      missingInputs: [...missing].sort(),
      conflictCodes: [...conflicts].sort(),
    };
  }

  const manifestCandidate = {
    manifestVersion: 1,
    changeReference: input.facultyLeaders.changeReference!,
    canonicalSourceSha256: input.expected.canonicalSourceSha256,
    facultyLeaders: PRODUCTION_UNIT_CODES.map((unitCode) => {
      const record = leaderByUnit.get(unitCode)!;
      return {
        email: record.email!,
        displayName: record.displayName!,
        unitCode,
        requirePasswordChange: record.requirePasswordChange!,
        passwordSecretReference: record.passwordSecretReference,
      };
    }),
    testLecturer: {
      email: input.testIdentities.lecturer.email,
      displayName: input.testIdentities.lecturer.displayName!,
      lecturerUid: input.testIdentities.lecturer.lecturerUid!,
      requirePasswordChange: true as const,
      passwordSecretReference:
        input.testIdentities.lecturer.passwordSecretReference,
    },
    testLeader: {
      email: input.testIdentities.leader.email,
      displayName: input.testIdentities.leader.displayName!,
      unitCode: input.testIdentities.leader.unitCode,
      requirePasswordChange: true as const,
      passwordSecretReference:
        input.testIdentities.leader.passwordSecretReference,
    },
  };
  const manifest =
    productionIdentityManifestSchema.safeParse(manifestCandidate);
  const state = productionIdentityStateSchema.safeParse({
    snapshotVersion: input.targetState.snapshotVersion,
    transactionMode: input.targetState.transactionMode,
    targetEnvironment: input.targetState.targetEnvironment,
    targetMode: input.targetState.targetMode,
    targetFingerprint: input.targetState.targetFingerprint,
    canonicalCoreRowCount: input.targetState.canonicalCoreRowCount,
    identities: input.targetState.identities,
  });
  if (!manifest.success) conflicts.add("PRODUCTION_MANIFEST_INVALID");
  if (!state.success) conflicts.add("PRODUCTION_TARGET_STATE_INVALID");
  if (!manifest.success || !state.success) {
    return {
      missingInputs: [],
      conflictCodes: [...conflicts].sort(),
    };
  }
  return {
    missingInputs: [],
    conflictCodes: [],
    resolutions: {
      approvedNonVnuLecturerUids: approvedNonVnu,
      replacementEmailByLecturerUid: replacements,
      excludedLecturerUids: exclusions,
      displayNameByLecturerUid: displayNames,
    },
    manifest: manifest.data,
    state: state.data,
    secrets: input.secrets,
  };
}

function validateEmailExceptions(input: {
  readonly expected: ExpectedLecturerExceptionInventory["nonVnu"];
  readonly actual: LecturerExceptionFile["emailExceptions"];
  readonly missing: Set<string>;
  readonly conflicts: Set<string>;
  readonly approvedNonVnu: Set<string>;
  readonly replacements: Map<string, string>;
  readonly exclusions: Set<string>;
}): void {
  const actualByUid = new Map(
    input.actual.map((record) => [record.lecturerUid, record]),
  );
  if (actualByUid.size !== input.expected.length) {
    input.conflicts.add("LECTURER_EMAIL_EXCEPTION_INVENTORY_MISMATCH");
  }
  for (const expected of input.expected) {
    const record = actualByUid.get(expected.lecturerUid);
    if (
      !record ||
      record.sourceRowReference !== expected.sourceRowReference ||
      normalizeIdentityEmail(record.sourceEmail) !== expected.sourceEmail
    ) {
      input.conflicts.add("LECTURER_EMAIL_EXCEPTION_LOCATOR_MISMATCH");
      continue;
    }
    const prefix = `lecturer-exceptions.json.emailExceptions.${expected.sourceRowReference}`;
    if (!record.justification?.trim()) {
      input.missing.add(`${prefix}.justification`);
    }
    if (!record.decision) {
      input.missing.add(`${prefix}.decision`);
      continue;
    }
    if (record.decision === "APPROVE_EXCEPTION") {
      input.approvedNonVnu.add(record.lecturerUid);
    } else if (record.decision === "EXCLUDE_WITH_JUSTIFICATION") {
      input.exclusions.add(record.lecturerUid);
    } else if (record.decision === "KEEP_BLOCKED_PENDING_VERIFICATION") {
      input.conflicts.add("LECTURER_EMAIL_EXCEPTION_PENDING_VERIFICATION");
    } else {
      if (
        !record.authorizedVnuEmail ||
        !normalizeIdentityEmail(record.authorizedVnuEmail).endsWith(
          "@vnu.edu.vn",
        ) ||
        !z.email().safeParse(normalizeIdentityEmail(record.authorizedVnuEmail))
          .success
      ) {
        input.missing.add(`${prefix}.authorizedVnuEmail`);
      } else {
        input.replacements.set(
          record.lecturerUid,
          normalizeIdentityEmail(record.authorizedVnuEmail),
        );
      }
    }
  }
}

function validateDisplayNameResolutions(input: {
  readonly expected: ExpectedLecturerExceptionInventory["ambiguousNames"];
  readonly actual: LecturerExceptionFile["displayNameResolutions"];
  readonly missing: Set<string>;
  readonly conflicts: Set<string>;
  readonly displayNames: Map<string, string>;
}): void {
  const actualByUid = new Map(
    input.actual.map((record) => [record.lecturerUid, record]),
  );
  if (actualByUid.size !== input.expected.length) {
    input.conflicts.add("DISPLAY_NAME_RESOLUTION_INVENTORY_MISMATCH");
  }
  for (const expected of input.expected) {
    const record = actualByUid.get(expected.lecturerUid);
    if (
      !record ||
      record.sourceRowReference !== expected.sourceRowReference ||
      JSON.stringify([...record.candidateDisplayNames].sort()) !==
        JSON.stringify([...expected.candidateDisplayNames].sort())
    ) {
      input.conflicts.add("DISPLAY_NAME_RESOLUTION_LOCATOR_MISMATCH");
      continue;
    }
    const prefix = `lecturer-exceptions.json.displayNameResolutions.${expected.sourceRowReference}`;
    if (!record.selectedDisplayName?.trim()) {
      input.missing.add(`${prefix}.selectedDisplayName`);
    } else {
      const selected = normalizeIdentityText(record.selectedDisplayName);
      if (!expected.candidateDisplayNames.includes(selected)) {
        input.conflicts.add("DISPLAY_NAME_SELECTION_NOT_CANONICAL_VARIANT");
      } else {
        input.displayNames.set(record.lecturerUid, selected);
      }
    }
  }
}
