import { createHash, randomUUID } from "node:crypto";

import { Client, Pool } from "pg";

import { AccessProfileStatus, BusinessRole } from "@/generated/prisma/client";
import {
  dropPhase4LatestReadModelTestDatabase,
  preparePhase4LatestReadModelTestDatabase,
} from "../../../scripts/phase-4/prepare-latest-read-model-test-database";

import type { Principal } from "@/lib/auth/principal";
import type {
  RowSubmissionPayload,
  SubmissionType,
} from "@/lib/workflow/types";
import type { Phase4TestDatabaseUrls } from "../../../scripts/phase-4/lib/test-database";

export const LEADER_TEST_UNIT_A = "Phase 4 Leader Unit A";
export const LEADER_TEST_UNIT_B = "Phase 4 Leader Unit B";

export interface LeaderTestIdentity extends Principal {
  readonly email: string;
  readonly roleIds: readonly string[];
  readonly scopeIds: readonly string[];
}

export interface LeaderRejectDatabaseFixture {
  readonly urls: Phase4TestDatabaseUrls;
  readonly owner: Client;
  readonly runtime: Pool;
  readonly unitAId: string;
  readonly unitBId: string;
  readonly importRunId: string;
  readonly lecturerA: LeaderTestIdentity;
  readonly lecturerB: LeaderTestIdentity;
  readonly leaderA: LeaderTestIdentity;
  readonly leaderB: LeaderTestIdentity;
  readonly leaderMultiUnit: LeaderTestIdentity;
  readonly leaderNoScope: LeaderTestIdentity;
  readonly admin: LeaderTestIdentity;
  readonly disabledLeader: LeaderTestIdentity;
  readonly recordA: { readonly recordUid: string; readonly stt: number };
  readonly recordB: { readonly recordUid: string; readonly stt: number };
}

