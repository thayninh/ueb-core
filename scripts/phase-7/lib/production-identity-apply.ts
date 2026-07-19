import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";

import {
  AccessProfileStatus,
  BusinessRole,
  Prisma,
  PrismaClient,
} from "../../../src/generated/prisma/client";
import {
  PHASE7_SECURE_INPUT_NAMES,
  type ProductionIdentity,
  type ProductionRosterResult,
} from "./production-identity";
import {
  parseOperatorWindow,
  PRODUCTION_EXECUTOR_CONTRACT,
  readEmbeddedSourceSha,
} from "./production-executor";
import { loadValidatedProductionRoster } from "../production-roster-workflow";

export const PRODUCTION_IDENTITY_APPLY_CONTRACT = {
  database: PRODUCTION_EXECUTOR_CONTRACT.database,
  provisionerRole: PRODUCTION_EXECUTOR_CONTRACT.provisionerRole,
  authorization: "PROVISION_START_AND_CUTOVER_PRODUCTION_PHASE7_2026-07-19",
  rosterManifestSha: PRODUCTION_EXECUTOR_CONTRACT.rosterManifestSha,
  canonicalChecksum: PRODUCTION_EXECUTOR_CONTRACT.canonicalChecksum,
  expectedGitShaPattern: /^[a-f0-9]{40}$/u,
  expectedAuthUserCount: 254,
  expectedAccessProfileCount: 254,
  expectedLecturerMappingCount: 247,
  expectedLecturerRoleCount: 247,
  expectedLeaderRoleCount: 7,
  expectedLeaderScopeCount: 7,
  expectedAdminRoleCount: 0,
  expectedMustChangePasswordCount: 254,
} as const;

export interface ProductionIdentityApplyCommand {
  readonly targetDatabase: string;
  readonly authorizationReference: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly expectedGitSha: string;
  readonly rosterManifestSha: string;
  readonly canonicalChecksum: string;
}

export interface ProductionIdentityApplyResult {
  readonly report: string;
  readonly exitCode: number;
}

export interface ExistingProductionIdentity {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly credentialAccountCount: number;
  readonly credentialPasswordPresent: boolean;
  readonly profileStatus: "ACTIVE" | "DISABLED" | "PENDING_MAPPING" | null;
  readonly lecturerUid: string | null;
  readonly mustChangePassword: boolean | null;
  readonly createdBySelf: boolean;
  readonly activeRoles: readonly string[];
  readonly roleGrantProvenanceSelf: boolean;
  readonly activeUnitCodes: readonly string[];
  readonly scopeGrantProvenanceSelf: boolean;
  readonly matchingAuditEvidenceCount: number;
  readonly testIdentityMarker: boolean | null;
}

export interface ProductionIdentityStateSnapshot {
  readonly identities: readonly ExistingProductionIdentity[];
  readonly activeSessionCount: number;
  readonly activeUnitIdsByCode: ReadonlyMap<string, string>;
}

export interface PreparedProductionIdentity {
  readonly identity: ProductionIdentity;
  readonly passwordHash: string;
}

export interface ProductionIdentityApplyTransaction {
  readState(input: {
    readonly rosterManifestSha: string;
  }): Promise<ProductionIdentityStateSnapshot>;
  createIdentity(input: {
    readonly prepared: PreparedProductionIdentity;
    readonly unitId: string | undefined;
    readonly command: ProductionIdentityApplyCommand;
  }): Promise<void>;
}

