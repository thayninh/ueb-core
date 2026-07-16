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
type RejectModule = typeof import("@/lib/workflow/reject-service");
type PrismaModule = typeof import("@/lib/server/prisma");
type PostgresModule = typeof import("@/lib/server/postgres");

let fixture: ApprovalDatabaseFixture;
let approveService: ApproveModule;
let rejectService: RejectModule;
let prismaModule: PrismaModule;
let postgresModule: PostgresModule;

isolatedDescribe("Phase 4 approval concurrency", () => {
  beforeAll(async () => {
    fixture = await prepareApprovalDatabase();
    process.env.DATABASE_URL = fixture.urls.runtimeUrl;
    vi.resetModules();
    approveService = await import("@/lib/workflow/approve-service");
    rejectService = await import("@/lib/workflow/reject-service");
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

  it("serializes concurrent approve/approve to one core and one terminal", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "double-approve",
    });
    const results = await Promise.allSettled([
      approveService.approveSubmission({
        submissionId: submission.submissionId,
      }),
      approveService.approveSubmission({
        submissionId: submission.submissionId,
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(
      (await coreRowsForSubmission(fixture, submission.submissionId)).rows,
    ).toHaveLength(1);
    const terminal = await terminalEvents(fixture, submission.submissionId);
    expect(terminal.rows).toHaveLength(1);
    expect(terminal.rows[0]?.event_type).toBe("APPROVED");
  });

  it("returns a controlled terminal conflict on sequential double approval", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "sequential-approve",
    });
    await approveService.approveSubmission({
      submissionId: submission.submissionId,
    });
    await expect(
      approveService.approveSubmission({
        submissionId: submission.submissionId,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_ALREADY_TERMINAL" });
    expect(
      (await coreRowsForSubmission(fixture, submission.submissionId)).rows,
    ).toHaveLength(1);
  });

  it("allows exactly one terminal winner in concurrent approve/reject", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "approve-reject",
    });
    const results = await Promise.allSettled([
      approveService.approveSubmission({
        submissionId: submission.submissionId,
      }),
      rejectService.rejectSubmission({
        submissionId: submission.submissionId,
        reason: "Concurrent rejection",
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    const terminal = await terminalEvents(fixture, submission.submissionId);
    const core = await coreRowsForSubmission(fixture, submission.submissionId);
    expect(terminal.rows).toHaveLength(1);
    if (terminal.rows[0]?.event_type === "APPROVED") {
      expect(core.rows).toHaveLength(1);
      expect(terminal.rows[0].reason).toBeNull();
    } else {
      expect(terminal.rows[0]?.event_type).toBe("REJECTED");
      expect(core.rows).toHaveLength(0);
    }
  });

  it("rolls back the core row when APPROVED event insertion fails", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "event-rollback",
    });
    await fixture.owner.query(`
      CREATE FUNCTION public.phase4_test_reject_approved_event()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'APPROVED'::public.workflow_event_type THEN
          RAISE EXCEPTION 'intentional isolated approval event failure';
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER workflow_event_phase4_test_reject_approved
      BEFORE INSERT ON public.workflow_event
      FOR EACH ROW EXECUTE FUNCTION public.phase4_test_reject_approved_event();
    `);
    try {
      await expect(
        approveService.approveSubmission({
          submissionId: submission.submissionId,
        }),
      ).rejects.toThrow();
      expect(
        (await coreRowsForSubmission(fixture, submission.submissionId)).rows,
      ).toHaveLength(0);
      expect(
        (await terminalEvents(fixture, submission.submissionId)).rows,
      ).toHaveLength(0);
    } finally {
      await fixture.owner.query(
        "DROP TRIGGER workflow_event_phase4_test_reject_approved ON public.workflow_event",
      );
      await fixture.owner.query(
        "DROP FUNCTION public.phase4_test_reject_approved_event()",
      );
    }
  });
});
