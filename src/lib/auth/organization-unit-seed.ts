import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { createOrganizationUnitKey } from "@/lib/auth/provisioning-policy";
import { getPrismaClient } from "@/lib/server/prisma";

export interface SeedOrganizationUnitsResult {
  readonly sourceUnitCount: number;
  readonly insertedUnitCount: number;
  readonly existingUnitCount: number;
  readonly leaderAssignmentCount: 0;
}

export async function seedOrganizationUnits(
  prisma: PrismaClient = getPrismaClient(),
): Promise<SeedOrganizationUnitsResult> {
  return prisma.$transaction(
    async (transaction) => {
      const sourceRows = await transaction.uebCoreData.findMany({
        where: { approvalUnit: { not: null } },
        distinct: ["approvalUnit"],
        orderBy: { approvalUnit: "asc" },
        select: { approvalUnit: true },
      });
      const sourceValues = sourceRows.map(({ approvalUnit }) => {
        if (approvalUnit === null) {
          throw new Error("Unexpected null approval_unit in unit seed.");
        }
        createOrganizationUnitKey(approvalUnit);
        return approvalUnit;
      });

      const existingUnits = await transaction.organizationUnit.findMany({
        where: { sourceValue: { in: sourceValues } },
        select: { sourceValue: true },
      });
      const existingSourceValues = new Set(
        existingUnits.map(({ sourceValue }) => sourceValue),
      );
      const unitsToInsert = sourceValues
        .filter((sourceValue) => !existingSourceValues.has(sourceValue))
        .map((sourceValue) => ({
          unitKey: createOrganizationUnitKey(sourceValue),
          sourceValue,
          displayName: sourceValue,
        }));

      const insertion =
        unitsToInsert.length === 0
          ? { count: 0 }
          : await transaction.organizationUnit.createMany({
              data: unitsToInsert,
              skipDuplicates: true,
            });
      const persistedUnitCount = await transaction.organizationUnit.count({
        where: { sourceValue: { in: sourceValues } },
      });
      if (persistedUnitCount !== sourceValues.length) {
        throw new Error(
          "Organization unit seed could not preserve every exact approval_unit value.",
        );
      }

      return {
        sourceUnitCount: sourceValues.length,
        insertedUnitCount: insertion.count,
        existingUnitCount: sourceValues.length - insertion.count,
        leaderAssignmentCount: 0,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
