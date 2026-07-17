import { Buffer } from "node:buffer";

import { Client, type ClientBase } from "pg";

export const PHASE5_PROVISIONING_ROLE = "ueb_core_uat_provisioner";
export const PHASE5_PROVISIONING_ROLE_MARKER =
  "ueb-core:phase-5:provisioning-role";

const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const UAT_DATABASE = /^ueb_core_uat(?:_[a-z0-9]+)*$/u;
const DATABASE_IDENTIFIER = /^[a-z][a-z0-9_]*$/u;
const ROLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/u;

export const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;
export type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

export const PROVISIONING_TABLE_PRIVILEGES = {
  ueb_core_data: ["SELECT"],
  auth_user: ["SELECT", "INSERT"],
  auth_account: ["SELECT", "INSERT"],
  access_profile: ["SELECT", "INSERT", "UPDATE"],
  role_assignment: ["SELECT", "INSERT", "UPDATE"],
  organization_unit: ["SELECT"],
  unit_scope_assignment: ["SELECT", "INSERT", "UPDATE"],
  auth_session: ["SELECT", "DELETE"],
  auth_audit_event: ["SELECT", "INSERT"],
} as const satisfies Record<string, readonly TablePrivilege[]>;

export const APP_RUNTIME_MANAGED_IDENTITY_TABLES = [
  "auth_user",
  "auth_account",
  "access_profile",
  "role_assignment",
  "organization_unit",
  "unit_scope_assignment",
] as const;

export interface ProvisioningConnectionEnvironment {
  readonly ownerUrl: string;
  readonly appRuntimeUrl: string;
  readonly provisioningUrl: string;
  readonly ownerUser: string;
  readonly appRuntimeUser: string;
  readonly provisioningUser: typeof PHASE5_PROVISIONING_ROLE;
  readonly databaseName: string;
}

export interface ProvisioningRoleReport {
  readonly databaseName: string;
  readonly roleName: string;
  readonly requiredTableCount: number;
  readonly excessPrivilegeCount: number;
  readonly appRuntimeWritePrivilegeCount: number;
  readonly nonOwner: boolean;
  readonly nonSuperuser: boolean;
  readonly noInherit: boolean;
  readonly noBypassRls: boolean;
  readonly noCreateDatabase: boolean;
  readonly noCreateRole: boolean;
  readonly noCreateSchema: boolean;
  readonly noTemporaryTables: boolean;
  readonly noReplication: boolean;
  readonly noRoleMemberships: boolean;
  readonly ownsNoObjects: boolean;
  readonly coreMutationBlocked: boolean;
  readonly workflowMutationBlocked: boolean;
}

