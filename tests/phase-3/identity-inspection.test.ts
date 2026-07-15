// @vitest-environment node

import { readFileSync } from "node:fs";

import type { ClientBase } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  inspectIdentitySource,
  loadIdentityColumnMetadata,
  loadOptionalUnitLeaderConfiguration,
  normalizeEmailForComparison,
  readRuntimeDatabaseUrl,
  type IdentityColumnMetadata,
  type IdentitySourceRow,
  type UnitLeaderConfiguration,
} from "../../scripts/phase-3/lib/identity-inspection";
import { queryRowsInVerifiedReadOnlyTransaction } from "../../scripts/phase-3/inspect-identity-source";

const METADATA: IdentityColumnMetadata = {
  schemaName: "public",
  tableName: "ueb_core_data",
  lecturerUidColumn: "lecturer_uid",
  emailColumn: "email_tai_khoan_vnu",
  lecturerNameColumn: "ten_giang_vien",
  approvalUnitColumn: "approval_unit",
};

const HMAC_KEY = new Uint8Array(32).fill(7);
const GENERATED_AT = new Date("2026-07-16T00:00:00.000Z");

const implementationSource = [
  readFileSync(
    new URL(
      "../../scripts/phase-3/lib/identity-inspection.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFileSync(
    new URL(
      "../../scripts/phase-3/inspect-identity-source.ts",
      import.meta.url,
    ),
    "utf8",
  ),
].join("\n");

describe("Phase 3 identity source inspection", () => {
  it("resolves identity columns from the locked contract and Prisma mappings", async () => {
    await expect(loadIdentityColumnMetadata()).resolves.toEqual(METADATA);
  });

  it("normalizes only for comparison without mutating source rows", () => {
    const rows: IdentitySourceRow[] = [
      row("00000000-0000-0000-0000-000000000001", " User@Example.EDU "),
    ];
    const before = structuredClone(rows);

    expect(normalizeEmailForComparison(rows[0]?.email ?? "")).toBe(
      "user@example.edu",
    );
    inspectIdentitySource(rows, {
      metadata: METADATA,
      generatedAt: GENERATED_AT,
      hmacKey: HMAC_KEY,
    });

    expect(rows).toEqual(before);
  });

  it("counts blocking ambiguities, warnings, variants, and unit coverage", () => {
    const rows: IdentitySourceRow[] = [
      row(
        "00000000-0000-0000-0000-000000000001",
        " Alice@Example.edu ",
        "Unit A",
        "Lecturer One",
      ),
      row(
        "00000000-0000-0000-0000-000000000001",
        "alice@example.edu",
        "Unit B",
        "Lecturer One",
      ),
      row(
        "00000000-0000-0000-0000-000000000002",
        "alice@example.edu",
        "Unit A",
        "Lecturer Two",
      ),
      row(
        "00000000-0000-0000-0000-000000000003",
        "invalid-address",
        "Unit C",
        "Lecturer Three",
      ),
      row(
        "00000000-0000-0000-0000-000000000004",
        "   ",
        "Unit C",
        "Lecturer Four",
      ),
      row(
        "00000000-0000-0000-0000-000000000005",
        "first@example.edu",
        "Unit D",
        "Lecturer Five",
      ),
      row(
        "00000000-0000-0000-0000-000000000005",
        "second@example.edu",
        "Unit D",
        "Lecturer Five",
      ),
    ];
    const leaderConfiguration: UnitLeaderConfiguration = {
      configuredBySourceUnit: new Map([
        ["Unit A", true],
        ["Unit B", false],
        ["Unit D", true],
      ]),
    };

    const report = inspectIdentitySource(rows, {
      metadata: METADATA,
      leaderConfiguration,
      generatedAt: GENERATED_AT,
      hmacKey: HMAC_KEY,
    });

    expect(report).toMatchObject({
      status: "BLOCKED",
      distinct_lecturer_uid_count: 5,
      distinct_normalized_email_count: 4,
      missing_email_lecturer_count: 1,
      invalid_email_count: 1,
      email_to_multiple_lecturer_uid_count: 1,
      lecturer_uid_to_multiple_email_count: 1,
      email_case_or_whitespace_variant_count: 1,
      distinct_unit_count: 4,
      lecturer_in_multiple_units_count: 1,
      unmapped_unit_leader_count: 2,
    });
    expect(report.blocking_errors.map((anomaly) => anomaly.type)).toEqual([
      "EMAIL_TO_MULTIPLE_LECTURER_UID",
      "LECTURER_UID_TO_MULTIPLE_EMAIL",
    ]);
    expect(report.warnings.map((anomaly) => anomaly.type)).toEqual([
      "MISSING_EMAIL_FOR_LECTURER",
      "INVALID_EMAIL",
      "EMAIL_CASE_OR_WHITESPACE_VARIANT",
      "LECTURER_IN_MULTIPLE_UNITS",
      "UNIT_WITHOUT_CONFIGURED_LEADER",
      "UNIT_WITHOUT_CONFIGURED_LEADER",
    ]);
  });

  it("does not expose source email, lecturer name, or lecturer UID in anomalies", () => {
    const sensitiveEmail = "Sensitive.Person@Example.edu";
    const sensitiveName = "Sensitive Lecturer Name";
    const sensitiveUid = "00000000-0000-0000-0000-000000000099";
    const report = inspectIdentitySource(
      [
        row(sensitiveUid, sensitiveEmail, "Unit A", sensitiveName),
        row(sensitiveUid, "other@example.edu", "Unit A", sensitiveName),
      ],
      {
        metadata: METADATA,
        generatedAt: GENERATED_AT,
        hmacKey: HMAC_KEY,
      },
    );
    const serializedAnomalies = JSON.stringify({
      blocking_errors: report.blocking_errors,
      warnings: report.warnings,
    });

    expect(serializedAnomalies).not.toContain(sensitiveEmail);
    expect(serializedAnomalies).not.toContain(sensitiveEmail.toLowerCase());
    expect(serializedAnomalies).not.toContain(sensitiveName);
    expect(serializedAnomalies).not.toContain(sensitiveUid);
    for (const anomaly of report.blocking_errors) {
      for (const hash of [
        anomaly.lecturer_uid_hash,
        anomaly.email_hash,
        ...(anomaly.lecturer_uid_hashes ?? []),
        ...(anomaly.email_hashes ?? []),
      ].filter((value): value is string => value !== undefined)) {
        expect(hash).toMatch(/^[a-f0-9]{64}$/u);
      }
    }
  });

  it("returns PASS when mappings are unambiguous", () => {
    const report = inspectIdentitySource(
      [
        row(
          "00000000-0000-0000-0000-000000000001",
          "one@example.edu",
          "Unit A",
        ),
        row(
          "00000000-0000-0000-0000-000000000002",
          "two@example.edu",
          "Unit B",
        ),
      ],
      {
        metadata: METADATA,
        generatedAt: GENERATED_AT,
        hmacKey: HMAC_KEY,
      },
    );

    expect(report.status).toBe("PASS");
    expect(report.blocking_errors).toEqual([]);
    expect(report.unmapped_unit_leader_count).toBeNull();
  });

  it("loads the existing six-unit leader inventory without exposing values", async () => {
    const configuration = await loadOptionalUnitLeaderConfiguration();

    expect(configuration?.configuredBySourceUnit.size).toBe(6);
    expect(
      [...(configuration?.configuredBySourceUnit.values() ?? [])].every(
        (configured) => !configured,
      ),
    ).toBe(true);
  });

  it("uses runtime DATABASE_URL and rejects missing or non-PostgreSQL URLs", () => {
    const databaseUrl = "postgresql://runtime:secret@127.0.0.1:55432/ueb_core";

    expect(readRuntimeDatabaseUrl({ DATABASE_URL: databaseUrl })).toBe(
      databaseUrl,
    );
    expect(() => readRuntimeDatabaseUrl({})).toThrow(/DATABASE_URL/u);
    expect(() =>
      readRuntimeDatabaseUrl({ DATABASE_URL: "https://example.test" }),
    ).toThrow(/PostgreSQL/u);
  });

  it("verifies a read-only transaction before selecting identity rows", async () => {
    const queries: string[] = [];
    const sourceRows = [
      row("00000000-0000-0000-0000-000000000001", "one@example.edu"),
    ];
    const client = {
      query: vi.fn(async (query: string) => {
        queries.push(query);
        if (query.includes("current_setting")) {
          return { rows: [{ transaction_read_only: "on" }] };
        }
        if (query.includes('FROM "public"."ueb_core_data"')) {
          return { rows: sourceRows };
        }
        return { rows: [] };
      }),
    } as unknown as ClientBase;

    await expect(
      queryRowsInVerifiedReadOnlyTransaction(client, METADATA),
    ).resolves.toEqual(sourceRows);
    expect(queries[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(queries.at(-1)).toBe("COMMIT");
    expect(queries.join("\n")).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu,
    );
  });

  it("has no Excel dependency or database mutation statement", () => {
    expect(implementationSource).not.toMatch(/exceljs|\.xlsx|\.xls\b/iu);
    expect(implementationSource).not.toContain("MIGRATION_DATABASE_URL");
    expect(implementationSource).not.toMatch(
      /\.query(?:<[^>]+>)?\(\s*["'`]\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu,
    );
    expect(implementationSource).toContain("DATABASE_URL");
    expect(implementationSource).toContain("READ ONLY");
  });
});

function row(
  lecturerUid: string,
  email: string | null,
  approvalUnit: string | null = null,
  lecturerName: string | null = null,
): IdentitySourceRow {
  return { lecturerUid, email, lecturerName, approvalUnit };
}
