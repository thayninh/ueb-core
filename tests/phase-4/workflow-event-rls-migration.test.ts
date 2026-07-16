// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readMigration("20260716050000_phase_4_workflow_event_rls");
const phase2Initial = readMigration("20260715135204_phase_2_initial");
const phase2Alignment = readMigration(
  "20260715164205_align_khoi_kien_thuc_integer",
);
const phase3Foundation = readMigration(
  "20260715183059_phase_3_auth_rbac_foundation",
);
const phase3CoreRls = readMigration("20260716030000_phase_3_core_read_rls");
const phase4Contract = readMigration(
  "20260716040000_phase_4_row_workflow_contract",
);

const selectPolicy = policySql("workflow_event_phase_4_select");
const submittedPolicy = policySql("workflow_event_phase_4_insert_submitted");
const terminalPolicy = policySql("workflow_event_phase_4_insert_terminal");

describe("Phase 4 workflow-event RLS migration", () => {
  it("1. enables RLS on workflow_event", () => {
    expect(migration).toContain(
      'ALTER TABLE "public"."workflow_event" ENABLE ROW LEVEL SECURITY;',
    );
  });

  it("2. does not force RLS or change table ownership", () => {
    expect(migration).not.toMatch(/FORCE ROW LEVEL SECURITY|OWNER TO/iu);
  });

  it("3. creates one SELECT policy", () => {
    expect(selectPolicy).toContain("FOR SELECT");
  });

  it("4. creates a dedicated SUBMITTED INSERT policy", () => {
    expect(submittedPolicy).toContain("FOR INSERT");
    expect(submittedPolicy).toContain("WITH CHECK");
    expect(submittedPolicy).toContain("'SUBMITTED'");
  });

  it("5. creates a dedicated terminal INSERT policy", () => {
    expect(terminalPolicy).toContain("FOR INSERT");
    expect(terminalPolicy).toContain("'APPROVED'");
    expect(terminalPolicy).toContain("'REJECTED'");
  });

  it("6. requires an active access profile for SELECT", () => {
    expect(selectPolicy).toContain(
      `profile."status" = 'ACTIVE'::"public"."access_profile_status"`,
    );
  });

  it("7. considers only non-revoked active roles for SELECT", () => {
    expect(selectPolicy).toContain('role_assignment."revoked_at" IS NULL');
    expect(selectPolicy).toContain("'ADMIN'");
    expect(selectPolicy).toContain("'LECTURER'");
    expect(selectPolicy).toContain("'FACULTY_LEADER'");
  });

  it("8. matches lecturer events through the database lecturer mapping", () => {
    expect(selectPolicy).toContain(
      'profile."lecturer_uid" = "workflow_event"."lecturer_uid"',
    );
  });

  it("9. matches leaders through active exact database unit scope", () => {
    expect(selectPolicy).toContain('unit_scope."revoked_at" IS NULL');
    expect(selectPolicy).toContain('organization_unit."is_active" = true');
    expect(selectPolicy).toContain(
      'organization_unit."source_value" = "workflow_event"."approval_unit"',
    );
  });

  it("10. requires the SUBMITTED actor to equal current user", () => {
    expect(submittedPolicy).toContain(
      `"actor_user_id"::text = current_setting('app.current_user_id', true)`,
    );
  });

  it("11. restricts SUBMITTED to an active mapped lecturer", () => {
    expect(submittedPolicy).toContain(`role_assignment."role" = 'LECTURER'`);
    expect(submittedPolicy).toContain(
      `profile."status" = 'ACTIVE'::"public"."access_profile_status"`,
    );
    expect(submittedPolicy).toContain(
      'profile."lecturer_uid" = "workflow_event"."lecturer_uid"',
    );
    expect(submittedPolicy).not.toContain("'ADMIN'");
    expect(submittedPolicy).not.toContain("'FACULTY_LEADER'");
  });

  it("12. requires the terminal actor to equal current user", () => {
    expect(terminalPolicy).toContain(
      `"actor_user_id"::text = current_setting('app.current_user_id', true)`,
    );
  });

  it("13. restricts terminal events to admin or an exact scoped leader", () => {
    expect(terminalPolicy).toContain("'ADMIN'");
    expect(terminalPolicy).toContain("'FACULTY_LEADER'");
    expect(terminalPolicy).toContain('unit_scope."revoked_at" IS NULL');
    expect(terminalPolicy).toContain(
      'organization_unit."source_value" = "workflow_event"."approval_unit"',
    );
    expect(terminalPolicy).not.toContain("'LECTURER'");
  });

  it("14. creates no UPDATE policy", () => {
    expect(migration).not.toMatch(/FOR UPDATE/iu);
  });

  it("15. creates no DELETE policy", () => {
    expect(migration).not.toMatch(/FOR DELETE/iu);
  });

  it("16. changes no runtime grants", () => {
    expect(migration).not.toMatch(/\bGRANT\b|\bREVOKE\b/iu);
  });

  it("17. grants no INSERT privilege on core data", () => {
    expect(migration).not.toMatch(/GRANT\s+INSERT[\s\S]*?ueb_core_data/iu);
  });

  it("18. creates no core INSERT policy", () => {
    expect(migration).not.toMatch(
      /CREATE POLICY[\s\S]*?ON\s+"public"\."ueb_core_data"[\s\S]*?FOR INSERT/iu,
    );
  });

  it("19. leaves every Phase 2 and Phase 3 migration byte-for-byte unchanged", () => {
    expect(sha256(phase2Initial)).toBe(
      "7c2c31f2542e5ccce2ce4d70360959e38f74b5402f82f145453eed1af3d879cd",
    );
    expect(sha256(phase2Alignment)).toBe(
      "d8aa65fa6dc25ace3a387b4334f4761b0c2415dd8a3f515a7ae32c932c75e2db",
    );
    expect(sha256(phase3Foundation)).toBe(
      "4bead8ebef87903729d441c2c8c40bd439eb8ba1ddc8ec865a74bad854d04cf8",
    );
    expect(sha256(phase3CoreRls)).toBe(
      "47d55f1ae6fe79cd0cc97579b008b9a7707f7a80789cf33177e7976e8842d125",
    );
  });

  it("20. leaves the Phase 4 row-workflow contract migration unchanged", () => {
    expect(sha256(phase4Contract)).toBe(
      "6045e43735abfa55d6953178794532f99f664a0772d23894ceb92285ffcff398",
    );
  });

  it("21. preserves the workflow append-only triggers", () => {
    expect(phase2Initial).toContain(
      'CREATE TRIGGER "workflow_event_reject_update_delete"',
    );
    expect(phase2Initial).toContain(
      'CREATE TRIGGER "workflow_event_reject_truncate"',
    );
    expect(migration).not.toMatch(/DROP TRIGGER|DISABLE TRIGGER/iu);
  });

  it("22. remains a create-only artifact for the acceptance status gate", () => {
    expect(migration).not.toContain("_prisma_migrations");
    expect(migration).not.toMatch(
      /prisma migrate (?:dev|deploy|reset)|prisma db push/iu,
    );
  });
});

function readMigration(name: string): string {
  return readFileSync(
    new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url),
    "utf8",
  );
}

function policySql(name: string): string {
  const match = migration.match(
    new RegExp(`CREATE POLICY "${name}"[\\s\\S]*?;`, "u"),
  );
  if (!match) throw new Error(`Missing policy ${name}.`);
  return match[0];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
