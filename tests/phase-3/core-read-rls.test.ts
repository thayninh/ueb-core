// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260716030000_phase_3_core_read_rls/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Phase 3 core read RLS migration", () => {
  it("enables RLS and creates only one SELECT policy", () => {
    expect(migration).toContain(
      'ALTER TABLE "public"."ueb_core_data" ENABLE ROW LEVEL SECURITY;',
    );
    expect(migration.match(/CREATE POLICY/gu)).toHaveLength(1);
    expect(migration).toMatch(
      /CREATE POLICY "ueb_core_data_phase_3_select"[\s\S]*?FOR SELECT[\s\S]*?USING/u,
    );
    expect(migration).not.toMatch(/FOR (?:INSERT|UPDATE|DELETE)|WITH CHECK/iu);
  });

  it("defaults to no identity and checks active profile, roles, and scopes", () => {
    expect(migration).toContain("current_setting('app.current_user_id', true)");
    expect(migration).toContain(
      'profile."status" = \'ACTIVE\'::"public"."access_profile_status"',
    );
    expect(migration).toContain('role_assignment."revoked_at" IS NULL');
    expect(migration).toContain('unit_scope."revoked_at" IS NULL');
    expect(migration).toContain('organization_unit."is_active" = true');
    expect(migration).toContain(
      'profile."lecturer_uid" = "ueb_core_data"."lecturer_uid"',
    );
    expect(migration).toContain(
      'organization_unit."source_value" = "ueb_core_data"."approval_unit"',
    );
  });

  it("does not mutate core rows or configure RLS on auth tables", () => {
    expect(migration).not.toMatch(
      /\b(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|DROP)\b/iu,
    );
    expect(migration).not.toMatch(
      /ALTER TABLE "public"\."(?:auth_|access_profile|role_assignment|organization_unit|unit_scope_assignment)/u,
    );
  });
});
