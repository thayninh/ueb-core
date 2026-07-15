import "server-only";

import { requireLecturerIdentity } from "@/lib/auth/authorization";
import { withCoreDataRlsContext } from "@/lib/auth/dal";
import {
  UEB_CORE_DATA_DTO_SELECT,
  type UebCoreDataDto,
} from "@/lib/data/dto";

export async function getLecturerData(): Promise<UebCoreDataDto[]> {
  const principal = await requireLecturerIdentity();

  return withCoreDataRlsContext(principal, (transaction) =>
    transaction.uebCoreData.findMany({
      where: { lecturerUid: principal.lecturerUid },
      orderBy: { stt: "asc" },
      select: UEB_CORE_DATA_DTO_SELECT,
    }),
  );
}
