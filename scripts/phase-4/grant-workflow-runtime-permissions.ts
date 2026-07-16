import "dotenv/config";

import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";

import { Client, type ClientBase } from "pg";
import { z } from "zod";

const CONFIRMATION_FLAG = "--confirm-runtime-grants";
const EXPECTED_DATABASE_PREFIX = "--expected-database=";
const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/u;
const DATABASE_NAME = /^[a-z][a-z0-9_]*$/u;
type TablePrivilege =
  | "SELECT"
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "TRUNCATE"
  | "REFERENCES"
  | "TRIGGER";

const TARGET_TABLE_PRIVILEGES = {
  ueb_core_data: ["SELECT", "INSERT"],
  workflow_event: ["SELECT", "INSERT"],
} as const satisfies Record<string, readonly TablePrivilege[]>;

const RLS_HELPER_TABLES = [
  "access_profile",
  "role_assignment",
  "organization_unit",
  "unit_scope_assignment",
] as const;

type RlsHelperTable = (typeof RLS_HELPER_TABLES)[number];

const environmentSchema = z.object({
  MIGRATION_DATABASE_URL: z
    .string({ error: "MIGRATION_DATABASE_URL is required." })
    .min(1, "MIGRATION_DATABASE_URL is required.")
    .refine(isPostgresUrl, {
      message: "MIGRATION_DATABASE_URL must be a PostgreSQL URL.",
    }),
  APP_DATABASE_USER: z
    .string({ error: "APP_DATABASE_USER is required." })
    .min(1, "APP_DATABASE_USER is required."),
});

export interface RuntimePermissionEnvironment {
  readonly MIGRATION_DATABASE_URL: string;
  readonly APP_DATABASE_USER: string;
}

export interface RuntimePermissionCommand {
  readonly expectedDatabase: string;
}

export interface RuntimePermissionReport {
  readonly targetDatabase: string;
  readonly runtimeRolePresent: true;
  readonly runtimeNonSuperuser: true;
  readonly runtimeNoBypassRls: true;
  readonly runtimeNonOwner: true;
  readonly core: TablePrivilegeState;
  readonly workflow: TablePrivilegeState;
  readonly rlsHelpers: Readonly<Record<RlsHelperTable, TablePrivilegeState>>;
  readonly sequenceName: string;
  readonly sequenceUsage: true;
  readonly sequenceSelect: false;
  readonly sequenceUpdate: false;
  readonly permissionReconciliation: "PASS";
}

interface TablePrivilegeState {
  readonly select: boolean;
  readonly insert: boolean;
  readonly update: boolean;
  readonly delete: boolean;
  readonly truncate: boolean;
  readonly references: boolean;
  readonly trigger: boolean;
}

interface DatabaseContext {
  readonly migration_user: string;
  readonly database_name: string;
  readonly database_owner: string;
  readonly schema_owner: string;
  readonly core_owner: string;
  readonly workflow_owner: string;
}

interface RuntimeRoleAttributes {
  readonly rolcanlogin: boolean;
  readonly rolsuper: boolean;
  readonly rolbypassrls: boolean;
}

interface SequenceIdentity {
  readonly schema_name: string;
  readonly sequence_name: string;
  readonly qualified_identifier: string;
  readonly sequence_owner: string;
}

interface TablePrivilegeRow {
  readonly table_name: string;
  readonly can_select: boolean;
  readonly can_insert: boolean;
  readonly can_update: boolean;
  readonly can_delete: boolean;
  readonly can_truncate: boolean;
  readonly can_references: boolean;
  readonly can_trigger: boolean;
}

interface SequencePrivilegeRow {
  readonly can_use: boolean;
  readonly can_select: boolean;
  readonly can_update: boolean;
}

export class SafeRuntimePermissionError extends Error {}

