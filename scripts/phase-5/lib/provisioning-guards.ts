import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";

import type {
  Prisma,
  PrismaClient,
} from "../../../src/generated/prisma/client";
import { Client } from "pg";
import { z } from "zod";

import {
  APPROVED_UNIT_SOURCE_VALUES,
  approvedLeaderSchema,
  approvedLecturerSchema,
  validateIdentityInputDocuments,
  type ApprovedLeaderInput,
  type ApprovedLecturerInput,
} from "./identity-input-schema";

const MAX_BATCH_RECORDS = 20;
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const UAT_DATABASE = /^ueb_core_uat(?:_[a-z0-9]+)*$/u;
const DATABASE_IDENTIFIER = /^[a-z][a-z0-9_]*$/u;
const SAFE_BATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export type ProvisioningErrorCode =
  | "INPUT_FILE_GUARD_FAILED"
  | "INPUT_PARSE_FAILED"
  | "INPUT_VALIDATION_FAILED"
  | "INPUT_CHECKSUM_MISMATCH"
  | "APPROVAL_BATCH_MISMATCH"
  | "BATCH_LIMIT_EXCEEDED"
  | "DATABASE_GUARD_FAILED"
  | "ACTOR_NOT_ACTIVE_ADMIN"
  | "BATCH_CHECKSUM_CONFLICT"
  | "BATCH_ALREADY_ROLLED_BACK"
  | "ACCOUNT_ACTION_CONFLICT"
  | "ACCOUNT_NOT_FOUND"
  | "ACCESS_PROFILE_NOT_FOUND"
  | "ACCESS_PROFILE_NOT_ACTIVE"
  | "LECTURER_SOURCE_MISMATCH"
  | "LECTURER_MAPPING_CONFLICT"
  | "UNIT_NOT_FOUND"
  | "RETAIN_CONTRACT_MISMATCH";

export class SafeProvisioningError extends Error {
  constructor(readonly code: ProvisioningErrorCode) {
    super(code);
  }
}

const provisioningBundleSchema = z
  .object({
    lecturers: z.array(approvedLecturerSchema),
    leaders: z.array(approvedLeaderSchema),
  })
  .strict();

export interface ProvisioningBundle {
  readonly lecturers: readonly ApprovedLecturerInput[];
  readonly leaders: readonly ApprovedLeaderInput[];
}

export interface ProvisioningCommand {
  readonly inputPath: string;
  readonly approvalBatchId: string;
  readonly inputChecksum: string;
  readonly expectedDatabase: string;
  readonly apply: boolean;
  readonly actorUserId: string;
  readonly credentialOutputPath?: string;
  readonly restoreRehearsalChecksum?: string;
}

export interface ReconciliationCommand {
  readonly inputPath: string;
  readonly approvalBatchId: string;
  readonly inputChecksum: string;
  readonly expectedDatabase: string;
}

export interface RollbackCommand {
  readonly inputPath?: string;
  readonly approvalBatchId: string;
  readonly inputChecksum: string;
  readonly expectedDatabase: string;
  readonly apply: boolean;
  readonly actorUserId?: string;
}

export interface ProvisioningDatabaseContext {
  readonly targetFingerprint: string;
  readonly databaseName: string;
  readonly runtimeUser: string;
}

type ProvisioningReadClient = Pick<
  PrismaClient,
  | "auth_user"
  | "organizationUnit"
  | "uebCoreData"
  | "authAuditEvent"
  | "roleAssignment"
>;

export interface ProvisioningBlocker {
  readonly source: "BATCH" | "LECTURERS" | "LEADERS";
  readonly rowNumber: number;
  readonly code: ProvisioningErrorCode;
}

export interface PlannedUnitScope {
  readonly unitUid: string;
  readonly organizationUnitId: string;
}

export interface ProvisioningPlanEntry {
  readonly source: "LECTURERS" | "LEADERS";
  readonly rowNumber: number;
  readonly email: string;
  readonly targetUserId?: string;
  readonly createAccount: boolean;
  readonly lecturerUid?: string;
  readonly assignLecturerMapping: boolean;
  readonly rolesToGrant: readonly ("LECTURER" | "FACULTY_LEADER")[];
  readonly unitScopesToGrant: readonly PlannedUnitScope[];
  readonly needsReconciliationMarker: boolean;
}

