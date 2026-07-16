import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { hashPassword } from "better-auth/crypto";
import { Client } from "pg";

import {
  assertExactPhase4LecturerPortalDatabase,
  readPhase4LecturerPortalDatabaseUrls,
} from "./lib/lecturer-portal-test-database";
import { readPhase4LecturerPortalFixtures } from "./lib/lecturer-portal-fixtures";

const UNIT = "Phase 4 E2E Unit";

export async function seedPhase4LecturerPortalE2e(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const urls = readPhase4LecturerPortalDatabaseUrls({
    MIGRATION_DATABASE_URL:
      environment.PHASE4_SOURCE_MIGRATION_DATABASE_URL ??
      environment.MIGRATION_DATABASE_URL,
    DATABASE_URL:
      environment.PHASE4_SOURCE_DATABASE_URL ?? environment.DATABASE_URL,
  });
  assertExactPhase4LecturerPortalDatabase(urls.migrationUrl);
  const fixture = readPhase4LecturerPortalFixtures(environment);
  const client = new Client({ connectionString: urls.migrationUrl });
  await client.connect();
  try {
    const existing = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.auth_user",
    );
    if (existing.rows[0]?.count !== 0) {
      throw new Error("Phase 4 E2E requires a freshly prepared database.");
    }

    const lecturerA = { userId: randomUUID(), lecturerUid: randomUUID() };
    const lecturerB = { userId: randomUUID(), lecturerUid: randomUUID() };
    const passwordHash = await hashPassword(fixture.password);
    const importRunId = randomUUID();
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO public.organization_unit (id, unit_key, source_value, display_name) VALUES ($1::uuid, 'phase4-e2e-unit', $2, $2)",
      [randomUUID(), UNIT],
    );
    await client.query(
      "INSERT INTO public.import_run (id, source_filename, source_sha256, source_sheet, source_contract_version, source_row_count, source_min_stt, source_max_stt, canonical_dataset_sha256, report, imported_at) VALUES ($1::uuid, 'phase4-e2e-fixture.xlsx', $2, 'fixture', 'phase4-e2e', 5, 41001, 42001, $3, '{}'::jsonb, clock_timestamp())",
      [importRunId, "a".repeat(64), "b".repeat(64)],
    );
    await createUser(
      client,
      lecturerA,
      fixture.lecturerAEmail,
      "Phase 4 Lecturer A",
      passwordHash,
    );
    await createUser(
      client,
      lecturerB,
      fixture.lecturerBEmail,
      "Phase 4 Lecturer B",
      passwordHash,
    );
    const recordA1 = randomUUID();
    const recordA2 = randomUUID();
    const recordA3 = randomUUID();
    await insertCore(
      client,
      importRunId,
      lecturerA.lecturerUid,
      recordA1,
      41001,
      1,
      "A1-v1",
    );
    await insertCore(
      client,
      importRunId,
      lecturerA.lecturerUid,
      recordA1,
      41002,
      2,
      "A1-v2",
    );
    await insertCore(
      client,
      importRunId,
      lecturerA.lecturerUid,
      recordA2,
      41003,
      1,
      "A2",
    );
    await insertCore(
      client,
      importRunId,
      lecturerA.lecturerUid,
      recordA3,
      41004,
      1,
      "A3",
    );
    const recordB = randomUUID();
    await insertCore(
      client,
      importRunId,
      lecturerB.lecturerUid,
      recordB,
      42001,
      1,
      "B1",
    );
    const lecturerBSubmissionId = randomUUID();
    await insertSubmittedEvent(
      client,
      lecturerBSubmissionId,
      recordB,
      lecturerB,
      42001,
      "CONFIRM_UNCHANGED",
      "B1",
    );
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        status: "SUCCESS",
        coreRowCount: 5,
        latestLecturerARows: 3,
        lecturerBSubmissionId,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function createUser(
  client: Client,
  identity: { userId: string; lecturerUid: string },
  email: string,
  name: string,
  passwordHash: string,
): Promise<void> {
  await client.query(
    'INSERT INTO public.auth_user (id, name, email, "emailVerified", "updatedAt") VALUES ($1::uuid, $2, $3, false, clock_timestamp())',
    [identity.userId, name, email],
  );
  await client.query(
    'INSERT INTO public.auth_account ("accountId", "providerId", "userId", password, "updatedAt") VALUES ($1, \'credential\', $2::uuid, $3, clock_timestamp())',
    [identity.userId, identity.userId, passwordHash],
  );
  await client.query(
    "INSERT INTO public.access_profile (id, user_id, lecturer_uid, status, updated_at, created_by) VALUES ($1::uuid, $1::uuid, $2::uuid, 'ACTIVE', clock_timestamp(), $1::uuid)",
    [identity.userId, identity.lecturerUid],
  );
  await client.query(
    "INSERT INTO public.role_assignment (id, user_id, role, granted_by) VALUES ($1::uuid, $2::uuid, 'LECTURER', $2::uuid)",
    [randomUUID(), identity.userId],
  );
}

