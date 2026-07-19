import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { Prisma, PrismaClient } from "../../../src/generated/prisma/client";
import {
  parseOperatorWindow,
  PRODUCTION_EXECUTOR_CONTRACT,
  readEmbeddedSourceSha,
} from "./production-executor";
import {
  PRODUCTION_UNIT_CODES,
  PRODUCTION_UNIT_SOURCE_VALUES,
} from "./production-identity";

export const PRODUCTION_ORGANIZATION_UNIT_SEED_CONTRACT = {
  database: PRODUCTION_EXECUTOR_CONTRACT.database,
  ownerRole: PRODUCTION_EXECUTOR_CONTRACT.ownerRole,
  authorizationAction: "SEED_PRODUCTION_ORGANIZATION_UNITS_ONLY_PHASE7",
  maximumWindowMilliseconds: 4 * 60 * 60 * 1_000,
  inventory: [
    {
      unitKey: "KTPT",
      sourceValue: PRODUCTION_UNIT_SOURCE_VALUES.KTPT,
      displayName: "Khoa Kinh tế phát triển",
      isActive: true,
    },
    {
      unitKey: "QTKD",
      sourceValue: PRODUCTION_UNIT_SOURCE_VALUES.QTKD,
      displayName: "Viện Quản trị kinh doanh",
      isActive: true,
    },
    {
      unitKey: "KTKDQT",
      sourceValue: PRODUCTION_UNIT_SOURCE_VALUES.KTKDQT,
      displayName: "Khoa Kinh tế và Kinh doanh quốc tế",
      isActive: true,
    },
    {
      unitKey: "KTCT",
      sourceValue: PRODUCTION_UNIT_SOURCE_VALUES.KTCT,
      displayName: "Khoa Kinh tế chính trị",
      isActive: true,
    },
    {
      unitKey: "TCNH",
      sourceValue: PRODUCTION_UNIT_SOURCE_VALUES.TCNH,
      displayName: "Khoa Tài chính - Ngân hàng",
      isActive: true,
    },
    {
      unitKey: "KTKT",
      sourceValue: PRODUCTION_UNIT_SOURCE_VALUES.KTKT,
      displayName: "Khoa Kế toán - Kiểm toán",
      isActive: true,
    },
  ] satisfies readonly ProductionOrganizationUnit[],
} as const;

export interface ProductionOrganizationUnit {
  readonly unitKey: string;
  readonly sourceValue: string;
  readonly displayName: string;
  readonly isActive: boolean;
}

export interface ProductionOrganizationUnitSeedCommand {
  readonly targetDatabase: string;
  readonly authorizationAction: string;
  readonly authorizationReference: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly expectedGitSha: string;
}

export interface ProductionOrganizationUnitSeedTransaction {
  readUnits(): Promise<readonly ProductionOrganizationUnit[]>;
  createUnit(unit: ProductionOrganizationUnit): Promise<void>;
}

export interface ProductionOrganizationUnitSeedDatabase {
  serializable<T>(
    operation: (
      transaction: ProductionOrganizationUnitSeedTransaction,
    ) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

export interface ProductionOrganizationUnitSeedResult {
  readonly report: string;
  readonly exitCode: number;
}

export class SafeProductionOrganizationUnitSeedError extends Error {
  constructor(
    readonly code: string,
    readonly transactionRolledBack: boolean | undefined = undefined,
  ) {
    super(code);
  }
}

const VALUE_PREFIXES = [
  "--target-database=",
  "--authorization-action=",
  "--authorization-reference=",
  "--change-window-start=",
  "--change-window-end=",
  "--expected-git-sha=",
] as const;
const CONFIRMATION = "--confirm-production-organization-unit-seed";
const GIT_SHA = /^[a-f0-9]{40}$/u;

export function parseProductionOrganizationUnitSeedCommand(
  arguments_: readonly string[],
): ProductionOrganizationUnitSeedCommand {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  if (
    args.includes("--") ||
    args.includes("--force") ||
    args.some(
      (argument) =>
        argument !== CONFIRMATION &&
        !VALUE_PREFIXES.some((prefix) => argument.startsWith(prefix)),
    ) ||
    args.filter((argument) => argument === CONFIRMATION).length !== 1 ||
    VALUE_PREFIXES.some(
      (prefix) =>
        args.filter((argument) => argument.startsWith(prefix)).length !== 1,
    )
  ) {
    throw new SafeProductionOrganizationUnitSeedError(
      args.includes(CONFIRMATION)
        ? "PRODUCTION_UNIT_SEED_ARGUMENTS_INVALID"
        : "PRODUCTION_UNIT_SEED_CONFIRMATION_REQUIRED",
    );
  }
  const value = (prefix: (typeof VALUE_PREFIXES)[number]): string =>
    args.find((argument) => argument.startsWith(prefix))!.slice(prefix.length);
  const command: ProductionOrganizationUnitSeedCommand = {
    targetDatabase: value("--target-database="),
    authorizationAction: value("--authorization-action="),
    authorizationReference: value("--authorization-reference="),
    windowStart: value("--change-window-start="),
    windowEnd: value("--change-window-end="),
    expectedGitSha: value("--expected-git-sha="),
  };
  assertProductionOrganizationUnitSeedContract(command);
  return command;
}

export function assertProductionOrganizationUnitSeedContract(
  command: ProductionOrganizationUnitSeedCommand,
): void {
  if (
    command.targetDatabase !==
    PRODUCTION_ORGANIZATION_UNIT_SEED_CONTRACT.database
  ) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_DATABASE_FORBIDDEN",
    );
  }
  if (
    command.authorizationAction !==
    PRODUCTION_ORGANIZATION_UNIT_SEED_CONTRACT.authorizationAction
  ) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_AUTHORIZATION_ACTION_MISMATCH",
    );
  }
  const reference = command.authorizationReference.trim();
  if (
    reference.length === 0 ||
    reference.length > 128 ||
    reference !== command.authorizationReference ||
    /[\r\n]/u.test(reference)
  ) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_AUTHORIZATION_REFERENCE_INVALID",
    );
  }
  if (!GIT_SHA.test(command.expectedGitSha)) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_SOURCE_SHA_INVALID",
    );
  }
  const window = parseOperatorWindow(command.windowStart, command.windowEnd);
  if (
    window.end.getTime() - window.start.getTime() >
    PRODUCTION_ORGANIZATION_UNIT_SEED_CONTRACT.maximumWindowMilliseconds
  ) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_CHANGE_WINDOW_INVALID",
    );
  }
}

