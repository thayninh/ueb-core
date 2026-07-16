// @vitest-environment node

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
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
  dropPhase4LecturerPortalTestDatabase,
  preparePhase4LecturerPortalTestDatabase,
} from "../../scripts/phase-4/prepare-lecturer-portal-test-database";
import type { Phase4LecturerPortalDatabaseUrls } from "../../scripts/phase-4/lib/lecturer-portal-test-database";

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

const UNIT = "Phase 4 Lecturer Portal Unit";
const lecturerA = identity();
const lecturerB = identity();
const submissionsA: string[] = [];
const submissionsB: string[] = [];
let urls: Phase4LecturerPortalDatabaseUrls;
let owner: Client;
let runtime: Pool;
let query: QueryModule;
let prismaModule: PrismaModule;
let postgresModule: PostgresModule;

describe.sequential("Phase 4 lecturer submission query", () => {
  beforeAll(async () => {
    urls = await preparePhase4LecturerPortalTestDatabase(process.env);
    owner = new Client({ connectionString: urls.migrationUrl });
    runtime = new Pool({ connectionString: urls.runtimeUrl });
    await owner.connect();
    await seedFixtures();
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
    await runtime?.end().catch(() => undefined);
    await owner?.end().catch(() => undefined);
    await dropPhase4LecturerPortalTestDatabase(urls);
  }, 30_000);

  it("returns only submissions belonging to the current lecturer", async () => {
    const page = await query.getLecturerSubmissions();
    expect(page.totalSubmissions).toBe(submissionsA.length);
    expect(
      page.submissions.some((item) => submissionsB.includes(item.submissionId)),
    ).toBe(false);
  });

  it("groups immutable events and resolves all three states", async () => {
    for (const state of ["PENDING", "REJECTED", "APPROVED"] as const) {
      const page = await query.getLecturerSubmissions({ state });
      expect(page.submissions.every((item) => item.state === state)).toBe(true);
      expect(page.totalSubmissions).toBeGreaterThan(0);
      if (state === "APPROVED") {
        expect(
          page.submissions.every(
            (item) => item.resultStt !== null && item.resultVersionNo !== null,
          ),
        ).toBe(true);
      }
    }
  });

  it("paginates by submission aggregate rather than event count", async () => {
    const first = await query.getLecturerSubmissions({ page: 1 });
    const second = await query.getLecturerSubmissions({ page: 2 });
    expect(first.submissions).toHaveLength(20);
    expect(second.submissions).toHaveLength(submissionsA.length - 20);
    expect(
      new Set(
        [...first.submissions, ...second.submissions].map(
          (row) => row.submissionId,
        ),
      ).size,
    ).toBe(submissionsA.length);
  });

  it("filters by submission type", async () => {
    const page = await query.getLecturerSubmissions({
      submissionType: "CREATE_NEW",
    });
    expect(
      page.submissions.every((item) => item.submissionType === "CREATE_NEW"),
    ).toBe(true);
    expect(page.totalSubmissions).toBeGreaterThan(0);
  });

  it("returns payload only in detail and never returns checksum", async () => {
    const list = await query.getLecturerSubmissions();
    expect(list.submissions[0]).not.toHaveProperty("payload");
    expect(list.submissions[0]).not.toHaveProperty("payloadChecksum");
    const detail = await query.getLecturerSubmissionDetail(submissionsA[0]!);
    expect(Object.keys(detail.payload)).toHaveLength(19);
    expect(detail).not.toHaveProperty("payloadChecksum");
    expect(detail).not.toHaveProperty("actorUserId");
  });

  it("blocks IDOR detail access through lecturer-scoped RLS", async () => {
    await expect(
      query.getLecturerSubmissionDetail(submissionsB[0]!),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("returns no workflow rows when PostgreSQL has no request context", async () => {
    const result = await runtime.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.workflow_event",
    );
    expect(result.rows[0]?.count).toBe(0);
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
  await owner.query(
    "INSERT INTO public.organization_unit (id, unit_key, source_value, display_name) VALUES ($1::uuid, 'phase4-lecturer-portal', $2, $2)",
    [randomUUID(), UNIT],
  );
  await seedIdentity(lecturerA, "lecturer-a@phase4.invalid");
  await seedIdentity(lecturerB, "lecturer-b@phase4.invalid");
  for (let index = 0; index < 23; index += 1) {
    submissionsA.push(
      await seedSubmission(
        lecturerA,
        index % 3 === 0
          ? "CREATE_NEW"
          : index % 3 === 1
            ? "UPDATE_EXISTING"
            : "CONFIRM_UNCHANGED",
        index % 5 === 0 ? "REJECTED" : index % 7 === 0 ? "APPROVED" : "PENDING",
        index,
      ),
    );
  }
  for (let index = 0; index < 3; index += 1) {
    submissionsB.push(
      await seedSubmission(lecturerB, "CONFIRM_UNCHANGED", "PENDING", index),
    );
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

async function seedSubmission(
  principal: Principal & { lecturerUid: string },
  submissionType: "CONFIRM_UNCHANGED" | "UPDATE_EXISTING" | "CREATE_NEW",
  state: "PENDING" | "REJECTED" | "APPROVED",
  index: number,
): Promise<string> {
  const submissionId = randomUUID();
  const recordUid = randomUUID();
  const createNew = submissionType === "CREATE_NEW";
  await owner.query(
    "INSERT INTO public.workflow_event (event_id, submission_id, event_type, submission_type, record_uid, lecturer_uid, approval_unit, base_stt, base_version_no, payload, payload_checksum, actor_user_id, created_at) VALUES ($1::uuid, $2::uuid, 'SUBMITTED', $3::public.workflow_submission_type, $4::uuid, $5::uuid, $6, $7, $8, $9::jsonb, 'fixture-checksum', $10::uuid, $11::timestamptz)",
    [
      randomUUID(),
      submissionId,
      submissionType,
      recordUid,
      principal.lecturerUid,
      UNIT,
      createNew ? null : 10_000 + index,
      createNew ? null : 1,
      JSON.stringify(payload(index)),
      principal.userId,
      new Date(Date.UTC(2026, 6, 16, 0, index)).toISOString(),
    ],
  );
  if (state !== "PENDING") {
    await owner.query(
      "INSERT INTO public.workflow_event (event_id, submission_id, event_type, record_uid, lecturer_uid, approval_unit, actor_user_id, reason, result_stt, result_version_no, created_at) VALUES ($1::uuid, $2::uuid, $3::public.workflow_event_type, $4::uuid, $5::uuid, $6, $7::uuid, $8, $9, $10, $11::timestamptz)",
      [
        randomUUID(),
        submissionId,
        state,
        recordUid,
        principal.lecturerUid,
        UNIT,
        principal.userId,
        state === "REJECTED" ? "Cần bổ sung minh chứng." : null,
        state === "APPROVED" ? 20_000 + index : null,
        state === "APPROVED" ? 2 : null,
        new Date(Date.UTC(2026, 6, 16, 1, index)).toISOString(),
      ],
    );
  }
  return submissionId;
}

function payload(index: number): Record<string, string | number | null> {
  return {
    don_vi_phu_trach_hoc_phan: UNIT,
    bo_mon_phu_trach_hoc_phan: "Bộ môn",
    khoi_kien_thuc: index,
    ma_hoc_phan: "P4-" + index,
    ten_hoc_phan: "Học phần " + index,
    ten_giang_vien: "Giảng viên",
    ma_so_can_bo: "GV-P4",
    email_tai_khoan_vnu: "lecturer@phase4.invalid",
    bo_mon: "Bộ môn",
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
