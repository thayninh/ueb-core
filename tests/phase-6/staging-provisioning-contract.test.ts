// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APP_RUNTIME_MANAGED_IDENTITY_TABLES,
  PROVISIONING_TABLE_PRIVILEGES,
} from "../../scripts/phase-5/lib/provisioning-role";
import { assertDedicatedProvisioningConnection } from "../../scripts/phase-6/lib/staging-database";
import {
  STAGING_DATABASE,
  STAGING_OWNER_ROLE,
  STAGING_PROVISIONING_ROLE,
  STAGING_RUNTIME_ROLE,
} from "../../scripts/phase-6/lib/staging-contracts";

const database = "ueb_core_staging_test_provision_01";
const ownerUrl = `postgresql://${STAGING_OWNER_ROLE}:owner-test-password@127.0.0.1:55432/${database}`;
const runtimeUrl = `postgresql://${STAGING_RUNTIME_ROLE}:runtime-test-password@127.0.0.1:55432/${database}`;
const provisionerUrl = `postgresql://${STAGING_PROVISIONING_ROLE}:provisioner-test-password@127.0.0.1:55432/${database}`;

function environment(provisioningUrl: string): Record<string, string> {
  return {
    STAGING_EXPECTED_DATABASE: database,
    STAGING_MIGRATION_OWNER_ROLE: STAGING_OWNER_ROLE,
    MIGRATION_DATABASE_URL: ownerUrl,
    APP_DATABASE_USER: STAGING_RUNTIME_ROLE,
    DATABASE_URL: runtimeUrl,
    PHASE6_PROVISIONING_USER: STAGING_PROVISIONING_ROLE,
    PHASE6_PROVISIONING_DATABASE_URL: provisioningUrl,
  };
}

describe("Phase 6 staging ACL contracts", () => {
  it("rejects owner and runtime URLs for provisioning apply", () => {
    expect(() =>
      assertDedicatedProvisioningConnection(environment(ownerUrl), database, {
        allowTest: true,
      }),
    ).toThrow();
    expect(() =>
      assertDedicatedProvisioningConnection(environment(runtimeUrl), database, {
        allowTest: true,
      }),
    ).toThrow();
  });

  it("accepts only the dedicated staging provisioner URL", () => {
    expect(() =>
      assertDedicatedProvisioningConnection(
        environment(provisionerUrl),
        database,
        { allowTest: true },
      ),
    ).not.toThrow();
  });

  it("keeps provisioning privileges at the audited Phase 5 minimum", () => {
    const privileges: Readonly<Record<string, readonly string[]>> =
      PROVISIONING_TABLE_PRIVILEGES;
    expect(PROVISIONING_TABLE_PRIVILEGES.ueb_core_data).toEqual(["SELECT"]);
    expect(privileges.workflow_event).toBeUndefined();
    for (const table of APP_RUNTIME_MANAGED_IDENTITY_TABLES) {
      expect(privileges[table]).toBeDefined();
    }
  });

  it("reuses the audited runtime reconciler and removes excess mutations", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/phase-6/lib/staging-database.ts"),
      "utf8",
    );
    expect(source).toContain("reconcileWorkflowRuntimePermissions");
    expect(source).toContain(
      "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER",
    );
    expect(source).toContain("PROVISIONER_EXCESS_PRIVILEGE_COUNT");
  });

  it("requires read-only no-context visibility for the RLS default-deny proof", () => {
    const source = readFileSync(
      resolve(process.cwd(), "scripts/phase-6/lib/staging-database.ts"),
      "utf8",
    );
    expect(source).toContain('runtimeClient.query("BEGIN READ ONLY")');
    expect(source).toContain(
      "row?.core_count === 0 && row.workflow_count === 0",
    );
    expect(source).toContain("RLS_DEFAULT_DENY=");
  });

  it("does not loosen the Phase 4 and Phase 5 database guards", () => {
    const phase4 = readFileSync(
      resolve(process.cwd(), "scripts/phase-4/lib/test-database.ts"),
      "utf8",
    );
    const phase5 = readFileSync(
      resolve(process.cwd(), "scripts/phase-5/lib/database-guards.ts"),
      "utf8",
    );
    expect(phase4).toContain("PHASE4_REHEARSAL_DATABASE");
    expect(phase5).toContain('UAT_DATABASE_PREFIX = "ueb_core_uat_"');
    expect(phase5).not.toContain(STAGING_DATABASE);
  });
});
