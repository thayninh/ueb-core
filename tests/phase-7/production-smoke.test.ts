import { describe, expect, it, vi } from "vitest";

import {
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
});
