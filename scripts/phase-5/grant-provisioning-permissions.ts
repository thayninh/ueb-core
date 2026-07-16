import "dotenv/config";

import { pathToFileURL } from "node:url";

import {
  parseProvisioningRoleCommand,
  PHASE5_PROVISIONING_ROLE,
  reconcileProvisioningPermissions,
  SafeProvisioningRoleError,
} from "./lib/provisioning-role";

async function run(): Promise<{
  readonly report: string;
  readonly exitCode: number;
}> {
  try {
    const command = parseProvisioningRoleCommand(
      process.argv.slice(2),
      "--confirm-provisioning-grants",
    );
    if (
      requireEnvironment("PHASE5_PROVISIONING_USER") !==
      PHASE5_PROVISIONING_ROLE
    ) {
      throw new SafeProvisioningRoleError("Provisioning role name is invalid.");
    }
    const report = await reconcileProvisioningPermissions({
      migrationUrl: requireEnvironment("MIGRATION_DATABASE_URL"),
      expectedDatabase: command.expectedDatabase,
      appRuntimeRole: requireEnvironment("APP_DATABASE_USER"),
    });
    return {
      report: [
        `TARGET_DATABASE=${report.databaseName}`,
        `PROVISIONING_ROLE=${report.roleName}`,
        `PROVISIONING_REQUIRED_TABLE_COUNT=${report.requiredTableCount}`,
        `PROVISIONING_EXCESS_PRIVILEGE_COUNT=${report.excessPrivilegeCount}`,
        `APP_RUNTIME_IDENTITY_WRITE_PRIVILEGE_COUNT=${report.appRuntimeWritePrivilegeCount}`,
        "PROVISIONING_ROLE_ACL=PASS",
        "SECRETS_PRINTED=NO",
      ].join("\n"),
      exitCode: 0,
    };
  } catch {
    return {
      report: ["PROVISIONING_ROLE_ACL=FAIL", "SECRETS_PRINTED=NO"].join("\n"),
      exitCode: 2,
    };
  }
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new SafeProvisioningRoleError(`${name} is required.`);
  return value;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  const result = await run();
  if (result.exitCode === 0) console.log(result.report);
  else console.error(result.report);
  process.exitCode = result.exitCode;
}
