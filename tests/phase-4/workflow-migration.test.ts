// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const phase2Initial = readFileSync(
  new URL(
    "../../prisma/migrations/20260715135204_phase_2_initial/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const phase2Alignment = readFileSync(
  new URL(
    "../../prisma/migrations/20260715164205_align_khoi_kien_thuc_integer/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const phase3Foundation = readFileSync(
  new URL(
    "../../prisma/migrations/20260715183059_phase_3_auth_rbac_foundation/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const phase3Rls = readFileSync(
  new URL(
    "../../prisma/migrations/20260716030000_phase_3_core_read_rls/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260716040000_phase_4_row_workflow_contract/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("Phase 4 row-workflow migration", () => {
  it("casts event_type to an enum without dropping the column or history", () => {
    expect(migration).toContain(
      "CREATE TYPE \"workflow_event_type\" AS ENUM ('SUBMITTED', 'REJECTED', 'APPROVED')",
    );
    expect(migration).toContain(
      "CREATE TYPE \"workflow_submission_type\" AS ENUM ('CONFIRM_UNCHANGED', 'UPDATE_EXISTING', 'CREATE_NEW')",
    );
    expect(migration).toContain("unsupported values");
    expect(migration).toContain(
      'ALTER COLUMN \"event_type\" TYPE \"workflow_event_type\" USING',
    );
    expect(migration).not.toMatch(/DROP COLUMN\s+"event_type"/iu);
  });

  it("enforces one submitted and at most one terminal event", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "workflow_event_one_submitted_per_submission_key"[\s\S]*?ON "workflow_event"\("submission_id"\)[\s\S]*?WHERE "event_type" = 'SUBMITTED';/u,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "workflow_event_one_terminal_per_submission_key"[\s\S]*?ON "workflow_event"\("submission_id"\)[\s\S]*?WHERE "event_type" IN \('APPROVED', 'REJECTED'\);/u,
    );
  });

  it("does not create a permanently unique submitted record_uid index", () => {
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?ON "workflow_event"\("record_uid"\)[\s\S]*?WHERE "event_type" = 'SUBMITTED'/u,
    );
  });

  it("contains event-shape, base metadata, rejection, approval, and parent checks", () => {
    expect(migration).toContain(
      'CONSTRAINT "workflow_event_event_shape_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "workflow_event_submitted_base_metadata_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "workflow_event_parent_submission_check"',
    );
    expect(migration).toContain("jsonb_typeof(\"payload\") = 'object'");
    expect(migration).toContain("btrim(\"payload_checksum\") <> ''");
    expect(migration).toContain("btrim(\"reason\") <> ''");
    expect(migration).toContain('"result_version_no" >= 1');
    expect(migration).toContain('"base_version_no" >= 1');
    expect(migration).toContain('"parent_submission_id" <> "submission_id"');
  });

  it("adds the global non-null source_submission_id uniqueness guard", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "ueb_core_data_source_submission_id_key"[\s\S]*?ON "ueb_core_data"\("source_submission_id"\)[\s\S]*?WHERE "source_submission_id" IS NOT NULL;/u,
    );
  });

  it("contains the six new query indexes plus the preserved submission index", () => {
    const newIndexNames = [
      "workflow_event_lecturer_uid_created_at_idx",
      "workflow_event_lecturer_uid_record_uid_created_at_idx",
      "workflow_event_approval_unit_created_at_idx",
      "workflow_event_event_type_created_at_idx",
      "workflow_event_record_uid_created_at_idx",
      "workflow_event_parent_submission_id_created_at_idx",
    ] as const;

    for (const indexName of newIndexNames) {
      expect(migration).toContain(`CREATE INDEX "${indexName}"`);
    }
    expect(phase2Initial).toContain(
      'CREATE INDEX "workflow_event_submission_id_created_at_idx"',
    );
  });

  it("preserves append-only triggers and does not add RLS or grants", () => {
    for (const triggerName of [
      "workflow_event_reject_update_delete",
      "workflow_event_reject_truncate",
      "ueb_core_data_reject_update_delete",
      "ueb_core_data_reject_truncate",
    ]) {
      expect(phase2Initial).toContain(`CREATE TRIGGER "${triggerName}"`);
      expect(migration).not.toContain(`DROP TRIGGER "${triggerName}"`);
      expect(migration).not.toContain(`DISABLE TRIGGER "${triggerName}"`);
    }

    expect(migration).not.toMatch(
      /GRANT|REVOKE|ENABLE ROW LEVEL SECURITY|CREATE POLICY|ALTER POLICY/iu,
    );
  });

  it("contains no destructive core mutation or STT sequence change", () => {
    expect(migration).not.toMatch(
      /DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE\s+"?ueb_core_data|TRUNCATE TABLE\s+"?ueb_core_data/iu,
    );
    expect(migration).not.toMatch(
      /ALTER TABLE\s+"ueb_core_data"|ALTER SEQUENCE|setval\s*\(|nextval\s*\(|GENERATED\s+(?:ALWAYS|BY DEFAULT)\s+AS IDENTITY/iu,
    );
  });

  it("leaves every Phase 2 and Phase 3 migration byte-for-byte unchanged", () => {
    expect(sha256(phase2Initial)).toBe(
      "7c2c31f2542e5ccce2ce4d70360959e38f74b5402f82f145453eed1af3d879cd",
    );
    expect(sha256(phase2Alignment)).toBe(
      "d8aa65fa6dc25ace3a387b4334f4761b0c2415dd8a3f515a7ae32c932c75e2db",
    );
    expect(sha256(phase3Foundation)).toBe(
      "4bead8ebef87903729d441c2c8c40bd439eb8ba1ddc8ec865a74bad854d04cf8",
    );
    expect(sha256(phase3Rls)).toBe(
      "47d55f1ae6fe79cd0cc97579b008b9a7707f7a80789cf33177e7976e8842d125",
    );
  });

  it("keeps Phase 4 as a create-only migration artifact", () => {
    expect(migration).not.toContain("_prisma_migrations");
    expect(migration).not.toMatch(/prisma migrate (?:dev|deploy)/u);
  });
});