export async function prepareLeaderRejectDatabase(): Promise<LeaderRejectDatabaseFixture> {
  const urls = await preparePhase4LatestReadModelTestDatabase(process.env);
  const owner = new Client({
    connectionString: urls.migrationUrl,
    application_name: "ueb-core-phase4-leader-reject-owner-test",
  });
  const runtime = new Pool({
    connectionString: urls.runtimeUrl,
    application_name: "ueb-core-phase4-leader-reject-runtime-test",
    max: 12,
  });
  await owner.connect();

  try {
    const unitAId = randomUUID();
    const unitBId = randomUUID();
    const importRunId = randomUUID();
    await owner.query(
      `INSERT INTO public.organization_unit
         (id, unit_key, source_value, display_name)
       VALUES ($1::uuid, 'phase4-leader-unit-a', $2, $2),
              ($3::uuid, 'phase4-leader-unit-b', $4, $4)`,
      [unitAId, LEADER_TEST_UNIT_A, unitBId, LEADER_TEST_UNIT_B],
    );
    await owner.query(
      `INSERT INTO public.import_run (
         id, source_filename, source_sha256, source_sheet,
         source_contract_version, source_row_count, source_min_stt,
         source_max_stt, canonical_dataset_sha256, report, imported_at
       ) VALUES (
         $1::uuid, 'phase4-leader-reject-fixture.xlsx', $2, 'fixture',
         'phase4-leader-reject', 2, 61001, 62001, $3, '{}'::jsonb,
         clock_timestamp()
       )`,
      [importRunId, "a".repeat(64), "b".repeat(64)],
    );

    const lecturerA = await createIdentity(owner, {
      email: "leader-test-lecturer-a@example.invalid",
      lecturerUid: randomUUID(),
      roles: [BusinessRole.LECTURER],
      status: AccessProfileStatus.ACTIVE,
      unitIds: [],
    });
    const lecturerB = await createIdentity(owner, {
      email: "leader-test-lecturer-b@example.invalid",
      lecturerUid: randomUUID(),
      roles: [BusinessRole.LECTURER],
      status: AccessProfileStatus.ACTIVE,
      unitIds: [],
    });
    const leaderA = await createIdentity(owner, {
      email: "leader-test-a@example.invalid",
      lecturerUid: null,
      roles: [BusinessRole.FACULTY_LEADER],
      status: AccessProfileStatus.ACTIVE,
      unitIds: [unitAId],
    });
    const leaderB = await createIdentity(owner, {
      email: "leader-test-b@example.invalid",
      lecturerUid: null,
      roles: [BusinessRole.FACULTY_LEADER],
      status: AccessProfileStatus.ACTIVE,
      unitIds: [unitBId],
    });
    const leaderMultiUnit = await createIdentity(owner, {
      email: "leader-test-multi@example.invalid",
      lecturerUid: null,
      roles: [BusinessRole.FACULTY_LEADER],
      status: AccessProfileStatus.ACTIVE,
      unitIds: [unitAId, unitBId],
    });
    const leaderNoScope = await createIdentity(owner, {
      email: "leader-test-no-scope@example.invalid",
      lecturerUid: null,
      roles: [BusinessRole.FACULTY_LEADER],
      status: AccessProfileStatus.ACTIVE,
      unitIds: [],
    });
    const admin = await createIdentity(owner, {
      email: "leader-test-admin@example.invalid",
      lecturerUid: null,
      roles: [BusinessRole.ADMIN],
      status: AccessProfileStatus.ACTIVE,
      unitIds: [],
    });
    const disabledLeader = await createIdentity(owner, {
      email: "leader-test-disabled@example.invalid",
      lecturerUid: null,
      roles: [BusinessRole.FACULTY_LEADER],
      status: AccessProfileStatus.DISABLED,
      unitIds: [unitAId],
    });

    const recordA = {
      recordUid: randomUUID(),
      stt: 61_001,
    };
    const recordB = {
      recordUid: randomUUID(),
      stt: 62_001,
    };
    await insertCoreRow(owner, {
      importRunId,
      lecturerUid: lecturerA.lecturerUid!,
      approvalUnit: LEADER_TEST_UNIT_A,
      recordUid: recordA.recordUid,
      stt: recordA.stt,
      seed: "A",
    });
    await insertCoreRow(owner, {
      importRunId,
      lecturerUid: lecturerB.lecturerUid!,
      approvalUnit: LEADER_TEST_UNIT_B,
      recordUid: recordB.recordUid,
      stt: recordB.stt,
      seed: "B",
    });

    return {
      urls,
      owner,
      runtime,
      unitAId,
      unitBId,
      importRunId,
      lecturerA,
      lecturerB,
      leaderA,
      leaderB,
      leaderMultiUnit,
      leaderNoScope,
      admin,
      disabledLeader,
      recordA,
      recordB,
    };
  } catch (error) {
    await runtime.end().catch(() => undefined);
    await owner.end().catch(() => undefined);
    await dropPhase4LatestReadModelTestDatabase(urls).catch(() => undefined);
    throw error;
  }
}

export async function cleanupLeaderRejectDatabase(
  fixture: LeaderRejectDatabaseFixture | undefined,
): Promise<void> {
  if (!fixture) return;
  await fixture.runtime.end().catch(() => undefined);
  await fixture.owner.end().catch(() => undefined);
  await dropPhase4LatestReadModelTestDatabase(fixture.urls);
}

