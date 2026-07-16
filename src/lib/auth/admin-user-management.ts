import "server-only";

import {
  AccessProfileStatus,
  BusinessRole,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import {
  appendAuthAuditEvent,
  type AuthAuditEventType,
  type AuthAuditMetadata,
} from "@/lib/auth/audit";
import { getPrismaClient } from "@/lib/server/prisma";

export interface AdminTargetInput {
  readonly actorUserId: string;
  readonly targetUserId: string;
}

export async function activateUser(
  input: AdminTargetInput,
  prisma: PrismaClient = getPrismaClient(),
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, input.actorUserId);
    const profile = await requireTargetProfile(transaction, input.targetUserId);
    if (profile.status === AccessProfileStatus.ACTIVE) return;

    await transaction.accessProfile.update({
      where: { userId: input.targetUserId },
      data: { status: AccessProfileStatus.ACTIVE },
    });
    await appendAudit(transaction, {
      eventType: "USER_ENABLED",
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      metadata: { previousStatus: profile.status },
    });
  });
}

export async function setUserRole(
  input: AdminTargetInput & {
    readonly role: BusinessRole;
    readonly enabled: boolean;
  },
  prisma: PrismaClient = getPrismaClient(),
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, input.actorUserId);
    if (
      !input.enabled &&
      input.role === BusinessRole.ADMIN &&
      input.actorUserId === input.targetUserId
    ) {
      throw new Error("Administrators cannot revoke their own ADMIN role.");
    }

    const profile = await requireTargetProfile(transaction, input.targetUserId);
    const activeAssignment = await transaction.roleAssignment.findFirst({
      where: {
        userId: input.targetUserId,
        role: input.role,
        revokedAt: null,
      },
      select: { id: true },
    });

    if (input.enabled) {
      if (activeAssignment) return;
      if (input.role === BusinessRole.LECTURER && !profile.lecturerUid) {
        throw new Error("LECTURER requires a lecturer_uid mapping.");
      }
      if (input.role === BusinessRole.FACULTY_LEADER) {
        const unitCount = await transaction.unitScopeAssignment.count({
          where: { userId: input.targetUserId, revokedAt: null },
        });
        if (unitCount === 0) {
          throw new Error("FACULTY_LEADER requires an active unit scope.");
        }
      }
      await transaction.roleAssignment.create({
        data: {
          userId: input.targetUserId,
          role: input.role,
          grantedBy: input.actorUserId,
        },
      });
    } else {
      if (!activeAssignment) return;
      await transaction.roleAssignment.update({
        where: { id: activeAssignment.id },
        data: { revokedBy: input.actorUserId, revokedAt: new Date() },
      });
    }

    await appendAudit(transaction, {
      eventType: input.enabled ? "ROLE_GRANTED" : "ROLE_REVOKED",
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      metadata: { role: input.role },
    });
  });
}

export async function setUserUnitScope(
  input: AdminTargetInput & {
    readonly organizationUnitId: string;
    readonly enabled: boolean;
  },
  prisma: PrismaClient = getPrismaClient(),
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, input.actorUserId);
    await requireTargetProfile(transaction, input.targetUserId);
    const unit = await transaction.organizationUnit.findFirst({
      where: { id: input.organizationUnitId, isActive: true },
      select: { id: true },
    });
    if (!unit) throw new Error("Active organization unit was not found.");

    const activeAssignment = await transaction.unitScopeAssignment.findFirst({
      where: {
        userId: input.targetUserId,
        organizationUnitId: input.organizationUnitId,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (input.enabled) {
      if (activeAssignment) return;
      await transaction.unitScopeAssignment.create({
        data: {
          userId: input.targetUserId,
          organizationUnitId: input.organizationUnitId,
          grantedBy: input.actorUserId,
        },
      });
    } else {
      if (!activeAssignment) return;
      const [hasLeaderRole, activeUnitCount] = await Promise.all([
        transaction.roleAssignment.count({
          where: {
            userId: input.targetUserId,
            role: BusinessRole.FACULTY_LEADER,
            revokedAt: null,
          },
        }),
        transaction.unitScopeAssignment.count({
          where: { userId: input.targetUserId, revokedAt: null },
        }),
      ]);
      if (hasLeaderRole > 0 && activeUnitCount <= 1) {
        throw new Error(
          "Revoke FACULTY_LEADER before removing its final unit scope.",
        );
      }
      await transaction.unitScopeAssignment.update({
        where: { id: activeAssignment.id },
        data: { revokedBy: input.actorUserId, revokedAt: new Date() },
      });
    }

    await appendAudit(transaction, {
      eventType: input.enabled ? "UNIT_SCOPE_GRANTED" : "UNIT_SCOPE_REVOKED",
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      metadata: { organizationUnitId: input.organizationUnitId },
    });
  });
}

