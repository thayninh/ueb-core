import "dotenv/config";

import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";

import { Client, type ClientBase } from "pg";
import { z } from "zod";

const RUNTIME_TABLES = [
  "ueb_core_data",
  "import_run",
  "workflow_event",
] as const;
const IDENTITY_SEQUENCE = "ueb_core_data_stt_seq";

const bootstrapEnvironmentSchema = z.object({
  MIGRATION_DATABASE_URL: z
    .string({ error: "MIGRATION_DATABASE_URL is required." })
    .min(1, "MIGRATION_DATABASE_URL is required.")
    .refine(isPostgresUrl, {
      message: "MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.",
    }),
  APP_DATABASE_USER: z
    .string({ error: "APP_DATABASE_USER is required." })
    .min(1, "APP_DATABASE_USER is required.")
    .refine((value) => !value.includes("\0"), {
      message: "APP_DATABASE_USER must not contain a null byte.",
    })
    .refine((value) => Buffer.byteLength(value, "utf8") <= 63, {
      message:
        "APP_DATABASE_USER must fit PostgreSQL's 63-byte identifier limit.",
    })
    .refine(
      (value) =>
        value.toLowerCase() !== "public" &&
        !value.toLowerCase().startsWith("pg_"),
      {
        message: "APP_DATABASE_USER uses a reserved PostgreSQL role name.",
      },
    ),
  APP_DATABASE_PASSWORD: z
    .string({ error: "APP_DATABASE_PASSWORD is required." })
    .min(1, "APP_DATABASE_PASSWORD is required.")
    .refine((value) => !value.includes("\0"), {
      message: "APP_DATABASE_PASSWORD must not contain a null byte.",
    }),
});

export type BootstrapEnvironment = z.infer<typeof bootstrapEnvironmentSchema>;

interface QuotedBootstrapValues {
  role_identifier: string;
  password_literal: string;
  database_identifier: string;
}

interface DatabaseContext {
  migration_user: string;
  database_name: string;
  database_owner: string;
  schema_owner: string;
}

interface RoleAttributes {
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
}

class SafeBootstrapError extends Error {}