export interface ProductionIdentityApplyDatabase {
  serializable<T>(
    operation: (transaction: ProductionIdentityApplyTransaction) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

export class SafeProductionIdentityApplyError extends Error {
  constructor(
    readonly code: string,
    readonly mutationPossible = false,
  ) {
    super(code);
  }
}

const VALUE_PREFIXES = [
  "--target-database=",
  "--authorization-reference=",
  "--change-window-start=",
  "--change-window-end=",
  "--expected-git-sha=",
  "--roster-manifest-sha=",
  "--canonical-checksum=",
] as const;
const CONFIRMATION = "--confirm-production-identity-apply";

export function parseProductionIdentityApplyCommand(
  arguments_: readonly string[],
): ProductionIdentityApplyCommand {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  if (
    args.includes("--") ||
    args.includes("--force") ||
    args.some(
      (argument) =>
        argument !== CONFIRMATION &&
        !VALUE_PREFIXES.some((prefix) => argument.startsWith(prefix)),
    ) ||
    args.filter((argument) => argument === CONFIRMATION).length !== 1 ||
    VALUE_PREFIXES.some(
      (prefix) =>
        args.filter((argument) => argument.startsWith(prefix)).length !== 1,
    )
  ) {
    throw new SafeProductionIdentityApplyError(
      args.includes(CONFIRMATION)
        ? "PRODUCTION_IDENTITY_ARGUMENTS_INVALID"
        : "PRODUCTION_IDENTITY_CONFIRMATION_REQUIRED",
    );
  }
  const value = (prefix: (typeof VALUE_PREFIXES)[number]): string =>
    args.find((argument) => argument.startsWith(prefix))!.slice(prefix.length);
  const command: ProductionIdentityApplyCommand = {
    targetDatabase: value("--target-database="),
    authorizationReference: value("--authorization-reference="),
    windowStart: value("--change-window-start="),
    windowEnd: value("--change-window-end="),
    expectedGitSha: value("--expected-git-sha="),
    rosterManifestSha: value("--roster-manifest-sha="),
    canonicalChecksum: value("--canonical-checksum="),
  };
  assertProductionIdentityApplyContract(command);
  return command;
}

export function assertProductionIdentityApplyContract(
  command: ProductionIdentityApplyCommand,
): void {
  if (command.targetDatabase !== PRODUCTION_IDENTITY_APPLY_CONTRACT.database) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_DATABASE_FORBIDDEN",
    );
  }
  if (
    command.authorizationReference !==
    PRODUCTION_IDENTITY_APPLY_CONTRACT.authorization
  ) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_AUTHORIZATION_REQUIRED",
    );
  }
  if (
    command.rosterManifestSha !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.rosterManifestSha ||
    command.canonicalChecksum !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.canonicalChecksum ||
    !PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedGitShaPattern.test(
      command.expectedGitSha,
    )
  ) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_IMMUTABLE_INPUT_MISMATCH",
    );
  }
  parseOperatorWindow(command.windowStart, command.windowEnd);
}

export function planProductionIdentityApply(input: {
  readonly roster: ProductionRosterResult;
  readonly state: ProductionIdentityStateSnapshot;
}): "CREATE" | "NOOP" {
  assertExpectedRoster(input.roster);
  if (input.state.activeSessionCount !== 0) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_ACTIVE_SESSIONS_PRESENT",
    );
  }
  if (input.state.identities.length === 0) return "CREATE";
  if (input.state.identities.length !== input.roster.identities.length) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_PARTIAL_TARGET_FORBIDDEN",
    );
  }
  const expectedByEmail = new Map(
    input.roster.identities.map((identity) => [
      identity.normalizedEmail,
      identity,
    ]),
  );
  const actualEmails = new Set<string>();
  for (const actual of input.state.identities) {
    if (actualEmails.has(actual.email)) {
      throw new SafeProductionIdentityApplyError(
        "PRODUCTION_IDENTITY_DUPLICATE_EMAIL",
      );
    }
    actualEmails.add(actual.email);
    const expected = expectedByEmail.get(actual.email);
    if (!expected || !existingIdentityMatches(expected, actual)) {
      throw new SafeProductionIdentityApplyError(
        "PRODUCTION_IDENTITY_TARGET_CONFLICT",
      );
    }
  }
  return "NOOP";
}

export async function applyProductionIdentitiesAtomically(input: {
  readonly database: ProductionIdentityApplyDatabase;
  readonly command: ProductionIdentityApplyCommand;
  readonly roster: ProductionRosterResult;
  readonly prepared: readonly PreparedProductionIdentity[];
}): Promise<{
  readonly mode: "CREATED" | "NOOP";
  readonly state: ProductionIdentityStateSnapshot;
}> {
  if (input.prepared.length !== input.roster.identities.length) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_PASSWORD_PREPARATION_MISMATCH",
    );
  }
  try {
    return await input.database.serializable(async (transaction) => {
      const before = await transaction.readState({
        rosterManifestSha: input.command.rosterManifestSha,
      });
      const plan = planProductionIdentityApply({
        roster: input.roster,
        state: before,
      });
      if (plan === "CREATE") {
        for (const prepared of input.prepared) {
          const unitId =
            prepared.identity.identityType === "FACULTY_LEADER"
              ? before.activeUnitIdsByCode.get(prepared.identity.unitCode)
              : undefined;
          if (prepared.identity.identityType === "FACULTY_LEADER" && !unitId) {
            throw new SafeProductionIdentityApplyError(
              "PRODUCTION_IDENTITY_UNIT_INVENTORY_MISMATCH",
            );
          }
          await transaction.createIdentity({
            prepared,
            unitId,
            command: input.command,
          });
        }
      }
      const after = await transaction.readState({
        rosterManifestSha: input.command.rosterManifestSha,
      });
      if (
        planProductionIdentityApply({ roster: input.roster, state: after }) !==
        "NOOP"
      ) {
        throw new SafeProductionIdentityApplyError(
          "PRODUCTION_IDENTITY_POST_APPLY_MISMATCH",
          true,
        );
      }
      return { mode: plan === "CREATE" ? "CREATED" : "NOOP", state: after };
    });
  } catch (error) {
    if (error instanceof SafeProductionIdentityApplyError) {
      throw new SafeProductionIdentityApplyError(error.code, false);
    }
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_TRANSACTION_ROLLED_BACK",
      false,
    );
  }
}

