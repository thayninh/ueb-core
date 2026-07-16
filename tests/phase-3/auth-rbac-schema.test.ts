// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  new URL("../../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260715183059_phase_3_auth_rbac_foundation/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const AUTH_TABLES = [
  "auth_user",
  "auth_session",
  "auth_account",
  "auth_verification",
] as const;

const RBAC_TABLES = [
  "access_profile",
  "role_assignment",
  "organization_unit",
  "unit_scope_assignment",
  "auth_audit_event",
] as const;

describe("Phase 3 authentication and RBAC schema", () => {
  it("creates the exact Better Auth and business RBAC table set", () => {
    const createdTables = [
      ...migration.matchAll(/^CREATE TABLE "([^"]+)"/gmu),
    ].map(([, table]) => table);

    expect(createdTables).toEqual([...AUTH_TABLES, ...RBAC_TABLES]);
    for (const table of createdTables) {
      expect(schema).toContain(`@@map("${table}")`);
    }
  });

  it("uses UUID identifiers without linking access profiles to core data", () => {
    for (const table of [...AUTH_TABLES, ...RBAC_TABLES]) {
      expect(migration).toMatch(
        new RegExp(
          `CREATE TABLE "${table}" \\([\\s\\S]*?"id" UUID NOT NULL`,
          "u",
        ),
      );
    }

    expect(migration).toContain('"lecturer_uid" UUID');
    expect(migration).not.toMatch(
      /REFERENCES "ueb_core_data"|ALTER TABLE "ueb_core_data"/u,
    );
  });

  it("enforces one active role and unit scope assignment", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "role_assignment_active_user_role_key"[\s\S]*?ON "role_assignment"\("user_id", "role"\)[\s\S]*?WHERE "revoked_at" IS NULL;/u,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "unit_scope_assignment_active_user_unit_key"[\s\S]*?ON "unit_scope_assignment"\("user_id", "organization_unit_id"\)[\s\S]*?WHERE "revoked_at" IS NULL;/u,
    );
    expect(migration).toContain(
      'CONSTRAINT "role_assignment_revocation_pair_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "unit_scope_assignment_revocation_pair_check"',
    );
  });

  it("requires active lecturers to retain a lecturer mapping", () => {
    expect(migration).toContain(
      'CREATE FUNCTION "enforce_lecturer_role_mapping"()',
    );
    expect(migration).toContain(
      'CREATE FUNCTION "protect_active_lecturer_mapping"()',
    );
    expect(migration).toContain('NEW."role" = \'LECTURER\'::"business_role"');
  });

  it("makes only auth audit events append-only", () => {
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON "auth_audit_event"\nFOR EACH ROW',
    );
    expect(migration).toContain(
      'BEFORE TRUNCATE ON "auth_audit_event"\nFOR EACH STATEMENT',
    );

    for (const table of [
      "auth_user",
      "auth_session",
      "auth_account",
      "auth_verification",
    ]) {
      expect(migration).not.toContain(`BEFORE UPDATE OR DELETE ON "${table}"`);
      expect(migration).not.toContain(`BEFORE TRUNCATE ON "${table}"`);
    }
  });

  it("does not mutate Phase 2 tables, create RLS, or cascade audit data", () => {
    expect(migration).not.toMatch(
      /^\s*(?:DROP|TRUNCATE)\s|ROW LEVEL SECURITY|CREATE POLICY/imu,
    );
    expect(migration).not.toMatch(
      /ALTER TABLE "(?:ueb_core_data|import_run|workflow_event)"/u,
    );
    expect(migration).not.toMatch(
      /ALTER TABLE "auth_audit_event"[\s\S]*?FOREIGN KEY/u,
    );

    const cascadeForeignKeys = migration
      .split("\n")
      .filter((line) => line.includes("ON DELETE CASCADE"));
    expect(cascadeForeignKeys).toHaveLength(2);
    expect(
      cascadeForeignKeys.every((line) =>
        /auth_(?:session|account)/u.test(line),
      ),
    ).toBe(true);
  });
});
