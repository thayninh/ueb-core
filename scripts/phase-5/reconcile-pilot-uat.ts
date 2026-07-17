import "dotenv/config";

import { pathToFileURL } from "node:url";

import { Client, type ClientBase } from "pg";

import {
  assertMigrationRoleOwnsSource,
  assertUatDatabase,
  readUatOwnerDatabaseContext,
  SafePhase5DatabaseError,
} from "./lib/database-guards";
import { APPROVED_UNIT_SOURCE_VALUES } from "./lib/identity-input-schema";
import {
  assertUatRuntimeContract,
  readUatBaselineReport,
  type UatBaselineReport,
} from "./lib/uat-database";

const SAFE_BATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PILOT_UNIT = "KTPT";
const EXPECTED_PILOT_TARGETS = 6;
const EXPECTED_PILOT_LECTURERS = 5;
const EXPECTED_PILOT_LEADERS = 1;

export interface PilotUatReconciliationCommand {
  readonly targetDatabase: string;
  readonly approvalBatchId: string;
  readonly inputChecksum: string;
  readonly pilotUnit: typeof PILOT_UNIT;
}

export interface PilotIdentityReport {
  readonly pilotTargetCount: number;
  readonly activePilotLecturerCount: number;
  readonly lecturerMappingCount: number;
  readonly activePilotLeaderCount: number;
  readonly activePilotScopeCount: number;
  readonly usersWithoutRole: number;
  readonly lecturersWithoutMapping: number;
  readonly leadersWithoutScope: number;
  readonly duplicateActiveRoleGroups: number;
  readonly duplicateActiveScopeGroups: number;
}

export interface PilotUatReconciliationReport
  extends PilotIdentityReport, UatBaselineReport {
  readonly rlsDefaultDeny: true;
}

export function parsePilotUatReconciliationCommand(
  arguments_: readonly string[],
): PilotUatReconciliationCommand {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  const allowed = [
    "--target-database=",
    "--approval-batch-id=",
    "--input-checksum=",
    "--pilot-unit=",
  ];
  if (
    args.includes("--") ||
    args.some(
      (argument) => !allowed.some((prefix) => argument.startsWith(prefix)),
    )
  ) {
    throw new SafePhase5DatabaseError(
      "Pilot UAT reconciliation arguments are invalid.",
    );
  }
  const targetDatabase = singleValue(args, "--target-database=");
  const approvalBatchId = singleValue(args, "--approval-batch-id=");
  const inputChecksum = singleValue(args, "--input-checksum=");
  const pilotUnit = singleValue(args, "--pilot-unit=");
  assertUatDatabase(targetDatabase);
  if (
    !SAFE_BATCH_ID.test(approvalBatchId) ||
    !SHA256.test(inputChecksum) ||
    pilotUnit !== PILOT_UNIT
  ) {
    throw new SafePhase5DatabaseError(
      "Pilot UAT reconciliation contract is invalid.",
    );
  }
  return {
    targetDatabase,
    approvalBatchId,
    inputChecksum,
    pilotUnit,
  };
}

