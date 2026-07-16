// @vitest-environment node

import "dotenv/config";

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
  cleanupApprovalDatabase,
  coreRowsForSubmission,
  insertStaleCoreVersion,
  prepareApprovalDatabase,
  principalFor,
  seedApprovalSubmission,
  terminalEvents,
  type ApprovalDatabaseFixture,
} from "./helpers/approval-database";

const integrationEnabled = process.env.PHASE4_APPROVAL_INTEGRATION === "1";
const isolatedDescribe = integrationEnabled
  ? describe.sequential
  : describe.skip;
const auth = vi.hoisted(() => ({ principal: null as Principal | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/authorization", () => ({
  requireAnyRole: async (roles: readonly BusinessRole[]) => {
    const principal = auth.principal;
    if (
      !principal ||
      principal.status !== AccessProfileStatus.ACTIVE ||
      !roles.some((role) => principal.roles.includes(role))
    ) {
      throw new Error("FORBIDDEN");
    }
    return principal;
  },
}));

type ApproveModule = typeof import("@/lib/workflow/approve-service");
type PrismaModule = typeof import("@/lib/server/prisma");
type PostgresModule = typeof import("@/lib/server/postgres");

let fixture: ApprovalDatabaseFixture;
let approveService: ApproveModule;
let prismaModule: PrismaModule;
let postgresModule: PostgresModule;