export interface ProvisioningPlan {
  readonly entries: readonly ProvisioningPlanEntry[];
  readonly blockers: readonly ProvisioningBlocker[];
  readonly createCount: number;
  readonly updateCount: number;
  readonly roleAssignmentCount: number;
  readonly lecturerMappingCount: number;
  readonly unitScopeAssignmentCount: number;
}

export interface BatchEvidence {
  readonly targetUserId: string;
  readonly eventType: string;
  readonly role?: "LECTURER" | "FACULTY_LEADER";
  readonly organizationUnitId?: string;
}

export function parseProvisioningCommand(
  arguments_: readonly string[],
): ProvisioningCommand {
  const args = normalizeArguments(arguments_);
  const base = parseCommonInputArguments(args);
  const apply = args.includes("--confirm-apply");
  const actors = valuesFor(args, "--actor-user-id=");
  const credentialOutputs = valuesFor(args, "--credential-output=");
  const restoreChecksums = valuesFor(args, "--restore-rehearsal-checksum=");
  assertKnownArguments(args, [
    "--confirm-apply",
    "--confirm-rollback-dry-run-pass",
    "--input=",
    "--approval-batch-id=",
    "--input-checksum=",
    "--expected-database=",
    "--actor-user-id=",
    "--credential-output=",
    "--restore-rehearsal-checksum=",
  ]);

  if (actors.length !== 1 || !z.uuid().safeParse(actors[0]).success) {
    throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
  }
  if (apply) {
    if (
      credentialOutputs.length !== 1 ||
      restoreChecksums.length !== 1 ||
      !args.includes("--confirm-rollback-dry-run-pass") ||
      !SHA256.test(restoreChecksums[0]!)
    ) {
      throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
    }
  } else if (
    credentialOutputs.length > 0 ||
    restoreChecksums.length > 0 ||
    args.includes("--confirm-rollback-dry-run-pass")
  ) {
    throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
  }

  return {
    ...base,
    apply,
    actorUserId: actors[0]!,
    credentialOutputPath: credentialOutputs[0],
    restoreRehearsalChecksum: restoreChecksums[0],
  };
}

export function parseReconciliationCommand(
  arguments_: readonly string[],
): ReconciliationCommand {
  const args = normalizeArguments(arguments_);
  assertKnownArguments(args, [
    "--input=",
    "--approval-batch-id=",
    "--input-checksum=",
    "--expected-database=",
  ]);
  return parseCommonInputArguments(args);
}

export function parseRollbackCommand(
  arguments_: readonly string[],
): RollbackCommand {
  const args = normalizeArguments(arguments_);
  assertKnownArguments(args, [
    "--input=",
    "--approval-batch-id=",
    "--input-checksum=",
    "--expected-database=",
    "--confirm-rollback",
    "--actor-user-id=",
  ]);
  const approvalBatchIds = valuesFor(args, "--approval-batch-id=");
  const inputs = valuesFor(args, "--input=");
  const checksums = valuesFor(args, "--input-checksum=");
  const databases = valuesFor(args, "--expected-database=");
  const actors = valuesFor(args, "--actor-user-id=");
  const apply = args.includes("--confirm-rollback");
  if (
    approvalBatchIds.length !== 1 ||
    checksums.length !== 1 ||
    databases.length !== 1 ||
    !SAFE_BATCH_ID.test(approvalBatchIds[0]!) ||
    !SHA256.test(checksums[0]!) ||
    (!apply && inputs.length !== 1) ||
    (apply && inputs.length > 1)
  ) {
    throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
  }
  assertUatDatabaseName(databases[0]!);
  if (
    (apply &&
      (actors.length !== 1 || !z.uuid().safeParse(actors[0]).success)) ||
    (!apply && actors.length > 0)
  ) {
    throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
  }
  return {
    inputPath: inputs[0],
    approvalBatchId: approvalBatchIds[0]!,
    inputChecksum: checksums[0]!,
    expectedDatabase: databases[0]!,
    apply,
    actorUserId: actors[0],
  };
}