export async function seedLeaderSubmission(
  fixture: LeaderRejectDatabaseFixture,
  input: {
    readonly unit: "A" | "B";
    readonly submissionType?: SubmissionType;
    readonly state?: "PENDING" | "REJECTED" | "APPROVED";
    readonly searchSeed?: string;
    readonly recordUid?: string;
    readonly baseStt?: number;
  },
): Promise<string> {
  const submissionId = randomUUID();
  const unitA = input.unit === "A";
  const lecturer = unitA ? fixture.lecturerA : fixture.lecturerB;
  const approvalUnit = unitA ? LEADER_TEST_UNIT_A : LEADER_TEST_UNIT_B;
  const submissionType = input.submissionType ?? "CREATE_NEW";
  const existing = submissionType !== "CREATE_NEW";
  const defaultRecord = unitA ? fixture.recordA : fixture.recordB;
  const recordUid =
    input.recordUid ?? (existing ? defaultRecord.recordUid : randomUUID());
  const baseStt = existing ? (input.baseStt ?? defaultRecord.stt) : null;
  const payload = workflowPayload(
    input.searchSeed ?? submissionId.slice(0, 8),
    approvalUnit,
    lecturer,
  );

  await fixture.owner.query(
    `INSERT INTO public.workflow_event (
       event_id, submission_id, event_type, submission_type, record_uid,
       lecturer_uid, approval_unit, base_stt, base_version_no, payload,
       payload_checksum, actor_user_id, reason, result_stt, result_version_no
     ) VALUES (
       $1::uuid, $2::uuid, 'SUBMITTED', $3::public.workflow_submission_type,
       $4::uuid, $5::uuid, $6, $7, $8, $9::jsonb, $10, $11::uuid,
       NULL, NULL, NULL
     )`,
    [
      randomUUID(),
      submissionId,
      submissionType,
      recordUid,
      lecturer.lecturerUid,
      approvalUnit,
      baseStt,
      existing ? 1 : null,
      JSON.stringify(payload),
      createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      lecturer.userId,
    ],
  );

  const state = input.state ?? "PENDING";
  if (state !== "PENDING") {
    await fixture.owner.query(
      `INSERT INTO public.workflow_event (
         event_id, submission_id, event_type, submission_type, record_uid,
         lecturer_uid, approval_unit, base_stt, base_version_no, payload,
         payload_checksum, actor_user_id, reason, result_stt,
         result_version_no, parent_submission_id, created_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::public.workflow_event_type,
         $4::public.workflow_submission_type, $5::uuid, $6::uuid, $7,
         $8, $9, NULL, NULL, $10::uuid, $11, $12, $13, NULL,
         clock_timestamp() + interval '1 second'
       )`,
      [
        randomUUID(),
        submissionId,
        state,
        submissionType,
        recordUid,
        lecturer.lecturerUid,
        approvalUnit,
        baseStt,
        existing ? 1 : null,
        fixture.admin.userId,
        state === "REJECTED" ? "Terminal fixture reason" : null,
        state === "APPROVED" ? 99_999 : null,
        state === "APPROVED" ? (existing ? 2 : 1) : null,
      ],
    );
  }
  return submissionId;
}

export async function countCoreRows(
  fixture: LeaderRejectDatabaseFixture,
): Promise<number> {
  const result = await fixture.owner.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM public.ueb_core_data",
  );
  return result.rows[0]?.count ?? -1;
}

