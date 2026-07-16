import { describe, expect, it } from "vitest";

import {
  assertExactPhase3TestDatabase,
  PHASE3_E2E_DATABASE,
  PHASE3_REHEARSAL_DATABASE,
  readPhase3TestDatabaseUrls,
} from "../../scripts/phase-3/lib/test-database";

const migrationUrl = "postgresql://owner:owner-secret@127.0.0.1:55432/ueb_core";
const runtimeUrl = "postgresql://app:app-secret@127.0.0.1:55432/ueb_core";

describe("Phase 3 isolated database safety", () => {
  it("derives only the two fixed test database names", () => {
    const urls = readPhase3TestDatabaseUrls({
      MIGRATION_DATABASE_URL: migrationUrl,
      DATABASE_URL: runtimeUrl,
    });

    expect(new URL(urls.rehearsalMigrationUrl).pathname).toBe(
      `/${PHASE3_REHEARSAL_DATABASE}`,
    );
    expect(new URL(urls.e2eRuntimeUrl).pathname).toBe(
      `/${PHASE3_E2E_DATABASE}`,
    );
    expect(urls.sourceMigrationUrl).toBe(migrationUrl);
  });

  it("refuses production hosts, role reuse, and test databases as sources", () => {
    expect(() =>
      readPhase3TestDatabaseUrls({
        MIGRATION_DATABASE_URL:
          "postgresql://owner:secret@db.example.edu/ueb_core",
        DATABASE_URL: runtimeUrl,
      }),
    ).toThrow(/local PostgreSQL/u);
    expect(() =>
      readPhase3TestDatabaseUrls({
        MIGRATION_DATABASE_URL: migrationUrl,
        DATABASE_URL: migrationUrl,
      }),
    ).toThrow(/roles must be different/u);
    expect(() =>
      readPhase3TestDatabaseUrls({
        MIGRATION_DATABASE_URL: migrationUrl.replace(
          "/ueb_core",
          `/${PHASE3_REHEARSAL_DATABASE}`,
        ),
        DATABASE_URL: runtimeUrl.replace(
          "/ueb_core",
          `/${PHASE3_REHEARSAL_DATABASE}`,
        ),
      }),
    ).toThrow(/source database must not be a test database/u);
  });

  it("guards every destructive helper by exact target name", () => {
    expect(() =>
      assertExactPhase3TestDatabase(migrationUrl, PHASE3_E2E_DATABASE),
    ).toThrow(/Refusing mutation/u);
    expect(() =>
      assertExactPhase3TestDatabase(
        migrationUrl.replace("/ueb_core", `/${PHASE3_E2E_DATABASE}`),
        PHASE3_E2E_DATABASE,
      ),
    ).not.toThrow();
  });
});