export async function loadProvisioningBundle(input: {
  readonly inputPath: string;
  readonly approvalBatchId: string;
  readonly expectedChecksum: string;
  readonly cwd?: string;
}): Promise<{
  readonly bundle: ProvisioningBundle;
  readonly checksum: string;
}> {
  const inputPath = await assertExternalJsonFile(
    input.inputPath,
    input.cwd ?? process.cwd(),
  );
  const bytes = await readFile(inputPath);
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new SafeProvisioningError("INPUT_FILE_GUARD_FAILED");
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== input.expectedChecksum) {
    throw new SafeProvisioningError("INPUT_CHECKSUM_MISMATCH");
  }
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new SafeProvisioningError("INPUT_PARSE_FAILED");
  }
  const parsed = provisioningBundleSchema.safeParse(document);
  if (!parsed.success) {
    throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
  }
  const validation = validateIdentityInputDocuments(
    parsed.data.lecturers,
    parsed.data.leaders,
  );
  if (validation.unresolvedAmbiguityCount !== 0) {
    throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
  }
  const rows = [...parsed.data.lecturers, ...parsed.data.leaders];
  if (rows.length === 0 || rows.length > MAX_BATCH_RECORDS) {
    throw new SafeProvisioningError("BATCH_LIMIT_EXCEEDED");
  }
  if (rows.some((row) => row.approval_batch_id !== input.approvalBatchId)) {
    throw new SafeProvisioningError("APPROVAL_BATCH_MISMATCH");
  }
  return { bundle: parsed.data, checksum };
}

export async function assertProvisioningDatabaseSafety(
  environment: Readonly<Record<string, string | undefined>>,
  expectedDatabase: string,
): Promise<ProvisioningDatabaseContext> {
  assertUatDatabaseName(expectedDatabase);
  if (environment.NODE_ENV === "production") {
    throw new SafeProvisioningError("DATABASE_GUARD_FAILED");
  }
  const ownerUrl = parseGuardedDatabaseUrl(
    environment.MIGRATION_DATABASE_URL,
    expectedDatabase,
  );
  const runtimeUrl = parseGuardedDatabaseUrl(
    environment.DATABASE_URL,
    expectedDatabase,
  );
  const ownerUser = decodeURIComponent(ownerUrl.username);
  const runtimeUser = decodeURIComponent(runtimeUrl.username);
  if (
    ownerUser === runtimeUser ||
    ownerUrl.hostname !== runtimeUrl.hostname ||
    ownerUrl.port !== runtimeUrl.port ||
    (environment.POSTGRES_USER && environment.POSTGRES_USER !== ownerUser) ||
    (environment.APP_DATABASE_USER &&
      environment.APP_DATABASE_USER !== runtimeUser)
  ) {
    throw new SafeProvisioningError("DATABASE_GUARD_FAILED");
  }

  const owner = new Client({
    connectionString: ownerUrl.toString(),
    application_name: "ueb-core-phase5-provisioning-owner-guard",
  });
  const runtime = new Client({
    connectionString: runtimeUrl.toString(),
    application_name: "ueb-core-phase5-provisioning-runtime-guard",
  });
  try {
    await Promise.all([owner.connect(), runtime.connect()]);
    const [ownerState, runtimeState, migrations] = await Promise.all([
      owner.query<{
        current_user: string;
        database_owner: string;
      }>(
        `SELECT current_user, pg_get_userbyid(datdba) AS database_owner
         FROM pg_database WHERE datname = current_database()`,
      ),
      runtime.query<{
        current_user: string;
        current_database: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `SELECT current_user, current_database(), rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`,
      ),
      owner.query<{ applied: number; pending: number }>(
        `SELECT
           count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::integer AS applied,
           count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::integer AS pending
         FROM public._prisma_migrations`,
      ),
    ]);
    const ownerRow = ownerState.rows[0];
    const runtimeRow = runtimeState.rows[0];
    const migrationRow = migrations.rows[0];
    if (
      !ownerRow ||
      ownerRow.current_user !== ownerUser ||
      ownerRow.database_owner !== ownerUser ||
      !runtimeRow ||
      runtimeRow.current_user !== runtimeUser ||
      runtimeRow.current_database !== expectedDatabase ||
      runtimeRow.rolsuper ||
      runtimeRow.rolbypassrls ||
      !migrationRow ||
      migrationRow.applied !== 7 ||
      migrationRow.pending !== 0
    ) {
      throw new SafeProvisioningError("DATABASE_GUARD_FAILED");
    }
  } catch (error) {
    if (error instanceof SafeProvisioningError) throw error;
    throw new SafeProvisioningError("DATABASE_GUARD_FAILED");
  } finally {
    await Promise.all([
      owner.end().catch(() => undefined),
      runtime.end().catch(() => undefined),
    ]);
  }
  return {
    databaseName: expectedDatabase,
    runtimeUser,
    targetFingerprint: createHash("sha256")
      .update(
        `${runtimeUrl.hostname}:${runtimeUrl.port}/${expectedDatabase}/${runtimeUser}`,
      )
      .digest("hex"),
  };
}

