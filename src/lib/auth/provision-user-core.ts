import { createHmac, randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";

import {
  AccessProfileStatus,
  BusinessRole,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import {
  assertLecturerEmailMapping,
  validateProvisionUserInput,
  type ProvisionUserInput,
  type ValidatedProvisionUserInput,
} from "@/lib/auth/provisioning-policy";
import { getPrismaClient } from "@/lib/server/prisma";

export interface ProvisionUserOptions {
  readonly auditHmacSecret?: string;
  readonly bootstrapInitialAdmin?: boolean;
  readonly prisma?: PrismaClient;
}

export interface ProvisionUserResult {
  readonly status: "CREATED" | "EXISTING";
  readonly userId: string;
  readonly email: string;
  readonly roles: readonly BusinessRole[];
  readonly lecturerMapped: boolean;
  readonly unitScopeCount: number;
}

const CREDENTIAL_PROVIDER_ID = "credential";
const MINIMUM_AUDIT_SECRET_LENGTH = 32;

export async function provisionUser(
  input: ProvisionUserInput,
  options: ProvisionUserOptions = {},
): Promise<ProvisionUserResult> {
  const validated = validateProvisionUserInput(input);
  const auditHmacSecret = readAuditHmacSecret(options.auditHmacSecret);
  const passwordHash = await hashPassword(validated.temporaryPassword);
  const prisma = options.prisma ?? getPrismaClient();

  return prisma.$transaction(
    async (transaction) => {
      const lecturerMatches = await findLecturerMatchesByEmail(
        transaction,
        validated.email,
      );
      assertLecturerEmailMapping(validated.lecturerUid, lecturerMatches);
      await assertOrganizationUnits(transaction, validated.unitIds);

      const existingUser = await transaction.auth_user.findUnique({
        where: { email: validated.email },
        select: { id: true },
      });
      if (existingUser) {
        return assertExistingProvisioningIsCompatible(
          transaction,
          existingUser.id,
          validated,
          options.bootstrapInitialAdmin === true,
        );
      }

      const targetUserId = randomUUID();
      const actorUserId = await resolveActorUserId(
        transaction,
        targetUserId,
        validated,
        options.bootstrapInitialAdmin === true,
      );

      await transaction.auth_user.create({
        data: {
          id: targetUserId,
          email: validated.email,
          emailVerified: false,
          name: validated.name,
        },
      });
      await transaction.auth_account.create({
        data: {
          accountId: targetUserId,
          providerId: CREDENTIAL_PROVIDER_ID,
          userId: targetUserId,
          password: passwordHash,
        },
      });
      await transaction.accessProfile.create({
        data: {
          userId: targetUserId,
          lecturerUid: validated.lecturerUid,
          status: AccessProfileStatus.ACTIVE,
          createdBy: actorUserId,
        },
      });
      await transaction.roleAssignment.createMany({
        data: validated.roles.map((role) => ({
          userId: targetUserId,
          role,
          grantedBy: actorUserId,
        })),
      });
      if (validated.unitIds.length > 0) {
        await transaction.unitScopeAssignment.createMany({
          data: validated.unitIds.map((organizationUnitId) => ({
            userId: targetUserId,
            organizationUnitId,
            grantedBy: actorUserId,
          })),
        });
      }

      const bootstrap = options.bootstrapInitialAdmin === true;
      await transaction.authAuditEvent.create({
        data: {
          eventType: bootstrap ? "USER_BOOTSTRAPPED" : "USER_PROVISIONED",
          outcome: "SUCCESS",
          actorUserId,
          targetUserId,
          identifierHash: hashIdentifier(validated.email, auditHmacSecret),
          metadata: {
            version: 1,
            mode: bootstrap ? "LOCAL_BOOTSTRAP" : "ADMIN_CONTROLLED",
            roles: validated.roles,
            lecturerMapped: validated.lecturerUid !== undefined,
            unitScopeCount: validated.unitIds.length,
          },
        },
      });

      return toProvisionUserResult("CREATED", targetUserId, validated);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function resolveActorUserId(
  transaction: Prisma.TransactionClient,
  targetUserId: string,
  input: ValidatedProvisionUserInput,
  bootstrapInitialAdmin: boolean,
): Promise<string> {
  if (bootstrapInitialAdmin) {
    if (
      input.actorUserId !== undefined ||
      input.roles.length !== 1 ||
      input.roles[0] !== BusinessRole.ADMIN ||
      input.lecturerUid !== undefined ||
      input.unitIds.length > 0
    ) {
      throw new Error(
        "Initial bootstrap can only create one unmapped ADMIN account.",
      );
    }
    if ((await transaction.auth_user.count()) !== 0) {
      throw new Error(
        "Initial bootstrap is closed because an authentication user already exists.",
      );
    }
    return targetUserId;
  }

  if (!input.actorUserId) {
    throw new Error("Controlled provisioning requires an actorUserId.");
  }
  const activeAdminRole = await transaction.roleAssignment.findFirst({
    where: {
      userId: input.actorUserId,
      role: BusinessRole.ADMIN,
      revokedAt: null,
      user: {
        accessProfile: { status: AccessProfileStatus.ACTIVE },
      },
    },
    select: { id: true },
  });
  if (!activeAdminRole) {
    throw new Error("Controlled provisioning requires an active ADMIN actor.");
  }
  return input.actorUserId;
}

async function findLecturerMatchesByEmail(
  transaction: Prisma.TransactionClient,
  normalizedEmail: string,
): Promise<string[]> {
  const rows = await transaction.$queryRaw<Array<{ lecturerUid: string }>>(
    Prisma.sql`
      SELECT DISTINCT "lecturer_uid"::text AS "lecturerUid"
      FROM "public"."ueb_core_data"
      WHERE lower(btrim("email_tai_khoan_vnu")) = ${normalizedEmail}
      ORDER BY "lecturer_uid"::text
    `,
  );
  return rows.map((row) => row.lecturerUid);
}

async function assertOrganizationUnits(
  transaction: Prisma.TransactionClient,
  unitIds: readonly string[],
): Promise<void> {
  if (unitIds.length === 0) return;

  const units = await transaction.organizationUnit.findMany({
    where: { id: { in: [...unitIds] }, isActive: true },
    select: { id: true },
  });
  if (units.length !== unitIds.length) {
    throw new Error(
      "Every requested unitId must identify an active organization unit.",
    );
  }
}

async function assertExistingProvisioningIsCompatible(
  transaction: Prisma.TransactionClient,
  userId: string,
  input: ValidatedProvisionUserInput,
  bootstrap: boolean,
): Promise<ProvisionUserResult> {
  const [credentialAccounts, profile, roles, unitScopes, auditEvent] =
    await Promise.all([
      transaction.auth_account.findMany({
        where: { userId, providerId: CREDENTIAL_PROVIDER_ID },
        select: { password: true },
      }),
      transaction.accessProfile.findUnique({
        where: { userId },
        select: { lecturerUid: true, status: true },
      }),
      transaction.roleAssignment.findMany({
        where: { userId, revokedAt: null },
        select: { role: true },
      }),
      transaction.unitScopeAssignment.findMany({
        where: { userId, revokedAt: null },
        select: { organizationUnitId: true },
      }),
      transaction.authAuditEvent.findFirst({
        where: {
          targetUserId: userId,
          eventType: bootstrap ? "USER_BOOTSTRAPPED" : "USER_PROVISIONED",
          outcome: "SUCCESS",
        },
        select: { id: true },
      }),
    ]);

  const activeRoles = new Set(roles.map(({ role }) => role));
  const activeUnitIds = new Set(
    unitScopes.map(({ organizationUnitId }) => organizationUnitId),
  );
  const compatible =
    credentialAccounts.length === 1 &&
    credentialAccounts[0]?.password != null &&
    profile?.status === AccessProfileStatus.ACTIVE &&
    (input.lecturerUid === undefined ||
      profile.lecturerUid === input.lecturerUid) &&
    input.roles.every((role) => activeRoles.has(role)) &&
    input.unitIds.every((unitId) => activeUnitIds.has(unitId)) &&
    auditEvent !== null;

  if (!compatible) {
    throw new Error(
      "An account with this email exists but requires manual provisioning review.",
    );
  }

  return toProvisionUserResult("EXISTING", userId, input);
}

function toProvisionUserResult(
  status: ProvisionUserResult["status"],
  userId: string,
  input: ValidatedProvisionUserInput,
): ProvisionUserResult {
  return {
    status,
    userId,
    email: input.email,
    roles: input.roles,
    lecturerMapped: input.lecturerUid !== undefined,
    unitScopeCount: input.unitIds.length,
  };
}

function readAuditHmacSecret(explicitSecret: string | undefined): string {
  const secret = explicitSecret ?? process.env.AUDIT_HMAC_SECRET;
  if (
    !secret ||
    secret.length < MINIMUM_AUDIT_SECRET_LENGTH ||
    secret.trim() !== secret ||
    secret.toLowerCase().includes("replace_with")
  ) {
    throw new Error("A non-placeholder AUDIT_HMAC_SECRET is required.");
  }
  return secret;
}

function hashIdentifier(identifier: string, secret: string): string {
  return createHmac("sha256", secret).update(identifier, "utf8").digest("hex");
}
