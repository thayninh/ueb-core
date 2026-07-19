// @vitest-environment node

import type { ClientBase } from "pg";
import { describe, expect, it, vi } from "vitest";

import { withTemporaryOwnerSetRole } from "../../scripts/phase-6/lib/temporary-owner-set-role";
import {
  createGuardedProductionRestoreDatabase,
  PRODUCTION_EXECUTOR_CONTRACT,
  type ProductionExecutorCommand,
  SafeProductionExecutorError,
} from "../../scripts/phase-7/lib/production-executor";

const BOOTSTRAP = "ueb_core_production_bootstrap_test";
const OWNER = "ueb_core_owner_test";

describe("Phase 7 temporary production-owner SET ROLE membership", () => {
  it("grants only SET capability and revokes it after success", async () => {
    const state = fakeMembershipClient();
    const report = await withTemporaryOwnerSetRole({
      client: state.client,
      bootstrapRole: BOOTSTRAP,
      ownerRole: OWNER,
      forbiddenRoles: ["ueb_core_app", "ueb_core_provisioner"],
      operation: async () => {
        expect(state.canSet()).toBe(true);
        return "database-created";
      },
    });

    expect(report).toEqual({
      value: "database-created",
      canSetBeforeOperation: true,
      membershipRevoked: true,
      canSetAfterOperation: false,
    });
    expect(state.canSet()).toBe(false);
    expect(state.resetCount()).toBe(1);
    expect(state.statements()).toContain(
      `GRANT "${OWNER}" TO "${BOOTSTRAP}" WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`,
    );
    expect(state.statements().join("\n")).not.toContain("ADMIN TRUE");
  });

  it("resets role and revokes SET capability after operation failure", async () => {
    const state = fakeMembershipClient();

    await expect(
      withTemporaryOwnerSetRole({
        client: state.client,
        bootstrapRole: BOOTSTRAP,
        ownerRole: OWNER,
        forbiddenRoles: ["ueb_core_app", "ueb_core_provisioner"],
        operation: async () => {
          expect(state.canSet()).toBe(true);
          throw Object.assign(new Error("injected-create-failure"), {
            code: "42501",
          });
        },
      }),
    ).rejects.toMatchObject({ code: "42501" });

    expect(state.canSet()).toBe(false);
    expect(state.resetCount()).toBe(1);
    expect(state.statements()).toContain("RESET ROLE");
  });

  it("rejects runtime or provisioner as the bootstrap role", async () => {
    const state = fakeMembershipClient();
    await expect(
      withTemporaryOwnerSetRole({
        client: state.client,
        bootstrapRole: "ueb_core_app",
        ownerRole: OWNER,
        forbiddenRoles: ["ueb_core_app", "ueb_core_provisioner"],
        operation: async () => undefined,
      }),
    ).rejects.toThrow(/roles must remain distinct/u);
    expect(state.query).not.toHaveBeenCalled();
  });

  it("creates a marked restore database with temporary SET-only membership", async () => {
    const state = fakeMembershipClient({ trackDatabase: true });
    const report = await createGuardedProductionRestoreDatabase({
      client: state.client,
      bootstrapRole: BOOTSTRAP,
      command: restoreCommand(),
    });

    expect(report).toEqual({
      canSetBeforeOperation: true,
      membershipRevoked: true,
      canSetAfterOperation: false,
    });
    expect(state.databaseExists()).toBe(true);
    expect(state.canSet()).toBe(false);
    expect(state.statements().join("\n")).toContain(
      'CREATE DATABASE "ueb_core_prod_restore_regression" OWNER "ueb_core_owner_test" TEMPLATE template0',
    );
    expect(state.statements().join("\n")).toContain(
      `COMMENT ON DATABASE "ueb_core_prod_restore_regression" IS '${PRODUCTION_EXECUTOR_CONTRACT.restoreMarker}'`,
    );
    expect(state.statements().join("\n")).not.toContain("ADMIN TRUE");
  });

  it("revokes membership and proves no restore residue after CREATE failure", async () => {
    const state = fakeMembershipClient({
      trackDatabase: true,
      failDatabaseCreate: true,
    });

    const error = await createGuardedProductionRestoreDatabase({
      client: state.client,
      bootstrapRole: BOOTSTRAP,
      command: restoreCommand(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SafeProductionExecutorError);
    expect(error).toMatchObject({
      code: "PRODUCTION_RESTORE_CREATE_FAILED",
      mutationPossible: false,
      diagnostic: {
        phase: "PRODUCTION_RESTORE_DATABASE_CREATE",
        postgresSqlstate: "42501",
      },
    });
    expect(state.databaseExists()).toBe(false);
    expect(state.canSet()).toBe(false);
    expect(state.resetCount()).toBe(1);
    expect(state.statements()).toContain("RESET ROLE");
  });
});

function fakeMembershipClient(
  input: {
    readonly trackDatabase?: boolean;
    readonly failDatabaseCreate?: boolean;
  } = {},
): {
  readonly client: ClientBase;
  readonly query: ReturnType<typeof vi.fn>;
  readonly canSet: () => boolean;
  readonly resetCount: () => number;
  readonly statements: () => readonly string[];
  readonly databaseExists: () => boolean;
} {
  let membershipCanSet = false;
  let restoreDatabaseExists = false;
  let resets = 0;
  const statements: string[] = [];
  const query = vi.fn(
    async (statement: string, values?: readonly unknown[]) => {
      statements.push(statement.trim());
      if (statement === "SELECT current_user") {
        return { rows: [{ current_user: BOOTSTRAP }] };
      }
      if (statement.includes("FROM pg_roles WHERE rolname = $1")) {
        const role = values?.[0];
        return {
          rows: [
            role === BOOTSTRAP
              ? restrictedRole({ createdb: true, createrole: true })
              : restrictedRole(),
          ],
        };
      }
      if (statement.includes("FROM pg_database WHERE datname = $1")) {
        return { rows: [{ exists: restoreDatabaseExists }] };
      }
      if (statement.startsWith("REVOKE ")) {
        membershipCanSet = false;
        return { rows: [] };
      }
      if (statement.startsWith("GRANT ")) {
        membershipCanSet = true;
        return { rows: [] };
      }
      if (statement === "RESET ROLE") {
        resets += 1;
        return { rows: [] };
      }
      if (statement.includes("pg_has_role")) {
        return { rows: [{ can_set: membershipCanSet }] };
      }
      if (statement.includes("FROM pg_auth_members")) {
        return { rows: [{ count: membershipCanSet ? 1 : 0 }] };
      }
      if (statement.startsWith("CREATE DATABASE ") && input.trackDatabase) {
        if (input.failDatabaseCreate) {
          throw Object.assign(new Error("injected-create-failure"), {
            code: "42501",
          });
        }
        restoreDatabaseExists = true;
        return { rows: [] };
      }
      if (statement.startsWith("COMMENT ON DATABASE ")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected test query: ${statement}`);
    },
  );
  return {
    client: { query } as unknown as ClientBase,
    query,
    canSet: () => membershipCanSet,
    resetCount: () => resets,
    statements: () => statements,
    databaseExists: () => restoreDatabaseExists,
  };
}

function restoreCommand(): ProductionExecutorCommand {
  return {
    mode: "RESTORE",
    targetDatabase: "ueb_core_prod_restore_regression",
    sourceDatabase: PRODUCTION_EXECUTOR_CONTRACT.database,
    authorizationReference: `${PRODUCTION_EXECUTOR_CONTRACT.authorizationPrefix}_TEST`,
    windowStart: "2026-07-19T01:00:00+07:00",
    windowEnd: "2026-07-19T04:00:00+07:00",
    expectedGitSha: "a".repeat(40),
    rosterManifestSha: PRODUCTION_EXECUTOR_CONTRACT.rosterManifestSha,
    canonicalChecksum: PRODUCTION_EXECUTOR_CONTRACT.canonicalChecksum,
    ownerRole: OWNER,
    runtimeRole: PRODUCTION_EXECUTOR_CONTRACT.runtimeRole,
    provisionerRole: PRODUCTION_EXECUTOR_CONTRACT.provisionerRole,
    emailEvidence: "/tmp/email-evidence",
    rollbackEvidence: "/tmp/rollback-evidence",
    appArchive: `/tmp/ueb-core-${"a".repeat(40)}.tar`,
    appArchiveSha256: "b".repeat(64),
    operatorArchive: `/tmp/ueb-core-operator-${"a".repeat(40)}.tar`,
    operatorArchiveSha256: "c".repeat(64),
    backupPath: "/tmp/production.dump",
    dryRun: false,
  };
}

function restrictedRole(
  input: { readonly createdb?: boolean; readonly createrole?: boolean } = {},
): Record<string, boolean> {
  return {
    rolcanlogin: true,
    rolinherit: false,
    rolsuper: false,
    rolcreatedb: input.createdb ?? false,
    rolcreaterole: input.createrole ?? false,
    rolreplication: false,
    rolbypassrls: false,
  };
}
