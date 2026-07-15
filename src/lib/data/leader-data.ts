import "server-only";

import { BusinessRole } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth/authorization";
import { withCoreDataRlsContext } from "@/lib/auth/dal";
import {
  UEB_CORE_DATA_DTO_SELECT,
  type UebCoreDataDto,
} from "@/lib/data/dto";

export async function getLeaderData(): Promise<UebCoreDataDto[]> {
  const principal = await requireRole(BusinessRole.FACULTY_LEADER);
  if (principal.activeUnitIds.length === 0) return [];

  return withCoreDataRlsContext(principal, async (transaction) => {
    const units = await transaction.organizationUnit.findMany({
      where: {
        id: { in: [...principal.activeUnitIds] },
        isActive: true,
      },
      select: { sourceValue: true },
    });
    const activeUnitSourceValues = units.map(({ sourceValue }) => sourceValue);
    if (activeUnitSourceValues.length === 0) return [];

    return transaction.uebCoreData.findMany({
      where: { approvalUnit: { in: activeUnitSourceValues } },
      orderBy: { stt: "asc" },
      select: UEB_CORE_DATA_DTO_SELECT,
    });
  });
}