export async function runPilotUatReconciliation(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly command: PilotUatReconciliationCommand;
}): Promise<PilotUatReconciliationReport> {
  const context = readUatOwnerDatabaseContext(
    input.environment,
    input.command.targetDatabase,
  );
  const client = new Client({
    connectionString: context.migrationUrl,
    application_name: "ueb-core-phase5-pilot-uat-reconciliation",
  });
  try {
    await client.connect();
    await assertMigrationRoleOwnsSource(client, context);
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    try {
      const baseline = await readUatBaselineReport(client);
      const identities = await readPilotIdentityReport(client, input.command);
      assertPilotIdentityIntegrity(identities);
      if (
        baseline.migrationsApplied !== 7 ||
        baseline.migrationsPending !== 0
      ) {
        throw new SafePhase5DatabaseError(
          "Pilot UAT migration baseline is invalid.",
        );
      }
      await assertUatRuntimeContract(client, context.runtimeRole);
      await client.query("COMMIT");
      return { ...baseline, ...identities, rlsDefaultDeny: true };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function assertPilotIdentityIntegrity(
  report: PilotIdentityReport,
): void {
  if (
    report.pilotTargetCount !== EXPECTED_PILOT_TARGETS ||
    report.activePilotLecturerCount !== EXPECTED_PILOT_LECTURERS ||
    report.lecturerMappingCount !== EXPECTED_PILOT_LECTURERS ||
    report.activePilotLeaderCount !== EXPECTED_PILOT_LEADERS ||
    report.activePilotScopeCount !== EXPECTED_PILOT_LEADERS ||
    report.usersWithoutRole !== 0 ||
    report.lecturersWithoutMapping !== 0 ||
    report.leadersWithoutScope !== 0 ||
    report.duplicateActiveRoleGroups !== 0 ||
    report.duplicateActiveScopeGroups !== 0
  ) {
    throw new SafePhase5DatabaseError(
      "Pilot UAT identity reconciliation failed.",
    );
  }
}

async function readPilotIdentityReport(
  client: ClientBase,
  command: PilotUatReconciliationCommand,
): Promise<PilotIdentityReport> {
  const report = (
    await client.query<{
      pilot_target_count: number;
      active_pilot_lecturer_count: number;
      lecturer_mapping_count: number;
      active_pilot_leader_count: number;
      active_pilot_scope_count: number;
      users_without_role: number;
      lecturers_without_mapping: number;
      leaders_without_scope: number;
      duplicate_active_role_groups: number;
      duplicate_active_scope_groups: number;
    }>(
      `WITH pilot_targets AS (
         SELECT DISTINCT target_user_id AS user_id
         FROM public.auth_audit_event
         WHERE target_user_id IS NOT NULL
           AND outcome = 'SUCCESS'
           AND metadata->>'phase5ApprovalBatchId' = $1
           AND metadata->>'phase5InputChecksum' = $2
           AND metadata->>'phase5Operation' = 'APPLY'
       )
       SELECT
         (SELECT count(*)::integer FROM pilot_targets) AS pilot_target_count,
         (SELECT count(*)::integer FROM pilot_targets target
          WHERE EXISTS (
            SELECT 1 FROM public.role_assignment assignment
            JOIN public.access_profile profile ON profile.user_id = assignment.user_id
            WHERE assignment.user_id = target.user_id
              AND assignment.role = 'LECTURER'
              AND assignment.revoked_at IS NULL
              AND profile.status = 'ACTIVE'
          )) AS active_pilot_lecturer_count,
         (SELECT count(*)::integer FROM pilot_targets target
          WHERE EXISTS (
            SELECT 1 FROM public.role_assignment assignment
            JOIN public.access_profile profile ON profile.user_id = assignment.user_id
            WHERE assignment.user_id = target.user_id
              AND assignment.role = 'LECTURER'
              AND assignment.revoked_at IS NULL
              AND profile.status = 'ACTIVE'
              AND profile.lecturer_uid IS NOT NULL
          )) AS lecturer_mapping_count,
         (SELECT count(*)::integer FROM pilot_targets target
          WHERE EXISTS (
            SELECT 1 FROM public.role_assignment assignment
            JOIN public.access_profile profile ON profile.user_id = assignment.user_id
            WHERE assignment.user_id = target.user_id
              AND assignment.role = 'FACULTY_LEADER'
              AND assignment.revoked_at IS NULL
              AND profile.status = 'ACTIVE'
          )) AS active_pilot_leader_count,
         (SELECT count(*)::integer FROM pilot_targets target
          WHERE EXISTS (
            SELECT 1 FROM public.role_assignment role_assignment
            JOIN public.unit_scope_assignment scope_assignment
              ON scope_assignment.user_id = role_assignment.user_id
            JOIN public.organization_unit unit
              ON unit.id = scope_assignment.organization_unit_id
            WHERE role_assignment.user_id = target.user_id
              AND role_assignment.role = 'FACULTY_LEADER'
              AND role_assignment.revoked_at IS NULL
              AND scope_assignment.revoked_at IS NULL
              AND unit.is_active
              AND unit.source_value = $3
          )) AS active_pilot_scope_count,
         (SELECT count(*)::integer FROM pilot_targets target
          WHERE NOT EXISTS (
            SELECT 1 FROM public.role_assignment assignment
            WHERE assignment.user_id = target.user_id
              AND assignment.revoked_at IS NULL
          )) AS users_without_role,
         (SELECT count(*)::integer FROM pilot_targets target
          WHERE EXISTS (
            SELECT 1 FROM public.role_assignment assignment
            WHERE assignment.user_id = target.user_id
              AND assignment.role = 'LECTURER'
              AND assignment.revoked_at IS NULL
          ) AND NOT EXISTS (
            SELECT 1 FROM public.access_profile profile
            WHERE profile.user_id = target.user_id
              AND profile.status = 'ACTIVE'
              AND profile.lecturer_uid IS NOT NULL
          )) AS lecturers_without_mapping,
         (SELECT count(*)::integer FROM pilot_targets target
          WHERE EXISTS (
            SELECT 1 FROM public.role_assignment assignment
            WHERE assignment.user_id = target.user_id
              AND assignment.role = 'FACULTY_LEADER'
              AND assignment.revoked_at IS NULL
          ) AND NOT EXISTS (
            SELECT 1 FROM public.unit_scope_assignment scope_assignment
            JOIN public.organization_unit unit
              ON unit.id = scope_assignment.organization_unit_id
            WHERE scope_assignment.user_id = target.user_id
              AND scope_assignment.revoked_at IS NULL
              AND unit.is_active
              AND unit.source_value = $3
          )) AS leaders_without_scope,
         (SELECT count(*)::integer FROM (
            SELECT assignment.user_id, assignment.role
            FROM public.role_assignment assignment
            JOIN pilot_targets target ON target.user_id = assignment.user_id
            WHERE assignment.revoked_at IS NULL
            GROUP BY assignment.user_id, assignment.role
            HAVING count(*) > 1
          ) duplicates) AS duplicate_active_role_groups,
         (SELECT count(*)::integer FROM (
            SELECT assignment.user_id, assignment.organization_unit_id
            FROM public.unit_scope_assignment assignment
            JOIN pilot_targets target ON target.user_id = assignment.user_id
            WHERE assignment.revoked_at IS NULL
            GROUP BY assignment.user_id, assignment.organization_unit_id
            HAVING count(*) > 1
          ) duplicates) AS duplicate_active_scope_groups`,
      [
        command.approvalBatchId,
        command.inputChecksum,
        APPROVED_UNIT_SOURCE_VALUES[command.pilotUnit],
      ],
    )
  ).rows[0];
  if (!report) {
    throw new SafePhase5DatabaseError("Pilot UAT identity counts are missing.");
  }
  return {
    pilotTargetCount: report.pilot_target_count,
    activePilotLecturerCount: report.active_pilot_lecturer_count,
    lecturerMappingCount: report.lecturer_mapping_count,
    activePilotLeaderCount: report.active_pilot_leader_count,
    activePilotScopeCount: report.active_pilot_scope_count,
    usersWithoutRole: report.users_without_role,
    lecturersWithoutMapping: report.lecturers_without_mapping,
    leadersWithoutScope: report.leaders_without_scope,
    duplicateActiveRoleGroups: report.duplicate_active_role_groups,
    duplicateActiveScopeGroups: report.duplicate_active_scope_groups,
  };
}

function singleValue(args: readonly string[], prefix: string): string {
  const values = args
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length));
  if (values.length !== 1 || !values[0]) {
    throw new SafePhase5DatabaseError(
      "Pilot UAT reconciliation requires one value per argument.",
    );
  }
  return values[0];
}

async function main(): Promise<void> {
  try {
    const command = parsePilotUatReconciliationCommand(process.argv.slice(2));
    const report = await runPilotUatReconciliation({
      environment: process.env,
      command,
    });
    console.log(
      [
        `TARGET_DATABASE=${command.targetDatabase}`,
        `PILOT_UNIT=${command.pilotUnit}`,
        `CORE_ROW_COUNT=${report.coreRows}`,
        `WORKFLOW_EVENT_COUNT=${report.workflowEvents}`,
        `MAX_STT=${report.maxStt}`,
        `NEXT_STT=${report.nextStt}`,
        `MIGRATIONS_APPLIED=${report.migrationsApplied}`,
        `MIGRATIONS_PENDING=${report.migrationsPending}`,
        `PILOT_TARGET_COUNT=${report.pilotTargetCount}`,
        `ACTIVE_PILOT_LECTURER_COUNT=${report.activePilotLecturerCount}`,
        `LECTURER_MAPPING_COUNT=${report.lecturerMappingCount}`,
        `ACTIVE_PILOT_LEADER_COUNT=${report.activePilotLeaderCount}`,
        `ACTIVE_KTPT_SCOPE_COUNT=${report.activePilotScopeCount}`,
        `USERS_WITHOUT_ROLE=${report.usersWithoutRole}`,
        `LECTURERS_WITHOUT_MAPPING=${report.lecturersWithoutMapping}`,
        `LEADERS_WITHOUT_SCOPE=${report.leadersWithoutScope}`,
        `DUPLICATE_ACTIVE_ROLE_GROUPS=${report.duplicateActiveRoleGroups}`,
        `DUPLICATE_ACTIVE_SCOPE_GROUPS=${report.duplicateActiveScopeGroups}`,
        `RLS_DEFAULT_DENY=${report.rlsDefaultDeny ? "PASS" : "FAIL"}`,
        "DATABASE_WRITES=0",
        "PILOT_UAT_RECONCILIATION=PASS",
      ].join("\n"),
    );
  } catch {
    console.error("DATABASE_WRITES=0\nPILOT_UAT_RECONCILIATION=FAIL");
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
