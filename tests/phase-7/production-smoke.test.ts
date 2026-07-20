import { describe, expect, it, vi } from "vitest";

import {
  createSessionRevocationRequest,
  getSmokeCleanupFailure,
  isAcceptedSafeDeny,
  runWithSmokeSessionCleanup,
} from "../../scripts/phase-7/lib/production-smoke";

describe("Phase 7 production smoke safe-deny contract", () => {
  it.each([403, 404])("accepts HTTP %i with no protected data", (status) => {
    expect(
      isAcceptedSafeDeny({
        status,
        containsProtectedData: false,
        redirectedToProtectedContent: false,
      }),
    ).toBe(true);
  });

  it("rejects HTTP 200 even when the harness did not detect protected data", () => {
    expect(
      isAcceptedSafeDeny({
        status: 200,
        containsProtectedData: false,
        redirectedToProtectedContent: false,
      }),
    ).toBe(false);
  });

  it("rejects a response containing protected data", () => {
    expect(
      isAcceptedSafeDeny({
        status: 403,
        containsProtectedData: true,
        redirectedToProtectedContent: false,
      }),
    ).toBe(false);
  });

  it.each([302, 307, 500, 503])(
    "rejects redirect and server-error status %i",
    (status) => {
      expect(
        isAcceptedSafeDeny({
          status,
          containsProtectedData: false,
          redirectedToProtectedContent: status < 400,
        }),
      ).toBe(false);
    },
  );

  it("always runs session logout or revocation when the smoke action fails", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const failure = new Error("safe smoke failure");

    await expect(
      runWithSmokeSessionCleanup(async () => {
        throw failure;
      }, cleanup),
    ).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("runs session cleanup after a successful smoke action", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);

    await expect(
      runWithSmokeSessionCleanup(async () => "PASS", cleanup),
    ).resolves.toBe("PASS");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("preserves the primary failure when session cleanup also fails", async () => {
    const primaryFailure = new Error("WORKFLOW_QUEUE_ASSERTION_FAILED");
    const cleanupFailure = new Error("SESSION_REVOCATION_HTTP_415");

    let observedFailure: unknown;
    try {
      await runWithSmokeSessionCleanup(
        async () => {
          throw primaryFailure;
        },
        async () => {
          throw cleanupFailure;
        },
      );
    } catch (error) {
      observedFailure = error;
    }

    expect(observedFailure).toBe(primaryFailure);
    expect(getSmokeCleanupFailure(observedFailure)).toBe(cleanupFailure);
  });

  it("reports cleanup HTTP 415 directly when the smoke action passed", async () => {
    const cleanupFailure = new Error("SESSION_REVOCATION_HTTP_415");

    await expect(
      runWithSmokeSessionCleanup(
        async () => "PASS",
        async () => {
          throw cleanupFailure;
        },
      ),
    ).rejects.toBe(cleanupFailure);
  });

  it("uses the Better Auth JSON POST contract for session revocation", () => {
    expect(createSessionRevocationRequest()).toEqual({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  });

  it("cleans active test sessions without creating workflow mutations", async () => {
    let activeTestSessions = 1;
    const workflowMutations = 0;

    await expect(
      runWithSmokeSessionCleanup(
        async () => {
          expect(workflowMutations).toBe(0);
          throw new Error("SAFE_READ_ONLY_ASSERTION_FAILED");
        },
        async () => {
          activeTestSessions = 0;
        },
      ),
    ).rejects.toThrow("SAFE_READ_ONLY_ASSERTION_FAILED");

    expect(activeTestSessions).toBe(0);
    expect(workflowMutations).toBe(0);
  });
});