export async function setLecturerMapping(
  input: AdminTargetInput & { readonly lecturerUid: string | null },
  prisma: PrismaClient = getPrismaClient(),
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, input.actorUserId);
    const profile = await requireTargetProfile(transaction, input.targetUserId);
    if (profile.lecturerUid === input.lecturerUid) return;

    const lecturerRoleCount = await transaction.roleAssignment.count({
      where: {
        userId: input.targetUserId,
        role: BusinessRole.LECTURER,
        revokedAt: null,
      },
    });
    if (input.lecturerUid === null && lecturerRoleCount > 0) {
      throw new Error("Revoke LECTURER before removing lecturer_uid.");
    }

    if (input.lecturerUid !== null) {
      const targetUser = await transaction.auth_user.findUnique({
        where: { id: input.targetUserId },
        select: { email: true },
      });
      if (!targetUser) throw new Error("Target user was not found.");
      await transaction.$queryRaw(
        Prisma.sql`SELECT set_config('app.current_user_id', ${input.actorUserId}, true)`,
      );
      const matches = await transaction.$queryRaw<
        Array<{ lecturerUid: string }>
      >(Prisma.sql`
        SELECT DISTINCT "lecturer_uid"::text AS "lecturerUid"
        FROM "public"."ueb_core_data"
        WHERE lower(btrim("email_tai_khoan_vnu")) = ${targetUser.email.toLowerCase()}
        ORDER BY "lecturer_uid"::text
      `);
      if (
        matches.length !== 1 ||
        matches[0]?.lecturerUid !== input.lecturerUid
      ) {
        throw new Error(
          "The account email must match exactly one requested lecturer_uid.",
        );
      }
    }

    await transaction.accessProfile.update({
      where: { userId: input.targetUserId },
      data: { lecturerUid: input.lecturerUid },
    });
    await appendAudit(transaction, {
      eventType:
        input.lecturerUid === null
          ? "LECTURER_MAPPING_REMOVED"
          : "LECTURER_MAPPING_ASSIGNED",
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      metadata: {
        lecturerUid: input.lecturerUid ?? profile.lecturerUid,
      },
    });
  });
}

export async function revokeUserSessions(
  input: AdminTargetInput,
  prisma: PrismaClient = getPrismaClient(),
): Promise<number> {
  return prisma.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, input.actorUserId);
    await requireTargetProfile(transaction, input.targetUserId);
    const revoked = await transaction.auth_session.deleteMany({
      where: { userId: input.targetUserId },
    });
    await appendAudit(transaction, {
      eventType: "SESSION_REVOKED",
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      metadata: {
        revocationType: "ADMIN_REQUEST",
        revokedSessionCount: revoked.count,
      },
    });
    return revoked.count;
  });
}

async function assertActiveAdmin(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
): Promise<void> {
  const role = await transaction.roleAssignment.findFirst({
    where: {
      userId: actorUserId,
      role: BusinessRole.ADMIN,
      revokedAt: null,
      user: { accessProfile: { status: AccessProfileStatus.ACTIVE } },
    },
    select: { id: true },
  });
  if (!role) throw new Error("An active ADMIN actor is required.");
}

async function requireTargetProfile(
  transaction: Prisma.TransactionClient,
  targetUserId: string,
) {
  const profile = await transaction.accessProfile.findUnique({
    where: { userId: targetUserId },
    select: { status: true, lecturerUid: true },
  });
  if (!profile) throw new Error("Target access profile was not found.");
  return profile;
}

async function appendAudit(
  transaction: Prisma.TransactionClient,
  event: {
    eventType: AuthAuditEventType;
    actorUserId: string;
    targetUserId: string;
    metadata: AuthAuditMetadata;
  },
): Promise<void> {
  await appendAuthAuditEvent(transaction, { ...event, outcome: "SUCCESS" });
}