export async function runProductionIdentityApply(input: {
  readonly command: ProductionIdentityApplyCommand;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly now?: Date;
  readonly sourceSha?: () => Promise<string>;
  readonly loadRoster?: typeof loadValidatedProductionRoster;
  readonly passwordHasher?: (password: string) => Promise<string>;
  readonly database?: ProductionIdentityApplyDatabase;
}): Promise<ProductionIdentityApplyResult> {
  const environment = input.environment ?? process.env;
  const window = parseOperatorWindow(
    input.command.windowStart,
    input.command.windowEnd,
  );
  const now = input.now ?? new Date();
  if (now < window.start) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_CHANGE_WINDOW_NOT_STARTED",
    );
  }
  if (now > window.end) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_CHANGE_WINDOW_EXPIRED",
    );
  }
  const sourceSha = await (input.sourceSha ?? readEmbeddedSourceSha)();
  if (sourceSha !== input.command.expectedGitSha) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_SOURCE_SHA_MISMATCH",
    );
  }
  const secureDirectory = environment.PHASE7_SECURE_DIRECTORY;
  if (!secureDirectory) {
    throw new SafeProductionIdentityApplyError(
      "PHASE7_SECURE_DIRECTORY_REQUIRED",
    );
  }
  let loaded: Awaited<ReturnType<typeof loadValidatedProductionRoster>>;
  try {
    loaded = await (input.loadRoster ?? loadValidatedProductionRoster)(
      secureDirectory,
    );
  } catch {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_DRY_RUN_OR_RECONCILIATION_BLOCKED",
    );
  }
  if (
    loaded.roster.rosterSha256 !== input.command.rosterManifestSha ||
    loaded.manifest.canonicalSourceSha256 !== input.command.canonicalChecksum
  ) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_ROSTER_VALIDATION_MISMATCH",
    );
  }
  assertExpectedRoster(loaded.roster);
  const passwordHasher = input.passwordHasher ?? hashPassword;
  const prepared = await Promise.all(
    loaded.roster.identities.map(async (identity) => ({
      identity,
      passwordHash: await passwordHasher(
        passwordForIdentity(identity, loaded.secrets),
      ),
    })),
  );
  const database =
    input.database ??
    createProductionIdentityApplyDatabase(environment, input.command);
  try {
    const applied = await applyProductionIdentitiesAtomically({
      database,
      command: input.command,
      roster: loaded.roster,
      prepared,
    });
    const counts = countIdentityState(applied.state);
    assertExpectedCounts(counts);
    return {
      report: [
        "PRODUCTION_IDENTITY_APPLY=PASS",
        `PROVISIONING_MODE=${applied.mode}`,
        `TARGET_DATABASE=${input.command.targetDatabase}`,
        "AUTHORIZATION_GATE=PASS",
        "CHANGE_WINDOW_GATE=PASS",
        "ROSTER_SHA_GUARD=PASS",
        "CANONICAL_CHECKSUM_GUARD=PASS",
        "APPLY_TRANSACTION=SERIALIZABLE_ALL_OR_NOTHING",
        `AUTH_USER_COUNT=${counts.authUsers}`,
        `ACCESS_PROFILE_COUNT=${counts.accessProfiles}`,
        `LECTURER_MAPPING_COUNT=${counts.lecturerMappings}`,
        `LECTURER_ROLE_COUNT=${counts.lecturerRoles}`,
        `LEADER_ROLE_COUNT=${counts.leaderRoles}`,
        `LEADER_SCOPE_COUNT=${counts.leaderScopes}`,
        `MUST_CHANGE_PASSWORD_COUNT=${counts.mustChangePassword}`,
        `ADMIN_ROLE_COUNT=${counts.adminRoles}`,
        `ACTIVE_SESSION_COUNT=${counts.activeSessions}`,
        "BLOCK_COUNT=0",
        "CONFLICT_COUNT=0",
        "SECRET_LEAKAGE=0",
      ].join("\n"),
      exitCode: 0,
    };
  } finally {
    if (!input.database) await database.close().catch(() => undefined);
  }
}