interface RoleAttributes {
  readonly rolcanlogin: boolean;
  readonly rolinherit: boolean;
  readonly rolsuper: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolreplication: boolean;
  readonly rolbypassrls: boolean;
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

export class SafeProvisioningRoleError extends Error {}

export function parseProvisioningRoleCommand(
  arguments_: readonly string[],
  confirmation?: string,
): { readonly expectedDatabase: string } {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  const expected = args
    .filter((argument) => argument.startsWith("--expected-database="))
    .map((argument) => argument.slice("--expected-database=".length));
  const allowed = new Set([
    "--expected-database=",
    ...(confirmation ? [confirmation] : []),
  ]);
  const unknown = args.filter(
    (argument) =>
      ![...allowed].some((candidate) =>
        candidate.endsWith("=")
          ? argument.startsWith(candidate)
          : argument === candidate,
      ),
  );
  if (
    unknown.length > 0 ||
    expected.length !== 1 ||
    (confirmation &&
      args.filter((argument) => argument === confirmation).length !== 1)
  ) {
    throw new SafeProvisioningRoleError("Command arguments are invalid.");
  }
  assertUatDatabase(expected[0]!);
  return { expectedDatabase: expected[0]! };
}

export function parseProvisioningConnectionEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  expectedDatabase: string,
): ProvisioningConnectionEnvironment {
  assertUatDatabase(expectedDatabase);
  if (environment.NODE_ENV === "production") {
    throw new SafeProvisioningRoleError(
      "Production provisioning is not supported.",
    );
  }
  const owner = parseLocalUrl(
    environment.MIGRATION_DATABASE_URL,
    "MIGRATION_DATABASE_URL",
    expectedDatabase,
  );
  const app = parseLocalUrl(
    environment.DATABASE_URL,
    "DATABASE_URL",
    expectedDatabase,
  );
  const provisioning = parseLocalUrl(
    environment.PHASE5_PROVISIONING_DATABASE_URL,
    "PHASE5_PROVISIONING_DATABASE_URL",
    expectedDatabase,
  );
  const ownerUser = decodeURIComponent(owner.username);
  const appRuntimeUser = decodeURIComponent(app.username);
  const provisioningUser = decodeURIComponent(provisioning.username);
  if (
    environment.APP_DATABASE_USER !== appRuntimeUser ||
    environment.PHASE5_PROVISIONING_USER !== PHASE5_PROVISIONING_ROLE ||
    provisioningUser !== PHASE5_PROVISIONING_ROLE ||
    new Set([ownerUser, appRuntimeUser, provisioningUser]).size !== 3
  ) {
    throw new SafeProvisioningRoleError(
      "Provisioning connection roles do not satisfy the separation contract.",
    );
  }
  return {
    ownerUrl: owner.toString(),
    appRuntimeUrl: app.toString(),
    provisioningUrl: provisioning.toString(),
    ownerUser,
    appRuntimeUser,
    provisioningUser: PHASE5_PROVISIONING_ROLE,
    databaseName: expectedDatabase,
  };
}

