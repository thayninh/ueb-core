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
  cleanupLeaderRejectDatabase,
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

type QueryModule = typeof import("@/lib/workflow/leader-submission-query");
type PrismaModule = typeof import("@/lib/server/prisma");
type PostgresModule = typeof import("@/lib/server/postgres");

let fixture: LeaderRejectDatabaseFixture;
let query: QueryModule;
let prismaModule: PrismaModule;
let postgresModule: PostgresModule;
let pendingA: string[];
let pendingB: string[];
let searchableA = "";
let searchableB = "";

isolatedDescribe("Phase 4 leader pending submission query", () => {
  beforeAll(async () => {
    fixture = await prepareLeaderRejectDatabase();
    pendingA = [];
    pendingB = [];
    for (let index = 0; index < 23; index += 1) {
      const id = await seedLeaderSubmission(fixture, {
        unit: "A",
        submissionType: index === 0 ? "UPDATE_EXISTING" : "CREATE_NEW",
        searchSeed: index === 5 ? "UniqueNeedle" : `A-${index}`,
      });
      pendingA.push(id);
      if (index === 5) searchableA = id;
    }
    for (let index = 0; index < 3; index += 1) {
      const id = await seedLeaderSubmission(fixture, {
        unit: "B",
        searchSeed: index === 0 ? "UniqueNeedle" : `B-${index}`,
      });
      pendingB.push(id);
      if (index === 0) searchableB = id;
    }
    await seedLeaderSubmission(fixture, { unit: "A", state: "REJECTED" });
    await seedLeaderSubmission(fixture, { unit: "A", state: "APPROVED" });

    process.env.DATABASE_URL = fixture.urls.runtimeUrl;
    vi.resetModules();
    query = await import("@/lib/workflow/leader-submission-query");
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

  it("lets Leader A see only Unit A pending submissions", async () => {
    const page = await query.getLeaderSubmissionQueue();
    expect(page.totalSubmissions).toBe(pendingA.length);
    expect(
      page.submissions.every(({ approvalUnit }) =>
        approvalUnit.includes("Unit A"),
      ),
    ).toBe(true);
  });

  it("does not expose Unit B to Leader A", async () => {
    const page = await query.getLeaderSubmissionQueue();
    expect(
      page.submissions.some(({ submissionId }) =>
        pendingB.includes(submissionId),
      ),
    ).toBe(false);
  });

  it("lets a multi-unit leader see the union of active scopes", async () => {
    auth.principal = fixture.leaderMultiUnit;
    const page = await query.getLeaderSubmissionQueue();
    expect(page.totalSubmissions).toBe(pendingA.length + pendingB.length);
  });

  it("gives a leader without scope an empty queue", async () => {
    auth.principal = fixture.leaderNoScope;
    const page = await query.getLeaderSubmissionQueue();
    expect(page.totalSubmissions).toBe(0);
    expect(page.submissions).toEqual([]);
  });

  it("lets ADMIN see all pending submissions", async () => {
    auth.principal = fixture.admin;
    const page = await query.getLeaderSubmissionQueue();
    expect(page.totalSubmissions).toBe(pendingA.length + pendingB.length);
  });

  it("excludes terminal submissions and counts submission aggregates", async () => {
    const page = await query.getLeaderSubmissionQueue();
    expect(page.totalSubmissions).toBe(23);
    expect(page.submissions.every(({ state }) => state === "PENDING")).toBe(
      true,
    );
  });

  it("filters by server-resolved unit ID and submission type", async () => {
    auth.principal = fixture.leaderMultiUnit;
    const unitPage = await query.getLeaderSubmissionQueue({
      unitId: fixture.unitBId,
    });
    expect(unitPage.totalSubmissions).toBe(3);
    const typePage = await query.getLeaderSubmissionQueue({
      unitId: fixture.unitAId,
      submissionType: "UPDATE_EXISTING",
    });
    expect(typePage.totalSubmissions).toBe(1);
  });

  it("paginates pending aggregates with deterministic oldest-first order", async () => {
    const first = await query.getLeaderSubmissionQueue({ page: 1 });
    const second = await query.getLeaderSubmissionQueue({ page: 2 });
    expect(first.submissions).toHaveLength(20);
    expect(second.submissions).toHaveLength(3);
    expect(
      new Set(
        [...first.submissions, ...second.submissions].map(
          ({ submissionId }) => submissionId,
        ),
      ).size,
    ).toBe(23);
  });

  it("searches within RLS scope without leaking another unit", async () => {
    const page = await query.getLeaderSubmissionQueue({
      search: "UniqueNeedle",
    });
    expect(page.submissions.map(({ submissionId }) => submissionId)).toEqual([
      searchableA,
    ]);
    expect(
      page.submissions.map(({ submissionId }) => submissionId),
    ).not.toContain(searchableB);
  });

  it("blocks IDOR detail access outside the leader scope", async () => {
    await expect(query.getLeaderSubmissionDetail(pendingB[0]!)).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("removes queue access immediately after scope revocation", async () => {
    await fixture.owner.query(
      "UPDATE public.unit_scope_assignment SET revoked_by = user_id, revoked_at = clock_timestamp() WHERE id = $1::uuid",
      [fixture.leaderA.scopeIds[0]],
    );
    const page = await query.getLeaderSubmissionQueue();
    expect(page.totalSubmissions).toBe(0);
  });
});