export async function buildProvisioningPlan(input: {
  readonly prisma: ProvisioningReadClient;
  readonly bundle: ProvisioningBundle;
  readonly approvalBatchId: string;
  readonly inputChecksum: string;
}): Promise<ProvisioningPlan> {
  const { prisma, bundle, approvalBatchId, inputChecksum } = input;
  const identities = [...bundle.lecturers, ...bundle.leaders];
  const emails = identities.map((row) => row.email);
  const unitUids = [...new Set(bundle.leaders.flatMap((row) => row.unit_uid))];
  const sourceValues = unitUids.map(
    (unitUid) =>
      APPROVED_UNIT_SOURCE_VALUES[
        unitUid as keyof typeof APPROVED_UNIT_SOURCE_VALUES
      ],
  );
  const [users, units, coreRows, evidenceRows] = await Promise.all([
    prisma.auth_user.findMany({
      where: { email: { in: emails } },
      include: {
        accessProfile: true,
        roleAssignments: { where: { revokedAt: null } },
        unitScopeAssignments: { where: { revokedAt: null } },
      },
    }),
    prisma.organizationUnit.findMany({
      where: { sourceValue: { in: sourceValues }, isActive: true },
      select: { id: true, sourceValue: true },
    }),
    prisma.uebCoreData.findMany({
      select: { emailTaiKhoanVnu: true, lecturerUid: true },
    }),
    prisma.authAuditEvent.findMany({
      where: {
        metadata: {
          path: ["phase5ApprovalBatchId"],
          equals: approvalBatchId,
        },
      },
      select: { targetUserId: true, metadata: true },
    }),
  ]);
  const blockers: ProvisioningBlocker[] = [];
  const entries: ProvisioningPlanEntry[] = [];
  const userByEmail = new Map(users.map((user) => [user.email, user]));
  const unitBySource = new Map(units.map((unit) => [unit.sourceValue, unit]));
  const lecturerMatches = new Map<string, Set<string>>();
  for (const row of coreRows) {
    if (!row.emailTaiKhoanVnu) continue;
    const email = row.emailTaiKhoanVnu.trim().toLowerCase();
    const matches = lecturerMatches.get(email) ?? new Set<string>();
    matches.add(row.lecturerUid);
    lecturerMatches.set(email, matches);
  }
  const evidenceTargets = new Set<string>();
  for (const row of evidenceRows) {
    const metadata = jsonObject(row.metadata);
    if (metadata.phase5InputChecksum !== inputChecksum) {
      blockers.push(blocker("BATCH", 0, "BATCH_CHECKSUM_CONFLICT"));
    }
    if (metadata.phase5Operation === "ROLLBACK") {
      blockers.push(blocker("BATCH", 0, "BATCH_ALREADY_ROLLED_BACK"));
    }
    if (row.targetUserId && metadata.phase5Operation === "APPLY") {
      evidenceTargets.add(row.targetUserId);
    }
  }

  for (const [index, row] of bundle.lecturers.entries()) {
    const rowNumber = index + 1;
    const user = userByEmail.get(row.email);
    const matches = lecturerMatches.get(row.email) ?? new Set<string>();
    if (matches.size !== 1 || !matches.has(row.lecturer_uid)) {
      blockers.push(
        blocker("LECTURERS", rowNumber, "LECTURER_SOURCE_MISMATCH"),
      );
      continue;
    }
    if (row.account_action === "CREATE") {
      if (user && !evidenceTargets.has(user.id)) {
        blockers.push(
          blocker("LECTURERS", rowNumber, "ACCOUNT_ACTION_CONFLICT"),
        );
        continue;
      }
      if (!user) {
        entries.push({
          source: "LECTURERS",
          rowNumber,
          email: row.email,
          createAccount: true,
          lecturerUid: row.lecturer_uid,
          assignLecturerMapping: true,
          rolesToGrant: ["LECTURER"],
          unitScopesToGrant: [],
          needsReconciliationMarker: false,
        });
        continue;
      }
    } else if (!user) {
      blockers.push(blocker("LECTURERS", rowNumber, "ACCOUNT_NOT_FOUND"));
      continue;
    }
    if (!user?.accessProfile) {
      blockers.push(
        blocker("LECTURERS", rowNumber, "ACCESS_PROFILE_NOT_FOUND"),
      );
      continue;
    }
    if (user.accessProfile.status !== "ACTIVE") {
      blockers.push(
        blocker("LECTURERS", rowNumber, "ACCESS_PROFILE_NOT_ACTIVE"),
      );
      continue;
    }
    if (
      user.accessProfile.lecturerUid &&
      user.accessProfile.lecturerUid !== row.lecturer_uid
    ) {
      blockers.push(
        blocker("LECTURERS", rowNumber, "LECTURER_MAPPING_CONFLICT"),
      );
      continue;
    }
    const hasLecturerRole = user.roleAssignments.some(
      ({ role }) => role === "LECTURER",
    );
    const assignLecturerMapping = !user.accessProfile.lecturerUid;
    entries.push({
      source: "LECTURERS",
      rowNumber,
      email: row.email,
      targetUserId: user.id,
      createAccount: false,
      lecturerUid: row.lecturer_uid,
      assignLecturerMapping,
      rolesToGrant: hasLecturerRole ? [] : ["LECTURER"],
      unitScopesToGrant: [],
      needsReconciliationMarker:
        !assignLecturerMapping &&
        hasLecturerRole &&
        !evidenceTargets.has(user.id),
    });
  }

  for (const [index, row] of bundle.leaders.entries()) {
    const rowNumber = index + 1;
    const user = userByEmail.get(row.email);
    if (!user) {
      blockers.push(blocker("LEADERS", rowNumber, "ACCOUNT_NOT_FOUND"));
      continue;
    }
    if (!user.accessProfile) {
      blockers.push(blocker("LEADERS", rowNumber, "ACCESS_PROFILE_NOT_FOUND"));
      continue;
    }
    if (user.accessProfile.status !== "ACTIVE") {
      blockers.push(blocker("LEADERS", rowNumber, "ACCESS_PROFILE_NOT_ACTIVE"));
      continue;
    }
    const requestedUnits: PlannedUnitScope[] = [];
    let unitMissing = false;
    for (const unitUid of row.unit_uid) {
      const sourceValue =
        APPROVED_UNIT_SOURCE_VALUES[
          unitUid as keyof typeof APPROVED_UNIT_SOURCE_VALUES
        ];
      const unit = unitBySource.get(sourceValue);
      if (!unit) {
        blockers.push(blocker("LEADERS", rowNumber, "UNIT_NOT_FOUND"));
        unitMissing = true;
        continue;
      }
      requestedUnits.push({ unitUid, organizationUnitId: unit.id });
    }
    if (unitMissing) continue;
    const activeUnitIds = new Set(
      user.unitScopeAssignments.map(
        ({ organizationUnitId }) => organizationUnitId,
      ),
    );
    const hasLeaderRole = user.roleAssignments.some(
      ({ role }) => role === "FACULTY_LEADER",
    );
    const missingUnits = requestedUnits.filter(
      ({ organizationUnitId }) => !activeUnitIds.has(organizationUnitId),
    );
    if (
      row.scope_action === "RETAIN" &&
      (!hasLeaderRole || missingUnits.length > 0)
    ) {
      blockers.push(blocker("LEADERS", rowNumber, "RETAIN_CONTRACT_MISMATCH"));
      continue;
    }
    entries.push({
      source: "LEADERS",
      rowNumber,
      email: row.email,
      targetUserId: user.id,
      createAccount: false,
      assignLecturerMapping: false,
      rolesToGrant:
        row.scope_action === "ASSIGN" && !hasLeaderRole
          ? ["FACULTY_LEADER"]
          : [],
      unitScopesToGrant: row.scope_action === "ASSIGN" ? missingUnits : [],
      needsReconciliationMarker:
        missingUnits.length === 0 &&
        hasLeaderRole &&
        !evidenceTargets.has(user.id),
    });
  }

  const uniqueBlockers = deduplicateBlockers(blockers);
  return summarizePlan(entries, uniqueBlockers);
}

