import "server-only";

import { requireAdmin } from "@/lib/auth/authorization";
import { withCoreDataRlsContext } from "@/lib/auth/dal";
import {
  UEB_CORE_DATA_DTO_SELECT,
  type UebCoreDataDto,
} from "@/lib/data/dto";

export async function getAdminData(): Promise<UebCoreDataDto[]> {
  const principal = await requireAdmin();

  return withCoreDataRlsContext(principal, (transaction) =>
    transaction.uebCoreData.findMany({
      orderBy: { stt: "asc" },
      select: UEB_CORE_DATA_DTO_SELECT,
    }),
  );
}
