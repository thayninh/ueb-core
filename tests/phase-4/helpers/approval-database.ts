import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { calculateRowSubmissionChecksum } from "@/lib/workflow/checksum";
import { SUBMISSION_PAYLOAD_FIELD_NAMES } from "@/lib/workflow/field-policy";
import type {
  EditableBusinessFields,
  RowSubmissionPayload,
  SubmissionType,
} from "@/lib/workflow/types";
import {
  cleanupLeaderRejectDatabase,
  prepareLeaderRejectDatabase,
  type LeaderRejectDatabaseFixture,
  type LeaderTestIdentity,
} from "./leader-reject-database";

export {
  cleanupLeaderRejectDatabase as cleanupApprovalDatabase,
  prepareLeaderRejectDatabase as prepareApprovalDatabase,
};
export type { LeaderRejectDatabaseFixture as ApprovalDatabaseFixture };

export interface ApprovalSubmissionFixture {
  readonly submissionId: string;
  readonly submissionType: SubmissionType;
  readonly recordUid: string;
  readonly lecturerUid: string;
  readonly approvalUnit: string;
  readonly baseStt: number | null;
  readonly baseVersionNo: number | null;
  readonly payload: RowSubmissionPayload;
}

export async function seedApprovalSubmission(
  fixture: LeaderRejectDatabaseFixture,
  input: {
    readonly submissionType: SubmissionType;
    readonly unit?: "A" | "B";
    readonly checksum?: string;
    readonly terminal?: "REJECTED";
    readonly seed?: string;
  },
): Promise<ApprovalSubmissionFixture> {
  const unit = input.unit ?? "A";
  const lecturer = unit === "A" ? fixture.lecturerA : fixture.lecturerB;
  const record = unit === "A" ? fixture.recordA : fixture.recordB;
  const current = await readCurrentPayload(fixture, record.recordUid);
  const submissionId = randomUUID();
  const createNew = input.submissionType === "CREATE_NEW";
  const recordUid = createNew ? randomUUID() : record.recordUid;
  const approvalUnit = current.approval_unit;
  const payload = createNew
    ? { ...current.payload, ...approvalEditable(input.seed ?? "create") }
    : input.submissionType === "UPDATE_EXISTING"
      ? { ...current.payload, ...approvalEditable(input.seed ?? "update") }
      : current.payload;
  const baseStt = createNew ? null : current.stt;
  const baseVersionNo = createNew ? null : current.version_no;

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
      input.submissionType,
      recordUid,
      lecturer.lecturerUid,
      approvalUnit,
      baseStt,
      baseVersionNo,
      JSON.stringify(payload),
      input.checksum ?? calculateRowSubmissionChecksum(payload),
      lecturer.userId,
    ],
  );

  if (input.terminal === "REJECTED") {
    await fixture.owner.query(
      `INSERT INTO public.workflow_event (
         event_id, submission_id, event_type, submission_type, record_uid,
         lecturer_uid, approval_unit, base_stt, base_version_no,
         actor_user_id, reason, created_at
       ) VALUES (
         $1::uuid, $2::uuid, 'REJECTED', $3::public.workflow_submission_type,
         $4::uuid, $5::uuid, $6, $7, $8, $9::uuid,
         'Rejected approval fixture', clock_timestamp() + interval '1 second'
       )`,
      [
        randomUUID(),
        submissionId,
        input.submissionType,
        recordUid,
        lecturer.lecturerUid,
        approvalUnit,
        baseStt,
        baseVersionNo,
        fixture.admin.userId,
      ],
    );
  }

  return {
    submissionId,
    submissionType: input.submissionType,
    recordUid,
    lecturerUid: lecturer.lecturerUid!,
    approvalUnit,
    baseStt,
    baseVersionNo,
    payload,
  };
}

export function principalFor(identity: LeaderTestIdentity) {
  return {
    userId: identity.userId,
    lecturerUid: identity.lecturerUid,
    roles: identity.roles,
    activeUnitIds: identity.activeUnitIds,
    status: identity.status,
  };
}