export async function assertActiveAdminActor(input: {
  readonly prisma: Pick<PrismaClient, "roleAssignment">;
  readonly actorUserId: string;
}): Promise<void> {
  const actorRole = await input.prisma.roleAssignment.findFirst({
    where: {
      userId: input.actorUserId,
      role: "ADMIN",
      revokedAt: null,
      user: { accessProfile: { status: "ACTIVE" } },
    },
    select: { id: true },
  });
  if (!actorRole) {
    throw new SafeProvisioningError("ACTOR_NOT_ACTIVE_ADMIN");
  }
}

export async function readBatchEvidence(input: {
  readonly prisma: PrismaClient;
  readonly approvalBatchId: string;
  readonly inputChecksum: string;
  readonly operation?: "APPLY" | "ROLLBACK";
}): Promise<readonly BatchEvidence[]> {
  const rows = await input.prisma.authAuditEvent.findMany({
    where: {
      metadata: {
        path: ["phase5ApprovalBatchId"],
        equals: input.approvalBatchId,
      },
    },
    select: { eventType: true, targetUserId: true, metadata: true },
  });
  const evidence: BatchEvidence[] = [];
  for (const row of rows) {
    if (!row.targetUserId) continue;
    const metadata = jsonObject(row.metadata);
    if (
      metadata.phase5InputChecksum !== input.inputChecksum ||
      (input.operation && metadata.phase5Operation !== input.operation)
    ) {
      continue;
    }
    const role =
      metadata.role === "LECTURER" || metadata.role === "FACULTY_LEADER"
        ? metadata.role
        : undefined;
    const organizationUnitId =
      typeof metadata.organizationUnitId === "string"
        ? metadata.organizationUnitId
        : undefined;
    evidence.push({
      targetUserId: row.targetUserId,
      eventType: row.eventType,
      role,
      organizationUnitId,
    });
  }
  return evidence;
}