export function planProductionOrganizationUnitSeed(
  actual: readonly ProductionOrganizationUnit[],
): "CREATE" | "NOOP" {
  const expected = PRODUCTION_ORGANIZATION_UNIT_SEED_CONTRACT.inventory;
  if (actual.length === 0) return "CREATE";
  if (
    hasDuplicates(actual.map(({ unitKey }) => unitKey)) ||
    hasDuplicates(actual.map(({ sourceValue }) => sourceValue)) ||
    hasDuplicates(actual.map(({ displayName }) => displayName))
  ) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_DUPLICATE_INVENTORY",
    );
  }
  if (actual.length !== expected.length) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_INVENTORY_SIZE_CONFLICT",
    );
  }
  const actualByKey = new Map(actual.map((unit) => [unit.unitKey, unit]));
  if (
    expected.some((unit) => {
      const persisted = actualByKey.get(unit.unitKey);
      return (
        !persisted ||
        persisted.sourceValue !== unit.sourceValue ||
        persisted.displayName !== unit.displayName ||
        persisted.isActive !== true
      );
    })
  ) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_INVENTORY_CONFLICT",
    );
  }
  return "NOOP";
}

export async function seedProductionOrganizationUnitsAtomically(input: {
  readonly database: ProductionOrganizationUnitSeedDatabase;
}): Promise<{
  readonly mode: "CREATED" | "NOOP";
  readonly units: readonly ProductionOrganizationUnit[];
}> {
  let transactionStarted = false;
  try {
    return await input.database.serializable(async (transaction) => {
      transactionStarted = true;
      const before = await transaction.readUnits();
      const plan = planProductionOrganizationUnitSeed(before);
      if (plan === "CREATE") {
        for (const unit of PRODUCTION_ORGANIZATION_UNIT_SEED_CONTRACT.inventory) {
          await transaction.createUnit(unit);
        }
      }
      const after = await transaction.readUnits();
      if (planProductionOrganizationUnitSeed(after) !== "NOOP") {
        throw new SafeProductionOrganizationUnitSeedError(
          "PRODUCTION_UNIT_SEED_POST_APPLY_MISMATCH",
        );
      }
      return {
        mode: plan === "CREATE" ? "CREATED" : "NOOP",
        units: after,
      };
    });
  } catch (error) {
    const code =
      error instanceof SafeProductionOrganizationUnitSeedError
        ? error.code
        : "PRODUCTION_UNIT_SEED_TRANSACTION_FAILED";
    throw new SafeProductionOrganizationUnitSeedError(code, transactionStarted);
  }
}

