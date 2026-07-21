// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const PRESENTATION_FILES = [
  "src/app/(protected)/admin/data/page.tsx",
  "src/app/(protected)/admin/audit/page.tsx",
  "src/app/(protected)/admin/users/page.tsx",
  "src/app/(protected)/admin/users/create-user-form.tsx",
] as const;

const EXPECTED_FIELD_NAMES = [
  "email",
  "enabled",
  "eventType",
  "lecturerUid",
  "name",
  "organizationUnitId",
  "outcome",
  "q",
  "requirePasswordChange",
  "role",
  "roles",
  "status",
  "targetUserId",
  "temporaryPassword",
  "unitIds",
] as const;

describe("Phase 8 admin presentation contract", () => {
  it("keeps the exact static field and form inventories", () => {
    const sources = PRESENTATION_FILES.map((file) =>
      readFileSync(resolve(process.cwd(), file), "utf8"),
    );
    const fieldNames = sources.flatMap((source) =>
      [...source.matchAll(/\bname="([^"]+)"/gu)].map((match) => match[1]!),
    );
    const formCount = sources.reduce(
      (count, source) => count + [...source.matchAll(/<form\b/gu)].length,
      0,
    );

    expect(fieldNames).toHaveLength(21);
    expect([...new Set(fieldNames)].sort()).toEqual(EXPECTED_FIELD_NAMES);
    expect(formCount).toBe(8);
  });
});
