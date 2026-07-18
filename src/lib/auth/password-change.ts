import "server-only";

import { hashPassword, verifyPassword } from "better-auth/crypto";

import {
  AccessProfileStatus,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { appendAuthAuditEvent } from "@/lib/auth/audit";
import { getPrismaClient } from "@/lib/server/prisma";

export const PASSWORD_CHANGE_ERROR_CODE = "PASSWORD_CHANGE_REQUIRED" as const;
export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 128,
} as const;

export type PasswordChangeRequirement =
  | { readonly required: false; readonly passwordChangedAt: Date | null }
  | { readonly required: true; readonly passwordChangedAt: Date | null };

export type RequiredPasswordChangeErrorCode =
  | "INVALID_CURRENT_PASSWORD"
  | "PASSWORD_CHANGE_NOT_REQUIRED"
  | "PASSWORD_CHANGE_STATE_UNAVAILABLE"
  | "PASSWORD_REUSE_NOT_ALLOWED"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_TOO_SHORT";

export class RequiredPasswordChangeError extends Error {
  constructor(readonly code: RequiredPasswordChangeErrorCode) {
    super(code);
    this.name = "RequiredPasswordChangeError";
  }
}

export async function getPasswordChangeRequirement(
  userId: string,
  prisma: PrismaClient = getPrismaClient(),
): Promise<PasswordChangeRequirement> {
  const profile = await prisma.accessProfile.findUnique({
    where: { userId },
    select: { mustChangePassword: true, passwordChangedAt: true },
  });
  if (!profile) {
    throw new RequiredPasswordChangeError("PASSWORD_CHANGE_STATE_UNAVAILABLE");
  }
  return {
    required: profile.mustChangePassword,
    passwordChangedAt: profile.passwordChangedAt,
  };
}

export async function markPasswordChangeRequired(
  userId: string,
  actorUserId: string,
  prisma: PrismaClient = getPrismaClient(),
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const profile = await transaction.accessProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) {
      throw new RequiredPasswordChangeError(
        "PASSWORD_CHANGE_STATE_UNAVAILABLE",
      );
    }
    await transaction.accessProfile.update({
      where: { userId },
      data: { mustChangePassword: true },
    });
    await appendAuthAuditEvent(transaction, {
      eventType: "AUTH_PASSWORD_CHANGE_REQUIRED",
      outcome: "SUCCESS",
      actorUserId,
      targetUserId: userId,
      metadata: {
        passwordChangeRequired: true,
        secretFields: "NONE",
      },
    });
  });
}

export interface CompleteRequiredPasswordChangeInput {
  readonly userId: string;
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly occurredAt?: Date;
}

export interface CompleteRequiredPasswordChangeResult {
  readonly passwordChangedAt: Date;
  readonly revokedSessionCount: number;
}

export async function completeRequiredPasswordChange(
  input: CompleteRequiredPasswordChangeInput,
  prisma: PrismaClient = getPrismaClient(),
): Promise<CompleteRequiredPasswordChangeResult> {
  validateNewPassword(input.currentPassword, input.newPassword);
  const passwordChangedAt = input.occurredAt ?? new Date();

  return prisma.$transaction(
    async (transaction) => {
      const [profile, credentialAccounts] = await Promise.all([
        transaction.accessProfile.findUnique({
          where: { userId: input.userId },
          select: { status: true, mustChangePassword: true },
        }),
        transaction.auth_account.findMany({
          where: { userId: input.userId, providerId: "credential" },
          select: { id: true, password: true },
        }),
      ]);

      if (!profile || profile.status !== AccessProfileStatus.ACTIVE) {
        throw new RequiredPasswordChangeError(
          "PASSWORD_CHANGE_STATE_UNAVAILABLE",
        );
      }
      if (!profile.mustChangePassword) {
        throw new RequiredPasswordChangeError("PASSWORD_CHANGE_NOT_REQUIRED");
      }
      if (credentialAccounts.length !== 1 || !credentialAccounts[0]?.password) {
        throw new RequiredPasswordChangeError(
          "PASSWORD_CHANGE_STATE_UNAVAILABLE",
        );
      }

      const credentialAccount = credentialAccounts[0];
      const currentPasswordValid = await verifyPassword({
        hash: credentialAccount.password!,
        password: input.currentPassword,
      });
      if (!currentPasswordValid) {
        throw new RequiredPasswordChangeError("INVALID_CURRENT_PASSWORD");
      }

      const newPasswordHash = await hashPassword(input.newPassword);
      await transaction.auth_account.update({
        where: { id: credentialAccount.id },
        data: { password: newPasswordHash },
      });
      const cleared = await transaction.accessProfile.updateMany({
        where: { userId: input.userId, mustChangePassword: true },
        data: { mustChangePassword: false, passwordChangedAt },
      });
      if (cleared.count !== 1) {
        throw new RequiredPasswordChangeError("PASSWORD_CHANGE_NOT_REQUIRED");
      }

      const revokedSessions = await transaction.auth_session.deleteMany({
        where: { userId: input.userId },
      });
      await appendAuthAuditEvent(transaction, {
        eventType: "AUTH_REQUIRED_PASSWORD_CHANGED",
        outcome: "SUCCESS",
        actorUserId: input.userId,
        targetUserId: input.userId,
        metadata: {
          secretFields: "NONE",
          sessionRevocation: "ALL",
          revokedSessionCount: revokedSessions.count,
        },
      });

      return {
        passwordChangedAt,
        revokedSessionCount: revokedSessions.count,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function validateNewPassword(
  currentPassword: string,
  newPassword: string,
): void {
  if (newPassword.length < PASSWORD_POLICY.minLength) {
    throw new RequiredPasswordChangeError("PASSWORD_TOO_SHORT");
  }
  if (newPassword.length > PASSWORD_POLICY.maxLength) {
    throw new RequiredPasswordChangeError("PASSWORD_TOO_LONG");
  }
  if (newPassword === currentPassword) {
    throw new RequiredPasswordChangeError("PASSWORD_REUSE_NOT_ALLOWED");
  }
}
