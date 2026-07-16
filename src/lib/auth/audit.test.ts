// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  appendAuthAuditEvent,
  AUTH_AUDIT_EVENT_TYPES,
  hashAuditIdentifier,
} from "@/lib/auth/audit";

describe("authentication audit policy", () => {
  it("uses the exact approved event taxonomy", () => {
    expect(AUTH_AUDIT_EVENT_TYPES).toEqual([
      "AUTH_LOGIN_SUCCESS",
      "AUTH_LOGIN_FAILED",
      "AUTH_LOGOUT",
      "USER_CREATED",
      "USER_ENABLED",
      "USER_DISABLED",
      "PASSWORD_SET_BY_ADMIN",
      "ROLE_GRANTED",
      "ROLE_REVOKED",
      "UNIT_SCOPE_GRANTED",
      "UNIT_SCOPE_REVOKED",
      "LECTURER_MAPPING_ASSIGNED",
      "LECTURER_MAPPING_REMOVED",
      "SESSION_REVOKED",
    ]);
  });

  it("normalizes email for HMAC without returning the clear identifier", () => {
    const secret = "a".repeat(32);
    const hash = hashAuditIdentifier(" User@Example.edu ", secret);

    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(hash).toBe(hashAuditIdentifier("user@example.edu", secret));
    expect(hash).not.toContain("user@example.edu");
  });

  it("writes only explicitly shaped event fields and safe metadata", async () => {
    const create = vi.fn().mockResolvedValue({});

    await appendAuthAuditEvent({ authAuditEvent: { create } } as never, {
      eventType: "AUTH_LOGIN_FAILED",
      outcome: "FAILED",
      identifierHash: "f".repeat(64),
      metadata: { authenticationType: "EMAIL_PASSWORD" },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "AUTH_LOGIN_FAILED",
        outcome: "FAILED",
        identifierHash: "f".repeat(64),
      }),
    });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("data.email");
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("data.password");
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("data.sessionToken");
  });
});
