import "dotenv/config";

import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";

import { Client, type ClientBase } from "pg";
import { z } from "zod";

const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

const EXPECTED_TABLE_PRIVILEGES = {
  ueb_core_data: ["SELECT"],
  import_run: ["SELECT"],
  workflow_event: ["SELECT", "INSERT"],
  auth_user: ["SELECT", "INSERT", "UPDATE"],
  auth_session: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  auth_account: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  auth_verification: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  access_profile: ["SELECT", "INSERT", "UPDATE"],
  role_assignment: ["SELECT", "INSERT", "UPDATE"],
  organization_unit: ["SELECT", "INSERT", "UPDATE"],
  unit_scope_assignment: ["SELECT", "INSERT", "UPDATE"],
  auth_audit_event: ["SELECT", "INSERT"],
} as const satisfies Record<string, readonly TablePrivilege[]>;

const RUNTIME_TABLES = Object.keys(EXPECTED_TABLE_PRIVILEGES);
const IDENTITY_SEQUENCE = "ueb_core_data_stt_seq";

const permissionEnvironmentSchema = z.object({
  MIGRATION_DATABASE_URL: z
    .string({ error: "MIGRATION_DATABASE_URL is required." })
    .min(1, "MIGRATION_DATABASE_URL is required.")
    .refine(isPostgresUrl, {
      message: "MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.",
    }),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required." })
    .min(1, "DATABASE_URL is required.")
    .refine(isPostgresUrl, {
      message: "DATABASE_URL must be a valid PostgreSQL URL.",
    }),
});

export type AuthPermissionEnvironment = z.infer<
  typeof permissionEnvironmentSchema
>;

type DatabaseContext = {
  migration_user: string;
  database_name: string;
  database_owner: string;
  schema_owner: string;
};

type RoleAttributes = {
  rolcanlogin: boolean;
  rolinherit: boolean;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
};

type TablePrivilegeRow = {
  table_name: string;
  can_select: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_truncate: boolean;
  can_references: boolean;
  can_trigger: boolean;
};

const PRIVILEGE_COLUMNS = {
  SELECT: "can_select",
  INSERT: "can_insert",
  UPDATE: "can_update",
  DELETE: "can_delete",
  TRUNCATE: "can_truncate",
  REFERENCES: "can_references",
  TRIGGER: "can_trigger",
} as const satisfies Record<
  TablePrivilege,
  Exclude<keyof TablePrivilegeRow, "table_name">
>;

class SafePermissionError extends Error {}

