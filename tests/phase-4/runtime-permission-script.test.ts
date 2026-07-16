// @vitest-environment node

import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import {
  parseRuntimePermissionCommand,
  parseRuntimePermissionEnvironment,
  reconcileWorkflowRuntimePermissions,
} from "../../scripts/phase-4/grant-workflow-runtime-permissions";

const SCRIPT_PATH = "scripts/phase-4/grant-workflow-runtime-permissions.ts";

let source = "";
let packageJson = "";

describe("Phase 4 runtime permission operational script contract", () => {
  beforeAll(async () => {
    [source, packageJson] = await Promise.all([
      readFile(SCRIPT_PATH, "utf8"),
      readFile("package.json", "utf8"),
    ]);
  });

  it("1. uses the owner connection variable and not the runtime URL", () => {
    expect(source).toContain("MIGRATION_DATABASE_URL");
    expect(source).not.toMatch(/\bDATABASE_URL\b/u);
    expect(source).toContain(
      "connectionString: input.environment.MIGRATION_DATABASE_URL",
    );
  });

  it("2. takes the runtime role from APP_DATABASE_USER", () => {
    const parsed = parseRuntimePermissionEnvironment({
      MIGRATION_DATABASE_URL:
        "postgresql://owner:secret@localhost:55432/ueb_core",
      APP_DATABASE_USER: "ueb_core_app",
    });
    expect(parsed.APP_DATABASE_USER).toBe("ueb_core_app");
  });

  it("3. requires the exact confirmation flag", () => {
    expect(() =>
      parseRuntimePermissionCommand(["--expected-database=ueb_core"]),
    ).toThrow(/confirmation/u);
    expect(
      parseRuntimePermissionCommand([
        "--",
        "--confirm-runtime-grants",
        "--expected-database=ueb_core",
      ]),
    ).toEqual({ expectedDatabase: "ueb_core" });
  });

  it("4. requires exactly one safe expected database", async () => {
    expect(() =>
      parseRuntimePermissionCommand([
        "--confirm-runtime-grants",
        "--expected-database=ueb_core",
        "--expected-database=other",
      ]),
    ).toThrow();
    expect(() =>
      parseRuntimePermissionCommand([
        "--confirm-runtime-grants",
        "--expected-database=ueb-core;drop",
      ]),
    ).toThrow();
    await expect(
      reconcileWorkflowRuntimePermissions({
        environment: parseRuntimePermissionEnvironment({
          MIGRATION_DATABASE_URL:
            "postgresql://owner:secret@localhost:55432/ueb_core",
          APP_DATABASE_USER: "ueb_core_app",
        }),
        expectedDatabase: "different_database",
      }),
    ).rejects.toThrow(/expected database/u);
  });

  it("5. validates and parameter-quotes the role identifier", () => {
    expect(() =>
      parseRuntimePermissionEnvironment({
        MIGRATION_DATABASE_URL:
          "postgresql://owner:secret@localhost:55432/ueb_core",
        APP_DATABASE_USER: 'unsafe";select 1;--',
      }),
    ).toThrow();
    expect(source).toContain("SELECT quote_ident($1) AS role_identifier");
    expect(source).toContain("[roleName]");
  });

  it("6. grants only SELECT and INSERT on core", () => {
    expect(source).toContain('ueb_core_data: ["SELECT", "INSERT"]');
    expect(source).toContain(
      'GRANT SELECT, INSERT ON TABLE "public"."${tableName}"',
    );
  });

  it("7. revokes core UPDATE DELETE and TRUNCATE", () => {
    expect(source).toContain(
      "REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE",
    );
    expect(source).toContain("!state.update");
    expect(source).toContain("!state.delete");
    expect(source).toContain("!state.truncate");
  });

  it("8. grants only SELECT and INSERT on workflow events", () => {
    expect(source).toContain('workflow_event: ["SELECT", "INSERT"]');
    expect(source).not.toMatch(
      /GRANT\s+(?:UPDATE|DELETE|TRUNCATE)[^\n]*workflow_event/iu,
    );
  });

  it("9. verifies workflow mutation privileges remain absent", () => {
    expect(source).toContain("WORKFLOW_UPDATE=");
    expect(source).toContain("WORKFLOW_DELETE=");
    expect(source).toContain("WORKFLOW_TRUNCATE=");
  });

  it("10. grants only sequence USAGE", () => {
    expect(source).toContain("GRANT USAGE ON SEQUENCE");
    expect(source).not.toMatch(/GRANT\s+(?:SELECT|UPDATE)\s+ON SEQUENCE/iu);
  });

  it("11. revokes sequence SELECT and UPDATE", () => {
    expect(source).toContain("REVOKE SELECT, UPDATE ON SEQUENCE");
    expect(source).toContain("sequencePrivileges.can_select");
    expect(source).toContain("sequencePrivileges.can_update");
  });

  it("12. does not grant wildcard schema privileges", () => {
    expect(source).not.toMatch(/GRANT\s+ALL/iu);
    expect(source).not.toMatch(/ON\s+ALL\s+TABLES/iu);
    expect(source).not.toMatch(/ON\s+SCHEMA/iu);
  });

  it("13. never changes ownership", () => {
    expect(source).not.toMatch(
      /ALTER\s+(?:TABLE|SEQUENCE|SCHEMA|DATABASE).*OWNER/iu,
    );
  });

  it("14. never enables BYPASSRLS", () => {
    expect(source).not.toMatch(/ALTER\s+ROLE[^;]*BYPASSRLS/iu);
    expect(source).toContain("rolbypassrls");
  });

  it("15. never creates a role", () => {
    expect(source).not.toMatch(/CREATE\s+ROLE/iu);
  });

  it("16. contains no business data mutation statements", () => {
    expect(source).not.toMatch(/INSERT\s+INTO/iu);
    expect(source).not.toMatch(/DELETE\s+FROM/iu);
    expect(source).not.toMatch(/TRUNCATE\s+TABLE/iu);
    expect(source).not.toMatch(/UPDATE\s+"?public"?\./iu);
  });

  it("17. never consumes the sequence", () => {
    for (const functionName of ["next", "set"].map(
      (prefix) => `${prefix}val`,
    )) {
      expect(source.toLowerCase()).not.toContain(`${functionName}(`);
    }
  });

  it("18. contains no migration creation or application path", () => {
    expect(source).not.toMatch(/prisma\s+migrate/iu);
    expect(source).not.toContain("prisma/migrations");
  });

  it("19. machine output never interpolates URL or password values", () => {
    expect(source).not.toMatch(
      /console\.(?:log|error)[^;]*MIGRATION_DATABASE_URL/isu,
    );
    expect(source).not.toMatch(/console\.(?:log|error)[^;]*password/isu);
    expect(source).toContain("PERMISSION_RECONCILIATION=");
  });

  it("20. is transactional, structurally idempotent, and exposed by package script", () => {
    expect(source).toContain('client.query("BEGIN")');
    expect(source).toContain('client.query("COMMIT")');
    expect(source).toContain('client.query("ROLLBACK")');
    expect(source).toContain("reconcileTablePrivileges");
    expect(source).toContain("reconcileSequencePrivileges");
    expect(packageJson).toContain(
      '"phase4:grant-runtime-permissions": "tsx scripts/phase-4/grant-workflow-runtime-permissions.ts"',
    );
  });
});
