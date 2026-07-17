import "dotenv/config";

import { pathToFileURL } from "node:url";

import {
  bootstrapProvisioningRole,
  parseProvisioningRoleCommand,
  PHASE5_PROVISIONING_ROLE,
  SafeProvisioningRoleError,
} from "./lib/provisioning-role";

async function run(): Promise<{
  readonly report: string;
  readonly exitCode: number;
}> {
  try {
    const command = parseProvisioningRoleCommand(
      process.argv.slice(2),
      "--confirm-bootstrap-provisioning-role",
    );
    const migrationUrl = requireEnvironment("MIGRATION_DATABASE_URL");
    const appRuntimeRole = requireEnvironment("APP_DATABASE_USER");
    const password = requireEnvironment("PHASE5_PROVISIONING_PASSWORD");
    if (
      requireEnvironment("PHASE5_PROVISIONING_USER") !==
      PHASE5_PROVISIONING_ROLE
    ) {
      throw new SafeProvisioningRoleError("Provisioning role name is invalid.");
    }
    await bootstrapProvisioningRole({
      migrationUrl,
      expectedDatabase: command.expectedDatabase,
      appRuntimeRole,
      password,
    });
    return {
      report: [
        `TARGET_DATABASE=${command.expectedDatabase}`,
        `PROVISIONING_ROLE=${PHASE5_PROVISIONING_ROLE}`,
        "PROVISIONING_ROLE_BOOTSTRAP=PASS",
        "SECRETS_PRINTED=NO",
      ].join("\n"),
      exitCode: 0,
    };
  } catch {
    return {
      report: ["PROVISIONING_ROLE_BOOTSTRAP=FAIL", "SECRETS_PRINTED=NO"].join(
        "\n",
      ),
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