export async function coreRowsForSubmission(
  fixture: LeaderRejectDatabaseFixture,
  submissionId: string,
) {
  return fixture.owner.query<{
    stt: number;
    version_no: number;
    record_uid: string;
    lecturer_uid: string;
    approval_unit: string;
    source_submission_id: string;
    origin: string;
    approved_by: string;
    source_row_number: number | null;
    source_row_checksum: string | null;
    source_import_run_id: string | null;
    payload: RowSubmissionPayload;
  }>(
    `SELECT
       core.stt, core.version_no, core.record_uid::text,
       core.lecturer_uid::text, core.approval_unit,
       core.source_submission_id::text, core.origin, core.approved_by::text,
       core.source_row_number, core.source_row_checksum,
       core.source_import_run_id::text,
       jsonb_build_object(
         'don_vi_phu_trach_hoc_phan', core.don_vi_phu_trach_hoc_phan,
         'bo_mon_phu_trach_hoc_phan', core.bo_mon_phu_trach_hoc_phan,
         'khoi_kien_thuc', core.khoi_kien_thuc,
         'ma_hoc_phan', core.ma_hoc_phan,
         'ten_hoc_phan', core.ten_hoc_phan,
         'ten_giang_vien', core.ten_giang_vien,
         'ma_so_can_bo', core.ma_so_can_bo,
         'email_tai_khoan_vnu', core.email_tai_khoan_vnu,
         'bo_mon', core.bo_mon,
         'don_vi', core.don_vi,
         'core_1_2_3', core.core_1_2_3,
         'tc1_tro_giang', core.tc1_tro_giang,
         'tc2_sh_chuyen_mon', core.tc2_sh_chuyen_mon,
         'tc3_tong_hop', core.tc3_tong_hop,
         'tc3_1_nganh_tot_nghiep_phu_hop', core.tc3_1_nganh_tot_nghiep_phu_hop,
         'tc3_2_bien_soan_de_cuong_giao_trinh', core.tc3_2_bien_soan_de_cuong_giao_trinh,
         'tc3_3_chu_nhiem_de_tai_nckh_lien_quan', core.tc3_3_chu_nhiem_de_tai_nckh_lien_quan,
         'tc3_4_bai_bao_lien_quan', core.tc3_4_bai_bao_lien_quan,
         'tc4_giang_thu', core.tc4_giang_thu
       ) AS payload
     FROM public.ueb_core_data AS core
     WHERE core.source_submission_id = $1::uuid`,
    [submissionId],
  );
}

export async function terminalEvents(
  fixture: LeaderRejectDatabaseFixture,
  submissionId: string,
) {
  return fixture.owner.query<{
    event_type: "APPROVED" | "REJECTED";
    actor_user_id: string;
    result_stt: number | null;
    result_version_no: number | null;
    reason: string | null;
  }>(
    `SELECT event_type::text, actor_user_id::text, result_stt,
            result_version_no, reason
     FROM public.workflow_event
     WHERE submission_id = $1::uuid
       AND event_type IN ('APPROVED', 'REJECTED')`,
    [submissionId],
  );
}