export async function assertExternalOutputPath(
  outputPath: string,
  cwd = process.cwd(),
): Promise<string> {
  if (!isAbsolute(outputPath) || !outputPath.endsWith(".json")) {
    throw new SafeProvisioningError("INPUT_FILE_GUARD_FAILED");
  }
  const workspacePath = await realpath(resolve(cwd));
  let resolvedOutput: string;
  try {
    const resolvedParent = await realpath(dirname(outputPath));
    resolvedOutput = resolve(resolvedParent, basename(outputPath));
  } catch {
    throw new SafeProvisioningError("INPUT_FILE_GUARD_FAILED");
  }
  if (
    resolvedOutput === workspacePath ||
    resolvedOutput.startsWith(`${workspacePath}${sep}`)
  ) {
    throw new SafeProvisioningError("INPUT_FILE_GUARD_FAILED");
  }
  try {
    await lstat(resolvedOutput);
  } catch {
    return resolvedOutput;
  }
  throw new SafeProvisioningError("INPUT_FILE_GUARD_FAILED");
}

function parseCommonInputArguments(
  args: readonly string[],
): ReconciliationCommand {
  const inputs = valuesFor(args, "--input=");
  const approvalBatchIds = valuesFor(args, "--approval-batch-id=");
  const checksums = valuesFor(args, "--input-checksum=");
  const databases = valuesFor(args, "--expected-database=");
  if (
    inputs.length !== 1 ||
    approvalBatchIds.length !== 1 ||
    checksums.length !== 1 ||
    databases.length !== 1 ||
    !SAFE_BATCH_ID.test(approvalBatchIds[0]!) ||
    !SHA256.test(checksums[0]!)
  ) {
    throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
  }
  assertUatDatabaseName(databases[0]!);
  return {
    inputPath: inputs[0]!,
    approvalBatchId: approvalBatchIds[0]!,
    inputChecksum: checksums[0]!,
    expectedDatabase: databases[0]!,
  };
}

