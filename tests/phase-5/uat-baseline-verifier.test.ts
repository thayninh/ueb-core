// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  assertCanonicalFingerprintsMatch,
  assertExpectedBaseline,
  resolveSingleActiveAdmin,
  type CanonicalFingerprint,
  type UatBaselineReport,
} from "../../scripts/phase-5/lib/uat-database";

const baseline: UatBaselineReport = {
  coreRows: 2497,
  workflowEvents: 0,
  importRuns: 1,
  migrationsApplied: 7,
  migrationsPending: 0,
  maxStt: 2569,
  nextStt: 2570,
  authUsers: 3,
  activeSessions: 0,
};

const fingerprint: CanonicalFingerprint = {
  databaseName: "ueb_core",
  coreRows: 2497,
  workflowEvents: 0,
  importRuns: 1,
  migrationsApplied: 7,
  migrationsPending: 0,
  maxStt: 2569,
  sequenceLastValue: 2569,
  sequenceIsCalled: true,
  sha256: "a".repeat(64),
};

describe("Phase 5 UAT baseline and canonical evidence", () => {
  it("accepts the exact immutable baseline without consuming STT", () => {
    expect(() => assertExpectedBaseline(baseline)).not.toThrow();
    expect(() =>
      assertExpectedBaseline({ ...baseline, nextStt: 2571 }),
    ).toThrow();
  });

  it("fails admin lookup safely for zero or multiple candidates", () => {
    expect(() => resolveSingleActiveAdmin([])).toThrow();
    expect(() =>
      resolveSingleActiveAdmin([
        { user_id: "10000000-0000-4000-8000-000000000001" },
        { user_id: "20000000-0000-4000-8000-000000000002" },
      ]),
    ).toThrow();
    expect(
      resolveSingleActiveAdmin([
        { user_id: "10000000-0000-4000-8000-000000000001" },
      ]),
    ).toBe("10000000-0000-4000-8000-000000000001");
  });

  it("requires identical canonical fingerprints", () => {
    expect(() =>
      assertCanonicalFingerprintsMatch(fingerprint, fingerprint),
    ).not.toThrow();
    expect(() =>
      assertCanonicalFingerprintsMatch(fingerprint, {
        ...fingerprint,
        sha256: "b".repeat(64),
      }),
    ).toThrow();
  });

  it("does not call nextval or expose identity fields in baseline code", () => {
    const source = readFileSync(
      new URL("../../scripts/phase-5/lib/uat-database.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/nextval\s*\(/iu);
    expect(source).not.toMatch(
      /auth_user\.(?:email|name)|auth_session\.token/iu,
    );
  });

  it("limits copied-session deletion to the UAT session table", () => {
    const source = readFileSync(
      new URL("../../scripts/phase-5/revoke-uat-sessions.ts", import.meta.url),
      "utf8",
    );
    const deletes = source.match(/DELETE\s+FROM\s+[^"'`\s]+/giu) ?? [];
    expect(deletes).toEqual(["DELETE FROM public.auth_session"]);
    expect(source).not.toMatch(/console\.(?:log|error).*token/iu);
  });
});