export function formatProductionIdentityApplyFailure(error: unknown): string {
  const safe =
    error instanceof SafeProductionIdentityApplyError ? error : undefined;
  return [
    "PRODUCTION_IDENTITY_APPLY=BLOCKED",
    `ERROR_CODE=${safe?.code ?? "PRODUCTION_IDENTITY_APPLY_FAILED"}`,
    "AUTH_USER_COUNT=0",
    "BLOCK_COUNT=1",
    "CONFLICT_COUNT=0",
    "SECRET_LEAKAGE=0",
    `DATABASE_MUTATIONS=${safe?.mutationPossible ? "UNKNOWN_RECONCILIATION_REQUIRED" : "0"}`,
  ].join("\n");
}

function assertExpectedRoster(roster: ProductionRosterResult): void {
  const blockerCount = roster.issues
    .filter(({ severity }) => severity === "BLOCKER")
    .reduce((total, issue) => total + issue.count, 0);
  if (
    blockerCount !== 0 ||
    roster.counts.total !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedAuthUserCount ||
    roster.counts.admin !== 0 ||
    roster.identities.filter(({ identityType }) => identityType === "LECTURER")
      .length !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedLecturerMappingCount ||
    roster.identities.filter(
      ({ identityType }) => identityType === "FACULTY_LEADER",
    ).length !== PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedLeaderRoleCount ||
    roster.identities.some(
      ({ requirePasswordChange }) => requirePasswordChange !== true,
    )
  ) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_ROSTER_COUNTS_INVALID",
    );
  }
}

function existingIdentityMatches(
  expected: ProductionIdentity,
  actual: ExistingProductionIdentity,
): boolean {
  const expectedRole = expected.identityType;
  const expectedLecturerUid =
    expected.identityType === "LECTURER" ? expected.lecturerUid : null;
  const expectedUnits =
    expected.identityType === "FACULTY_LEADER" ? [expected.unitCode] : [];
  return (
    actual.displayName === expected.displayName &&
    actual.credentialAccountCount === 1 &&
    actual.credentialPasswordPresent &&
    actual.profileStatus === "ACTIVE" &&
    actual.lecturerUid === expectedLecturerUid &&
    actual.mustChangePassword === expected.requirePasswordChange &&
    actual.createdBySelf &&
    sameSet(actual.activeRoles, [expectedRole]) &&
    actual.roleGrantProvenanceSelf &&
    sameSet(actual.activeUnitCodes, expectedUnits) &&
    actual.scopeGrantProvenanceSelf &&
    actual.matchingAuditEvidenceCount === 1 &&
    actual.testIdentityMarker === expected.testIdentity
  );
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

function passwordForIdentity(
  identity: ProductionIdentity,
  secrets: Readonly<Record<string, string>>,
): string {
  const reference =
    identity.testIdentity || identity.identityType === "LECTURER"
      ? PHASE7_SECURE_INPUT_NAMES.lecturerPassword
      : identity.identityType === "FACULTY_LEADER"
        ? PHASE7_SECURE_INPUT_NAMES.leaderPasswords[identity.unitCode]
        : PHASE7_SECURE_INPUT_NAMES.productionAdminPassword;
  const password = secrets[reference];
  if (!password) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_PASSWORD_REFERENCE_MISSING",
    );
  }
  return password;
}

function createProductionIdentityApplyDatabase(
  environment: Readonly<Record<string, string | undefined>>,
  command: ProductionIdentityApplyCommand,
): ProductionIdentityApplyDatabase {
  const connectionString = assertProvisioningConnection(environment, command);
  const pool = new Pool({
    connectionString,
    application_name: "ueb-core-phase7-production-identity-apply",
    max: 1,
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: false }),
  });
  return {
    async serializable<T>(
      operation: (
        transaction: ProductionIdentityApplyTransaction,
      ) => Promise<T>,
    ): Promise<T> {
      return prisma.$transaction(
        async (transaction) =>
          operation(createPrismaApplyTransaction(transaction)),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 300_000,
        },
      );
    },
    async close(): Promise<void> {
      await prisma.$disconnect().catch(() => undefined);
      await pool.end().catch(() => undefined);
    },
  };
}