export function parseRuntimePermissionEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): RuntimePermissionEnvironment {
  const result = environmentSchema.safeParse({
    MIGRATION_DATABASE_URL: environment.MIGRATION_DATABASE_URL,
    APP_DATABASE_USER: environment.APP_DATABASE_USER,
  });
  if (!result.success) {
    throw new SafeRuntimePermissionError(
      "Runtime permission environment validation failed.",
    );
  }
  assertSafeRoleName(result.data.APP_DATABASE_USER);
  return result.data;
}

export function parseRuntimePermissionCommand(
  arguments_: readonly string[],
): RuntimePermissionCommand {
  const separatorCount = arguments_.filter(
    (argument) => argument === "--",
  ).length;
  if (separatorCount > 1 || (separatorCount === 1 && arguments_[0] !== "--")) {
    throw new SafeRuntimePermissionError(
      "The command argument separator is invalid.",
    );
  }
  const commandArguments =
    arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (!commandArguments.includes(CONFIRMATION_FLAG)) {
    throw new SafeRuntimePermissionError(
      `Explicit confirmation is required: ${CONFIRMATION_FLAG}`,
    );
  }
  const expectedArguments = commandArguments.filter((argument) =>
    argument.startsWith(EXPECTED_DATABASE_PREFIX),
  );
  const unknownArguments = commandArguments.filter(
    (argument) =>
      argument !== CONFIRMATION_FLAG &&
      !argument.startsWith(EXPECTED_DATABASE_PREFIX),
  );
  if (expectedArguments.length !== 1 || unknownArguments.length !== 0) {
    throw new SafeRuntimePermissionError(
      "Exactly one expected database argument is required.",
    );
  }
  const expectedDatabase = expectedArguments[0]!.slice(
    EXPECTED_DATABASE_PREFIX.length,
  );
  if (
    !DATABASE_NAME.test(expectedDatabase) ||
    Buffer.byteLength(expectedDatabase, "utf8") > 63
  ) {
    throw new SafeRuntimePermissionError(
      "The expected database name is invalid.",
    );
  }
  return { expectedDatabase };
}

export async function reconcileWorkflowRuntimePermissions(input: {
  readonly environment: RuntimePermissionEnvironment;
  readonly expectedDatabase: string;
}): Promise<RuntimePermissionReport> {
  assertSafeRoleName(input.environment.APP_DATABASE_USER);
  const urlDatabase = databaseNameFromUrl(
    input.environment.MIGRATION_DATABASE_URL,
  );
  if (urlDatabase !== input.expectedDatabase) {
    throw new SafeRuntimePermissionError(
      "Migration connection does not match the expected database.",
    );
  }

  const client = new Client({
    connectionString: input.environment.MIGRATION_DATABASE_URL,
    application_name: "ueb-core-phase4-runtime-permissions",
  });
  let transactionStarted = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('ueb-core-phase4-runtime-permissions'))",
    );

    const context = await readDatabaseContext(client);
    const sequence = await readIdentitySequence(client);
    await validateTargetAndRole(
      client,
      input.expectedDatabase,
      input.environment.APP_DATABASE_USER,
      context,
      sequence,
    );
    const roleIdentifier = await quoteRoleIdentifier(
      client,
      input.environment.APP_DATABASE_USER,
    );

    await reconcileTablePrivileges(client, roleIdentifier);
    await reconcileSequencePrivileges(
      client,
      roleIdentifier,
      sequence.qualified_identifier,
    );
    const report = await verifyTargetPrivileges(
      client,
      input.expectedDatabase,
      input.environment.APP_DATABASE_USER,
      sequence,
    );

    await client.query("COMMIT");
    transactionStarted = false;
    return report;
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    if (error instanceof SafeRuntimePermissionError) throw error;
    throw new SafeRuntimePermissionError(
      "Runtime permission reconciliation failed safely.",
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
    throw new SafeRuntimePermissionError(
      "Migration URL must include a database name.",
    );
  }
  return databaseName;
}

