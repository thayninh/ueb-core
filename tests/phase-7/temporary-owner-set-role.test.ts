// @vitest-environment node

import type { ClientBase } from "pg";
import { describe, expect, it, vi } from "vitest";

import { withTemporaryOwnerSetRole } from "../../scripts/phase-6/lib/temporary-owner-set-role";

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
});

function fakeMembershipClient(): {
  readonly client: ClientBase;
  readonly query: ReturnType<typeof vi.fn>;
  readonly canSet: () => boolean;
  readonly resetCount: () => number;
  readonly statements: () => readonly string[];
} {
  let membershipCanSet = false;
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
      throw new Error(`Unexpected test query: ${statement}`);
    },
  );
  return {
    client: { query } as unknown as ClientBase,
    query,
    canSet: () => membershipCanSet,
    resetCount: () => resets,
    statements: () => statements,
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
