import "dotenv/config";

import { pathToFileURL } from "node:url";

import { provisionUser } from "../../src/lib/auth/provision-user-core";
import { parseBootstrapAdminEnvironment } from "../../src/lib/auth/provisioning-policy";
import { closeRuntimeDatabaseConnections } from "./lib/runtime-database";

const CONFIRMATION_ARGUMENT = "--confirm-local-bootstrap";

async function main(): Promise<void> {
  let databaseOpened = false;
  try {
    if (!process.argv.slice(2).includes(CONFIRMATION_ARGUMENT)) {
      throw new Error("Local bootstrap confirmation is required.");
    }
    const environment = parseBootstrapAdminEnvironment(process.env);
    databaseOpened = true;

    const result = await provisionUser(
      {
        email: environment.email,
        temporaryPassword: environment.password,
        name: environment.name,
        roles: ["ADMIN"],
      },
      {
        auditHmacSecret: environment.auditHmacSecret,
        bootstrapInitialAdmin: true,
      },
    );
    console.log(
      JSON.stringify({
        status: "SUCCESS",
        provisioningStatus: result.status,
        roles: result.roles,
        lecturerMapped: result.lecturerMapped,
        unitScopeCount: result.unitScopeCount,
        securityReminder:
          "Remove BOOTSTRAP_ADMIN_PASSWORD from shell history if it was exported manually.",
      }),
    );
  } catch {
    console.error(
      JSON.stringify({
        status: "ERROR",
        message:
          "Admin bootstrap failed safely; verify confirmation and local environment values.",
      }),
    );
    process.exitCode = 1;
  } finally {
    if (databaseOpened) await closeRuntimeDatabaseConnections();
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
