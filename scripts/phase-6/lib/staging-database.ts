import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Client, type ClientBase } from "pg";

import { grantAuthRuntimePermissions } from "../../phase-3/grant-auth-runtime-permissions";
import { reconcileWorkflowRuntimePermissions } from "../../phase-4/grant-workflow-runtime-permissions";
import {
  APP_RUNTIME_MANAGED_IDENTITY_TABLES,
  PROVISIONING_TABLE_PRIVILEGES,
} from "../../phase-5/lib/provisioning-role";
import {
  parseStagingConnection,
  quoteIdentifier,
  readStagingRoleEnvironment,
  SafePhase6StagingError,
  STAGING_DATABASE,
  STAGING_MIGRATION_COUNT,
  STAGING_OWNER_ROLE,
  STAGING_PROVISIONING_ROLE,
  STAGING_RUNTIME_ROLE,
  withDatabaseName,
} from "./staging-contracts";

const execFileAsync = promisify(execFile);
const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;
const RLS_HELPERS = [
  "access_profile",
  "role_assignment",
  "organization_unit",
  "unit_scope_assignment",
] as const;

interface RoleAttributes {
  readonly rolcanlogin: boolean;
  readonly rolinherit: boolean;
  readonly rolsuper: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolreplication: boolean;
  readonly rolbypassrls: boolean;
}

interface TableAclRow {
  readonly table_name: string;
  readonly can_select: boolean;
  readonly can_insert: boolean;
  readonly can_update: boolean;
  readonly can_delete: boolean;
  readonly can_truncate: boolean;
  readonly can_references: boolean;
  readonly can_trigger: boolean;
}

export interface SecurityReport {
  readonly targetDatabase: string;
  readonly databaseOwnerRole: string;
  readonly runtimeRole: string;
  readonly provisioningRole: string;
  readonly roleSeparation: boolean;
  readonly runtimeNonOwner: boolean;
  readonly runtimeNonSuperuser: boolean;
  readonly runtimeNoBypassRls: boolean;
  readonly provisionerNonOwner: boolean;
  readonly provisionerNonSuperuser: boolean;
  readonly provisionerNoBypassRls: boolean;
  readonly rlsDefaultDeny: boolean;
  readonly coreAcl: "PASS" | "FAIL";
  readonly workflowAcl: "PASS" | "FAIL";
  readonly rlsHelperAcl: "PASS" | "FAIL";
  readonly provisionerExcessPrivilegeCount: number;
  readonly securityVerify: "PASS";
}

export interface StagingFingerprint {
  readonly database: string;
  readonly migrationCount: number;
  readonly failedMigrationCount: number;
  readonly coreCount: number;
  readonly workflowCount: number;
  readonly importRunCount: number;
  readonly maxStt: number | null;
  readonly sequenceLastValue: string | null;
  readonly sequenceIsCalled: boolean | null;
  readonly authUserCount: number;
  readonly activeSessionCount: number;
  readonly runtimeFlags: string;
  readonly provisionerFlags: string;
  readonly sha256: string;
}