export function parseBootstrapEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): BootstrapEnvironment {
  const result = bootstrapEnvironmentSchema.safeParse({
    MIGRATION_DATABASE_URL: environment.MIGRATION_DATABASE_URL,
    APP_DATABASE_USER: environment.APP_DATABASE_USER,
    APP_DATABASE_PASSWORD: environment.APP_DATABASE_PASSWORD,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new SafeBootstrapError(
      `Runtime role environment validation failed: ${issues}`,
    );
  }

  return result.data;
}

export function buildRoleStatement(
  roleExists: boolean,
  roleIdentifier: string,
  passwordLiteral: string,
): string {
  const command = roleExists ? "ALTER ROLE" : "CREATE ROLE";

  return `${command} ${roleIdentifier} WITH LOGIN PASSWORD ${passwordLiteral} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`;
}

export async function bootstrapRuntimeRole(
  environment: BootstrapEnvironment,
): Promise<{ roleName: string }> {
  const client = new Client({
    connectionString: environment.MIGRATION_DATABASE_URL,
    application_name: "ueb-core-runtime-role-bootstrap",
  });
  let transactionStarted = false;

  try {
    await client.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('ueb-core-runtime-role-bootstrap'))",
    );

    await assertDatabaseObjectsExist(client);
    const context = await readDatabaseContext(client);
    await assertRoleSeparation(client, environment.APP_DATABASE_USER, context);

    const quoted = await quoteBootstrapValues(
      client,
      environment.APP_DATABASE_USER,
      environment.APP_DATABASE_PASSWORD,
    );
    const roleExists = await databaseRoleExists(
      client,
      environment.APP_DATABASE_USER,
    );

    if (roleExists) {
      await assertRoleHasNoMemberships(client, environment.APP_DATABASE_USER);
    }

    await client.query(
      buildRoleStatement(
        roleExists,
        quoted.role_identifier,
        quoted.password_literal,
      ),
    );
    await applyLeastPrivileges(
      client,
      quoted.role_identifier,
      quoted.database_identifier,
    );
    await verifyRoleAttributes(client, environment.APP_DATABASE_USER);
    await verifyRuntimePrivileges(client, environment.APP_DATABASE_USER);

    await client.query("COMMIT");
    transactionStarted = false;
    return { roleName: environment.APP_DATABASE_USER };
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    if (error instanceof SafeBootstrapError) throw error;
    throw new SafeBootstrapError(
      "Runtime role bootstrap failed; no credential or connection detail was logged.",
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

async function assertDatabaseObjectsExist(client: ClientBase): Promise<void> {
  const result = await client.query<{
    ueb_core_data: string | null;
    import_run: string | null;
    workflow_event: string | null;
    identity_sequence: string | null;
  }>(`
    SELECT
      to_regclass('public.ueb_core_data')::text AS ueb_core_data,
      to_regclass('public.import_run')::text AS import_run,
      to_regclass('public.workflow_event')::text AS workflow_event,
      to_regclass('public.${IDENTITY_SEQUENCE}')::text AS identity_sequence
  `);
  const objects = result.rows[0];

  if (!objects || Object.values(objects).some((value) => value === null)) {
    throw new SafeBootstrapError(
      "Phase 2 tables and identity sequence must exist before bootstrapping the runtime role.",
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
    throw new SafeBootstrapError(
      "Could not determine database and public schema ownership.",
    );
  }
  return context;
}

async function assertRoleSeparation(
  client: ClientBase,
  roleName: string,
  context: DatabaseContext,
): Promise<void> {
  if (
    roleName === context.migration_user ||
    roleName === context.database_owner ||
    roleName === context.schema_owner
  ) {
    throw new SafeBootstrapError(
      "APP_DATABASE_USER must differ from the migration, database-owner, and schema-owner roles.",
    );
  }

  const ownership = await client.query<{ owns_object: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = $1)
        UNION ALL
        SELECT 1
        FROM pg_proc
        WHERE proowner = (SELECT oid FROM pg_roles WHERE rolname = $1)
      ) AS owns_object
    `,
    [roleName],
  );

  if (ownership.rows[0]?.owns_object) {
    throw new SafeBootstrapError(
      "APP_DATABASE_USER owns database objects and cannot be used as the restricted runtime role.",
    );
  }
}

async function quoteBootstrapValues(
  client: ClientBase,
  roleName: string,
  password: string,
): Promise<QuotedBootstrapValues> {
  const result = await client.query<QuotedBootstrapValues>(
    `
      SELECT
        quote_ident($1) AS role_identifier,
        quote_literal($2) AS password_literal,
        quote_ident(current_database()) AS database_identifier
    `,
    [roleName, password],
  );
  const quoted = result.rows[0];

  if (!quoted) {
    throw new SafeBootstrapError("Could not quote runtime role identifiers.");
  }
  return quoted;
}

async function databaseRoleExists(
  client: ClientBase,
  roleName: string,
): Promise<boolean> {
  const result = await client.query<{ role_exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS role_exists",
    [roleName],
  );
  return result.rows[0]?.role_exists ?? false;
}

async function assertRoleHasNoMemberships(
  client: ClientBase,
  roleName: string,
): Promise<void> {
  const result = await client.query<{ membership_count: number }>(
    `
      SELECT count(*)::integer AS membership_count
      FROM pg_auth_members
      WHERE member = (SELECT oid FROM pg_roles WHERE rolname = $1)
    `,
    [roleName],
  );

  if ((result.rows[0]?.membership_count ?? 0) > 0) {
    throw new SafeBootstrapError(
      "APP_DATABASE_USER has role memberships; remove them explicitly before bootstrap.",
    );
  }
}

async function applyLeastPrivileges(
  client: ClientBase,
  roleIdentifier: string,
  databaseIdentifier: string,
): Promise<void> {
  const tables = RUNTIME_TABLES.map((table) => `"public"."${table}"`).join(
    ", ",
  );
  const sequence = `"public"."${IDENTITY_SEQUENCE}"`;

  // Remove broad defaults first. PUBLIC revokes prevent inherited CREATE/TEMP.
  await client.query(`REVOKE CREATE ON SCHEMA "public" FROM PUBLIC`);
  await client.query(
    `REVOKE TEMPORARY ON DATABASE ${databaseIdentifier} FROM PUBLIC`,
  );
  await client.query(
    `REVOKE ALL PRIVILEGES ON DATABASE ${databaseIdentifier} FROM ${roleIdentifier}`,
  );
  await client.query(
    `REVOKE ALL PRIVILEGES ON SCHEMA "public" FROM ${roleIdentifier}`,
  );
  await client.query(
    `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM ${roleIdentifier}`,
  );
  await client.query(
    `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "public" FROM ${roleIdentifier}`,
  );

  await client.query(
    `GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${roleIdentifier}`,
  );
  await client.query(`GRANT USAGE ON SCHEMA "public" TO ${roleIdentifier}`);
  await client.query(
    `GRANT SELECT, INSERT ON TABLE ${tables} TO ${roleIdentifier}`,
  );
  await client.query(
    `GRANT USAGE, SELECT ON SEQUENCE ${sequence} TO ${roleIdentifier}`,
  );
}

async function verifyRoleAttributes(
  client: ClientBase,
  roleName: string,
): Promise<void> {
  const result = await client.query<RoleAttributes>(
    `
      SELECT
        rolcanlogin,
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
  const role = result.rows[0];

  if (
    !role?.rolcanlogin ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolreplication ||
    role.rolbypassrls
  ) {
    throw new SafeBootstrapError(
      "Runtime role attributes do not satisfy the Phase 2 policy.",
    );
  }
}

async function verifyRuntimePrivileges(
  client: ClientBase,
  roleName: string,
): Promise<void> {
  const databasePrivileges = await client.query<{
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
  );
  const schemaPrivileges = await client.query<{
    can_use: boolean;
    can_create: boolean;
  }>(
    `
      SELECT
        has_schema_privilege($1, 'public', 'USAGE') AS can_use,
        has_schema_privilege($1, 'public', 'CREATE') AS can_create
    `,
    [roleName],
  );
  const tablePrivileges = await client.query<{
    relname: string;
    can_select: boolean;
    can_insert: boolean;
    can_update: boolean;
    can_delete: boolean;
    can_truncate: boolean;
  }>(
    `
      SELECT
        table_name AS relname,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'SELECT') AS can_select,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'INSERT') AS can_insert,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'UPDATE') AS can_update,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'DELETE') AS can_delete,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'TRUNCATE') AS can_truncate
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($2::text[])
    `,
    [roleName, [...RUNTIME_TABLES]],
  );
  const sequencePrivileges = await client.query<{
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
  );

  const database = databasePrivileges.rows[0];
  const schema = schemaPrivileges.rows[0];
  const sequence = sequencePrivileges.rows[0];
  const tablesAreRestricted =
    tablePrivileges.rows.length === RUNTIME_TABLES.length &&
    tablePrivileges.rows.every(
      (table) =>
        table.can_select &&
        table.can_insert &&
        !table.can_update &&
        !table.can_delete &&
        !table.can_truncate,
    );

  if (
    !database?.can_connect ||
    database.can_create ||
    database.can_temporary ||
    !schema?.can_use ||
    schema.can_create ||
    !tablesAreRestricted ||
    !sequence?.can_use ||
    !sequence.can_select ||
    sequence.can_update
  ) {
    throw new SafeBootstrapError(
      "Runtime privileges do not satisfy the Phase 2 least-privilege policy.",
    );
  }
}

async function main(): Promise<void> {
  try {
    const environment = parseBootstrapEnvironment(process.env);
    const result = await bootstrapRuntimeRole(environment);
    console.log(
      JSON.stringify({
        status: "SUCCESS",
        role: result.roleName,
        policy: "SELECT_INSERT_ONLY",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "ERROR",
        message:
          error instanceof SafeBootstrapError
            ? error.message
            : "Runtime role bootstrap failed safely.",
      }),
    );
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
