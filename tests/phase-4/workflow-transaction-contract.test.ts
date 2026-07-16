// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PHASE_4_WORKFLOW_POLICY } from "../../config/phase-4/workflow-policy";

const serviceSources = [
  "submit-service.ts",
  "reject-service.ts",
  "approve-service.ts",
].map((fileName) => ({
  fileName,
  source: readFileSync(
    new URL(`../../src/lib/workflow/${fileName}`, import.meta.url),
    "utf8",
  ),
}));

describe("Phase 4 workflow transaction contract", () => {
  it.each(serviceSources)(
    "$fileName requests explicit Serializable isolation",
    ({ source }) => {
      expect(source).toContain(
        "isolationLevel: Prisma.TransactionIsolationLevel.Serializable",
      );
    },
  );

  it.each(serviceSources)(
    "$fileName locks submission_id before record_uid",
    ({ source }) => {
      const submissionLock = source.indexOf("await lockSubmission(");
      const recordLock = source.indexOf("await lockRecord(");

      expect(submissionLock).toBeGreaterThanOrEqual(0);
      expect(recordLock).toBeGreaterThan(submissionLock);
    },
  );

  it("publishes isolation, idempotency key, and lock order machine-readably", () => {
    expect(PHASE_4_WORKFLOW_POLICY.concurrency).toMatchObject({
      transactionIsolation: "SERIALIZABLE",
      idempotencyKey: "SERVER_ACTION_VALIDATED_SUBMISSION_ID",
      lockOrder: ["SUBMISSION_ID", "RECORD_UID"],
    });
  });

  it("keeps submit idempotent across bounded Serializable conflicts", () => {
    const submitSource = serviceSources.find(
      ({ fileName }) => fileName === "submit-service.ts",
    )?.source;

    expect(submitSource).toContain("SERIALIZABLE_SUBMIT_MAX_ATTEMPTS = 3");
    expect(submitSource).toContain('error.code === "P2034"');
  });
});