export async function bootstrapStagingDatabase(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly expectedDatabase: typeof STAGING_DATABASE;
}): Promise<{ readonly migrationCount: number }> {
  const target = parseStagingConnection({
    value: input.environment.MIGRATION_DATABASE_URL,
    expectedDatabase: input.expectedDatabase,
    expectedUser: undefined,
    environment: input.environment,
  });
  const authorizedBootstrapRole =
    input.environment.STAGING_AUTHORIZED_BOOTSTRAP_ROLE;
  if (
    target.user !== STAGING_OWNER_ROLE &&
    (!authorizedBootstrapRole || target.user !== authorizedBootstrapRole)
  ) {
    throw new SafePhase6StagingError(
      "Connection role is not the staging owner or authorized bootstrap role.",
    );
  }
  const maintenance = new Client({
    connectionString: withDatabaseName(target.url, "postgres"),
    application_name: "ueb-core-phase6-staging-bootstrap",
  });
  try {
    await maintenance.connect();
    const current = await readRoleAttributes(maintenance, target.user);
    if (!current || current.rolsuper || !current.rolcreatedb) {
      throw new SafePhase6StagingError(
        "Bootstrap connection must be non-superuser with CREATEDB.",
      );
    }
    const exists = await databaseExists(maintenance, STAGING_DATABASE);
    if (exists) {
      throw new SafePhase6StagingError(
        "Staging target already exists; bootstrap refuses existing databases.",
      );
    }
    if (target.user !== STAGING_OWNER_ROLE) {
      if (!current.rolcreaterole) {
        throw new SafePhase6StagingError(
          "Authorized bootstrap role lacks required CREATEROLE capability.",
        );
      }
      await createRestrictedOwnerRole(
        maintenance,
        input.environment.STAGING_MIGRATION_OWNER_PASSWORD,
      );
    } else {
      await assertOwnerRoleIsRestricted(maintenance, STAGING_OWNER_ROLE);
    }
    await maintenance.query(
      `CREATE DATABASE ${quoteIdentifier(STAGING_DATABASE)} OWNER ${quoteIdentifier(STAGING_OWNER_ROLE)}`,
    );
  } catch (error) {
    if (error instanceof SafePhase6StagingError) throw error;
    throw new SafePhase6StagingError(
      "Staging database bootstrap failed safely; inspect restricted operator logs.",
    );
  } finally {
    await maintenance.end().catch(() => undefined);
  }

  const ownerUrl = replaceConnectionUser(
    target.url,
    STAGING_OWNER_ROLE,
    input.environment.STAGING_MIGRATION_OWNER_PASSWORD,
  );
  await runPrismaMigrateDeploy(ownerUrl);
  const migrationCount = await verifyMigrationState(ownerUrl);
  return { migrationCount };
}

export async function bootstrapStagingRole(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly role: "runtime" | "provisioner";
  readonly allowTest?: boolean;
}): Promise<{ readonly roleName: string }> {
  const context = readStagingRoleEnvironment(input.environment, {
    allowTest: input.allowTest,
  });
  const roleName =
    input.role === "runtime" ? STAGING_RUNTIME_ROLE : STAGING_PROVISIONING_ROLE;
  const password =
    input.role === "runtime"
      ? input.environment.STAGING_RUNTIME_PASSWORD
      : input.environment.STAGING_PROVISIONING_PASSWORD;
  assertStrongPassword(password);
  const authorizedRole = input.environment.STAGING_AUTHORIZED_BOOTSTRAP_ROLE;
  const roleAdmin = parseStagingConnection({
    value: input.environment.STAGING_ROLE_ADMIN_DATABASE_URL,
    expectedDatabase: context.owner.database,
    expectedUser: authorizedRole,
    environment: input.environment,
    allowTest: input.allowTest,
  });
  if (!authorizedRole || roleAdmin.user === STAGING_OWNER_ROLE) {
    throw new SafePhase6StagingError(
      "Role bootstrap requires the distinct authorized bootstrap role.",
    );
  }
  const client = await connectOwner(roleAdmin.url, context.owner.database);
  let transaction = false;
  try {
    await client.query("BEGIN");
    transaction = true;
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('ueb-core-phase6-role-bootstrap'))",
    );
    if ((await readDatabaseOwner(client)) !== STAGING_OWNER_ROLE) {
      throw new SafePhase6StagingError(
        "Role bootstrap target is not owned by the staging owner.",
      );
    }
    const attributes = await readRoleAttributes(client, roleAdmin.user);
    if (!attributes || attributes.rolsuper || !attributes.rolcreaterole) {
      throw new SafePhase6StagingError(
        "Authorized bootstrap role must be non-superuser with CREATEROLE.",
      );
    }
    await ensureRestrictedRole(client, roleName, password!);
    await assertRoleOwnsNoObjects(client, roleName);
    await client.query("COMMIT");
    transaction = false;
    return { roleName };
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof SafePhase6StagingError) throw error;
    throw new SafePhase6StagingError("Staging role bootstrap failed safely.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function grantStagingRuntimePermissions(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly allowTest?: boolean;
}): Promise<void> {
  const context = readStagingRoleEnvironment(input.environment, {
    allowTest: input.allowTest,
  });
  const runtime = parseStagingConnection({
    value: input.environment.DATABASE_URL,
    expectedDatabase: context.owner.database,
    expectedUser: STAGING_RUNTIME_ROLE,
    environment: input.environment,
    allowTest: input.allowTest,
  });
  await grantAuthRuntimePermissions({
    MIGRATION_DATABASE_URL: context.owner.url,
    DATABASE_URL: runtime.url,
  });
  await reconcileWorkflowRuntimePermissions({
    environment: {
      MIGRATION_DATABASE_URL: context.owner.url,
      APP_DATABASE_USER: STAGING_RUNTIME_ROLE,
    },
    expectedDatabase: context.owner.database,
  });
}

