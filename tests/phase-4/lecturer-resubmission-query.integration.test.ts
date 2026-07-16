// @vitest-environment node

import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";

import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AccessProfileStatus, BusinessRole } from "@/generated/prisma/client";
import type { Principal } from "@/lib/auth/principal";
import {
  dropResubmissionQueryTestDatabase,
  prepareResubmissionQueryTestDatabase,
  type ResubmissionQueryTestDatabaseUrls,
} from "../../scripts/phase-4/prepare-resubmission-query-test-database";

const auth = vi.hoisted(() => ({ principal: null as Principal | null }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/authorization", () => ({
  requireLecturerIdentity: async () => {
    if (!auth.principal?.lecturerUid) throw new Error("FORBIDDEN");
    return auth.principal as Principal & { lecturerUid: string };
  },
}));

type QueryModule = typeof import("@/lib/workflow/lecturer-submission-query");
type PrismaModule = typeof import("@/lib/server/prisma");
type PostgresModule = typeof import("@/lib/server/postgres");

const UNIT_A = "Phase 4 Resubmission Query Unit A";
const UNIT_B = "Phase 4 Resubmission Query Unit B";
const lecturerA = identity();
const lecturerB = identity();

let urls: ResubmissionQueryTestDatabaseUrls;
let owner: Client;
let query: QueryModule;
let prismaModule: PrismaModule;
let postgresModule: PostgresModule;
let rejectedConfirmId: string;
let rejectedUpdateId: string;
let rejectedCreateId: string;
let pendingId: string;
let approvedId: string;
let foreignRejectedId: string;
let confirmRecordUid: string;
let updateRecordUid: string;
let createRecordUid: string;
let initialCoreCount: number;