export async function bootstrapProvisioningRole(input: {
  readonly migrationUrl: string;
  readonly expectedDatabase: string;
  readonly appRuntimeRole: string;
  readonly password: string;
  readonly roleName?: string;
}): Promise<void> {
  const roleName = input.roleName ?? PHASE5_PROVISIONING_ROLE;
  assertRoleName(roleName);
  assertRoleName(input.appRuntimeRole);
  assertStrongPassword(input.password);
  const client = await connectGuardedOwner(
    input.migrationUrl,
    input.expectedDatabase,
    "ueb-core-phase5-provisioning-role-bootstrap",
  );
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      PHASE5_PROVISIONING_ROLE_MARKER,
    ]);
    const owner = await readOwnerUser(client);
    if (roleName === owner || roleName === input.appRuntimeRole) {
      throw new SafeProvisioningRoleError(
        "Provisioning role must differ from owner and application runtime.",
      );
    }
    const existing = await readRoleAttributes(client, roleName);
    if (existing) await assertRestrictedRole(client, roleName, owner);
    const quoted = await quoteRoleAndPassword(client, roleName, input.password);
    if (existing) {
      await client.query(
        `ALTER ROLE ${quoted.role} WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quoted.password}`,
      );
    } else {
      await client.query(
        `CREATE ROLE ${quoted.role} WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quoted.password}`,
      );
    }
    await assertRestrictedRole(client, roleName, owner);
    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted)
      await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof SafeProvisioningRoleError) throw error;
    throw new SafeProvisioningRoleError(
      "Provisioning role bootstrap failed safely.",
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function reconcileProvisioningPermissions(input: {
  readonly migrationUrl: string;
  readonly expectedDatabase: string;
  readonly appRuntimeRole: string;
  readonly roleName?: string;
}): Promise<ProvisioningRoleReport> {
  const roleName = input.roleName ?? PHASE5_PROVISIONING_ROLE;
  assertRoleName(roleName);
  assertRoleName(input.appRuntimeRole);
  const client = await connectGuardedOwner(
    input.migrationUrl,
    input.expectedDatabase,
    "ueb-core-phase5-provisioning-permissions",
  );
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      PHASE5_PROVISIONING_ROLE_MARKER,
    ]);
    const owner = await readOwnerUser(client);
    await assertRestrictedRole(client, roleName, owner);
    await assertRequiredTables(client);
    const quoted = await quoteIdentifiers(
      client,
      roleName,
      input.appRuntimeRole,
    );
    await client.query(
      `REVOKE ALL PRIVILEGES ON DATABASE ${quoted.database} FROM ${quoted.role}`,
    );
    await client.query(
      `REVOKE TEMPORARY ON DATABASE ${quoted.database} FROM PUBLIC`,
    );
    await client.query(
      `REVOKE ALL PRIVILEGES ON SCHEMA "public" FROM ${quoted.role}`,
    );
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM ${quoted.role}`,
    );
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "public" FROM ${quoted.role}`,
    );
    await client.query(
      `GRANT CONNECT ON DATABASE ${quoted.database} TO ${quoted.role}`,
    );
    await client.query(`GRANT USAGE ON SCHEMA "public" TO ${quoted.role}`);
    for (const [table, privileges] of Object.entries(
      PROVISIONING_TABLE_PRIVILEGES,
    )) {
      await client.query(
        `GRANT ${privileges.join(", ")} ON TABLE "public"."${table}" TO ${quoted.role}`,
      );
    }
    for (const table of APP_RUNTIME_MANAGED_IDENTITY_TABLES) {
      await client.query(
        `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."${table}" FROM ${quoted.appRuntime}`,
      );
      await client.query(
        `GRANT SELECT ON TABLE "public"."${table}" TO ${quoted.appRuntime}`,
      );
    }
    const report = await inspectProvisioningRole(
      client,
      roleName,
      input.appRuntimeRole,
      owner,
    );
    assertPassingReport(report);
    await client.query("COMMIT");
    transactionStarted = false;
    return report;
  } catch (error) {
    if (transactionStarted)
      await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof SafeProvisioningRoleError) throw error;
    throw new SafeProvisioningRoleError(
      "Provisioning permission reconciliation failed safely.",
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function verifyProvisioningRole(input: {
  readonly connections: ProvisioningConnectionEnvironment;
}): Promise<ProvisioningRoleReport> {
  const { connections } = input;
  const owner = new Client({
    connectionString: connections.ownerUrl,
    application_name: "ueb-core-phase5-provisioning-role-owner-verify",
  });
  const app = new Client({
    connectionString: connections.appRuntimeUrl,
    application_name: "ueb-core-phase5-provisioning-role-app-verify",
  });
  const provisioner = new Client({
    connectionString: connections.provisioningUrl,
    application_name: "ueb-core-phase5-provisioning-role-self-verify",
  });
  try {
    await Promise.all([owner.connect(), app.connect(), provisioner.connect()]);
    const [ownerUser, appIdentity, provisionerIdentity] = await Promise.all([
      readOwnerUser(owner),
      app.query<{ current_user: string; current_database: string }>(
        "SELECT current_user, current_database()",
      ),
      provisioner.query<{ current_user: string; current_database: string }>(
        "SELECT current_user, current_database()",
      ),
    ]);
    if (
      appIdentity.rows[0]?.current_user !== connections.appRuntimeUser ||
      appIdentity.rows[0]?.current_database !== connections.databaseName ||
      provisionerIdentity.rows[0]?.current_user !==
        connections.provisioningUser ||
      provisionerIdentity.rows[0]?.current_database !== connections.databaseName
    ) {
      throw new SafeProvisioningRoleError(
        "Provisioning connection identity verification failed.",
      );
    }
    const report = await inspectProvisioningRole(
      owner,
      connections.provisioningUser,
      connections.appRuntimeUser,
      ownerUser,
    );
    assertPassingReport(report);
    return report;
  } catch (error) {
    if (error instanceof SafeProvisioningRoleError) throw error;
    throw new SafeProvisioningRoleError(
      "Provisioning role verification failed safely.",
    );
  } finally {
    await Promise.all([
      owner.end().catch(() => undefined),
      app.end().catch(() => undefined),
      provisioner.end().catch(() => undefined),
    ]);
  }
}

async function inspectProvisioningRole(
  client: ClientBase,
  roleName: string,
  appRuntimeRole: string,
  ownerUser: string,
): Promise<ProvisioningRoleReport> {
  const role = await readRoleAttributes(client, roleName);
  if (!role)
    throw new SafeProvisioningRoleError("Provisioning role is absent.");
  const tables = await client.query<TablePrivilegeRow>(
    `SELECT table_name,
       has_table_privilege($1, format('%I.%I', table_schema, table_name), 'SELECT') AS can_select,
       has_table_privilege($1, format('%I.%I', table_schema, table_name), 'INSERT') AS can_insert,
       has_table_privilege($1, format('%I.%I', table_schema, table_name), 'UPDATE') AS can_update,
       has_table_privilege($1, format('%I.%I', table_schema, table_name), 'DELETE') AS can_delete,
       has_table_privilege($1, format('%I.%I', table_schema, table_name), 'TRUNCATE') AS can_truncate,
       has_table_privilege($1, format('%I.%I', table_schema, table_name), 'REFERENCES') AS can_references,
       has_table_privilege($1, format('%I.%I', table_schema, table_name), 'TRIGGER') AS can_trigger
     FROM information_schema.tables
     WHERE table_schema = 'public'`,
    [roleName],
  );
  let excessPrivilegeCount = 0;
  let requiredTableCount = 0;
  for (const table of tables.rows) {
    const expected = new Set<TablePrivilege>(
      PROVISIONING_TABLE_PRIVILEGES[
        table.table_name as keyof typeof PROVISIONING_TABLE_PRIVILEGES
      ] ?? [],
    );
    if (expected.size > 0) requiredTableCount += 1;
    for (const privilege of TABLE_PRIVILEGES) {
      const actual = table[PRIVILEGE_COLUMNS[privilege]];
      if (actual !== expected.has(privilege)) excessPrivilegeCount += 1;
    }
  }
  const appWrites = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM unnest($2::text[]) AS managed(table_name)
     CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) AS operations(privilege)
     WHERE has_table_privilege($1, format('%I.%I', 'public', managed.table_name), operations.privilege)`,
    [appRuntimeRole, [...APP_RUNTIME_MANAGED_IDENTITY_TABLES]],
  );
  const objectState = await client.query<{
    owned_objects: number;
    can_create_database: boolean;
    can_create_schema: boolean;
    can_create_temporary: boolean;
    has_sequence_privilege: boolean;
    has_role_memberships: boolean;
  }>(
    `SELECT
       ((SELECT count(*) FROM pg_class WHERE relowner = role.oid) +
        (SELECT count(*) FROM pg_proc WHERE proowner = role.oid) +
        (SELECT count(*) FROM pg_namespace WHERE nspowner = role.oid) +
        (SELECT count(*) FROM pg_database WHERE datdba = role.oid))::integer AS owned_objects,
       has_database_privilege($1, current_database(), 'CREATE') AS can_create_database,
       EXISTS (
         SELECT 1 FROM pg_namespace namespace
         WHERE namespace.nspname !~ '^pg_' AND namespace.nspname <> 'information_schema'
           AND has_schema_privilege($1, namespace.oid, 'CREATE')
       ) AS can_create_schema,
       has_database_privilege($1, current_database(), 'TEMPORARY') AS can_create_temporary,
       EXISTS (
         SELECT 1 FROM pg_auth_members membership
         WHERE membership.member = role.oid
       ) AS has_role_memberships,
       EXISTS (
         SELECT 1 FROM pg_class sequence
         JOIN pg_namespace namespace ON namespace.oid = sequence.relnamespace
         WHERE sequence.relkind = 'S' AND namespace.nspname = 'public'
           AND (has_sequence_privilege($1, sequence.oid, 'USAGE')
             OR has_sequence_privilege($1, sequence.oid, 'SELECT')
             OR has_sequence_privilege($1, sequence.oid, 'UPDATE'))
       ) AS has_sequence_privilege
     FROM pg_roles role WHERE role.rolname = $1`,
    [roleName],
  );
  const object = objectState.rows[0];
  if (!object || object.has_sequence_privilege) excessPrivilegeCount += 1;
  const byName = new Map(tables.rows.map((table) => [table.table_name, table]));
  const core = byName.get("ueb_core_data");
  const workflow = byName.get("workflow_event");
  const mutationBlocked = (table: TablePrivilegeRow | undefined) =>
    !!table &&
    !table.can_update &&
    !table.can_delete &&
    !table.can_truncate &&
    !table.can_references &&
    !table.can_trigger;
  return {
    databaseName: (
      await client.query<{ current_database: string }>(
        "SELECT current_database()",
      )
    ).rows[0]!.current_database,
    roleName,
    requiredTableCount,
    excessPrivilegeCount,
    appRuntimeWritePrivilegeCount: appWrites.rows[0]?.count ?? -1,
    nonOwner: roleName !== ownerUser,
    nonSuperuser: !role.rolsuper,
    noInherit: !role.rolinherit,
    noBypassRls: !role.rolbypassrls,
    noCreateDatabase: !role.rolcreatedb,
    noCreateRole: !role.rolcreaterole,
    noCreateSchema: !object?.can_create_database && !object?.can_create_schema,
    noTemporaryTables: !object?.can_create_temporary,
    noReplication: !role.rolreplication,
    noRoleMemberships: !object?.has_role_memberships,
    ownsNoObjects: object?.owned_objects === 0,
    coreMutationBlocked: mutationBlocked(core) && !core?.can_insert,
    workflowMutationBlocked:
      mutationBlocked(workflow) &&
      !workflow?.can_insert &&
      !workflow?.can_select,
  };
}

function assertPassingReport(report: ProvisioningRoleReport): void {
  if (
    report.requiredTableCount !==
      Object.keys(PROVISIONING_TABLE_PRIVILEGES).length ||
    report.excessPrivilegeCount !== 0 ||
    report.appRuntimeWritePrivilegeCount !== 0 ||
    !report.nonOwner ||
    !report.nonSuperuser ||
    !report.noInherit ||
    !report.noBypassRls ||
    !report.noCreateDatabase ||
    !report.noCreateRole ||
    !report.noCreateSchema ||
    !report.noTemporaryTables ||
    !report.noReplication ||
    !report.noRoleMemberships ||
    !report.ownsNoObjects ||
    !report.coreMutationBlocked ||
    !report.workflowMutationBlocked
  ) {
    throw new SafeProvisioningRoleError(
      "Provisioning role or ACL does not satisfy the exact policy.",
    );
  }
}

async function assertRequiredTables(client: ClientBase): Promise<void> {
  const names = [
    ...Object.keys(PROVISIONING_TABLE_PRIVILEGES),
    "workflow_event",
  ];
  const result = await client.query<{
    table_name: string;
    relation: string | null;
  }>(
    `SELECT table_name,
       to_regclass(format('%I.%I', 'public', table_name))::text AS relation
     FROM unnest($1::text[]) AS required(table_name)`,
    [names],
  );
  if (result.rows.some((row) => row.relation === null)) {
    throw new SafeProvisioningRoleError(
      "Required provisioning tables do not exist.",
    );
  }
}

async function connectGuardedOwner(
  migrationUrl: string,
  expectedDatabase: string,
  applicationName: string,
): Promise<Client> {
  assertUatDatabase(expectedDatabase);
  const url = parseLocalUrl(
    migrationUrl,
    "MIGRATION_DATABASE_URL",
    expectedDatabase,
  );
  const client = new Client({
    connectionString: url.toString(),
    application_name: applicationName,
  });
  await client.connect();
  const owner = await readOwnerUser(client);
  if (owner !== decodeURIComponent(url.username)) {
    await client.end().catch(() => undefined);
    throw new SafeProvisioningRoleError(
      "MIGRATION_DATABASE_URL must authenticate as the UAT database owner.",
    );
  }
  return client;
}

async function readOwnerUser(client: ClientBase): Promise<string> {
  const result = await client.query<{
    current_user: string;
    database_owner: string;
  }>(
    `SELECT current_user, pg_get_userbyid(datdba) AS database_owner
     FROM pg_database WHERE datname = current_database()`,
  );
  const row = result.rows[0];
  if (!row || row.current_user !== row.database_owner) {
    throw new SafeProvisioningRoleError(
      "Connection is not the current database owner.",
    );
  }
  return row.current_user;
}

async function readRoleAttributes(
  client: ClientBase,
  roleName: string,
): Promise<RoleAttributes | undefined> {
  return (
    await client.query<RoleAttributes>(
      `SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
              rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname = $1`,
      [roleName],
    )
  ).rows[0];
}

async function assertRestrictedRole(
  client: ClientBase,
  roleName: string,
  ownerUser: string,
): Promise<void> {
  const role = await readRoleAttributes(client, roleName);
  const unsafe = await client.query<{ unsafe: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_auth_members
       WHERE member = (SELECT oid FROM pg_roles WHERE rolname = $1)
     ) AS unsafe`,
    [roleName],
  );
  if (
    roleName === ownerUser ||
    !role?.rolcanlogin ||
    role.rolinherit ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolreplication ||
    role.rolbypassrls ||
    unsafe.rows[0]?.unsafe
  ) {
    throw new SafeProvisioningRoleError(
      "Provisioning role attributes are unsafe.",
    );
  }
}