export async function grantStagingProvisioningPermissions(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly allowTest?: boolean;
}): Promise<void> {
  const context = readStagingRoleEnvironment(input.environment, {
    allowTest: input.allowTest,
  });
  assertDedicatedProvisioningConnection(
    input.environment,
    context.owner.database,
    {
      allowTest: input.allowTest,
    },
  );
  const client = await connectOwner(context.owner.url, context.owner.database);
  let transaction = false;
  try {
    await client.query("BEGIN");
    transaction = true;
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('ueb-core-phase6-provisioning-acl'))",
    );
    await assertExactDatabaseOwner(client, context.owner.user);
    await assertRestrictedRole(client, STAGING_PROVISIONING_ROLE);
    await assertRequiredProvisioningTables(client);
    const role = quoteIdentifier(STAGING_PROVISIONING_ROLE);
    const runtime = quoteIdentifier(STAGING_RUNTIME_ROLE);
    const database = quoteIdentifier(context.owner.database);
    await client.query(
      `REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${role}`,
    );
    await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${role}`);
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`,
    );
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
    );
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    for (const [table, privileges] of Object.entries(
      PROVISIONING_TABLE_PRIVILEGES,
    )) {
      await client.query(
        `GRANT ${privileges.join(", ")} ON TABLE public.${quoteIdentifier(table)} TO ${role}`,
      );
    }
    for (const table of APP_RUNTIME_MANAGED_IDENTITY_TABLES) {
      await client.query(
        `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.${quoteIdentifier(table)} FROM ${runtime}`,
      );
      await client.query(
        `GRANT SELECT ON TABLE public.${quoteIdentifier(table)} TO ${runtime}`,
      );
    }
    const excess = await countProvisionerExcessPrivileges(client);
    const runtimeIdentityWrites =
      await countRuntimeManagedIdentityWritePrivileges(client);
    if (excess !== 0 || runtimeIdentityWrites !== 0) {
      throw new SafePhase6StagingError(
        "Provisioning ACL contains excess or missing privileges.",
      );
    }
    await client.query("COMMIT");
    transaction = false;
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof SafePhase6StagingError) throw error;
    throw new SafePhase6StagingError(
      "Staging provisioning ACL reconciliation failed safely.",
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function verifyStagingSecurity(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly allowTest?: boolean;
  readonly allowRestore?: boolean;
}): Promise<SecurityReport> {
  const context = readStagingRoleEnvironment(input.environment, {
    allowTest: input.allowTest,
    allowRestore: input.allowRestore,
  });
  const runtime = parseStagingConnection({
    value: input.environment.DATABASE_URL,
    expectedDatabase: context.owner.database,
    expectedUser: STAGING_RUNTIME_ROLE,
    environment: input.environment,
    allowTest: input.allowTest,
    allowRestore: input.allowRestore,
  });
  const provisioner = parseStagingConnection({
    value: input.environment.PHASE6_PROVISIONING_DATABASE_URL,
    expectedDatabase: context.owner.database,
    expectedUser: STAGING_PROVISIONING_ROLE,
    environment: input.environment,
    allowTest: input.allowTest,
    allowRestore: input.allowRestore,
  });
  const ownerClient = await connectOwner(
    context.owner.url,
    context.owner.database,
  );
  const runtimeClient = new Client({
    connectionString: runtime.url,
    application_name: "ueb-core-phase6-runtime-security-verify",
  });
  const provisionerClient = new Client({
    connectionString: provisioner.url,
    application_name: "ueb-core-phase6-provisioner-security-verify",
  });
  try {
    await Promise.all([runtimeClient.connect(), provisionerClient.connect()]);
    await Promise.all([
      ownerClient.query("BEGIN READ ONLY"),
      runtimeClient.query("BEGIN READ ONLY"),
      provisionerClient.query("BEGIN READ ONLY"),
    ]);
    const owner = await readDatabaseOwner(ownerClient);
    const runtimeAttributes = await readRoleAttributes(
      ownerClient,
      STAGING_RUNTIME_ROLE,
    );
    const provisionerAttributes = await readRoleAttributes(
      ownerClient,
      STAGING_PROVISIONING_ROLE,
    );
    if (!runtimeAttributes || !provisionerAttributes) {
      throw new SafePhase6StagingError("Dedicated staging roles are missing.");
    }
    const runtimeAcl = await inspectRuntimeAcl(ownerClient);
    const provisionerExcess =
      await countProvisionerExcessPrivileges(ownerClient);
    const runtimeIdentityWrites =
      await countRuntimeManagedIdentityWritePrivileges(ownerClient);
    const visibility = await runtimeClient.query<{
      core_count: number;
      workflow_count: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM public.ueb_core_data) AS core_count,
         (SELECT count(*)::integer FROM public.workflow_event) AS workflow_count`,
    );
    const row = visibility.rows[0];
    const roleSeparation =
      new Set([owner, STAGING_RUNTIME_ROLE, STAGING_PROVISIONING_ROLE]).size ===
      3;
    const report: SecurityReport = {
      targetDatabase: context.owner.database,
      databaseOwnerRole: owner,
      runtimeRole: STAGING_RUNTIME_ROLE,
      provisioningRole: STAGING_PROVISIONING_ROLE,
      roleSeparation,
      runtimeNonOwner: STAGING_RUNTIME_ROLE !== owner,
      runtimeNonSuperuser: !runtimeAttributes.rolsuper,
      runtimeNoBypassRls: !runtimeAttributes.rolbypassrls,
      provisionerNonOwner: STAGING_PROVISIONING_ROLE !== owner,
      provisionerNonSuperuser: !provisionerAttributes.rolsuper,
      provisionerNoBypassRls: !provisionerAttributes.rolbypassrls,
      rlsDefaultDeny: row?.core_count === 0 && row.workflow_count === 0,
      coreAcl: runtimeAcl.core ? "PASS" : "FAIL",
      workflowAcl: runtimeAcl.workflow ? "PASS" : "FAIL",
      rlsHelperAcl: runtimeAcl.helpers ? "PASS" : "FAIL",
      provisionerExcessPrivilegeCount: provisionerExcess,
      securityVerify: "PASS",
    };
    if (
      !Object.entries(report)
        .filter(([key]) =>
          [
            "roleSeparation",
            "runtimeNonOwner",
            "runtimeNonSuperuser",
            "runtimeNoBypassRls",
            "provisionerNonOwner",
            "provisionerNonSuperuser",
            "provisionerNoBypassRls",
            "rlsDefaultDeny",
          ].includes(key),
        )
        .every(([, value]) => value === true) ||
      report.coreAcl !== "PASS" ||
      report.workflowAcl !== "PASS" ||
      report.rlsHelperAcl !== "PASS" ||
      report.provisionerExcessPrivilegeCount !== 0 ||
      runtimeIdentityWrites !== 0
    ) {
      throw new SafePhase6StagingError(
        "Staging security verification did not satisfy the exact contract.",
      );
    }
    return report;
  } catch (error) {
    if (error instanceof SafePhase6StagingError) throw error;
    throw new SafePhase6StagingError(
      "Staging security verification failed safely.",
    );
  } finally {
    await Promise.all([
      ownerClient.query("ROLLBACK").catch(() => undefined),
      runtimeClient.query("ROLLBACK").catch(() => undefined),
      provisionerClient.query("ROLLBACK").catch(() => undefined),
    ]);
    await Promise.all([
      ownerClient.end().catch(() => undefined),
      runtimeClient.end().catch(() => undefined),
      provisionerClient.end().catch(() => undefined),
    ]);
  }
}

export async function fingerprintStaging(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly allowTest?: boolean;
  readonly databaseUrl?: string;
  readonly expectedDatabase?: string;
}): Promise<StagingFingerprint> {
  const expectedDatabase =
    input.expectedDatabase ??
    input.environment.STAGING_EXPECTED_DATABASE ??
    STAGING_DATABASE;
  const connection = parseStagingConnection({
    value: input.databaseUrl ?? input.environment.MIGRATION_DATABASE_URL,
    expectedDatabase,
    environment: input.environment,
    allowTest: input.allowTest,
    allowRestore: expectedDatabase.startsWith("ueb_core_staging_restore_"),
  });
  const client = new Client({
    connectionString: connection.url,
    application_name: "ueb-core-phase6-staging-fingerprint",
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const counts = await client.query<{
      migration_count: number;
      failed_migration_count: number;
      core_count: number;
      workflow_count: number;
      import_run_count: number;
      max_stt: number | null;
      auth_user_count: number;
      active_session_count: number;
    }>(`SELECT
      (SELECT count(*)::integer FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migration_count,
      (SELECT count(*)::integer FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS failed_migration_count,
      (SELECT count(*)::integer FROM public.ueb_core_data) AS core_count,
      (SELECT count(*)::integer FROM public.workflow_event) AS workflow_count,
      (SELECT count(*)::integer FROM public.import_run) AS import_run_count,
      (SELECT max(stt)::integer FROM public.ueb_core_data) AS max_stt,
      (SELECT count(*)::integer FROM public.auth_user) AS auth_user_count,
      (SELECT count(*)::integer FROM public.auth_session WHERE "expiresAt" > now()) AS active_session_count`);
    const sequence = await client.query<{
      last_value: string;
      is_called: boolean;
    }>("SELECT last_value::text, is_called FROM public.ueb_core_data_stt_seq");
    const roles = await client.query<{
      rolname: string;
      flags: string;
    }>(
      `SELECT rolname,
        concat_ws(':', rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls) AS flags
       FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
      [[STAGING_RUNTIME_ROLE, STAGING_PROVISIONING_ROLE]],
    );
    const row = counts.rows[0];
    if (!row)
      throw new SafePhase6StagingError("Fingerprint metadata is absent.");
    const roleMap = new Map(
      roles.rows.map((role) => [role.rolname, role.flags]),
    );
    const material = {
      database: connection.database,
      migrationCount: row.migration_count,
      failedMigrationCount: row.failed_migration_count,
      coreCount: row.core_count,
      workflowCount: row.workflow_count,
      importRunCount: row.import_run_count,
      maxStt: row.max_stt,
      sequenceLastValue: sequence.rows[0]?.last_value ?? null,
      sequenceIsCalled: sequence.rows[0]?.is_called ?? null,
      authUserCount: row.auth_user_count,
      activeSessionCount: row.active_session_count,
      runtimeFlags: roleMap.get(STAGING_RUNTIME_ROLE) ?? "MISSING",
      provisionerFlags: roleMap.get(STAGING_PROVISIONING_ROLE) ?? "MISSING",
    };
    const sha256 = createHash("sha256")
      .update(JSON.stringify(material))
      .digest("hex");
    return { ...material, sha256 };
  } catch (error) {
    if (error instanceof SafePhase6StagingError) throw error;
    throw new SafePhase6StagingError("Staging fingerprint failed safely.");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

export function formatSecurityReport(report: SecurityReport): string {
  const yesNo = (value: boolean) => (value ? "YES" : "NO");
  return [
    `TARGET_DATABASE=${report.targetDatabase}`,
    `DATABASE_OWNER_ROLE=${report.databaseOwnerRole}`,
    `RUNTIME_ROLE=${report.runtimeRole}`,
    `PROVISIONING_ROLE=${report.provisioningRole}`,
    `ROLE_SEPARATION=${yesNo(report.roleSeparation)}`,
    `RUNTIME_NON_OWNER=${yesNo(report.runtimeNonOwner)}`,
    `RUNTIME_NON_SUPERUSER=${yesNo(report.runtimeNonSuperuser)}`,
    `RUNTIME_NOBYPASSRLS=${yesNo(report.runtimeNoBypassRls)}`,
    `PROVISIONER_NON_OWNER=${yesNo(report.provisionerNonOwner)}`,
    `PROVISIONER_NON_SUPERUSER=${yesNo(report.provisionerNonSuperuser)}`,
    `PROVISIONER_NOBYPASSRLS=${yesNo(report.provisionerNoBypassRls)}`,
    `RLS_DEFAULT_DENY=${yesNo(report.rlsDefaultDeny)}`,
    `CORE_ACL=${report.coreAcl}`,
    `WORKFLOW_ACL=${report.workflowAcl}`,
    `RLS_HELPER_ACL=${report.rlsHelperAcl}`,
    `PROVISIONER_EXCESS_PRIVILEGE_COUNT=${report.provisionerExcessPrivilegeCount}`,
    "DATABASE_WRITES=0",
    `SECURITY_VERIFY=${report.securityVerify}`,
  ].join("\n");
}

async function connectOwner(url: string, database: string): Promise<Client> {
  const client = new Client({
    connectionString: url,
    application_name: "ueb-core-phase6-owner-operation",
  });
  await client.connect();
  const row = (
    await client.query<{ current_database: string }>(
      "SELECT current_database()",
    )
  ).rows[0];
  if (row?.current_database !== database) {
    await client.end().catch(() => undefined);
    throw new SafePhase6StagingError(
      "Connected database identity is incorrect.",
    );
  }
  return client;
}

async function assertExactDatabaseOwner(
  client: ClientBase,
  expectedOwner: string,
): Promise<void> {
  const owner = await readDatabaseOwner(client);
  const current = (
    await client.query<{ current_user: string }>("SELECT current_user")
  ).rows[0]?.current_user;
  if (owner !== expectedOwner || current !== expectedOwner) {
    throw new SafePhase6StagingError(
      "Connection must authenticate as the exact database owner.",
    );
  }
}

async function readDatabaseOwner(client: ClientBase): Promise<string> {
  const row = (
    await client.query<{ owner: string }>(
      `SELECT pg_get_userbyid(datdba) AS owner
       FROM pg_database WHERE datname = current_database()`,
    )
  ).rows[0];
  if (!row) throw new SafePhase6StagingError("Database owner is unavailable.");
  return row.owner;
}

async function readRoleAttributes(
  client: ClientBase,
  role: string,
): Promise<RoleAttributes | undefined> {
  return (
    await client.query<RoleAttributes>(
      `SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
              rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname = $1`,
      [role],
    )
  ).rows[0];
}

async function ensureRestrictedRole(
  client: ClientBase,
  roleName: string,
  password: string,
): Promise<void> {
  const quoted = (
    await client.query<{ role: string; password: string }>(
      "SELECT quote_ident($1) AS role, quote_literal($2) AS password",
      [roleName, password],
    )
  ).rows[0];
  if (!quoted) throw new SafePhase6StagingError("Role quoting failed.");
  const existing = await readRoleAttributes(client, roleName);
  const statement = existing ? "ALTER ROLE" : "CREATE ROLE";
  await client.query(
    `${statement} ${quoted.role} WITH LOGIN PASSWORD ${quoted.password} NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
  await assertRestrictedRole(client, roleName);
}

async function assertRestrictedRole(
  client: ClientBase,
  roleName: string,
): Promise<void> {
  const role = await readRoleAttributes(client, roleName);
  const memberships = (
    await client.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM pg_auth_members
       WHERE member = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
      [roleName],
    )
  ).rows[0]?.count;
  if (
    !role?.rolcanlogin ||
    role.rolinherit ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolreplication ||
    role.rolbypassrls ||
    memberships !== 0
  ) {
    throw new SafePhase6StagingError(
      "Dedicated role attributes do not satisfy the staging policy.",
    );
  }
}

async function assertRoleOwnsNoObjects(
  client: ClientBase,
  roleName: string,
): Promise<void> {
  const row = (
    await client.query<{ count: number }>(
      `SELECT (
        (SELECT count(*) FROM pg_class WHERE relowner = role.oid) +
        (SELECT count(*) FROM pg_proc WHERE proowner = role.oid) +
        (SELECT count(*) FROM pg_namespace WHERE nspowner = role.oid) +
        (SELECT count(*) FROM pg_database WHERE datdba = role.oid)
      )::integer AS count FROM pg_roles role WHERE role.rolname = $1`,
      [roleName],
    )
  ).rows[0];
  if (!row || row.count !== 0) {
    throw new SafePhase6StagingError("Dedicated role owns database objects.");
  }
}

async function createRestrictedOwnerRole(
  client: ClientBase,
  password: string | undefined,
): Promise<void> {
  assertStrongPassword(password);
  const existing = await readRoleAttributes(client, STAGING_OWNER_ROLE);
  if (existing) {
    await assertOwnerRoleIsRestricted(client, STAGING_OWNER_ROLE);
    return;
  }
  const quoted = (
    await client.query<{ role: string; password: string }>(
      "SELECT quote_ident($1) AS role, quote_literal($2) AS password",
      [STAGING_OWNER_ROLE, password],
    )
  ).rows[0];
  if (!quoted) throw new SafePhase6StagingError("Owner role quoting failed.");
  await client.query(
    `CREATE ROLE ${quoted.role} WITH LOGIN PASSWORD ${quoted.password} NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );
}

async function assertOwnerRoleIsRestricted(
  client: ClientBase,
  roleName: string,
): Promise<void> {
  const role = await readRoleAttributes(client, roleName);
  if (
    !role?.rolcanlogin ||
    role.rolsuper ||
    role.rolcreaterole ||
    role.rolreplication ||
    role.rolbypassrls
  ) {
    throw new SafePhase6StagingError("Staging owner role is unsafe.");
  }
}

async function databaseExists(
  client: ClientBase,
  database: string,
): Promise<boolean> {
  return (
    (
      await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
        [database],
      )
    ).rows[0]?.exists ?? false
  );
}

async function runPrismaMigrateDeploy(ownerUrl: string): Promise<void> {
  try {
    await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: ownerUrl,
        DATABASE_URL: ownerUrl,
      },
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    throw new SafePhase6StagingError("Prisma migration deploy failed safely.");
  }
}

async function verifyMigrationState(ownerUrl: string): Promise<number> {
  const client = new Client({
    connectionString: ownerUrl,
    application_name: "ueb-core-phase6-migration-verify",
  });
  try {
    await client.connect();
    const row = (
      await client.query<{ applied: number; failed: number }>(`SELECT
        count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::integer AS applied,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::integer AS failed
        FROM public._prisma_migrations`)
    ).rows[0];
    if (row?.applied !== STAGING_MIGRATION_COUNT || row.failed !== 0) {
      throw new SafePhase6StagingError(
        "Migration verification requires exactly 7 applied and 0 failed migrations.",
      );
    }
    return row.applied;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function replaceConnectionUser(
  databaseUrl: string,
  user: string,
  password: string | undefined,
): string {
  const url = new URL(databaseUrl);
  if (decodeURIComponent(url.username) !== user) {
    assertStrongPassword(password);
    url.username = user;
    url.password = password!;
  }
  url.pathname = `/${STAGING_DATABASE}`;
  return url.toString();
}

function assertStrongPassword(
  password: string | undefined,
): asserts password is string {
  if (
    !password ||
    password.length < 32 ||
    password.trim() !== password ||
    password.includes("\0") ||
    /(?:replace|change[_-]?me|password)/iu.test(password)
  ) {
    throw new SafePhase6StagingError(
      "Dedicated role password does not satisfy the secure input contract.",
    );
  }
}

export function assertDedicatedProvisioningConnection(
  environment: Readonly<Record<string, string | undefined>>,
  expectedDatabase: string,
  options: { readonly allowTest?: boolean },
): void {
  const provisioning = parseStagingConnection({
    value: environment.PHASE6_PROVISIONING_DATABASE_URL,
    expectedDatabase,
    expectedUser: STAGING_PROVISIONING_ROLE,
    environment,
    allowTest: options.allowTest,
  });
  const ownerUser = new URL(environment.MIGRATION_DATABASE_URL!).username;
  const runtimeUser = new URL(environment.DATABASE_URL!).username;
  if (
    provisioning.user === decodeURIComponent(ownerUser) ||
    provisioning.user === decodeURIComponent(runtimeUser)
  ) {
    throw new SafePhase6StagingError(
      "Provisioning apply requires the dedicated provisioning URL.",
    );
  }
}

async function assertRequiredProvisioningTables(
  client: ClientBase,
): Promise<void> {
  const tables = Object.keys(PROVISIONING_TABLE_PRIVILEGES);
  const rows = await client.query<{ relation: string | null }>(
    `SELECT to_regclass(format('%I.%I', 'public', name))::text AS relation
     FROM unnest($1::text[]) AS required(name)`,
    [tables],
  );
  if (
    rows.rows.length !== tables.length ||
    rows.rows.some((row) => !row.relation)
  ) {
    throw new SafePhase6StagingError(
      "Required provisioning tables are missing.",
    );
  }
}

async function countProvisionerExcessPrivileges(
  client: ClientBase,
): Promise<number> {
  const rows = await inspectTablePrivileges(client, STAGING_PROVISIONING_ROLE);
  let differences = 0;
  for (const row of rows) {
    const expected = new Set<string>(
      PROVISIONING_TABLE_PRIVILEGES[
        row.table_name as keyof typeof PROVISIONING_TABLE_PRIVILEGES
      ] ?? [],
    );
    for (const privilege of TABLE_PRIVILEGES) {
      const column = `can_${privilege.toLowerCase()}` as keyof TableAclRow;
      if (Boolean(row[column]) !== expected.has(privilege)) differences += 1;
    }
  }
  const required = Object.keys(PROVISIONING_TABLE_PRIVILEGES);
  if (required.some((table) => !rows.some((row) => row.table_name === table))) {
    differences += 1;
  }
  const sequence = (
    await client.query<{ has_privilege: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_class sequence
         JOIN pg_namespace namespace ON namespace.oid = sequence.relnamespace
         WHERE sequence.relkind = 'S' AND namespace.nspname = 'public'
           AND (has_sequence_privilege($1, sequence.oid, 'USAGE')
             OR has_sequence_privilege($1, sequence.oid, 'SELECT')
             OR has_sequence_privilege($1, sequence.oid, 'UPDATE'))
       ) AS has_privilege`,
      [STAGING_PROVISIONING_ROLE],
    )
  ).rows[0]?.has_privilege;
  return differences + (sequence ? 1 : 0);
}

async function countRuntimeManagedIdentityWritePrivileges(
  client: ClientBase,
): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM unnest($2::text[]) AS managed(table_name)
     WHERE has_table_privilege($1, format('public.%I', table_name), 'INSERT')
        OR has_table_privilege($1, format('public.%I', table_name), 'UPDATE')
        OR has_table_privilege($1, format('public.%I', table_name), 'DELETE')
        OR has_table_privilege($1, format('public.%I', table_name), 'TRUNCATE')
        OR has_table_privilege($1, format('public.%I', table_name), 'REFERENCES')
        OR has_table_privilege($1, format('public.%I', table_name), 'TRIGGER')`,
    [STAGING_RUNTIME_ROLE, [...APP_RUNTIME_MANAGED_IDENTITY_TABLES]],
  );
  return result.rows[0]?.count ?? APP_RUNTIME_MANAGED_IDENTITY_TABLES.length;
}

async function inspectRuntimeAcl(client: ClientBase): Promise<{
  readonly core: boolean;
  readonly workflow: boolean;
  readonly helpers: boolean;
}> {
  const rows = await inspectTablePrivileges(client, STAGING_RUNTIME_ROLE);
  const byName = new Map(rows.map((row) => [row.table_name, row]));
  const readInsertOnly = (row: TableAclRow | undefined) =>
    !!row &&
    row.can_select &&
    row.can_insert &&
    !row.can_update &&
    !row.can_delete &&
    !row.can_truncate &&
    !row.can_references &&
    !row.can_trigger;
  const readOnly = (row: TableAclRow | undefined) =>
    !!row &&
    row.can_select &&
    !row.can_insert &&
    !row.can_update &&
    !row.can_delete &&
    !row.can_truncate &&
    !row.can_references &&
    !row.can_trigger;
  const sequence = (
    await client.query<{
      usage: boolean;
      select: boolean;
      update: boolean;
    }>(
      `SELECT
        has_sequence_privilege($1, 'public.ueb_core_data_stt_seq', 'USAGE') AS usage,
        has_sequence_privilege($1, 'public.ueb_core_data_stt_seq', 'SELECT') AS select,
        has_sequence_privilege($1, 'public.ueb_core_data_stt_seq', 'UPDATE') AS update`,
      [STAGING_RUNTIME_ROLE],
    )
  ).rows[0];
  return {
    core:
      readInsertOnly(byName.get("ueb_core_data")) &&
      !!sequence?.usage &&
      !sequence.select &&
      !sequence.update,
    workflow: readInsertOnly(byName.get("workflow_event")),
    helpers: RLS_HELPERS.every((table) => readOnly(byName.get(table))),
  };
}

async function inspectTablePrivileges(
  client: ClientBase,
  role: string,
): Promise<TableAclRow[]> {
  return (
    await client.query<TableAclRow>(
      `SELECT table_name,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'SELECT') AS can_select,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'INSERT') AS can_insert,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'UPDATE') AS can_update,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'DELETE') AS can_delete,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'TRUNCATE') AS can_truncate,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'REFERENCES') AS can_references,
        has_table_privilege($1, format('%I.%I', table_schema, table_name), 'TRIGGER') AS can_trigger
       FROM information_schema.tables WHERE table_schema = 'public'`,
      [role],
    )
  ).rows;
}