function normalizeArguments(arguments_: readonly string[]): readonly string[] {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  if (args.includes("--")) {
    throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
  }
  return args;
}

function assertKnownArguments(
  args: readonly string[],
  allowed: readonly string[],
): void {
  const unknown = args.filter(
    (argument) =>
      !allowed.some((candidate) =>
        candidate.endsWith("=")
          ? argument.startsWith(candidate)
          : argument === candidate,
      ),
  );
  const duplicateFlags = allowed
    .filter((candidate) => !candidate.endsWith("="))
    .some(
      (candidate) =>
        args.filter((argument) => argument === candidate).length > 1,
    );
  if (unknown.length > 0 || duplicateFlags) {
    throw new SafeProvisioningError("INPUT_VALIDATION_FAILED");
  }
}

function valuesFor(args: readonly string[], prefix: string): string[] {
  return args
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length))
    .filter((value) => value.length > 0);
}

function assertUatDatabaseName(databaseName: string): void {
  if (
    !DATABASE_IDENTIFIER.test(databaseName) ||
    !UAT_DATABASE.test(databaseName) ||
    databaseName === "ueb_core" ||
    Buffer.byteLength(databaseName, "utf8") > 63
  ) {
    throw new SafeProvisioningError("DATABASE_GUARD_FAILED");
  }
}

function parseGuardedDatabaseUrl(
  value: string | undefined,
  expectedDatabase: string,
): URL {
  if (!value) throw new SafeProvisioningError("DATABASE_GUARD_FAILED");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeProvisioningError("DATABASE_GUARD_FAILED");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    url.port !== "55432" ||
    decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase ||
    !url.username ||
    !url.password
  ) {
    throw new SafeProvisioningError("DATABASE_GUARD_FAILED");
  }
  return url;
}

async function assertExternalJsonFile(
  inputPath: string,
  cwd: string,
): Promise<string> {
  if (!isAbsolute(inputPath) || !inputPath.endsWith(".json")) {
    throw new SafeProvisioningError("INPUT_FILE_GUARD_FAILED");
  }
  try {
    const [workspacePath, resolvedPath, metadata] = await Promise.all([
      realpath(resolve(cwd)),
      realpath(inputPath),
      lstat(inputPath),
    ]);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      resolvedPath === workspacePath ||
      resolvedPath.startsWith(`${workspacePath}${sep}`)
    ) {
      throw new SafeProvisioningError("INPUT_FILE_GUARD_FAILED");
    }
    return resolvedPath;
  } catch (error) {
    if (error instanceof SafeProvisioningError) throw error;
    throw new SafeProvisioningError("INPUT_FILE_GUARD_FAILED");
  }
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function blocker(
  source: ProvisioningBlocker["source"],
  rowNumber: number,
  code: ProvisioningErrorCode,
): ProvisioningBlocker {
  return { source, rowNumber, code };
}

function deduplicateBlockers(
  blockers: readonly ProvisioningBlocker[],
): ProvisioningBlocker[] {
  const seen = new Set<string>();
  return blockers.filter((candidate) => {
    const key = `${candidate.source}:${candidate.rowNumber}:${candidate.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizePlan(
  entries: readonly ProvisioningPlanEntry[],
  blockers: readonly ProvisioningBlocker[],
): ProvisioningPlan {
  return {
    entries,
    blockers,
    createCount: entries.filter(({ createAccount }) => createAccount).length,
    updateCount: entries.filter(
      (entry) =>
        !entry.createAccount &&
        (entry.assignLecturerMapping ||
          entry.rolesToGrant.length > 0 ||
          entry.unitScopesToGrant.length > 0),
    ).length,
    roleAssignmentCount: entries.reduce(
      (count, entry) => count + entry.rolesToGrant.length,
      0,
    ),
    lecturerMappingCount: entries.filter(
      ({ assignLecturerMapping }) => assignLecturerMapping,
    ).length,
    unitScopeAssignmentCount: entries.reduce(
      (count, entry) => count + entry.unitScopesToGrant.length,
      0,
    ),
  };
}