export async function countEvents(
  fixture: LeaderRejectDatabaseFixture,
  submissionId: string,
  eventType?: "SUBMITTED" | "REJECTED" | "APPROVED",
): Promise<number> {
  const result = await fixture.owner.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM public.workflow_event
     WHERE submission_id = $1::uuid
       AND ($2::text IS NULL OR event_type::text = $2)`,
    [submissionId, eventType ?? null],
  );
  return result.rows[0]?.count ?? -1;
}

async function createIdentity(
  owner: Client,
  input: {
    readonly email: string;
    readonly lecturerUid: string | null;
    readonly roles: readonly BusinessRole[];
    readonly status: AccessProfileStatus;
    readonly unitIds: readonly string[];
  },
): Promise<LeaderTestIdentity> {
  const userId = randomUUID();
  const roleIds: string[] = [];
  const scopeIds: string[] = [];
  await owner.query(
    'INSERT INTO public.auth_user (id, name, email, "emailVerified", "updatedAt") VALUES ($1::uuid, $2, $3, false, clock_timestamp())',
    [userId, input.email.split("@")[0], input.email],
  );
  await owner.query(
    "INSERT INTO public.access_profile (id, user_id, lecturer_uid, status, updated_at, created_by) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::public.access_profile_status, clock_timestamp(), $2::uuid)",
    [randomUUID(), userId, input.lecturerUid, input.status],
  );
  for (const role of input.roles) {
    const id = randomUUID();
    roleIds.push(id);
    await owner.query(
      "INSERT INTO public.role_assignment (id, user_id, role, granted_by) VALUES ($1::uuid, $2::uuid, $3::public.business_role, $2::uuid)",
      [id, userId, role],
    );
  }
  for (const unitId of input.unitIds) {
    const id = randomUUID();
    scopeIds.push(id);
    await owner.query(
      "INSERT INTO public.unit_scope_assignment (id, user_id, organization_unit_id, granted_by) VALUES ($1::uuid, $2::uuid, $3::uuid, $2::uuid)",
      [id, userId, unitId],
    );
  }
  return {
    userId,
    lecturerUid: input.lecturerUid,
    roles: input.roles,
    activeUnitIds: input.unitIds,
    status: input.status,
    email: input.email,
    roleIds,
    scopeIds,
  };
}

async function insertCoreRow(
  owner: Client,
  input: {
    readonly importRunId: string;
    readonly lecturerUid: string;
    readonly approvalUnit: string;
    readonly recordUid: string;
    readonly stt: number;
    readonly seed: string;
  },
): Promise<void> {
  await owner.query(
    `INSERT INTO public.ueb_core_data (
       stt, don_vi_phu_trach_hoc_phan, bo_mon_phu_trach_hoc_phan,
       khoi_kien_thuc, ma_hoc_phan, ten_hoc_phan, ten_giang_vien,
       ma_so_can_bo, email_tai_khoan_vnu, bo_mon, don_vi, core_1_2_3,
       lecturer_uid, record_uid, snapshot_id, version_no, identity_status,
       source_row_number, source_row_checksum, source_import_run_id,
       approval_unit, origin, approved_at
     ) OVERRIDING SYSTEM VALUE VALUES (
       $1, $2, 'Bộ môn fixture', 1, $3, $4, $5, $6, $7,
       'Bộ môn fixture', $2, '1', $8::uuid, $9::uuid, $10::uuid, 1,
       'RESOLVED', $1, $11, $12::uuid, $2, 'LEGACY_IMPORT',
       clock_timestamp()
     )`,
    [
      input.stt,
      input.approvalUnit,
      `P4-LEADER-${input.seed}`,
      `Học phần ${input.seed}`,
      `Giảng viên ${input.seed}`,
      `CB-${input.seed}`,
      `${input.seed.toLowerCase()}@example.invalid`,
      input.lecturerUid,
      input.recordUid,
      randomUUID(),
      createHash("sha256").update(input.recordUid).digest("hex"),
      input.importRunId,
    ],
  );
}

function workflowPayload(
  seed: string,
  approvalUnit: string,
  lecturer: LeaderTestIdentity,
): RowSubmissionPayload {
  return {
    don_vi_phu_trach_hoc_phan: approvalUnit,
    bo_mon_phu_trach_hoc_phan: "Bộ môn fixture",
    khoi_kien_thuc: 1,
    ma_hoc_phan: `P4-${seed}`,
    ten_hoc_phan: `Học phần ${seed}`,
    ten_giang_vien: `Lecturer ${seed}`,
    ma_so_can_bo: `CB-${seed}`,
    email_tai_khoan_vnu: lecturer.email,
    bo_mon: "Bộ môn fixture",
    don_vi: approvalUnit,
    core_1_2_3: "1",
    tc1_tro_giang: null,
    tc2_sh_chuyen_mon: null,
    tc3_tong_hop: null,
    tc3_1_nganh_tot_nghiep_phu_hop: null,
    tc3_2_bien_soan_de_cuong_giao_trinh: null,
    tc3_3_chu_nhiem_de_tai_nckh_lien_quan: null,
    tc3_4_bai_bao_lien_quan: null,
    tc4_giang_thu: null,
  };
}
