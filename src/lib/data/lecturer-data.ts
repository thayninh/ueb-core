import "server-only";

import type { UebCoreDataDto } from "@/lib/data/dto";
import { getLatestCoreRowsForLecturer } from "@/lib/data/latest-core-data";

export async function getLecturerData(): Promise<UebCoreDataDto[]> {
  return [...(await getLatestCoreRowsForLecturer())];
}
