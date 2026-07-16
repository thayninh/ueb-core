// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordLoginFailure } from "@/lib/auth/audit-writer";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/prisma", () => ({
  getPrismaClient: () => ({ authAuditEvent: { create: mocks.create } }),
}));

describe("login audit writer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUDIT_HMAC_SECRET", "a".repeat(32));
    mocks.create.mockResolvedValue({});
  });

  afterEach(() => vi.unstubAllEnvs());

  it("stores an HMAC instead of the failed email", async () => {
    await recordLoginFailure("failed@example.edu");

    const data = mocks.create.mock.calls[0]?.[0]?.data;
    expect(data.eventType).toBe("AUTH_LOGIN_FAILED");
    expect(data.outcome).toBe("FAILED");
    expect(data.identifierHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(data)).not.toContain("failed@example.edu");
  });
});