export async function runProductionOrganizationUnitSeed(input: {
  readonly command: ProductionOrganizationUnitSeedCommand;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly now?: Date;
  readonly sourceSha?: () => Promise<string>;
  readonly database?: ProductionOrganizationUnitSeedDatabase;
}): Promise<ProductionOrganizationUnitSeedResult> {
  const window = parseOperatorWindow(
    input.command.windowStart,
    input.command.windowEnd,
  );
  const now = input.now ?? new Date();
  if (now < window.start) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_CHANGE_WINDOW_NOT_STARTED",
    );
  }
  if (now > window.end) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_CHANGE_WINDOW_EXPIRED",
    );
  }
  const sourceSha = await (input.sourceSha ?? readEmbeddedSourceSha)();
  if (sourceSha !== input.command.expectedGitSha) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_SOURCE_SHA_MISMATCH",
    );
  }
  const database =
    input.database ??
    createProductionOrganizationUnitSeedDatabase(
      input.environment ?? process.env,
      input.command,
    );
  try {
    const seeded = await seedProductionOrganizationUnitsAtomically({
      database,
    });
    return {
      report: [
        "PRODUCTION_ORGANIZATION_UNIT_SEED=PASS",
        `UNIT_SEED_MODE=${seeded.mode}`,
        `TARGET_DATABASE=${input.command.targetDatabase}`,
        "AUTHORIZATION_GATE=PASS",
        "CHANGE_WINDOW_GATE=PASS",
        "TRANSACTION=SERIALIZABLE_ALL_OR_NOTHING",
        `ORGANIZATION_UNIT_COUNT=${seeded.units.length}`,
        `ACTIVE_ORGANIZATION_UNIT_COUNT=${seeded.units.filter(({ isActive }) => isActive).length}`,
        `UNIT_CODES=${PRODUCTION_UNIT_CODES.join(",")}`,
        "DUPLICATE_UNIT_COUNT=0",
        "UNKNOWN_UNIT_COUNT=0",
        `DATABASE_MUTATIONS=${seeded.mode === "CREATED" ? seeded.units.length : 0}`,
        "IDENTITY_PROVISIONING=NOT_PERFORMED",
        "SECRET_LEAKAGE=0",
      ].join("\n"),
      exitCode: 0,
    };
  } finally {
    if (!input.database) await database.close().catch(() => undefined);
  }
}

export function formatProductionOrganizationUnitSeedFailure(
  error: unknown,
): string {
  const safe =
    error instanceof SafeProductionOrganizationUnitSeedError
      ? error
      : undefined;
  return [
    "PRODUCTION_ORGANIZATION_UNIT_SEED=BLOCKED",
    `ERROR_CODE=${safe?.code ?? "PRODUCTION_UNIT_SEED_FAILED"}`,
    `TRANSACTION_ROLLED_BACK=${safe?.transactionRolledBack === true ? "YES" : safe?.transactionRolledBack === false ? "NO" : "NOT_APPLICABLE"}`,
    "IDENTITY_PROVISIONING=NOT_PERFORMED",
    "SECRET_LEAKAGE=0",
    "DATABASE_MUTATIONS=0",
  ].join("\n");
}

export function assertProductionOrganizationUnitSeedConnection(
  environment: Readonly<Record<string, string | undefined>>,
  command: ProductionOrganizationUnitSeedCommand,
): string {
  const value = environment.MIGRATION_DATABASE_URL;
  if (!value) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_OWNER_CREDENTIAL_MISSING",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_OWNER_URL_INVALID",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.pathname.slice(1)) !== command.targetDatabase ||
    decodeURIComponent(url.username) !==
      PRODUCTION_ORGANIZATION_UNIT_SEED_CONTRACT.ownerRole ||
    !url.password ||
    !environment.PRODUCTION_DATABASE_HOST ||
    url.hostname !== environment.PRODUCTION_DATABASE_HOST ||
    environment.PRODUCTION_DATABASE_PUBLIC_PORT !== "NO"
  ) {
    throw new SafeProductionOrganizationUnitSeedError(
      "PRODUCTION_UNIT_SEED_OWNER_URL_MISMATCH",
    );
  }
  return url.toString();
}

function createProductionOrganizationUnitSeedDatabase(
  environment: Readonly<Record<string, string | undefined>>,
  command: ProductionOrganizationUnitSeedCommand,
): ProductionOrganizationUnitSeedDatabase {
  const connectionString = assertProductionOrganizationUnitSeedConnection(
    environment,
    command,
  );
  const pool = new Pool({
    connectionString,
    application_name: "ueb-core-phase7-production-organization-unit-seed",
    max: 1,
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: false }),
  });
  return {
    async serializable<T>(
      operation: (
        transaction: ProductionOrganizationUnitSeedTransaction,
      ) => Promise<T>,
    ): Promise<T> {
      return prisma.$transaction(
        async (transaction) =>
          operation({
            async readUnits() {
              return transaction.organizationUnit.findMany({
                orderBy: { unitKey: "asc" },
                select: {
                  unitKey: true,
                  sourceValue: true,
                  displayName: true,
                  isActive: true,
                },
              }) as Promise<readonly ProductionOrganizationUnit[]>;
            },
            async createUnit(unit) {
              await transaction.organizationUnit.create({ data: unit });
            },
          }),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 60_000,
        },
      );
    },
    async close() {
      await prisma.$disconnect().catch(() => undefined);
      await pool.end().catch(() => undefined);
    },
  };
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}