export async function runtimeInsertCore(
  fixture: LeaderRejectDatabaseFixture,
  submission: ApprovalSubmissionFixture,
  input: {
    readonly currentUserId?: string;
    readonly approvedBy?: string;
    readonly sourceSubmissionId?: string | null;
    readonly lecturerUid?: string;
    readonly recordUid?: string;
    readonly approvalUnit?: string;
    readonly versionNo?: number;
    readonly payload?: RowSubmissionPayload;
    readonly stt?: number;
  } = {},
): Promise<{ stt: number; versionNo: number }> {
  const connection = await fixture.runtime.connect();
  try {
    await connection.query("BEGIN");
    if (input.currentUserId) {
      await connection.query(
        "SELECT set_config('app.current_user_id', $1, true)",
        [input.currentUserId],
      );
    }
    const result = await insertCoreWithConnection(
      connection,
      submission,
      input,
    );
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function insertCoreWithConnection(
  connection: PoolClient,
  submission: ApprovalSubmissionFixture,
  input: NonNullable<Parameters<typeof runtimeInsertCore>[2]>,
): Promise<{ stt: number; versionNo: number }> {
  const payload = input.payload ?? submission.payload;
  const businessColumns = SUBMISSION_PAYLOAD_FIELD_NAMES.map(
    (field) => `"${field}"`,
  );
  const businessValues = SUBMISSION_PAYLOAD_FIELD_NAMES.map(
    (field) => payload[field],
  );
  const technicalColumns = [
    "lecturer_uid",
    "record_uid",
    "version_no",
    "source_submission_id",
    "approval_unit",
    "origin",
    "approved_by",
  ];
  const columns = [
    ...businessColumns,
    ...technicalColumns.map((x) => `"${x}"`),
  ];
  const values = [
    ...businessValues,
    input.lecturerUid ?? submission.lecturerUid,
    input.recordUid ?? submission.recordUid,
    input.versionNo ?? (submission.submissionType === "CREATE_NEW" ? 1 : 2),
    input.sourceSubmissionId === undefined
      ? submission.submissionId
      : input.sourceSubmissionId,
    input.approvalUnit ?? submission.approvalUnit,
    "APPROVED_SUBMISSION",
    input.approvedBy ?? input.currentUserId ?? null,
  ];
  if (input.stt !== undefined) {
    columns.unshift('"stt"');
    values.unshift(input.stt);
  }
  const parameters = values.map((_, index) => `$${index + 1}`);
  const result = await connection.query<{ stt: number; version_no: number }>(
    `INSERT INTO public.ueb_core_data (${columns.join(", ")})
     VALUES (${parameters.join(", ")})
     RETURNING stt, version_no`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw new Error("Approved core fixture returned no row.");
  return { stt: row.stt, versionNo: row.version_no };
}

export async function insertStaleCoreVersion(
  fixture: LeaderRejectDatabaseFixture,
  submission: ApprovalSubmissionFixture,
): Promise<void> {
  const importRunId = fixture.importRunId;
  await fixture.owner.query(
    `INSERT INTO public.ueb_core_data (
       don_vi_phu_trach_hoc_phan, bo_mon_phu_trach_hoc_phan,
       khoi_kien_thuc, ma_hoc_phan, ten_hoc_phan, ten_giang_vien,
       ma_so_can_bo, email_tai_khoan_vnu, bo_mon, don_vi, core_1_2_3,
       lecturer_uid, record_uid, snapshot_id, version_no, identity_status,
       source_row_number, source_row_checksum, source_import_run_id,
       approval_unit, origin, approved_at
     ) VALUES (
       'Stale', 'Stale', 99, 'STALE', 'Stale', $1, $2, $3, $4, $5, '3',
       $6::uuid, $7::uuid, $8::uuid,
       (SELECT max(version_no) + 1 FROM public.ueb_core_data WHERE record_uid = $7::uuid),
       'RESOLVED', 99001, $9,
       $10::uuid, $11, 'LEGACY_IMPORT', clock_timestamp()
     )`,
    [
      submission.payload.ten_giang_vien,
      submission.payload.ma_so_can_bo,
      submission.payload.email_tai_khoan_vnu,
      submission.payload.bo_mon,
      submission.payload.don_vi,
      submission.lecturerUid,
      submission.recordUid,
      randomUUID(),
      "f".repeat(64),
      importRunId,
      submission.approvalUnit,
    ],
  );
}

function approvalEditable(seed: string): EditableBusinessFields {
  return {
    don_vi_phu_trach_hoc_phan: `${seed}-owner-unit`,
    bo_mon_phu_trach_hoc_phan: `${seed}-department`,
    khoi_kien_thuc: seed.length,
    ma_hoc_phan: `${seed}-course`,
    ten_hoc_phan: `${seed}-course-name`,
    core_1_2_3: `${seed}-core`,
    tc1_tro_giang: `${seed}-tc1`,
    tc2_sh_chuyen_mon: `${seed}-tc2`,
    tc3_tong_hop: `${seed}-tc3`,
    tc3_1_nganh_tot_nghiep_phu_hop: `${seed}-tc31`,
    tc3_2_bien_soan_de_cuong_giao_trinh: `${seed}-tc32`,
    tc3_3_chu_nhiem_de_tai_nckh_lien_quan: `${seed}-tc33`,
    tc3_4_bai_bao_lien_quan: `${seed}-tc34`,
    tc4_giang_thu: `${seed}-tc4`,
  };
}

async function readCurrentPayload(
  fixture: LeaderRejectDatabaseFixture,
  recordUid: string,
): Promise<{
  stt: number;
  version_no: number;
  approval_unit: string;
  payload: RowSubmissionPayload;
}> {
  const result = await fixture.owner.query<{
    stt: number;
    version_no: number;
    approval_unit: string;
    payload: RowSubmissionPayload;
  }>(
    `SELECT stt, version_no, approval_unit,
       jsonb_build_object(
         'don_vi_phu_trach_hoc_phan', don_vi_phu_trach_hoc_phan,
         'bo_mon_phu_trach_hoc_phan', bo_mon_phu_trach_hoc_phan,
         'khoi_kien_thuc', khoi_kien_thuc,
         'ma_hoc_phan', ma_hoc_phan,
         'ten_hoc_phan', ten_hoc_phan,
         'ten_giang_vien', ten_giang_vien,
         'ma_so_can_bo', ma_so_can_bo,
         'email_tai_khoan_vnu', email_tai_khoan_vnu,
         'bo_mon', bo_mon,
         'don_vi', don_vi,
         'core_1_2_3', core_1_2_3,
         'tc1_tro_giang', tc1_tro_giang,
         'tc2_sh_chuyen_mon', tc2_sh_chuyen_mon,
         'tc3_tong_hop', tc3_tong_hop,
         'tc3_1_nganh_tot_nghiep_phu_hop', tc3_1_nganh_tot_nghiep_phu_hop,
         'tc3_2_bien_soan_de_cuong_giao_trinh', tc3_2_bien_soan_de_cuong_giao_trinh,
         'tc3_3_chu_nhiem_de_tai_nckh_lien_quan', tc3_3_chu_nhiem_de_tai_nckh_lien_quan,
         'tc3_4_bai_bao_lien_quan', tc3_4_bai_bao_lien_quan,
         'tc4_giang_thu', tc4_giang_thu
       ) AS payload
     FROM public.ueb_core_data
     WHERE record_uid = $1::uuid
     ORDER BY version_no DESC, stt DESC
     LIMIT 1`,
    [recordUid],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Expected approval core fixture.");
  return row;
}
