// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  formatProductionOrganizationUnitSeedFailure,
  parseProductionOrganizationUnitSeedCommand,
  planProductionOrganizationUnitSeed,
  PRODUCTION_ORGANIZATION_UNIT_SEED_CONTRACT,
  runProductionOrganizationUnitSeed,
  SafeProductionOrganizationUnitSeedError,
  seedProductionOrganizationUnitsAtomically,
  type ProductionOrganizationUnit,
  type ProductionOrganizationUnitSeedDatabase,
  type ProductionOrganizationUnitSeedTransaction,
} from "../../scripts/phase-7/lib/production-organization-unit-seed";

const gitSha = "a".repeat(40);
const approvedInventory = PRODUCTION_ORGANIZATION_UNIT_SEED_CONTRACT.inventory;

describe("Phase 7 guarded production organization unit seed", () => {
  it("separates the exact action from the operator reference", () => {
    const current = parseProductionOrganizationUnitSeedCommand(baseArguments());
    const anotherDate = parseProductionOrganizationUnitSeedCommand(
      replace(
        baseArguments(),
        "--authorization-reference=",
        "--authorization-reference=PHASE7_UNIT_SEED_APPROVAL_2027-01-15",
      ),
    );

    expect(current.authorizationAction).toBe(
      "SEED_PRODUCTION_ORGANIZATION_UNITS_ONLY_PHASE7",
    );
    expect(anotherDate.authorizationReference).toBe(
      "PHASE7_UNIT_SEED_APPROVAL_2027-01-15",
    );
  });

  it("requires exact action, bounded reference, confirmation and a four-hour-or-shorter window", () => {
    expect(() =>
      parseProductionOrganizationUnitSeedCommand(
        replace(
          baseArguments(),
          "--authorization-action=",
          "--authorization-action=SEED_SOMETHING_ELSE",
        ),
      ),
    ).toThrow(/PRODUCTION_UNIT_SEED_AUTHORIZATION_ACTION_MISMATCH/u);
    expect(() =>
      parseProductionOrganizationUnitSeedCommand(
        replace(
          baseArguments(),
          "--authorization-reference=",
          "--authorization-reference=",
        ),
      ),
    ).toThrow(/PRODUCTION_UNIT_SEED_AUTHORIZATION_REFERENCE_INVALID/u);
    expect(() =>
      parseProductionOrganizationUnitSeedCommand(
        baseArguments().filter(
          (argument) => !argument.startsWith("--authorization-reference="),
        ),
      ),
    ).toThrow(/PRODUCTION_UNIT_SEED_ARGUMENTS_INVALID/u);
    expect(() =>
      parseProductionOrganizationUnitSeedCommand(
        replace(
          baseArguments(),
          "--authorization-reference=",
          `--authorization-reference=${"a".repeat(129)}`,
        ),
      ),
    ).toThrow(/PRODUCTION_UNIT_SEED_AUTHORIZATION_REFERENCE_INVALID/u);
    expect(() =>
      parseProductionOrganizationUnitSeedCommand(
        baseArguments().filter(
          (argument) =>
            argument !== "--confirm-production-organization-unit-seed",
        ),
      ),
    ).toThrow(/PRODUCTION_UNIT_SEED_CONFIRMATION_REQUIRED/u);
    expect(() =>
      parseProductionOrganizationUnitSeedCommand(
        replace(
          baseArguments(),
          "--change-window-end=",
          "--change-window-end=2026-07-20T05:00:01+07:00",
        ),
      ),
    ).toThrow(/PRODUCTION_CHANGE_WINDOW_INVALID/u);
    expect(() =>
      parseProductionOrganizationUnitSeedCommand(
        replace(
          baseArguments(),
          "--change-window-start=",
          "--change-window-start=2026-07-20T01:00:00",
        ),
      ),
    ).toThrow(/PRODUCTION_CHANGE_WINDOW_INVALID/u);
  });

  it("blocks future and expired windows before a database transaction", async () => {
    const database = fakeDatabase();
    const command = parseProductionOrganizationUnitSeedCommand(baseArguments());
    await expect(
      runProductionOrganizationUnitSeed({
        command,
        now: new Date("2026-07-20T00:59:59+07:00"),
        sourceSha: async () => gitSha,
        database,
      }),
    ).rejects.toThrow(/PRODUCTION_CHANGE_WINDOW_NOT_STARTED/u);
    expect(database.transactionCount()).toBe(0);

    await expect(
      runProductionOrganizationUnitSeed({
        command,
        now: new Date("2026-07-20T04:00:01+07:00"),
        sourceSha: async () => gitSha,
        database,
      }),
    ).rejects.toThrow(/PRODUCTION_CHANGE_WINDOW_EXPIRED/u);
    expect(database.transactionCount()).toBe(0);
  });

  it("rejects canonical, staging and UAT database names", () => {
    for (const database of [
      "ueb_core",
      "ueb_core_staging",
      "ueb_core_uat_phase5",
    ]) {
      expect(() =>
        parseProductionOrganizationUnitSeedCommand(
          replace(
            baseArguments(),
            "--target-database=",
            `--target-database=${database}`,
          ),
        ),
      ).toThrow(/PRODUCTION_UNIT_SEED_DATABASE_FORBIDDEN/u);
    }
  });

  it("creates the exact six-unit inventory and reruns as NOOP", async () => {
    const database = fakeDatabase();
    const first = await seedProductionOrganizationUnitsAtomically({ database });
    const second = await seedProductionOrganizationUnitsAtomically({
      database,
    });

    expect(first.mode).toBe("CREATED");
    expect(second.mode).toBe("NOOP");
    expect(database.committedUnits()).toEqual(approvedInventory);
    expect(database.createCount()).toBe(6);
    expect(database.transactionCount()).toBe(2);
  });

  it("blocks duplicate codes and names", () => {
    const duplicateCode = [...approvedInventory, { ...approvedInventory[0]! }];
    expect(() => planProductionOrganizationUnitSeed(duplicateCode)).toThrow(
      /PRODUCTION_UNIT_SEED_DUPLICATE_INVENTORY/u,
    );

    const duplicateName = approvedInventory.map((unit, index) =>
      index === 1
        ? { ...unit, displayName: approvedInventory[0]!.displayName }
        : unit,
    );
    expect(() => planProductionOrganizationUnitSeed(duplicateName)).toThrow(
      /PRODUCTION_UNIT_SEED_DUPLICATE_INVENTORY/u,
    );
  });

  it("blocks wrong names, missing units and extra units without updating", () => {
    expect(() =>
      planProductionOrganizationUnitSeed(
        approvedInventory.map((unit) =>
          unit.unitKey === "KTCT"
            ? { ...unit, displayName: "Wrong name" }
            : unit,
        ),
      ),
    ).toThrow(/PRODUCTION_UNIT_SEED_INVENTORY_CONFLICT/u);
    expect(() =>
      planProductionOrganizationUnitSeed(approvedInventory.slice(0, 5)),
    ).toThrow(/PRODUCTION_UNIT_SEED_INVENTORY_SIZE_CONFLICT/u);
    expect(() =>
      planProductionOrganizationUnitSeed([
        ...approvedInventory,
        {
          unitKey: "EXTRA",
          sourceValue: "Extra source",
          displayName: "Extra unit",
          isActive: true,
        },
      ]),
    ).toThrow(/PRODUCTION_UNIT_SEED_INVENTORY_SIZE_CONFLICT/u);
  });

  it("rolls back all six records when one create fails", async () => {
    const database = fakeDatabase({ failAtCreate: 4 });
    const error = await seedProductionOrganizationUnitsAtomically({
      database,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SafeProductionOrganizationUnitSeedError);
    expect((error as SafeProductionOrganizationUnitSeedError).code).toBe(
      "PRODUCTION_UNIT_SEED_TRANSACTION_FAILED",
    );
    expect(
      (error as SafeProductionOrganizationUnitSeedError).transactionRolledBack,
    ).toBe(true);
    expect(database.committedUnits()).toEqual([]);
  });

  it("reports exact aggregate counts without leaking database credentials", async () => {
    const database = fakeDatabase();
    const result = await runProductionOrganizationUnitSeed({
      command: parseProductionOrganizationUnitSeedCommand(baseArguments()),
      now: new Date("2026-07-20T02:00:00+07:00"),
      sourceSha: async () => gitSha,
      database,
    });

    expect(result.report).toContain("UNIT_SEED_MODE=CREATED");
    expect(result.report).toContain("ORGANIZATION_UNIT_COUNT=6");
    expect(result.report).toContain("ACTIVE_ORGANIZATION_UNIT_COUNT=6");
    expect(result.report).toContain(
      "UNIT_CODES=KTPT,QTKD,KTKDQT,KTCT,TCNH,KTKT",
    );
    expect(result.report).toContain("DATABASE_MUTATIONS=6");
    expect(result.report).toContain("IDENTITY_PROVISIONING=NOT_PERFORMED");
    expect(result.report).not.toMatch(/postgres(?:ql)?:\/\//u);

    const report = formatProductionOrganizationUnitSeedFailure(
      new Error("sensitive-diagnostic-material"),
    );
    expect(report).not.toContain("sensitive-diagnostic-material");
    expect(report).toContain("DATABASE_MUTATIONS=0");
  });
});

function baseArguments(): string[] {
  return [
    "--target-database=ueb_core_prod",
    "--authorization-action=SEED_PRODUCTION_ORGANIZATION_UNITS_ONLY_PHASE7",
    "--authorization-reference=PHASE7_UNIT_SEED_APPROVAL_2026-07-20",
    "--change-window-start=2026-07-20T01:00:00+07:00",
    "--change-window-end=2026-07-20T04:00:00+07:00",
    `--expected-git-sha=${gitSha}`,
    "--confirm-production-organization-unit-seed",
  ];
}

function replace(
  arguments_: readonly string[],
  prefix: string,
  replacement: string,
): string[] {
  return arguments_.map((argument) =>
    argument.startsWith(prefix) ? replacement : argument,
  );
}

function fakeDatabase(
  options: { readonly failAtCreate?: number } = {},
): ProductionOrganizationUnitSeedDatabase & {
  committedUnits(): readonly ProductionOrganizationUnit[];
  createCount(): number;
  transactionCount(): number;
} {
  let committed: ProductionOrganizationUnit[] = [];
  let creates = 0;
  let transactions = 0;
  return {
    async serializable<T>(
      operation: (
        transaction: ProductionOrganizationUnitSeedTransaction,
      ) => Promise<T>,
    ): Promise<T> {
      transactions += 1;
      const working = committed.map((unit) => ({ ...unit }));
      const result = await operation({
        async readUnits() {
          return working.map((unit) => ({ ...unit }));
        },
        async createUnit(unit) {
          creates += 1;
          if (creates === options.failAtCreate) {
            throw new Error("database failure with secret=must-not-leak");
          }
          working.push({ ...unit });
        },
      });
      committed = working;
      return result;
    },
    async close() {},
    committedUnits: () => committed,
    createCount: () => creates,
    transactionCount: () => transactions,
  };
}