export function assertProvisioningConnection(
  environment: Readonly<Record<string, string | undefined>>,
  command: ProductionIdentityApplyCommand,
): string {
  const value = environment.PHASE7_PROVISIONING_DATABASE_URL;
  if (!value) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_PROVISIONING_CREDENTIAL_MISSING",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_PROVISIONING_URL_INVALID",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.pathname.slice(1)) !== command.targetDatabase ||
    decodeURIComponent(url.username) !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.provisionerRole ||
    !url.password ||
    !environment.PRODUCTION_DATABASE_HOST ||
    url.hostname !== environment.PRODUCTION_DATABASE_HOST ||
    environment.PRODUCTION_DATABASE_PUBLIC_PORT !== "NO"
  ) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_PROVISIONING_URL_MISMATCH",
    );
  }
  return url.toString();
}

type PrismaTransaction = Prisma.TransactionClient;

function createPrismaApplyTransaction(
  transaction: PrismaTransaction,
): ProductionIdentityApplyTransaction {
  return {
    async readState({ rosterManifestSha }) {
      const [users, sessions, units, audits] = await Promise.all([
        transaction.auth_user.findMany({
          include: {
            auth_accounts: true,
            accessProfile: true,
            roleAssignments: true,
            unitScopeAssignments: { include: { organizationUnit: true } },
          },
        }),
        transaction.auth_session.count(),
        transaction.organizationUnit.findMany({
          where: { isActive: true },
          select: { id: true, unitKey: true },
        }),
        transaction.authAuditEvent.findMany({
          where: { eventType: "PROVISIONING_BATCH_RECONCILED" },
          select: { targetUserId: true, metadata: true },
        }),
      ]);
      const auditByUser = new Map<
        string,
        { count: number; test: boolean | null }
      >();
      for (const audit of audits) {
        if (!audit.targetUserId || !isRecord(audit.metadata)) continue;
        if (audit.metadata.phase7RosterManifestSha !== rosterManifestSha)
          continue;
        const current = auditByUser.get(audit.targetUserId) ?? {
          count: 0,
          test: null,
        };
        auditByUser.set(audit.targetUserId, {
          count: current.count + 1,
          test:
            typeof audit.metadata.testIdentity === "boolean"
              ? audit.metadata.testIdentity
              : null,
        });
      }
      return {
        activeSessionCount: sessions,
        activeUnitIdsByCode: new Map(
          units.map(({ unitKey, id }) => [unitKey, id]),
        ),
        identities: users.map((user) => {
          const credentials = user.auth_accounts.filter(
            ({ providerId }) => providerId === "credential",
          );
          const activeRoles = user.roleAssignments.filter(
            ({ revokedAt }) => revokedAt === null,
          );
          const activeScopes = user.unitScopeAssignments.filter(
            ({ revokedAt }) => revokedAt === null,
          );
          const evidence = auditByUser.get(user.id);
          return {
            userId: user.id,
            email: user.email,
            displayName: user.name,
            credentialAccountCount: credentials.length,
            credentialPasswordPresent:
              credentials.length === 1 && credentials[0]?.password != null,
            profileStatus: user.accessProfile?.status ?? null,
            lecturerUid: user.accessProfile?.lecturerUid ?? null,
            mustChangePassword: user.accessProfile?.mustChangePassword ?? null,
            createdBySelf: user.accessProfile?.createdBy === user.id,
            activeRoles: activeRoles.map(({ role }) => role),
            roleGrantProvenanceSelf: activeRoles.every(
              ({ grantedBy }) => grantedBy === user.id,
            ),
            activeUnitCodes: activeScopes.map(
              ({ organizationUnit }) => organizationUnit.unitKey,
            ),
            scopeGrantProvenanceSelf: activeScopes.every(
              ({ grantedBy }) => grantedBy === user.id,
            ),
            matchingAuditEvidenceCount: evidence?.count ?? 0,
            testIdentityMarker: evidence?.test ?? null,
          };
        }),
      };
    },
    async createIdentity({ prepared, unitId, command }) {
      const { identity, passwordHash } = prepared;
      const userId = randomUUID();
      const role =
        identity.identityType === "LECTURER"
          ? BusinessRole.LECTURER
          : identity.identityType === "FACULTY_LEADER"
            ? BusinessRole.FACULTY_LEADER
            : BusinessRole.ADMIN;
      await transaction.auth_user.create({
        data: {
          id: userId,
          email: identity.normalizedEmail,
          emailVerified: false,
          name: identity.displayName,
        },
      });
      await transaction.auth_account.create({
        data: {
          id: randomUUID(),
          accountId: userId,
          providerId: "credential",
          userId,
          password: passwordHash,
        },
      });
      await transaction.accessProfile.create({
        data: {
          id: randomUUID(),
          userId,
          lecturerUid:
            identity.identityType === "LECTURER" ? identity.lecturerUid : null,
          status: AccessProfileStatus.ACTIVE,
          mustChangePassword: identity.requirePasswordChange,
          createdBy: userId,
        },
      });
      await transaction.roleAssignment.create({
        data: {
          id: randomUUID(),
          userId,
          role,
          grantedBy: userId,
        },
      });
      if (unitId) {
        await transaction.unitScopeAssignment.create({
          data: {
            id: randomUUID(),
            userId,
            organizationUnitId: unitId,
            grantedBy: userId,
          },
        });
      }
      await transaction.authAuditEvent.create({
        data: {
          id: randomUUID(),
          eventType: "PROVISIONING_BATCH_RECONCILED",
          outcome: "SUCCESS",
          actorUserId: null,
          targetUserId: userId,
          identifierHash: null,
          metadata: {
            phase7RosterManifestSha: command.rosterManifestSha,
            phase7AuthorizationReference: command.authorizationReference,
            provisioningStatus: "CREATED",
            identityType: identity.identityType,
            testIdentity: identity.testIdentity,
            requirePasswordChange: identity.requirePasswordChange,
            unitCode:
              identity.identityType === "FACULTY_LEADER"
                ? identity.unitCode
                : null,
            grantProvenance: "SELF_BOOTSTRAP",
          },
        },
      });
    },
  };
}

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface IdentityCounts {
  readonly authUsers: number;
  readonly accessProfiles: number;
  readonly lecturerMappings: number;
  readonly lecturerRoles: number;
  readonly leaderRoles: number;
  readonly leaderScopes: number;
  readonly mustChangePassword: number;
  readonly adminRoles: number;
  readonly activeSessions: number;
}