async function quoteIdentifiers(
  client: ClientBase,
  roleName: string,
  appRuntimeRole: string,
): Promise<{ role: string; appRuntime: string; database: string }> {
  const row = (
    await client.query<{
      role: string;
      app_runtime: string;
      database: string;
    }>(
      `SELECT quote_ident($1) AS role, quote_ident($2) AS app_runtime,
              quote_ident(current_database()) AS database`,
      [roleName, appRuntimeRole],
    )
  ).rows[0];
  if (!row) throw new SafeProvisioningRoleError("Identifier quoting failed.");
  return {
    role: row.role,
    appRuntime: row.app_runtime,
    database: row.database,
  };
}

async function quoteRoleAndPassword(
  client: ClientBase,
  roleName: string,
  password: string,
): Promise<{ role: string; password: string }> {
  const row = (
    await client.query<{ role: string; password: string }>(
      "SELECT quote_ident($1) AS role, quote_literal($2) AS password",
      [roleName, password],
    )
  ).rows[0];
  if (!row) throw new SafeProvisioningRoleError("Credential quoting failed.");
  return row;
}

function parseLocalUrl(
  value: string | undefined,
  variable: string,
  expectedDatabase: string,
): URL {
  if (!value) {
    throw new SafeProvisioningRoleError(`${variable} is required.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeProvisioningRoleError(`${variable} is invalid.`);
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.port !== "55432" ||
    decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase ||
    !url.username ||
    !url.password
  ) {
    throw new SafeProvisioningRoleError(
      `${variable} does not match the guarded local UAT target.`,
    );
  }
  return url;
}

function assertUatDatabase(databaseName: string): void {
  if (
    !DATABASE_IDENTIFIER.test(databaseName) ||
    !UAT_DATABASE.test(databaseName) ||
    Buffer.byteLength(databaseName, "utf8") > 63
  ) {
    throw new SafeProvisioningRoleError(
      "Provisioning role operations require a local Phase 5 UAT database.",
    );
  }
}

function assertRoleName(roleName: string): void {
  if (!ROLE_IDENTIFIER.test(roleName)) {
    throw new SafeProvisioningRoleError("PostgreSQL role name is invalid.");
  }
}

function assertStrongPassword(password: string): void {
  if (
    password.length < 32 ||
    password.trim() !== password ||
    password.includes("\0") ||
    password.toLowerCase().includes("replace_with")
  ) {
    throw new SafeProvisioningRoleError(
      "Provisioning role password does not satisfy the secure input contract.",
    );
  }
}
