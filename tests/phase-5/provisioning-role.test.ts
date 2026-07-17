// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APP_RUNTIME_MANAGED_IDENTITY_TABLES,
  parseProvisioningConnectionEnvironment,
  parseProvisioningRoleCommand,
  PHASE5_PROVISIONING_ROLE,
  PROVISIONING_TABLE_PRIVILEGES,
} from "../../scripts/phase-5/lib/provisioning-role";

const targetDatabase = "ueb_core_uat_phase5";
const ownerUrl = `postgresql://uat_owner:owner-secret@127.0.0.1:55432/${targetDatabase}`;
const appUrl = `postgresql://ueb_core_uat_app:app-secret@127.0.0.1:55432/${targetDatabase}`;
const provisionerUrl = `postgresql://${PHASE5_PROVISIONING_ROLE}:provisioner-secret@127.0.0.1:55432/${targetDatabase}`;

function environment(provisioningUrl = provisionerUrl): Record<string, string> {
  return {
    MIGRATION_DATABASE_URL: ownerUrl,
    DATABASE_URL: appUrl,
    PHASE5_PROVISIONING_DATABASE_URL: provisioningUrl,
    APP_DATABASE_USER: "ueb_core_uat_app",
    PHASE5_PROVISIONING_USER: PHASE5_PROVISIONING_ROLE,
  };
}

describe("Phase 5 dedicated provisioning role", () => {
  it("requires the exact local UAT command contract", () => {
    expect(
      parseProvisioningRoleCommand(
        [
          `--expected-database=${targetDatabase}`,
          "--confirm-provisioning-grants",
        ],
        "--confirm-provisioning-grants",
      ),
    ).toEqual({ expectedDatabase: targetDatabase });
    expect(() =>
      parseProvisioningRoleCommand(
        ["--expected-database=ueb_core", "--confirm-provisioning-grants"],
        "--confirm-provisioning-grants",
      ),
    ).toThrow();
  });

  it("rejects owner and shared app URLs as the provisioning connection", () => {
    expect(() =>
      parseProvisioningConnectionEnvironment(
        environment(ownerUrl),
        targetDatabase,
      ),
    ).toThrow();
    expect(() =>
      parseProvisioningConnectionEnvironment(
        environment(appUrl),
        targetDatabase,
      ),
    ).toThrow();
  });

  it("accepts only the exact separated provisioner identity", () => {
    expect(
      parseProvisioningConnectionEnvironment(environment(), targetDatabase),
    ).toMatchObject({
      ownerUser: "uat_owner",
      appRuntimeUser: "ueb_core_uat_app",
      provisioningUser: PHASE5_PROVISIONING_ROLE,
      databaseName: targetDatabase,
    });
  });

  it("defines the minimal service-backed table privilege matrix", () => {
    expect(PROVISIONING_TABLE_PRIVILEGES).toEqual({
      ueb_core_data: ["SELECT"],
      auth_user: ["SELECT", "INSERT"],
      auth_account: ["SELECT", "INSERT"],
      access_profile: ["SELECT", "INSERT", "UPDATE"],
      role_assignment: ["SELECT", "INSERT", "UPDATE"],
      organization_unit: ["SELECT"],
      unit_scope_assignment: ["SELECT", "INSERT", "UPDATE"],
      auth_session: ["SELECT", "DELETE"],
      auth_audit_event: ["SELECT", "INSERT"],
    });
    expect(APP_RUNTIME_MANAGED_IDENTITY_TABLES).toEqual([
      "auth_user",
      "auth_account",
      "access_profile",
      "role_assignment",
      "organization_unit",
      "unit_scope_assignment",
    ]);
  });

  it("uses the dedicated connection in every provisioning operation", () => {
    for (const file of [
      "scripts/phase-5/provision-approved-users.ts",
      "scripts/phase-5/reconcile-provisioning-batch.ts",
      "scripts/phase-5/rollback-provisioning-batch.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).toContain("createProvisioningDatabase");
      expect(source).not.toContain("getPrismaClient");
      expect(source).not.toContain("closeRuntimeDatabaseConnections");
    }
  });
});
