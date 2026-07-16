import "dotenv/config";

import { pathToFileURL } from "node:url";

import {
  parseProvisioningConnectionEnvironment,
  parseProvisioningRoleCommand,
  verifyProvisioningRole,
} from "./lib/provisioning-role";

async function run(): Promise<{
  readonly report: string;
  readonly exitCode: number;
}> {
  try {
    const command = parseProvisioningRoleCommand(process.argv.slice(2));
    const connections = parseProvisioningConnectionEnvironment(
      process.env,
      command.expectedDatabase,
    );
    const report = await verifyProvisioningRole({ connections });
    return {
      report: [
        `TARGET_DATABASE=${report.databaseName}`,
        `PROVISIONING_ROLE=${report.roleName}`,
        `PROVISIONING_REQUIRED_TABLE_COUNT=${report.requiredTableCount}`,
        `PROVISIONING_EXCESS_PRIVILEGE_COUNT=${report.excessPrivilegeCount}`,
        `APP_RUNTIME_IDENTITY_WRITE_PRIVILEGE_COUNT=${report.appRuntimeWritePrivilegeCount}`,
        `PROVISIONING_NON_OWNER=${report.nonOwner ? "YES" : "NO"}`,
        `PROVISIONING_NON_SUPERUSER=${report.nonSuperuser ? "YES" : "NO"}`,
        `PROVISIONING_NOINHERIT=${report.noInherit ? "YES" : "NO"}`,
        `PROVISIONING_NOBYPASSRLS=${report.noBypassRls ? "YES" : "NO"}`,
        `PROVISIONING_NO_SCHEMA_CREATE=${report.noCreateSchema ? "YES" : "NO"}`,
        `PROVISIONING_NO_TEMP_TABLE=${report.noTemporaryTables ? "YES" : "NO"}`,
        `PROVISIONING_NO_ROLE_MEMBERSHIP=${report.noRoleMemberships ? "YES" : "NO"}`,
        `PROVISIONING_OWNS_NO_OBJECTS=${report.ownsNoObjects ? "YES" : "NO"}`,
        `PROVISIONING_CORE_MUTATION_BLOCKED=${report.coreMutationBlocked ? "YES" : "NO"}`,
        `PROVISIONING_WORKFLOW_MUTATION_BLOCKED=${report.workflowMutationBlocked ? "YES" : "NO"}`,
        "PROVISIONING_ROLE_VERIFY=PASS",
        "DATABASE_WRITES=0",
        "SECRETS_PRINTED=NO",
      ].join("\n"),
      exitCode: 0,
    };
  } catch {
    return {
      report: [
        "PROVISIONING_ROLE_VERIFY=FAIL",
        "DATABASE_WRITES=0",
        "SECRETS_PRINTED=NO",
      ].join("\n"),
      exitCode: 2,
    };
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  const result = await run();
  if (result.exitCode === 0) console.log(result.report);
  else console.error(result.report);
  process.exitCode = result.exitCode;
}