export function parseAuthPermissionEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): AuthPermissionEnvironment {
  const result = permissionEnvironmentSchema.safeParse({
    MIGRATION_DATABASE_URL: environment.MIGRATION_DATABASE_URL,
    DATABASE_URL: environment.DATABASE_URL,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new SafePermissionError(
      `Authentication permission environment validation failed: ${issues}`,
    );
  }

  const migrationDatabase = databaseNameFromUrl(
    result.data.MIGRATION_DATABASE_URL,
  );
  const runtimeDatabase = databaseNameFromUrl(result.data.DATABASE_URL);
  if (migrationDatabase !== runtimeDatabase) {
    throw new SafePermissionError(
      "MIGRATION_DATABASE_URL and DATABASE_URL must target the same database.",
    );
  }

  runtimeRoleFromUrl(result.data.DATABASE_URL);
  return result.data;
}

export async function grantAuthRuntimePermissions(
  environment: AuthPermissionEnvironment,
): Promise<{ roleName: string; tableCount: number }> {
  const roleName = runtimeRoleFromUrl(environment.DATABASE_URL);
  const expectedDatabase = databaseNameFromUrl(environment.DATABASE_URL);
  const client = new Client({
    connectionString: environment.MIGRATION_DATABASE_URL,
    application_name: "ueb-core-auth-runtime-permissions",
  });
  let transactionStarted = false;

  try {
    await client.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('ueb-core-auth-runtime-permissions'))",
    );

    await assertRequiredObjectsExist(client);
    const context = await readDatabaseContext(client);
    await assertRuntimeRoleIsRestricted(
      client,
      roleName,
      expectedDatabase,
      context,
    );
    const quoted = await quoteIdentifiers(client, roleName);

    await revokeExistingPrivileges(
      client,
      quoted.roleIdentifier,
      quoted.databaseIdentifier,
    );
    await grantExpectedPrivileges(
      client,
      quoted.roleIdentifier,
      quoted.databaseIdentifier,
    );
    await verifyPrivileges(client, roleName);

    await client.query("COMMIT");
    transactionStarted = false;
    return { roleName, tableCount: RUNTIME_TABLES.length };
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    if (error instanceof SafePermissionError) throw error;
    throw new SafePermissionError(
      "Authentication permission grant failed safely; no credential or connection detail was logged.",
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

function databaseNameFromUrl(value: string): string {
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!databaseName) {
    throw new SafePermissionError("Database URL must include a database name.");
  }
  return databaseName;
}

function runtimeRoleFromUrl(value: string): string {
  const roleName = decodeURIComponent(new URL(value).username);
  if (!roleName) {
    throw new SafePermissionError("DATABASE_URL must include a runtime role.");
  }
  if (roleName.includes("\0") || Buffer.byteLength(roleName, "utf8") > 63) {
    throw new SafePermissionError(
      "DATABASE_URL contains an invalid runtime role.",
    );
  }
  if (
    roleName.toLowerCase() === "public" ||
    roleName.toLowerCase().startsWith("pg_")
  ) {
    throw new SafePermissionError(
      "DATABASE_URL contains a reserved PostgreSQL role name.",
    );
  }
  return roleName;
}

async function assertRequiredObjectsExist(client: ClientBase): Promise<void> {
  const result = await client.query<{
    object_name: string;
    relation: string | null;
  }>(
    `
      SELECT object_name, to_regclass(format('%I.%I', 'public', object_name))::text AS relation
      FROM unnest($1::text[]) AS objects(object_name)
    `,
    [[...RUNTIME_TABLES, IDENTITY_SEQUENCE]],
  );
  if (
    result.rows.length !== RUNTIME_TABLES.length + 1 ||
    result.rows.some((row) => row.relation === null)
  ) {
    throw new SafePermissionError(
      "Phase 2 and Phase 3 database objects must exist before granting authentication permissions.",
    );
  }
}

async function readDatabaseContext(
  client: ClientBase,
): Promise<DatabaseContext> {
  const result = await client.query<DatabaseContext>(`
    SELECT
      current_user AS migration_user,
      current_database() AS database_name,
      pg_get_userbyid(database_row.datdba) AS database_owner,
      pg_get_userbyid(schema_row.nspowner) AS schema_owner
    FROM pg_database AS database_row
    CROSS JOIN pg_namespace AS schema_row
    WHERE database_row.datname = current_database()
      AND schema_row.nspname = 'public'
  `);
  const context = result.rows[0];
  if (!context) {
    throw new SafePermissionError(
      "Could not determine database and public schema ownership.",
    );
  }
  return context;
}

async function assertRuntimeRoleIsRestricted(
  client: ClientBase,
  roleName: string,
  expectedDatabase: string,
  context: DatabaseContext,
): Promise<void> {
  if (context.database_name !== expectedDatabase) {
    throw new SafePermissionError(
      "Migration connection does not match the runtime database.",
    );
  }
  if (
    roleName === context.migration_user ||
    roleName === context.database_owner ||
    roleName === context.schema_owner
  ) {
    throw new SafePermissionError(
      "Runtime role must differ from migration and owner roles.",
    );
  }

  const roleResult = await client.query<RoleAttributes>(
    `
      SELECT
        rolcanlogin,
        rolinherit,
        rolsuper,
        rolcreatedb,
        rolcreaterole,
        rolreplication,
        rolbypassrls
      FROM pg_roles
      WHERE rolname = $1
    `,
    [roleName],
  );
  const role = roleResult.rows[0];
  if (
    !role?.rolcanlogin ||
    role.rolinherit ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolreplication ||
    role.rolbypassrls
  ) {
    throw new SafePermissionError(
      "Runtime role attributes do not satisfy the least-privilege policy.",
    );
  }

  const unsafeRelationship = await client.query<{ unsafe: boolean }>(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_auth_members
          WHERE member = (SELECT oid FROM pg_roles WHERE rolname = $1)
        ) OR EXISTS (
          SELECT 1
          FROM pg_class
          WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = $1)
        ) OR EXISTS (
          SELECT 1
          FROM pg_proc
          WHERE proowner = (SELECT oid FROM pg_roles WHERE rolname = $1)
        ) AS unsafe
    `,
    [roleName],
  );
  if (unsafeRelationship.rows[0]?.unsafe) {
    throw new SafePermissionError(
      "Runtime role must not inherit roles or own database objects.",
    );
  }
}

async function quoteIdentifiers(
  client: ClientBase,
  roleName: string,
): Promise<{ roleIdentifier: string; databaseIdentifier: string }> {
  const result = await client.query<{
    role_identifier: string;
    database_identifier: string;
  }>(
    `
      SELECT
        quote_ident($1) AS role_identifier,
        quote_ident(current_database()) AS database_identifier
    `,
    [roleName],
  );
  const row = result.rows[0];
  if (!row)
    throw new SafePermissionError("Could not quote database identifiers.");
  return {
    roleIdentifier: row.role_identifier,
    databaseIdentifier: row.database_identifier,
  };
}

async function revokeExistingPrivileges(
  client: ClientBase,
  roleIdentifier: string,
  databaseIdentifier: string,
): Promise<void> {
  await client.query('REVOKE CREATE ON SCHEMA "public" FROM PUBLIC');
  await client.query(
    `REVOKE TEMPORARY ON DATABASE ${databaseIdentifier} FROM PUBLIC`,
  );
  await client.query(
    `REVOKE ALL PRIVILEGES ON DATABASE ${databaseIdentifier} FROM ${roleIdentifier}`,
  );
  await client.query(
    `REVOKE ALL PRIVILEGES ON SCHEMA "public" FROM ${roleIdentifier}`,
  );
  for (const table of RUNTIME_TABLES) {
    await client.query(
      `REVOKE ALL PRIVILEGES ON TABLE "public"."${table}" FROM ${roleIdentifier}`,
    );
  }
  await client.query(
    `REVOKE ALL PRIVILEGES ON SEQUENCE "public"."${IDENTITY_SEQUENCE}" FROM ${roleIdentifier}`,
  );
}

async function grantExpectedPrivileges(
  client: ClientBase,
  roleIdentifier: string,
  databaseIdentifier: string,
): Promise<void> {
  await client.query(
    `GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${roleIdentifier}`,
  );
  await client.query(`GRANT USAGE ON SCHEMA "public" TO ${roleIdentifier}`);
  for (const [table, privileges] of Object.entries(EXPECTED_TABLE_PRIVILEGES)) {
    await client.query(
      `GRANT ${privileges.join(", ")} ON TABLE "public"."${table}" TO ${roleIdentifier}`,
    );
  }
}

async function verifyPrivileges(
  client: ClientBase,
  roleName: string,
): Promise<void> {
  const database = (
    await client.query<{
      can_connect: boolean;
      can_create: boolean;
      can_temporary: boolean;
    }>(
      `
        SELECT
          has_database_privilege($1, current_database(), 'CONNECT') AS can_connect,
          has_database_privilege($1, current_database(), 'CREATE') AS can_create,
          has_database_privilege($1, current_database(), 'TEMPORARY') AS can_temporary
      `,
      [roleName],
    )
  ).rows[0];
  const schema = (
    await client.query<{ can_use: boolean; can_create: boolean }>(
      `
        SELECT
          has_schema_privilege($1, 'public', 'USAGE') AS can_use,
          has_schema_privilege($1, 'public', 'CREATE') AS can_create
      `,
      [roleName],
    )
  ).rows[0];
  const tables = await client.query<TablePrivilegeRow>(
    `
      SELECT
        table_name,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'SELECT') AS can_select,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'INSERT') AS can_insert,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'UPDATE') AS can_update,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'DELETE') AS can_delete,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'TRUNCATE') AS can_truncate,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'REFERENCES') AS can_references,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'TRIGGER') AS can_trigger
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($2::text[])
    `,
    [roleName, RUNTIME_TABLES],
  );
  const sequence = (
    await client.query<{
      can_use: boolean;
      can_select: boolean;
      can_update: boolean;
    }>(
      `
        SELECT
          has_sequence_privilege($1, 'public.${IDENTITY_SEQUENCE}', 'USAGE') AS can_use,
          has_sequence_privilege($1, 'public.${IDENTITY_SEQUENCE}', 'SELECT') AS can_select,
          has_sequence_privilege($1, 'public.${IDENTITY_SEQUENCE}', 'UPDATE') AS can_update
      `,
      [roleName],
    )
  ).rows[0];

  const tablePermissionsMatch =
    tables.rows.length === RUNTIME_TABLES.length &&
    tables.rows.every((table) => {
      const expected = new Set<TablePrivilege>(
        EXPECTED_TABLE_PRIVILEGES[
          table.table_name as keyof typeof EXPECTED_TABLE_PRIVILEGES
        ],
      );
      return TABLE_PRIVILEGES.every(
        (privilege) =>
          table[PRIVILEGE_COLUMNS[privilege]] === expected.has(privilege),
      );
    });

  if (
    !database?.can_connect ||
    database.can_create ||
    database.can_temporary ||
    !schema?.can_use ||
    schema.can_create ||
    !tablePermissionsMatch ||
    sequence?.can_use ||
    sequence?.can_select ||
    sequence?.can_update
  ) {
    throw new SafePermissionError(
      "Runtime privileges do not satisfy the Phase 3 authentication policy.",
    );
  }
}

async function main(): Promise<void> {
  try {
    const environment = parseAuthPermissionEnvironment(process.env);
    const result = await grantAuthRuntimePermissions(environment);
    console.log(
      JSON.stringify({
        status: "SUCCESS",
        role: result.roleName,
        tableCount: result.tableCount,
        policy: "PHASE_3_AUTH_LEAST_PRIVILEGE",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "ERROR",
        message:
          error instanceof SafePermissionError
            ? error.message
            : "Authentication permission grant failed safely.",
      }),
    );
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
