import type { ClientBase } from "pg";

import {
  quoteIdentifier,
  SafePhase6StagingError,
  STAGING_PROVISIONING_ROLE,
  STAGING_RUNTIME_ROLE,
} from "./staging-contracts";

interface RoleAttributes {
  readonly rolcanlogin: boolean;
  readonly rolinherit: boolean;
  readonly rolsuper: boolean;
  readonly rolcreatedb: boolean;
  readonly rolcreaterole: boolean;
  readonly rolreplication: boolean;
  readonly rolbypassrls: boolean;
}

export interface TemporaryOwnerSetRoleReport<T> {
  readonly value: T;
  readonly canSetBeforeOperation: true;
  readonly membershipRevoked: true;
  readonly canSetAfterOperation: false;
}

export async function withTemporaryOwnerSetRole<T>(input: {
  readonly client: ClientBase;
  readonly bootstrapRole: string;
  readonly ownerRole: string;
  readonly forbiddenRoles?: readonly string[];
  readonly operation: () => Promise<T>;
}): Promise<TemporaryOwnerSetRoleReport<T>> {
  if (
    input.bootstrapRole === input.ownerRole ||
    input.bootstrapRole === STAGING_RUNTIME_ROLE ||
    input.bootstrapRole === STAGING_PROVISIONING_ROLE ||
    input.forbiddenRoles?.includes(input.bootstrapRole)
  ) {
    throw new SafePhase6StagingError(
      "Bootstrap, owner, runtime and provisioner roles must remain distinct.",
    );
  }
  const currentUser = (
    await input.client.query<{ current_user: string }>("SELECT current_user")
  ).rows[0]?.current_user;
  if (currentUser !== input.bootstrapRole) {
    throw new SafePhase6StagingError(
      "Temporary membership must be managed by the authenticated bootstrap role.",
    );
  }
  const bootstrap = await readRoleAttributes(input.client, input.bootstrapRole);
  if (
    !bootstrap?.rolcanlogin ||
    bootstrap.rolinherit ||
    bootstrap.rolsuper ||
    !bootstrap.rolcreatedb ||
    !bootstrap.rolcreaterole ||
    bootstrap.rolreplication ||
    bootstrap.rolbypassrls
  ) {
    throw new SafePhase6StagingError(
      "Authorized bootstrap role attributes are unsafe.",
    );
  }
  await assertOwnerRoleIsRestricted(input.client, input.ownerRole);

  const owner = quoteIdentifier(input.ownerRole);
  const bootstrapRole = quoteIdentifier(input.bootstrapRole);
  await input.client.query(`REVOKE ${owner} FROM ${bootstrapRole}`);
  await assertNoOwnerSetRoleCapability(
    input.client,
    input.bootstrapRole,
    input.ownerRole,
  );
  await input.client.query(
    `GRANT ${owner} TO ${bootstrapRole} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`,
  );
  const canSetBeforeOperation = await canSetRole(
    input.client,
    input.bootstrapRole,
    input.ownerRole,
  );
  const exactTemporaryGrant = (
    await input.client.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM pg_auth_members membership
       JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
       JOIN pg_roles member_role ON member_role.oid = membership.member
       JOIN pg_roles grantor_role ON grantor_role.oid = membership.grantor
       WHERE granted_role.rolname = $1
         AND member_role.rolname = $2
         AND grantor_role.rolname = $2
         AND membership.admin_option = false
         AND membership.inherit_option = false
         AND membership.set_option = true`,
      [input.ownerRole, input.bootstrapRole],
    )
  ).rows[0]?.count;
  if (!canSetBeforeOperation || exactTemporaryGrant !== 1) {
    await input.client
      .query(`REVOKE ${owner} FROM ${bootstrapRole}`)
      .catch(() => undefined);
    throw new SafePhase6StagingError(
      "Temporary SET ROLE membership could not be proven.",
    );
  }

  let value: T | undefined;
  let operationError: unknown;
  try {
    value = await input.operation();
  } catch (error) {
    operationError = error;
  }

  try {
    await input.client.query("RESET ROLE");
    await input.client.query(`REVOKE ${owner} FROM ${bootstrapRole}`);
    await assertNoOwnerSetRoleCapability(
      input.client,
      input.bootstrapRole,
      input.ownerRole,
    );
  } catch {
    throw new SafePhase6StagingError(
      "Temporary SET ROLE cleanup failed; owner-access residue may remain.",
    );
  }
  if (operationError) throw operationError;
  return {
    value: value as T,
    canSetBeforeOperation: true,
    membershipRevoked: true,
    canSetAfterOperation: false,
  };
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

async function assertOwnerRoleIsRestricted(
  client: ClientBase,
  role: string,
): Promise<void> {
  const owner = await readRoleAttributes(client, role);
  if (
    !owner?.rolcanlogin ||
    owner.rolinherit ||
    owner.rolsuper ||
    owner.rolcreatedb ||
    owner.rolcreaterole ||
    owner.rolreplication ||
    owner.rolbypassrls
  ) {
    throw new SafePhase6StagingError("Owner role is unsafe.");
  }
}

async function canSetRole(
  client: ClientBase,
  memberRole: string,
  targetRole: string,
): Promise<boolean> {
  return (
    (
      await client.query<{ can_set: boolean }>(
        "SELECT pg_has_role($1, $2, 'SET') AS can_set",
        [memberRole, targetRole],
      )
    ).rows[0]?.can_set ?? false
  );
}

async function assertNoOwnerSetRoleCapability(
  client: ClientBase,
  memberRole: string,
  targetRole: string,
): Promise<void> {
  const accessMemberships = (
    await client.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM pg_auth_members membership
       JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
       JOIN pg_roles member_role ON member_role.oid = membership.member
       WHERE granted_role.rolname = $1
         AND member_role.rolname = $2
         AND (membership.set_option OR membership.inherit_option)`,
      [targetRole, memberRole],
    )
  ).rows[0]?.count;
  if (
    (await canSetRole(client, memberRole, targetRole)) ||
    accessMemberships !== 0
  ) {
    throw new SafePhase6StagingError(
      "Bootstrap role retains owner SET ROLE or INHERIT capability.",
    );
  }
}