async function insertCore(
  client: Client,
  importRunId: string,
  lecturerUid: string,
  recordUid: string,
  stt: number,
  versionNo: number,
  seed: string,
): Promise<void> {
  await client.query(
    "INSERT INTO public.ueb_core_data (stt, don_vi_phu_trach_hoc_phan, bo_mon_phu_trach_hoc_phan, khoi_kien_thuc, ma_hoc_phan, ten_hoc_phan, ten_giang_vien, ma_so_can_bo, email_tai_khoan_vnu, bo_mon, don_vi, core_1_2_3, lecturer_uid, record_uid, snapshot_id, version_no, identity_status, source_row_number, source_row_checksum, source_import_run_id, approval_unit, origin, approved_at) OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'Bộ môn E2E', 1, $3, $4, 'Phase 4 Lecturer', 'P4-E2E', 'lecturer@phase4.invalid', 'Bộ môn E2E', $2, '1', $5::uuid, $6::uuid, $7::uuid, $8, 'RESOLVED', $1, $9, $10::uuid, $2, 'LEGACY_IMPORT', clock_timestamp())",
    [
      stt,
      UNIT,
      "P4-" + seed,
      "Học phần " + seed,
      lecturerUid,
      recordUid,
      randomUUID(),
      versionNo,
      createHash("sha256").update(seed).digest("hex"),
      importRunId,
    ],
  );
}

async function insertSubmittedEvent(
  client: Client,
  submissionId: string,
  recordUid: string,
  identity: { userId: string; lecturerUid: string },
  baseStt: number,
  type: "CONFIRM_UNCHANGED",
  seed: string,
): Promise<void> {
  await client.query(
    "INSERT INTO public.workflow_event (event_id, submission_id, event_type, submission_type, record_uid, lecturer_uid, approval_unit, base_stt, base_version_no, payload, payload_checksum, actor_user_id) VALUES ($1::uuid, $2::uuid, 'SUBMITTED', $3::public.workflow_submission_type, $4::uuid, $5::uuid, $6, $7, 1, $8::jsonb, 'e2e-fixture-checksum', $9::uuid)",
    [
      randomUUID(),
      submissionId,
      type,
      recordUid,
      identity.lecturerUid,
      UNIT,
      baseStt,
      JSON.stringify(payload(seed)),
      identity.userId,
    ],
  );
}

function payload(seed: string): Record<string, string | number | null> {
  return {
    don_vi_phu_trach_hoc_phan: UNIT,
    bo_mon_phu_trach_hoc_phan: "Bộ môn E2E",
    khoi_kien_thuc: 1,
    ma_hoc_phan: "P4-" + seed,
    ten_hoc_phan: "Học phần " + seed,
    ten_giang_vien: "Phase 4 Lecturer",
    ma_so_can_bo: "P4-E2E",
    email_tai_khoan_vnu: "lecturer@phase4.invalid",
    bo_mon: "Bộ môn E2E",
    don_vi: UNIT,
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

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await seedPhase4LecturerPortalE2e(process.env).catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Phase 4 lecturer E2E seed failed safely.",
    );
    process.exitCode = 1;
  });
}