describe.sequential("Phase 4 lecturer resubmission query", () => {
  beforeAll(async () => {
    urls = await prepareResubmissionQueryTestDatabase(process.env);
    owner = new Client({ connectionString: urls.migrationUrl });
    await owner.connect();
    await seedFixtures();
    initialCoreCount = await coreCount();
    process.env.DATABASE_URL = urls.runtimeUrl;
    vi.resetModules();
    query = await import("@/lib/workflow/lecturer-submission-query");
    prismaModule = await import("@/lib/server/prisma");
    postgresModule = await import("@/lib/server/postgres");
  }, 60_000);

  beforeEach(() => {
    auth.principal = lecturerA;
  });

  afterAll(async () => {
    if (!urls) return;
    await prismaModule
      ?.getPrismaClient()
      .$disconnect()
      .catch(() => undefined);
    await postgresModule
      ?.getPostgresPool()
      .end()
      .catch(() => undefined);
    await owner?.end().catch(() => undefined);
    await dropResubmissionQueryTestDatabase(urls);
  }, 30_000);

  it("loads CONFIRM_UNCHANGED with the latest current base", async () => {
    const draft = await query.getLecturerResubmissionDraft(rejectedConfirmId);
    expect(draft).toMatchObject({
      parentSubmissionId: rejectedConfirmId,
      submissionType: "CONFIRM_UNCHANGED",
      recordUid: confirmRecordUid,
      previousBaseStt: 51_001,
      previousBaseVersionNo: 1,
      latestBaseStt: 51_002,
      latestBaseVersionNo: 2,
      baseChanged: true,
      editableFields: null,
      rejectionReason: "Confirm rejection reason",
    });
    expect(draft.currentRow?.ma_hoc_phan).toBe("CURRENT-CONFIRM");
  });

  it("loads rejected editable values but current read-only values for UPDATE_EXISTING", async () => {
    const draft = await query.getLecturerResubmissionDraft(rejectedUpdateId);
    expect(draft.submissionType).toBe("UPDATE_EXISTING");
    if (draft.submissionType !== "UPDATE_EXISTING") throw new Error("type");
    expect(draft.editableFields.ten_hoc_phan).toBe("Rejected update draft");
    expect(draft.currentRow.ten_giang_vien).toBe("Current Lecturer A");
    expect(draft.latestBaseStt).toBe(51_003);
    expect(draft.latestBaseVersionNo).toBe(1);
  });

  it("loads CREATE_NEW draft without exposing a current row or base", async () => {
    const draft = await query.getLecturerResubmissionDraft(rejectedCreateId);
    expect(draft).toMatchObject({
      parentSubmissionId: rejectedCreateId,
      submissionType: "CREATE_NEW",
      recordUid: createRecordUid,
      currentRow: null,
      latestBaseStt: null,
      latestBaseVersionNo: null,
      baseChanged: false,
    });
    expect(draft.editableFields?.ten_hoc_phan).toBe("Rejected create draft");
  });

  it("returns only resubmission-safe DTO fields", async () => {
    const draft = await query.getLecturerResubmissionDraft(rejectedUpdateId);
    expect(draft).not.toHaveProperty("payloadChecksum");
    expect(draft).not.toHaveProperty("actorUserId");
    expect(draft).not.toHaveProperty("sessionId");
    expect(draft).not.toHaveProperty("authAccountId");
  });

  it("safe-denies PENDING and APPROVED parents", async () => {
    await expect(query.getLecturerResubmissionDraft(pendingId)).rejects.toThrow(
      "NOT_FOUND",
    );
    await expect(
      query.getLecturerResubmissionDraft(approvedId),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("safe-denies a parent belonging to another lecturer", async () => {
    await expect(
      query.getLecturerResubmissionDraft(foreignRejectedId),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("safe-denies a missing parent", async () => {
    await expect(
      query.getLecturerResubmissionDraft(randomUUID()),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("does not write core while loading any resubmission draft", async () => {
    expect(await coreCount()).toBe(initialCoreCount);
  });
});

function identity(): Principal & { lecturerUid: string } {
  return {
    userId: randomUUID(),
    lecturerUid: randomUUID(),
    roles: [BusinessRole.LECTURER],
    activeUnitIds: [],
    status: AccessProfileStatus.ACTIVE,
  };
}

async function seedFixtures(): Promise<void> {
  const importRunId = randomUUID();
  await owner.query("BEGIN");
  try {
    await owner.query(
      "INSERT INTO public.organization_unit (id, unit_key, source_value, display_name) VALUES ($1::uuid, 'resubmit-query-a', $2, $2), ($3::uuid, 'resubmit-query-b', $4, $4)",
      [randomUUID(), UNIT_A, randomUUID(), UNIT_B],
    );
    await owner.query(
      "INSERT INTO public.import_run (id, source_filename, source_sha256, source_sheet, source_contract_version, source_row_count, source_min_stt, source_max_stt, canonical_dataset_sha256, report, imported_at) VALUES ($1::uuid, 'resubmission-query-fixture.xlsx', $2, 'fixture', 'phase4-test', 6, 51001, 52001, $3, '{}'::jsonb, clock_timestamp())",
      [importRunId, "a".repeat(64), "b".repeat(64)],
    );
    await seedIdentity(lecturerA, "resubmit-a@example.invalid");
    await seedIdentity(lecturerB, "resubmit-b@example.invalid");

    confirmRecordUid = randomUUID();
    updateRecordUid = randomUUID();
    createRecordUid = randomUUID();
    const pendingRecordUid = randomUUID();
    const approvedRecordUid = randomUUID();
    const foreignRecordUid = randomUUID();

    await insertCore(
      importRunId,
      lecturerA.lecturerUid,
      confirmRecordUid,
      51_001,
      1,
      "OLD-CONFIRM",
      UNIT_A,
    );
    await insertCore(
      importRunId,
      lecturerA.lecturerUid,
      confirmRecordUid,
      51_002,
      2,
      "CURRENT-CONFIRM",
      UNIT_A,
    );
    await insertCore(
      importRunId,
      lecturerA.lecturerUid,
      updateRecordUid,
      51_003,
      1,
      "CURRENT-UPDATE",
      UNIT_A,
    );
    await insertCore(
      importRunId,
      lecturerA.lecturerUid,
      pendingRecordUid,
      51_004,
      1,
      "PENDING",
      UNIT_A,
    );
    await insertCore(
      importRunId,
      lecturerA.lecturerUid,
      approvedRecordUid,
      51_005,
      1,
      "APPROVED",
      UNIT_A,
    );
    await insertCore(
      importRunId,
      lecturerB.lecturerUid,
      foreignRecordUid,
      52_001,
      1,
      "FOREIGN",
      UNIT_B,
    );

    rejectedConfirmId = await insertSubmission({
      principal: lecturerA,
      recordUid: confirmRecordUid,
      type: "CONFIRM_UNCHANGED",
      state: "REJECTED",
      baseStt: 51_001,
      baseVersionNo: 1,
      approvalUnit: UNIT_A,
      payload: payload("Old confirm payload", UNIT_A),
      reason: "Confirm rejection reason",
    });
    rejectedUpdateId = await insertSubmission({
      principal: lecturerA,
      recordUid: updateRecordUid,
      type: "UPDATE_EXISTING",
      state: "REJECTED",
      baseStt: 51_003,
      baseVersionNo: 1,
      approvalUnit: UNIT_A,
      payload: payload("Rejected update draft", UNIT_A),
      reason: "Update rejection reason",
    });
    rejectedCreateId = await insertSubmission({
      principal: lecturerA,
      recordUid: createRecordUid,
      type: "CREATE_NEW",
      state: "REJECTED",
      baseStt: null,
      baseVersionNo: null,
      approvalUnit: UNIT_A,
      payload: payload("Rejected create draft", UNIT_A),
      reason: "Create rejection reason",
    });
    pendingId = await insertSubmission({
      principal: lecturerA,
      recordUid: pendingRecordUid,
      type: "UPDATE_EXISTING",
      state: "PENDING",
      baseStt: 51_004,
      baseVersionNo: 1,
      approvalUnit: UNIT_A,
      payload: payload("Pending", UNIT_A),
    });
    approvedId = await insertSubmission({
      principal: lecturerA,
      recordUid: approvedRecordUid,
      type: "CONFIRM_UNCHANGED",
      state: "APPROVED",
      baseStt: 51_005,
      baseVersionNo: 1,
      approvalUnit: UNIT_A,
      payload: payload("Approved", UNIT_A),
    });
    foreignRejectedId = await insertSubmission({
      principal: lecturerB,
      recordUid: foreignRecordUid,
      type: "UPDATE_EXISTING",
      state: "REJECTED",
      baseStt: 52_001,
      baseVersionNo: 1,
      approvalUnit: UNIT_B,
      payload: payload("Foreign", UNIT_B),
      reason: "Foreign rejection reason",
    });
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK");
    throw error;
  }
}

async function seedIdentity(
  principal: Principal & { lecturerUid: string },
  email: string,
): Promise<void> {
  await owner.query(
    'INSERT INTO public.auth_user (id, name, email, "emailVerified", "updatedAt") VALUES ($1::uuid, $2, $3, false, clock_timestamp())',
    [principal.userId, email, email],
  );
  await owner.query(
    "INSERT INTO public.access_profile (id, user_id, lecturer_uid, status, updated_at, created_by) VALUES ($1::uuid, $1::uuid, $2::uuid, 'ACTIVE', clock_timestamp(), $1::uuid)",
    [principal.userId, principal.lecturerUid],
  );
  await owner.query(
    "INSERT INTO public.role_assignment (id, user_id, role, granted_by) VALUES ($1::uuid, $2::uuid, 'LECTURER', $2::uuid)",
    [randomUUID(), principal.userId],
  );
}

async function insertCore(
  importRunId: string,
  lecturerUid: string,
  recordUid: string,
  stt: number,
  versionNo: number,
  courseCode: string,
  approvalUnit: string,
): Promise<void> {
  await owner.query(
    "INSERT INTO public.ueb_core_data (stt, don_vi_phu_trach_hoc_phan, bo_mon_phu_trach_hoc_phan, khoi_kien_thuc, ma_hoc_phan, ten_hoc_phan, ten_giang_vien, ma_so_can_bo, email_tai_khoan_vnu, bo_mon, don_vi, core_1_2_3, lecturer_uid, record_uid, snapshot_id, version_no, identity_status, source_row_number, source_row_checksum, source_import_run_id, approval_unit, origin, approved_at) OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Current Department', 1, $3, $3, 'Current Lecturer A', 'CURRENT-A', 'current-a@example.invalid', 'Current Department', $2, '1', $4::uuid, $5::uuid, $6::uuid, $7, 'RESOLVED', $1, $8, $9::uuid, $2, 'LEGACY_IMPORT', clock_timestamp())",
    [
      stt,
      approvalUnit,
      courseCode,
      lecturerUid,
      recordUid,
      randomUUID(),
      versionNo,
      createHash("sha256").update(`${recordUid}:${versionNo}`).digest("hex"),
      importRunId,
    ],
  );
}

async function insertSubmission(input: {
  principal: Principal & { lecturerUid: string };
  recordUid: string;
  type: "CONFIRM_UNCHANGED" | "UPDATE_EXISTING" | "CREATE_NEW";
  state: "PENDING" | "REJECTED" | "APPROVED";
  baseStt: number | null;
  baseVersionNo: number | null;
  approvalUnit: string;
  payload: Record<string, string | number | null>;
  reason?: string;
}): Promise<string> {
  const submissionId = randomUUID();
  await owner.query(
    "INSERT INTO public.workflow_event (event_id, submission_id, event_type, submission_type, record_uid, lecturer_uid, approval_unit, base_stt, base_version_no, payload, payload_checksum, actor_user_id, created_at) VALUES ($1::uuid, $2::uuid, 'SUBMITTED', $3::public.workflow_submission_type, $4::uuid, $5::uuid, $6, $7, $8, $9::jsonb, 'resubmission-query-checksum', $10::uuid, clock_timestamp())",
    [
      randomUUID(),
      submissionId,
      input.type,
      input.recordUid,
      input.principal.lecturerUid,
      input.approvalUnit,
      input.baseStt,
      input.baseVersionNo,
      JSON.stringify(input.payload),
      input.principal.userId,
    ],
  );
  if (input.state !== "PENDING") {
    await owner.query(
      "INSERT INTO public.workflow_event (event_id, submission_id, event_type, record_uid, lecturer_uid, approval_unit, actor_user_id, reason, result_stt, result_version_no, created_at) VALUES ($1::uuid, $2::uuid, $3::public.workflow_event_type, $4::uuid, $5::uuid, $6, $7::uuid, $8, $9, $10, clock_timestamp() + interval '1 second')",
      [
        randomUUID(),
        submissionId,
        input.state,
        input.recordUid,
        input.principal.lecturerUid,
        input.approvalUnit,
        input.principal.userId,
        input.state === "REJECTED" ? input.reason : null,
        input.state === "APPROVED" ? 99_001 : null,
        input.state === "APPROVED" ? 2 : null,
      ],
    );
  }
  return submissionId;
}

function payload(
  courseName: string,
  approvalUnit: string,
): Record<string, string | number | null> {
  return {
    don_vi_phu_trach_hoc_phan: approvalUnit,
    bo_mon_phu_trach_hoc_phan: "Rejected Department",
    khoi_kien_thuc: 7,
    ma_hoc_phan: "REJECTED-CODE",
    ten_hoc_phan: courseName,
    ten_giang_vien: "Rejected Lecturer Identity",
    ma_so_can_bo: "REJECTED-ID",
    email_tai_khoan_vnu: "rejected@example.invalid",
    bo_mon: "Rejected Department",
    don_vi: approvalUnit,
    core_1_2_3: "3",
    tc1_tro_giang: "Rejected draft",
    tc2_sh_chuyen_mon: null,
    tc3_tong_hop: null,
    tc3_1_nganh_tot_nghiep_phu_hop: null,
    tc3_2_bien_soan_de_cuong_giao_trinh: null,
    tc3_3_chu_nhiem_de_tai_nckh_lien_quan: null,
    tc3_4_bai_bao_lien_quan: null,
    tc4_giang_thu: null,
  };
}

async function coreCount(): Promise<number> {
  const result = await owner.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM public.ueb_core_data",
  );
  return result.rows[0]!.count;
}