function assertSafeRoleName(roleName: string): void {
  if (
    !POSTGRES_IDENTIFIER.test(roleName) ||
    Buffer.byteLength(roleName, "utf8") > 63 ||
    roleName.toLowerCase() === "public" ||
    roleName.toLowerCase().startsWith("pg_")
  ) {
    throw new SafeRuntimePermissionError(
      "APP_DATABASE_USER contains an invalid PostgreSQL role name.",
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
      pg_get_userbyid(schema_row.nspowner) AS schema_owner,
      pg_get_userbyid(core.relowner) AS core_owner,
      pg_get_userbyid(workflow.relowner) AS workflow_owner
    FROM pg_database AS database_row
    CROSS JOIN pg_namespace AS schema_row
    CROSS JOIN pg_class AS core
    CROSS JOIN pg_class AS workflow
    WHERE database_row.datname = current_database()
      AND schema_row.nspname = 'public'
      AND core.oid = to_regclass('public.ueb_core_data')
      AND workflow.oid = to_regclass('public.workflow_event')
  `);
  const context = result.rows[0];
  if (!context) {
    throw new SafeRuntimePermissionError(
      "Required Phase 4 database objects are missing.",
    );
  }
  return context;
}

async function readIdentitySequence(
  client: ClientBase,
): Promise<SequenceIdentity> {
  const result = await client.query<SequenceIdentity>(`
    SELECT
      sequence_namespace.nspname AS schema_name,
      sequence_relation.relname AS sequence_name,
      format(
        '%I.%I',
        sequence_namespace.nspname,
        sequence_relation.relname
      ) AS qualified_identifier,
      pg_get_userbyid(sequence_relation.relowner) AS sequence_owner
    FROM pg_class AS table_relation
    INNER JOIN pg_namespace AS table_namespace
      ON table_namespace.oid = table_relation.relnamespace
    INNER JOIN pg_attribute AS table_column
      ON table_column.attrelid = table_relation.oid
     AND table_column.attname = 'stt'
     AND table_column.attnum > 0
     AND NOT table_column.attisdropped
    INNER JOIN pg_depend AS dependency
      ON dependency.refobjid = table_relation.oid
     AND dependency.refobjsubid = table_column.attnum
     AND dependency.classid = 'pg_class'::regclass
     AND dependency.deptype IN ('a', 'i')
    INNER JOIN pg_class AS sequence_relation
      ON sequence_relation.oid = dependency.objid
     AND sequence_relation.relkind = 'S'
    INNER JOIN pg_namespace AS sequence_namespace
      ON sequence_namespace.oid = sequence_relation.relnamespace
    WHERE table_namespace.nspname = 'public'
      AND table_relation.relname = 'ueb_core_data'
  `);
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new SafeRuntimePermissionError(
      "Could not resolve exactly one STT identity sequence from the catalog.",
    );
  }
  return result.rows[0];
}

async function validateTargetAndRole(
  client: ClientBase,
  expectedDatabase: string,
  roleName: string,
  context: DatabaseContext,
  sequence: SequenceIdentity,
): Promise<void> {
  if (context.database_name !== expectedDatabase) {
    throw new SafeRuntimePermissionError(
      "Connected database does not match the expected database.",
    );
  }
  if (
    context.migration_user !== context.database_owner ||
    context.migration_user !== context.core_owner ||
    context.migration_user !== context.workflow_owner ||
    context.migration_user !== sequence.sequence_owner
  ) {
    throw new SafeRuntimePermissionError(
      "MIGRATION_DATABASE_URL must use the database object owner.",
    );
  }
  if (
    roleName === context.migration_user ||
    roleName === context.database_owner ||
    roleName === context.schema_owner ||
    roleName === context.core_owner ||
    roleName === context.workflow_owner ||
    roleName === sequence.sequence_owner
  ) {
    throw new SafeRuntimePermissionError(
      "Runtime role must not own migration or Phase 4 objects.",
    );
  }

  const roleResult = await client.query<RuntimeRoleAttributes>(
    `
      SELECT rolcanlogin, rolsuper, rolbypassrls
      FROM pg_roles
      WHERE rolname = $1
    `,
    [roleName],
  );
  const role = roleResult.rows[0];
  if (!role) {
    throw new SafeRuntimePermissionError("Runtime role does not exist.");
  }
  if (!role.rolcanlogin || role.rolsuper || role.rolbypassrls) {
    throw new SafeRuntimePermissionError(
      "Runtime role attributes violate the Phase 4 permission contract.",
    );
  }
}

async function quoteRoleIdentifier(
  client: ClientBase,
  roleName: string,
): Promise<string> {
  const result = await client.query<{ role_identifier: string }>(
    "SELECT quote_ident($1) AS role_identifier",
    [roleName],
  );
  const identifier = result.rows[0]?.role_identifier;
  if (!identifier) {
    throw new SafeRuntimePermissionError(
      "Could not quote the runtime role identifier.",
    );
  }
  return identifier;
}

async function reconcileTablePrivileges(
  client: ClientBase,
  roleIdentifier: string,
): Promise<void> {
  for (const tableName of Object.keys(TARGET_TABLE_PRIVILEGES)) {
    await client.query(
      `REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."${tableName}" FROM ${roleIdentifier}`,
    );
    await client.query(
      `GRANT SELECT, INSERT ON TABLE "public"."${tableName}" TO ${roleIdentifier}`,
    );
  }
  for (const tableName of RLS_HELPER_TABLES) {
    await client.query(
      `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."${tableName}" FROM ${roleIdentifier}`,
    );
    await client.query(
      `GRANT SELECT ON TABLE "public"."${tableName}" TO ${roleIdentifier}`,
    );
  }
}

async function reconcileSequencePrivileges(
  client: ClientBase,
  roleIdentifier: string,
  sequenceIdentifier: string,
): Promise<void> {
  await client.query(
    `REVOKE SELECT, UPDATE ON SEQUENCE ${sequenceIdentifier} FROM ${roleIdentifier}`,
  );
  await client.query(
    `GRANT USAGE ON SEQUENCE ${sequenceIdentifier} TO ${roleIdentifier}`,
  );
}

async function verifyTargetPrivileges(
  client: ClientBase,
  expectedDatabase: string,
  roleName: string,
  sequence: SequenceIdentity,
): Promise<RuntimePermissionReport> {
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
      ORDER BY table_name
    `,
    [roleName, [...Object.keys(TARGET_TABLE_PRIVILEGES), ...RLS_HELPER_TABLES]],
  );
  const sequencePrivileges = (
    await client.query<SequencePrivilegeRow>(
      `
        SELECT
          has_sequence_privilege($1, $2, 'USAGE') AS can_use,
          has_sequence_privilege($1, $2, 'SELECT') AS can_select,
          has_sequence_privilege($1, $2, 'UPDATE') AS can_update
      `,
      [roleName, `${sequence.schema_name}.${sequence.sequence_name}`],
    )
  ).rows[0];

  const core = tableState(tables.rows, "ueb_core_data");
  const workflow = tableState(tables.rows, "workflow_event");
  const rlsHelpers = Object.fromEntries(
    RLS_HELPER_TABLES.map((tableName) => [
      tableName,
      tableState(tables.rows, tableName),
    ]),
  ) as Record<RlsHelperTable, TablePrivilegeState>;
  if (
    !matchesTarget(core) ||
    !matchesTarget(workflow) ||
    Object.values(rlsHelpers).some((state) => !matchesSelectOnly(state)) ||
    !sequencePrivileges?.can_use ||
    sequencePrivileges.can_select ||
    sequencePrivileges.can_update
  ) {
    throw new SafeRuntimePermissionError(
      "Runtime ACL verification failed; transaction was rolled back.",
    );
  }

  return {
    targetDatabase: expectedDatabase,
    runtimeRolePresent: true,
    runtimeNonSuperuser: true,
    runtimeNoBypassRls: true,
    runtimeNonOwner: true,
    core,
    workflow,
    rlsHelpers,
    sequenceName: `${sequence.schema_name}.${sequence.sequence_name}`,
    sequenceUsage: true,
    sequenceSelect: false,
    sequenceUpdate: false,
    permissionReconciliation: "PASS",
  };
}

function tableState(
  rows: readonly TablePrivilegeRow[],
  tableName: string,
): TablePrivilegeState {
  const row = rows.find((candidate) => candidate.table_name === tableName);
  if (!row) {
    throw new SafeRuntimePermissionError(
      "Required Phase 4 permission table is missing.",
    );
  }
  return {
    select: row.can_select,
    insert: row.can_insert,
    update: row.can_update,
    delete: row.can_delete,
    truncate: row.can_truncate,
    references: row.can_references,
    trigger: row.can_trigger,
  };
}

function matchesSelectOnly(state: TablePrivilegeState): boolean {
  return (
    state.select &&
    !state.insert &&
    !state.update &&
    !state.delete &&
    !state.truncate &&
    !state.references &&
    !state.trigger
  );
}

function matchesTarget(state: TablePrivilegeState): boolean {
  return (
    state.select &&
    state.insert &&
    !state.update &&
    !state.delete &&
    !state.truncate &&
    !state.references &&
    !state.trigger
  );
}

function yesNo(value: boolean): "YES" | "NO" {
  return value ? "YES" : "NO";
}

function printReport(report: RuntimePermissionReport): void {
  const lines = [
    `TARGET_DATABASE=${report.targetDatabase}`,
    `RUNTIME_ROLE_PRESENT=${yesNo(report.runtimeRolePresent)}`,
    `RUNTIME_NON_SUPERUSER=${yesNo(report.runtimeNonSuperuser)}`,
    `RUNTIME_NOBYPASSRLS=${yesNo(report.runtimeNoBypassRls)}`,
    `RUNTIME_NON_OWNER=${yesNo(report.runtimeNonOwner)}`,
    `CORE_SELECT=${yesNo(report.core.select)}`,
    `CORE_INSERT=${yesNo(report.core.insert)}`,
    `CORE_UPDATE=${yesNo(report.core.update)}`,
    `CORE_DELETE=${yesNo(report.core.delete)}`,
    `CORE_TRUNCATE=${yesNo(report.core.truncate)}`,
    `WORKFLOW_SELECT=${yesNo(report.workflow.select)}`,
    `WORKFLOW_INSERT=${yesNo(report.workflow.insert)}`,
    `WORKFLOW_UPDATE=${yesNo(report.workflow.update)}`,
    `WORKFLOW_DELETE=${yesNo(report.workflow.delete)}`,
    `WORKFLOW_TRUNCATE=${yesNo(report.workflow.truncate)}`,
    `RLS_HELPER_TABLES=${RLS_HELPER_TABLES.join(",")}`,
    `RLS_HELPER_SELECT=${yesNo(
      Object.values(report.rlsHelpers).every((state) => state.select),
    )}`,
    `RLS_HELPER_WRITE=${yesNo(
      Object.values(report.rlsHelpers).some(
        (state) =>
          state.insert ||
          state.update ||
          state.delete ||
          state.truncate ||
          state.references ||
          state.trigger,
      ),
    )}`,
    `SEQUENCE_NAME=${report.sequenceName}`,
    `SEQUENCE_USAGE=${yesNo(report.sequenceUsage)}`,
    `SEQUENCE_SELECT=${yesNo(report.sequenceSelect)}`,
    `SEQUENCE_UPDATE=${yesNo(report.sequenceUpdate)}`,
    `PERMISSION_RECONCILIATION=${report.permissionReconciliation}`,
  ];
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  try {
    const command = parseRuntimePermissionCommand(process.argv.slice(2));
    const environment = parseRuntimePermissionEnvironment(process.env);
    const report = await reconcileWorkflowRuntimePermissions({
      environment,
      expectedDatabase: command.expectedDatabase,
    });
    printReport(report);
  } catch (error) {
    console.error(
      `PERMISSION_RECONCILIATION=ERROR\nERROR=${
        error instanceof SafeRuntimePermissionError
          ? error.message
          : "Runtime permission reconciliation failed safely."
      }`,
    );
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