isolatedDescribe("Phase 4 approval service", () => {
  beforeAll(async () => {
    fixture = await prepareApprovalDatabase();
    process.env.DATABASE_URL = fixture.urls.runtimeUrl;
    vi.resetModules();
    approveService = await import("@/lib/workflow/approve-service");
    prismaModule = await import("@/lib/server/prisma");
    postgresModule = await import("@/lib/server/postgres");
  }, 60_000);

  beforeEach(() => {
    auth.principal = principalFor(fixture.leaderA);
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
    await cleanupApprovalDatabase(fixture);
  }, 30_000);

  it("approves CONFIRM_UNCHANGED as one new immutable version", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CONFIRM_UNCHANGED",
    });
    const oldBefore = await readCoreVersion(submission.recordUid, 1);
    const result = await approveService.approveSubmission({
      submissionId: submission.submissionId,
    });
    const core = await coreRowsForSubmission(fixture, submission.submissionId);
    expect(core.rows).toHaveLength(1);
    expect(core.rows[0]).toMatchObject({
      version_no: 2,
      record_uid: submission.recordUid,
      lecturer_uid: submission.lecturerUid,
      approval_unit: submission.approvalUnit,
      source_submission_id: submission.submissionId,
      origin: "APPROVED_SUBMISSION",
      approved_by: fixture.leaderA.userId,
      source_row_number: null,
      source_row_checksum: null,
      source_import_run_id: null,
      payload: submission.payload,
    });
    expect(core.rows[0]!.stt).not.toBe(submission.baseStt);
    expect(await readCoreVersion(submission.recordUid, 1)).toEqual(oldBefore);
    expect(result).toMatchObject({
      state: "APPROVED",
      resultStt: core.rows[0]!.stt,
      resultVersionNo: 2,
    });
    expect(
      (await terminalEvents(fixture, submission.submissionId)).rows,
    ).toEqual([
      {
        event_type: "APPROVED",
        actor_user_id: fixture.leaderA.userId,
        result_stt: core.rows[0]!.stt,
        result_version_no: 2,
        reason: null,
      },
    ]);
  });

  it("approves UPDATE_EXISTING with fourteen edits and five DB identity fields", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "UPDATE_EXISTING",
      seed: "updated",
    });
    const baseVersionNo = submission.baseVersionNo!;
    const oldBefore = await readCoreVersion(
      submission.recordUid,
      baseVersionNo,
    );
    await approveService.approveSubmission({
      submissionId: submission.submissionId,
    });
    const core = await coreRowsForSubmission(fixture, submission.submissionId);
    expect(core.rows).toHaveLength(1);
    expect(core.rows[0]!.payload).toEqual(submission.payload);
    expect(core.rows[0]!.version_no).toBe(baseVersionNo + 1);
    expect(core.rows[0]!.stt).not.toBe(submission.baseStt);
    expect(await readCoreVersion(submission.recordUid, baseVersionNo)).toEqual(
      oldBefore,
    );
  });

  it("approves CREATE_NEW with server record UID and version one", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
    });
    await approveService.approveSubmission({
      submissionId: submission.submissionId,
    });
    const core = await coreRowsForSubmission(fixture, submission.submissionId);
    expect(core.rows).toHaveLength(1);
    expect(core.rows[0]).toMatchObject({
      version_no: 1,
      record_uid: submission.recordUid,
      payload: submission.payload,
    });
    const terminal = await terminalEvents(fixture, submission.submissionId);
    expect(terminal.rows[0]).toMatchObject({
      event_type: "APPROVED",
      result_stt: core.rows[0]!.stt,
      result_version_no: 1,
    });
  });

  it("does not approve a REJECTED submission or create core", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      terminal: "REJECTED",
    });
    await expect(
      approveService.approveSubmission({
        submissionId: submission.submissionId,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_ALREADY_TERMINAL" });
    expect(
      (await coreRowsForSubmission(fixture, submission.submissionId)).rows,
    ).toHaveLength(0);
  });

  it("lets ADMIN approve across units", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      unit: "B",
    });
    auth.principal = principalFor(fixture.admin);
    await expect(
      approveService.approveSubmission({
        submissionId: submission.submissionId,
      }),
    ).resolves.toMatchObject({ state: "APPROVED" });
  });

  it("blocks a leader outside the submission scope", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      unit: "B",
    });
    await expect(
      approveService.approveSubmission({
        submissionId: submission.submissionId,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_SUBMISSION_NOT_FOUND" });
    expect(
      (await coreRowsForSubmission(fixture, submission.submissionId)).rows,
    ).toHaveLength(0);
  });

  it("blocks a pure lecturer and a disabled leader", async () => {
    const lecturerSubmission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
    });
    auth.principal = principalFor(fixture.lecturerA);
    await expect(
      approveService.approveSubmission({
        submissionId: lecturerSubmission.submissionId,
      }),
    ).rejects.toThrow("FORBIDDEN");

    const disabledSubmission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
    });
    auth.principal = principalFor(fixture.disabledLeader);
    await expect(
      approveService.approveSubmission({
        submissionId: disabledSubmission.submissionId,
      }),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("blocks stale principals after role or scope revocation", async () => {
    const roleSubmission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
    });
    await fixture.owner.query(
      "UPDATE public.role_assignment SET revoked_by = user_id, revoked_at = clock_timestamp() WHERE id = $1::uuid",
      [fixture.leaderA.roleIds[0]],
    );
    await expect(
      approveService.approveSubmission({
        submissionId: roleSubmission.submissionId,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_SUBMISSION_NOT_FOUND" });
    await fixture.owner.query(
      "UPDATE public.role_assignment SET revoked_by = NULL, revoked_at = NULL WHERE id = $1::uuid",
      [fixture.leaderA.roleIds[0]],
    );

    const scopeSubmission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
    });
    await fixture.owner.query(
      "UPDATE public.unit_scope_assignment SET revoked_by = user_id, revoked_at = clock_timestamp() WHERE id = $1::uuid",
      [fixture.leaderA.scopeIds[0]],
    );
    await expect(
      approveService.approveSubmission({
        submissionId: scopeSubmission.submissionId,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_SUBMISSION_NOT_FOUND" });
    await fixture.owner.query(
      "UPDATE public.unit_scope_assignment SET revoked_by = NULL, revoked_at = NULL WHERE id = $1::uuid",
      [fixture.leaderA.scopeIds[0]],
    );
  });

  it("keeps a stale-base submission PENDING without core or APPROVED", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "UPDATE_EXISTING",
    });
    await insertStaleCoreVersion(fixture, submission);
    await expect(
      approveService.approveSubmission({
        submissionId: submission.submissionId,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_STALE_BASE" });
    expect(
      (await coreRowsForSubmission(fixture, submission.submissionId)).rows,
    ).toHaveLength(0);
    expect(
      (await terminalEvents(fixture, submission.submissionId)).rows,
    ).toHaveLength(0);
  });

  it("rejects a stored payload checksum mismatch before core insert", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      checksum: "0".repeat(64),
    });
    await expect(
      approveService.approveSubmission({
        submissionId: submission.submissionId,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_PAYLOAD_MISMATCH" });
    expect(
      (await coreRowsForSubmission(fixture, submission.submissionId)).rows,
    ).toHaveLength(0);
  });
});

async function readCoreVersion(recordUid: string, versionNo: number) {
  const result = await fixture.owner.query(
    "SELECT * FROM public.ueb_core_data WHERE record_uid = $1::uuid AND version_no = $2",
    [recordUid, versionNo],
  );
  return result.rows[0];
}
