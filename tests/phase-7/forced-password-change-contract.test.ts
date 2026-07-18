// @vitest-environment node

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationPath =
  "prisma/migrations/20260718190000_phase_7_forced_password_change/migration.sql";

describe("Phase 7 forced password change contract", () => {
  it("adds only backward-compatible access-profile state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(
      /must_change_password" BOOLEAN NOT NULL DEFAULT false/iu,
    );
    expect(sql).toMatch(/password_changed_at" TIMESTAMPTZ\(6\)/iu);
    expect(sql).not.toMatch(/\b(?:DROP|DELETE|UPDATE|TRUNCATE)\b/iu);
    expect(sql).not.toMatch(/ueb_core_data|workflow_event/iu);
  });

  it("keeps bootstrap admin false and production lecturer provisioning true", async () => {
    const [bootstrap, lecturerProvisioning] = await Promise.all([
      readFile("scripts/phase-3/bootstrap-admin.ts", "utf8"),
      readFile("scripts/phase-5/provision-approved-users.ts", "utf8"),
    ]);
    expect(bootstrap).toMatch(/requirePasswordChange:\s*false/u);
    expect(lecturerProvisioning).toMatch(
      /roles:\s*\["LECTURER"\][\s\S]{0,160}requirePasswordChange:\s*true/u,
    );
  });

  it("requires an explicit leader/operator choice in the admin form", async () => {
    const [policy, form] = await Promise.all([
      readFile("src/lib/auth/provisioning-policy.ts", "utf8"),
      readFile("src/app/(protected)/admin/users/create-user-form.tsx", "utf8"),
    ]);
    expect(policy).toMatch(/requirePasswordChange:\s*z\.boolean\(\)/u);
    expect(form).toMatch(/name="requirePasswordChange"[\s\S]{0,80}required/u);
    expect(form).toMatch(/value="true"/u);
    expect(form).toMatch(/value="false"/u);
  });
});