function countIdentityState(
  state: ProductionIdentityStateSnapshot,
): IdentityCounts {
  return {
    authUsers: state.identities.length,
    accessProfiles: state.identities.filter(
      ({ profileStatus }) => profileStatus !== null,
    ).length,
    lecturerMappings: state.identities.filter(
      ({ lecturerUid }) => lecturerUid !== null,
    ).length,
    lecturerRoles: state.identities.filter(({ activeRoles }) =>
      activeRoles.includes("LECTURER"),
    ).length,
    leaderRoles: state.identities.filter(({ activeRoles }) =>
      activeRoles.includes("FACULTY_LEADER"),
    ).length,
    leaderScopes: state.identities.reduce(
      (total, { activeUnitCodes }) => total + activeUnitCodes.length,
      0,
    ),
    mustChangePassword: state.identities.filter(
      ({ mustChangePassword }) => mustChangePassword === true,
    ).length,
    adminRoles: state.identities.filter(({ activeRoles }) =>
      activeRoles.includes("ADMIN"),
    ).length,
    activeSessions: state.activeSessionCount,
  };
}

function assertExpectedCounts(counts: IdentityCounts): void {
  if (
    counts.authUsers !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedAuthUserCount ||
    counts.accessProfiles !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedAccessProfileCount ||
    counts.lecturerMappings !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedLecturerMappingCount ||
    counts.lecturerRoles !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedLecturerRoleCount ||
    counts.leaderRoles !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedLeaderRoleCount ||
    counts.leaderScopes !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedLeaderScopeCount ||
    counts.mustChangePassword !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedMustChangePasswordCount ||
    counts.adminRoles !==
      PRODUCTION_IDENTITY_APPLY_CONTRACT.expectedAdminRoleCount ||
    counts.activeSessions !== 0
  ) {
    throw new SafeProductionIdentityApplyError(
      "PRODUCTION_IDENTITY_FINAL_COUNTS_MISMATCH",
      true,
    );
  }
}
