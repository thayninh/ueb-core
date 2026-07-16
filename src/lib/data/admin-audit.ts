import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  AUTH_AUDIT_EVENT_TYPES,
  type AuthAuditEventType,
  type AuthAuditOutcome,
} from "@/lib/auth/audit";
import { requireAdmin } from "@/lib/auth/authorization";
import { getPrismaClient } from "@/lib/server/prisma";

export const ADMIN_AUDIT_PAGE_SIZE = 50;
export const AUTH_AUDIT_OUTCOMES = ["SUCCESS", "FAILED"] as const;

const SAFE_METADATA_KEYS = new Set([
  "authenticationType",
  "creationType",
  "passwordType",
  "previousStatus",
  "profileStatus",
  "role",
  "organizationUnitId",
  "lecturerUid",
  "revocationType",
  "revokedSessionCount",
]);

export interface AdminAuditRowDto {
  readonly id: string;
  readonly eventType: string;
  readonly outcome: string;
  readonly actorUserId: string | null;
  readonly targetUserId: string | null;
  readonly sessionId: string | null;
  readonly metadata: Readonly<Record<string, string | number | null>>;
  readonly occurredAt: Date;
}

export interface AdminAuditPageDto {
  readonly rows: readonly AdminAuditRowDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalRows: number;
  readonly totalPages: number;
  readonly eventType: AuthAuditEventType | null;
  readonly outcome: AuthAuditOutcome | null;
}

export async function getAdminAuditPage(input: {
  readonly page?: number;
  readonly eventType?: AuthAuditEventType | null;
  readonly outcome?: AuthAuditOutcome | null;
}): Promise<AdminAuditPageDto> {
  await requireAdmin();
  const requestedPage = normalizePage(input.page);
  const where: Prisma.AuthAuditEventWhereInput = {
    eventType: input.eventType ?? { in: [...AUTH_AUDIT_EVENT_TYPES] },
    outcome: input.outcome ?? { in: [...AUTH_AUDIT_OUTCOMES] },
  };
  const prisma = getPrismaClient();
  const totalRows = await prisma.authAuditEvent.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalRows / ADMIN_AUDIT_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const rows = await prisma.authAuditEvent.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * ADMIN_AUDIT_PAGE_SIZE,
    take: ADMIN_AUDIT_PAGE_SIZE,
    select: {
      id: true,
      eventType: true,
      outcome: true,
      actorUserId: true,
      targetUserId: true,
      sessionId: true,
      metadata: true,
      occurredAt: true,
    },
  });

  return {
    rows: rows.map((row) => ({
      ...row,
      metadata: sanitizeMetadata(row.metadata),
    })),
    page,
    pageSize: ADMIN_AUDIT_PAGE_SIZE,
    totalRows,
    totalPages,
    eventType: input.eventType ?? null,
    outcome: input.outcome ?? null,
  };
}

export function parseAuditEventType(
  value: string | undefined,
): AuthAuditEventType | null {
  return AUTH_AUDIT_EVENT_TYPES.includes(value as AuthAuditEventType)
    ? (value as AuthAuditEventType)
    : null;
}

export function parseAuditOutcome(
  value: string | undefined,
): AuthAuditOutcome | null {
  return AUTH_AUDIT_OUTCOMES.includes(value as AuthAuditOutcome)
    ? (value as AuthAuditOutcome)
    : null;
}

function normalizePage(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value ?? 1) : 1;
}

function sanitizeMetadata(
  metadata: Prisma.JsonValue,
): Readonly<Record<string, string | number | null>> {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metadata).filter(
      (entry): entry is [string, string | number | null] =>
        SAFE_METADATA_KEYS.has(entry[0]) &&
        (entry[1] === null ||
          typeof entry[1] === "string" ||
          typeof entry[1] === "number"),
    ),
  );
}
