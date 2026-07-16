// @vitest-environment node

import "dotenv/config";

import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
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
  cleanupLeaderRejectDatabase,
  countCoreRows,
  countEvents,
  prepareLeaderRejectDatabase,
  seedLeaderSubmission,
  type LeaderRejectDatabaseFixture,
} from "./helpers/leader-reject-database";

const integrationEnabled = process.env.PHASE4_LEADER_INTEGRATION === "1";
const isolatedDescribe = integrationEnabled
  ? describe.sequential
  : describe.skip;
const auth = vi.hoisted(() => ({ principal: null as Principal | null }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/authorization", () => ({
  requireAnyRole: async (roles: readonly BusinessRole[]) =>
    authorize(roles, false),
  requireLecturerIdentity: async () => authorize([BusinessRole.LECTURER], true),
}));

type RejectModule = typeof import("@/lib/workflow/reject-service");
type LeaderQueryModule =
  typeof import("@/lib/workflow/leader-submission-query");
type LecturerQueryModule =
  typeof import("@/lib/workflow/lecturer-submission-query");
type PrismaModule = typeof import("@/lib/server/prisma");
type PostgresModule = typeof import("@/lib/server/postgres");

let fixture: LeaderRejectDatabaseFixture;
let rejectService: RejectModule;
let leaderQuery: LeaderQueryModule;
let lecturerQuery: LecturerQueryModule;
let prismaModule: PrismaModule;
let postgresModule: PostgresModule;

