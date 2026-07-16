import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "prisma/migrations/20260716060000_phase_4_approved_row_insert/migration.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const permissions = readFileSync(
  join(process.cwd(), "scripts/phase-3/grant-auth-runtime-permissions.ts"),
  "utf8",
);

describe("Phase 4 approved-row migration contract", () => {
  it("grants only column-scoped core INSERT and sequence USAGE", () => {
    expect(permissions).toMatch(
      /GRANT INSERT \(\$\{APPROVED_CORE_INSERT_COLUMNS/iu,
    );
    expect(permissions).toMatch(/GRANT USAGE ON SEQUENCE/iu);
    expect(permissions).not.toMatch(
      /GRANT (?:UPDATE|DELETE|TRUNCATE).*ueb_core_data/iu,
    );
    expect(permissions).not.toMatch(/GRANT (?:SELECT|UPDATE).*SEQUENCE/iu);
  });

  it("excludes generated STT and server defaults from insert columns", () => {
    const declaration = permissions.match(
      /const APPROVED_CORE_INSERT_COLUMNS = \[([\s\S]*?)\] as const;/u,
    )?.[1];
    expect(declaration).toBeDefined();
    expect(declaration).not.toMatch(/"stt"/u);
    expect(declaration).not.toMatch(/"snapshot_id"/u);
    expect(declaration).not.toMatch(/"approved_at"/u);
    expect(declaration).not.toMatch(/"created_at"/u);
  });

  it("creates one core INSERT policy and no write mutation policy", () => {
    expect(migration.match(/CREATE POLICY/gu)).toHaveLength(1);
    expect(migration).toMatch(
      /CREATE POLICY "ueb_core_data_phase_4_insert_approved"[\s\S]*?FOR INSERT[\s\S]*?WITH CHECK/iu,
    );
    expect(migration).not.toMatch(/FOR (?:UPDATE|DELETE|ALL)/iu);
  });

  it("requires active admin or exact scoped faculty leader", () => {
    expect(migration).toMatch(/"profile"\."status" = 'ACTIVE'/u);
    expect(migration).toMatch(/"role_assignment"\."role" = 'ADMIN'/u);
    expect(migration).toMatch(/"role_assignment"\."role" = 'FACULTY_LEADER'/u);
    expect(migration).toMatch(
      /"organization_unit"\."source_value" = "ueb_core_data"\."approval_unit"/u,
    );
    expect(migration).toMatch(/"unit_scope"\."revoked_at" IS NULL/u);
  });

  it("requires one SUBMITTED event and no terminal event", () => {
    expect(migration).toMatch(
      /AND 1 = \([\s\S]*?count\(\*\)[\s\S]*?'SUBMITTED'/u,
    );
    expect(migration).toMatch(
      /AND NOT EXISTS \([\s\S]*?'APPROVED'[\s\S]*?'REJECTED'/u,
    );
    expect(migration).not.toMatch(/APPROVED event (?:exists|exist|before)/iu);
  });

  it("creates the approved-row validation trigger", () => {
    expect(migration).toMatch(
      /CREATE FUNCTION "public"\."validate_phase4_approved_core_insert"/u,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "ueb_core_data_validate_phase_4_approved_insert"[\s\S]*?BEFORE INSERT/u,
    );
  });

  it("compares exactly the nineteen payload fields and never payload STT", () => {
    const payloadComparison = migration.match(
      /-- Exactly 19 payload fields; generated stt is intentionally absent\.([\s\S]*?)IF "submitted_event"\."submission_type" IN/u,
    )?.[1];
    expect(payloadComparison).toBeDefined();
    expect(
      payloadComparison?.match(/"submitted_event"\."payload" -> '/gu),
    ).toHaveLength(19);
    expect(payloadComparison).not.toMatch(/payload" -> 'stt'/u);
  });

  it("validates application-compatible checksum over the canonical fields", () => {
    expect(migration).toMatch(/phase4_row_submission_canonical_json/u);
    expect(migration).toMatch(/pg_catalog\.sha256/u);
    expect(migration).toMatch(
      /payload_checksum" IS DISTINCT FROM[\s\S]*?phase4_row_submission_checksum/u,
    );
  });

  it("enforces existing-row base and version increment", () => {
    expect(migration).toMatch(
      /ORDER BY "core"\."version_no" DESC, "core"\."stt" DESC/u,
    );
    expect(migration).toMatch(
      /NEW\."version_no" IS DISTINCT FROM "current_core"\."version_no" \+ 1/u,
    );
    expect(migration).toMatch(
      /current_core"\."stt" IS DISTINCT FROM "submitted_event"\."base_stt"/u,
    );
  });

  it("enforces CREATE_NEW base null, record absence and version one", () => {
    expect(migration).toMatch(
      /submission_type" = 'CREATE_NEW'[\s\S]*?base_stt" IS NOT NULL[\s\S]*?version_no" <> 1[\s\S]*?NOT EXISTS|submission_type" = 'CREATE_NEW'[\s\S]*?version_no" <> 1[\s\S]*?EXISTS/iu,
    );
    expect(migration).toMatch(
      /WHERE "core"\."record_uid" = NEW\."record_uid"/u,
    );
  });

  it("does not duplicate source_submission_id uniqueness", () => {
    const createdUniqueIndexes = [
      ...migration.matchAll(/CREATE UNIQUE INDEX[^;]+;/giu),
    ].map(([statement]) => statement);
    expect(createdUniqueIndexes).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/source_submission_id/iu)]),
    );
    const prior = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260716040000_phase_4_row_workflow_contract/migration.sql",
      ),
      "utf8",
    );
    expect(prior).toMatch(/ueb_core_data_source_submission_id_key/iu);
  });

  it("does not mutate legacy rows or destroy core objects", () => {
    expect(migration).not.toMatch(/UPDATE\s+"?(?:public"\.)?"?ueb_core_data/iu);
    expect(migration).not.toMatch(
      /DELETE FROM\s+"?(?:public"\.)?"?ueb_core_data/iu,
    );
    expect(migration).not.toMatch(/DROP (?:TABLE|COLUMN)/iu);
    expect(migration).not.toMatch(/TRUNCATE/iu);
  });

  it("keeps the two earlier Phase 4 migrations separate", () => {
    expect(migrationPath).toContain("20260716060000");
    expect(migration).not.toMatch(/ALTER TABLE "public"\."workflow_event"/u);
  });
});
