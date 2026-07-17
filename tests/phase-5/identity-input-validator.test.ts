// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  APPROVED_UNIT_UIDS,
  validateIdentityInputDocuments,
} from "../../scripts/phase-5/lib/identity-input-schema";
import { formatIdentityValidationReport } from "../../scripts/phase-5/lib/redacted-report";
import {
  calculateInputChecksum,
  parseIdentityInputCommand,
} from "../../scripts/phase-5/validate-identity-input";

const approval = {
  approval_batch_id: "phase5-pilot-approval",
  approved_at: "2026-07-16T13:00:00+07:00",
  approved_by: "approved-authority-reference",
} as const;

function lecturer(overrides: Record<string, unknown> = {}) {
  return {
    ...approval,
    email: "lecturer-one@example.com",
    lecturer_uid: "10000000-0000-4000-8000-000000000001",
    requested_roles: ["LECTURER"],
    account_action: "CREATE",
    ...overrides,
  };
}

function leader(overrides: Record<string, unknown> = {}) {
  return {
    ...approval,
    email: "leader-one@example.com",
    unit_uid: ["KTPT"],
    requested_roles: ["FACULTY_LEADER"],
    scope_action: "ASSIGN",
    ...overrides,
  };
}

describe("Phase 5 approved identity input validator", () => {
  it("locks the six-unit inventory", () => {
    expect(APPROVED_UNIT_UIDS).toEqual([
      "KTPT",
      "QTKD",
      "KTKDQT",
      "KTCT",
      "TCNH",
      "KTKT",
    ]);
  });

  it("passes one approved lecturer and leader batch without ambiguity", () => {
    const result = validateIdentityInputDocuments([lecturer()], [leader()]);

    expect(result).toMatchObject({
      approvalBatchCount: 1,
      lecturerRecordCount: 1,
      leaderRecordCount: 1,
      unitScopeCount: 1,
      duplicateEmailCount: 0,
      duplicateLecturerUidCount: 0,
      duplicateRoleCount: 0,
      duplicateScopeCount: 0,
      unknownUnitCount: 0,
      unresolvedAmbiguityCount: 0,
    });
  });

  it("accepts independently approved records in the same approval batch", () => {
    const result = validateIdentityInputDocuments(
      [lecturer()],
      [
        leader({
          approved_at: "2026-07-16T14:00:00+07:00",
          approved_by: "second-authority-reference",
        }),
      ],
    );

    expect(result).toMatchObject({
      approvalBatchCount: 1,
      unresolvedAmbiguityCount: 0,
    });
  });

  it("detects duplicate email across lecturer and leader inputs", () => {
    const result = validateIdentityInputDocuments(
      [lecturer()],
      [leader({ email: " LECTURER-ONE@example.com " })],
    );

    expect(result.duplicateEmailCount).toBe(1);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DUPLICATE_EMAIL" }),
      ]),
    );
  });

  it("detects duplicate lecturer uid, roles and scopes", () => {
    const result = validateIdentityInputDocuments(
      [
        lecturer({ requested_roles: ["LECTURER", "LECTURER"] }),
        lecturer({ email: "lecturer-two@example.com" }),
      ],
      [leader({ unit_uid: ["KTPT", "KTPT"] })],
    );

    expect(result).toMatchObject({
      duplicateLecturerUidCount: 1,
      duplicateRoleCount: 1,
      duplicateScopeCount: 1,
    });
  });

  it("rejects unknown units, missing required roles and multiple batches", () => {
    const result = validateIdentityInputDocuments(
      [lecturer({ requested_roles: ["ADMIN"] })],
      [
        leader({
          approval_batch_id: "different-batch",
          requested_roles: ["ADMIN"],
          unit_uid: ["UNKNOWN"],
        }),
      ],
    );

    expect(result.unknownUnitCount).toBe(1);
    expect(result.approvalBatchCount).toBe(2);
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "LECTURER_ROLE_MISSING",
        "LEADER_ROLE_MISSING",
        "UNKNOWN_UNIT",
        "APPROVAL_BATCH_AMBIGUOUS",
      ]),
    );
  });

  it("returns only redacted counts, row numbers, codes and checksum", () => {
    const summary = validateIdentityInputDocuments(
      [lecturer()],
      [leader({ unit_uid: ["UNKNOWN"] })],
    );
    const report = formatIdentityValidationReport(summary, "a".repeat(64));

    expect(report).toContain("IDENTITY_INPUT_VALIDATION=FAIL");
    expect(report).toContain("ERROR_1_ROW=LEADERS:1");
    expect(report).toContain("ERROR_1_CODE=UNKNOWN_UNIT");
    expect(report).not.toContain("leader-one@example.com");
    expect(report).not.toContain("approved-authority-reference");
    expect(report).not.toContain("10000000-0000-4000-8000-000000000001");
  });

  it("produces a deterministic domain-separated checksum", () => {
    const first = calculateInputChecksum(
      Buffer.from("lecturers"),
      Buffer.from("leaders"),
    );
    const second = calculateInputChecksum(
      Buffer.from("lecturers"),
      Buffer.from("leaders"),
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("requires two distinct absolute input paths", () => {
    expect(
      parseIdentityInputCommand([
        "--lecturers=/secure/lecturers.json",
        "--leaders=/secure/leaders.json",
      ]),
    ).toEqual({
      lecturersPath: "/secure/lecturers.json",
      leadersPath: "/secure/leaders.json",
    });
    expect(() =>
      parseIdentityInputCommand([
        "--lecturers=/secure/input.json",
        "--leaders=/secure/input.json",
      ]),
    ).toThrow();
  });

  it("has no database client, provisioning or environment connection path", () => {
    const source = readFileSync(
      new URL(
        "../../scripts/phase-5/validate-identity-input.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).not.toMatch(
      /@prisma|from ["']pg["']|DATABASE_URL|provisionUser/u,
    );
  });
});
