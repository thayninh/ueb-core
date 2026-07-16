// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAdminAuditPage,
  parseAuditEventType,
  parseAuditOutcome,
} from "@/lib/data/admin-audit";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/server/prisma", () => ({
  getPrismaClient: () => ({
    authAuditEvent: { count: mocks.count, findMany: mocks.findMany },
  }),
}));

describe("admin audit DAL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ userId: "admin-user" });
    mocks.count.mockResolvedValue(51);
    mocks.findMany.mockResolvedValue([
      {
        id: "event-id",
        eventType: "ROLE_GRANTED",
        outcome: "SUCCESS",
        actorUserId: "actor-id",
        targetUserId: "target-id",
        sessionId: null,
        occurredAt: new Date("2026-01-01T00:00:00Z"),
        metadata: {
          role: "ADMIN",
          email: "must-not-render@example.edu",
          sessionToken: "must-not-render",
          nested: { password: "must-not-render" },
        },
      },
    ]);
  });

  it("paginates whitelisted filters and strips unapproved metadata", async () => {
    const result = await getAdminAuditPage({
      eventType: "ROLE_GRANTED",
      outcome: "SUCCESS",
      page: 2,
    });

    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventType: "ROLE_GRANTED", outcome: "SUCCESS" },
        skip: 50,
        take: 50,
        select: expect.not.objectContaining({ identifierHash: true }),
      }),
    );
    expect(result.rows[0]?.metadata).toEqual({ role: "ADMIN" });
    expect(JSON.stringify(result)).not.toContain("must-not-render");
  });

  it("rejects unknown filter values", () => {
    expect(parseAuditEventType("UNKNOWN_EVENT")).toBeNull();
    expect(parseAuditOutcome("UNKNOWN_OUTCOME")).toBeNull();
    expect(parseAuditEventType("AUTH_LOGOUT")).toBe("AUTH_LOGOUT");
    expect(parseAuditOutcome("FAILED")).toBe("FAILED");
  });
});