isolatedDescribe("Phase 4 workflow rejection service", () => {
  beforeAll(async () => {
    fixture = await prepareLeaderRejectDatabase();
    process.env.DATABASE_URL = fixture.urls.runtimeUrl;
    vi.resetModules();
    rejectService = await import("@/lib/workflow/reject-service");
    leaderQuery = await import("@/lib/workflow/leader-submission-query");
    lecturerQuery = await import("@/lib/workflow/lecturer-submission-query");
    prismaModule = await import("@/lib/server/prisma");
    postgresModule = await import("@/lib/server/postgres");
  }, 60_000);

  beforeEach(() => {
    auth.principal = fixture.leaderA;
  });

  afterAll(async () => {
    await prismaModule
      ?.getPrismaClient()
      .$disconnect()
      .catch(() => undefined);
    await postgresModule
      ?.getPostgresPool()
      .end()
      .catch(() => undefined);
    await cleanupLeaderRejectDatabase(fixture);
  }, 30_000);

  it("rejects a scoped PENDING submission and trims the reason", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "A" });
    const result = await rejectService.rejectSubmission({
      submissionId,
      reason: "  Cần bổ sung minh chứng.  ",
    });
    expect(result).toMatchObject({
      submissionId,
      state: "REJECTED",
      reason: "Cần bổ sung minh chứng.",
    });
    expect(await countEvents(fixture, submissionId, "REJECTED")).toBe(1);
  });

  it("does not insert core and removes the submission from the pending queue", async () => {
    const submissionId = await seedLeaderSubmission(fixture, {
      unit: "A",
      searchSeed: "queue-removal",
    });
    const before = await countCoreRows(fixture);
    await rejectService.rejectSubmission({
      submissionId,
      reason: "Từ chối hợp lệ",
    });
    const page = await leaderQuery.getLeaderSubmissionQueue({
      search: submissionId,
    });
    expect(page.totalSubmissions).toBe(0);
    expect(await countCoreRows(fixture)).toBe(before);
  });

  it("lets the lecturer see REJECTED state, reason and rejectedAt", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "A" });
    await rejectService.rejectSubmission({
      submissionId,
      reason: "Lý do hiển thị cho giảng viên",
    });
    auth.principal = fixture.lecturerA;
    const detail =
      await lecturerQuery.getLecturerSubmissionDetail(submissionId);
    expect(detail).toMatchObject({
      state: "REJECTED",
      rejectionReason: "Lý do hiển thị cho giảng viên",
    });
    expect(detail.terminalAt).toBeInstanceOf(Date);
  });

  it("blocks a leader from rejecting another unit", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "B" });
    await expect(
      rejectService.rejectSubmission({ submissionId, reason: "Ngoài scope" }),
    ).rejects.toMatchObject({ code: "WORKFLOW_SUBMISSION_NOT_FOUND" });
    expect(await countEvents(fixture, submissionId, "REJECTED")).toBe(0);
  });

  it("blocks a pure lecturer from rejecting", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "A" });
    auth.principal = fixture.lecturerA;
    await expect(
      rejectService.rejectSubmission({
        submissionId,
        reason: "Không có quyền",
      }),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("blocks a disabled leader", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "A" });
    auth.principal = fixture.disabledLeader;
    await expect(
      rejectService.rejectSubmission({
        submissionId,
        reason: "Không có quyền",
      }),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("blocks a stale principal immediately after scope revocation", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "A" });
    await fixture.owner.query(
      "UPDATE public.unit_scope_assignment SET revoked_by = user_id, revoked_at = clock_timestamp() WHERE id = $1::uuid",
      [fixture.leaderA.scopeIds[0]],
    );
    await expect(
      rejectService.rejectSubmission({
        submissionId,
        reason: "Scope đã bị thu hồi",
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_SUBMISSION_NOT_FOUND" });
    expect(await countEvents(fixture, submissionId, "REJECTED")).toBe(0);
    await fixture.owner.query(
      "UPDATE public.unit_scope_assignment SET revoked_by = NULL, revoked_at = NULL WHERE id = $1::uuid",
      [fixture.leaderA.scopeIds[0]],
    );
  });

  it("lets ADMIN reject a submission in any active unit", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "B" });
    auth.principal = fixture.admin;
    await expect(
      rejectService.rejectSubmission({ submissionId, reason: "Admin từ chối" }),
    ).resolves.toMatchObject({ state: "REJECTED" });
  });

  it("blocks rejection of an APPROVED submission", async () => {
    const submissionId = await seedLeaderSubmission(fixture, {
      unit: "A",
      state: "APPROVED",
    });
    await expect(
      rejectService.rejectSubmission({ submissionId, reason: "Đã terminal" }),
    ).rejects.toMatchObject({ code: "WORKFLOW_ALREADY_TERMINAL" });
    expect(await countEvents(fixture, submissionId, "REJECTED")).toBe(0);
  });

  it("blocks a second rejection without changing the first reason", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "A" });
    await rejectService.rejectSubmission({
      submissionId,
      reason: "Lý do thứ nhất",
    });
    await expect(
      rejectService.rejectSubmission({ submissionId, reason: "Lý do thứ hai" }),
    ).rejects.toMatchObject({ code: "WORKFLOW_ALREADY_TERMINAL" });
    const result = await fixture.owner.query<{ reason: string }>(
      "SELECT reason FROM public.workflow_event WHERE submission_id = $1::uuid AND event_type = 'REJECTED'",
      [submissionId],
    );
    expect(result.rows).toEqual([{ reason: "Lý do thứ nhất" }]);
  });

  it("serializes concurrent reject/reject to one terminal event", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "A" });
    const coreRowsBefore = await countCoreRows(fixture);
    const results = await Promise.allSettled([
      rejectService.rejectSubmission({
        submissionId,
        reason: "Quyết định một",
      }),
      rejectService.rejectSubmission({
        submissionId,
        reason: "Quyết định hai",
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(await countEvents(fixture, submissionId, "REJECTED")).toBe(1);
    expect(await countCoreRows(fixture)).toBe(coreRowsBefore);
    const terminal = await fixture.owner.query<{ reason: string }>(
      "SELECT reason FROM public.workflow_event WHERE submission_id = $1::uuid AND event_type = 'REJECTED'",
      [submissionId],
    );
    expect(terminal.rows).toHaveLength(1);
    expect(["Quyết định một", "Quyết định hai"]).toContain(
      terminal.rows[0]?.reason,
    );
  });

  it("RLS rejects a terminal actor mismatch", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "A" });
    await expect(
      directRuntimeReject(
        submissionId,
        fixture.leaderA.userId,
        fixture.leaderB.userId,
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("RLS rejects a terminal insert without request context", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "A" });
    await expect(
      directRuntimeReject(submissionId, null, fixture.leaderA.userId),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("keeps the original SUBMITTED event unchanged", async () => {
    const submissionId = await seedLeaderSubmission(fixture, { unit: "A" });
    const before = await submittedSnapshot(submissionId);
    await rejectService.rejectSubmission({
      submissionId,
      reason: "Không sửa submitted",
    });
    expect(await submittedSnapshot(submissionId)).toEqual(before);
  });

  it("keeps runtime unable to write core data", async () => {
    await expect(
      fixture.runtime.query("INSERT INTO public.ueb_core_data DEFAULT VALUES"),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      fixture.runtime.query(
        "UPDATE public.ueb_core_data SET stt = stt WHERE false",
      ),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      fixture.runtime.query("DELETE FROM public.ueb_core_data WHERE false"),
    ).rejects.toThrow(/permission denied/iu);
  });
});

async function authorize(
  roles: readonly BusinessRole[],
  lecturerRequired: boolean,
): Promise<Principal> {
  const principal = auth.principal;
  if (
    !principal ||
    principal.status !== AccessProfileStatus.ACTIVE ||
    !roles.some((role) => principal.roles.includes(role)) ||
    (lecturerRequired && !principal.lecturerUid)
  ) {
    throw new Error("FORBIDDEN");
  }
  return principal;
}

async function directRuntimeReject(
  submissionId: string,
  currentUserId: string | null,
  actorUserId: string,
): Promise<void> {
  const submitted = await fixture.owner.query<{
    submission_type: string;
    record_uid: string;
    lecturer_uid: string;
    approval_unit: string;
    base_stt: number | null;
    base_version_no: number | null;
  }>(
    "SELECT submission_type::text, record_uid::text, lecturer_uid::text, approval_unit, base_stt, base_version_no FROM public.workflow_event WHERE submission_id = $1::uuid AND event_type = 'SUBMITTED'",
    [submissionId],
  );
  const row = submitted.rows[0]!;
  const connection = await fixture.runtime.connect();
  try {
    await connection.query("BEGIN");
    if (currentUserId) await setContext(connection, currentUserId);
    await connection.query(
      `INSERT INTO public.workflow_event (
         event_id, submission_id, event_type, submission_type, record_uid,
         lecturer_uid, approval_unit, base_stt, base_version_no,
         actor_user_id, reason
       ) VALUES (
         $1::uuid, $2::uuid, 'REJECTED', $3::public.workflow_submission_type,
         $4::uuid, $5::uuid, $6, $7, $8, $9::uuid, 'Direct RLS rejection'
       )`,
      [
        randomUUID(),
        submissionId,
        row.submission_type,
        row.record_uid,
        row.lecturer_uid,
        row.approval_unit,
        row.base_stt,
        row.base_version_no,
        actorUserId,
      ],
    );
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

function setContext(connection: PoolClient, userId: string) {
  return connection.query(
    "SELECT set_config('app.current_user_id', $1, true)",
    [userId],
  );
}

async function submittedSnapshot(submissionId: string) {
  const result = await fixture.owner.query(
    "SELECT event_id::text, submission_id::text, event_type::text, submission_type::text, record_uid::text, lecturer_uid::text, approval_unit, base_stt, base_version_no, payload, payload_checksum, actor_user_id::text, reason, result_stt, result_version_no, parent_submission_id::text FROM public.workflow_event WHERE submission_id = $1::uuid AND event_type = 'SUBMITTED'",
    [submissionId],
  );
  return result.rows[0];
}
