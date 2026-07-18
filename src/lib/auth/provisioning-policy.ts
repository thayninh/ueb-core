import { createHash } from "node:crypto";

import { z } from "zod";

export const BUSINESS_ROLES = ["LECTURER", "FACULTY_LEADER", "ADMIN"] as const;

export type ProvisionedBusinessRole = (typeof BUSINESS_ROLES)[number];

export interface ProvisionUserInput {
  readonly email: string;
  readonly temporaryPassword: string;
  readonly roles: readonly ProvisionedBusinessRole[];
  readonly lecturerUid?: string;
  readonly unitIds?: readonly string[];
  readonly name?: string;
  readonly actorUserId?: string;
  readonly requirePasswordChange: boolean;
}

export interface ValidatedProvisionUserInput {
  readonly email: string;
  readonly temporaryPassword: string;
  readonly roles: readonly ProvisionedBusinessRole[];
  readonly lecturerUid?: string;
  readonly unitIds: readonly string[];
  readonly name: string;
  readonly actorUserId?: string;
  readonly requirePasswordChange: boolean;
}

export interface BootstrapAdminEnvironment {
  readonly databaseUrl: string;
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly auditHmacSecret: string;
}

const MINIMUM_PASSWORD_LENGTH = 12;
const MAXIMUM_PASSWORD_LENGTH = 128;
const MINIMUM_AUDIT_SECRET_LENGTH = 32;
const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const SAMPLE_PASSWORDS = new Set([
  "admin123456",
  "change_me",
  "changeme",
  "password1234",
  "replace_with_local_password",
]);

const provisionUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  temporaryPassword: z
    .string()
    .min(MINIMUM_PASSWORD_LENGTH)
    .max(MAXIMUM_PASSWORD_LENGTH)
    .refine((password) => !isSamplePassword(password), {
      message: "A sample or placeholder password is not allowed.",
    }),
  roles: z.array(z.enum(BUSINESS_ROLES)).min(1),
  lecturerUid: z.uuid().optional(),
  unitIds: z.array(z.uuid()).optional(),
  name: z.string().trim().min(1).optional(),
  actorUserId: z.uuid().optional(),
  requirePasswordChange: z.boolean(),
});

const bootstrapAdminEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BOOTSTRAP_ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  BOOTSTRAP_ADMIN_PASSWORD: z
    .string()
    .min(MINIMUM_PASSWORD_LENGTH)
    .max(MAXIMUM_PASSWORD_LENGTH)
    .refine((password) => !isSamplePassword(password), {
      message: "BOOTSTRAP_ADMIN_PASSWORD must not be a sample value.",
    }),
  BOOTSTRAP_ADMIN_NAME: z.string().trim().min(1),
  AUDIT_HMAC_SECRET: z
    .string()
    .min(MINIMUM_AUDIT_SECRET_LENGTH)
    .refine(
      (secret) =>
        secret.trim() === secret &&
        !secret.toLowerCase().includes("replace_with"),
      {
        message: "AUDIT_HMAC_SECRET must not be a placeholder value.",
      },
    ),
});

export function validateProvisionUserInput(
  input: ProvisionUserInput,
): ValidatedProvisionUserInput {
  const result = provisionUserSchema.safeParse({
    ...input,
    roles: [...input.roles],
    unitIds: input.unitIds ? [...input.unitIds] : undefined,
  });

  if (!result.success) {
    throw new Error(formatValidationIssues(result.error));
  }

  const roles = uniqueSorted(result.data.roles);
  const unitIds = uniqueSorted(result.data.unitIds ?? []);
  if (roles.includes("LECTURER") && !result.data.lecturerUid) {
    throw new Error("LECTURER requires a lecturerUid mapping.");
  }
  if (roles.includes("FACULTY_LEADER") && unitIds.length === 0) {
    throw new Error("FACULTY_LEADER requires at least one organization unit.");
  }
  if (!roles.includes("FACULTY_LEADER") && unitIds.length > 0) {
    throw new Error(
      "Organization unit scopes require the FACULTY_LEADER role.",
    );
  }

  return {
    email: result.data.email,
    temporaryPassword: result.data.temporaryPassword,
    roles,
    lecturerUid: result.data.lecturerUid,
    unitIds,
    name: result.data.name ?? result.data.email,
    actorUserId: result.data.actorUserId,
    requirePasswordChange: result.data.requirePasswordChange,
  };
}

export function assertLecturerEmailMapping(
  lecturerUid: string | undefined,
  lecturerMatches: readonly string[],
): void {
  if (lecturerMatches.length > 1) {
    throw new Error(
      "Email maps to multiple lecturer_uid values and requires manual resolution.",
    );
  }
  if (
    lecturerUid !== undefined &&
    (lecturerMatches.length !== 1 || lecturerMatches[0] !== lecturerUid)
  ) {
    throw new Error(
      "The explicit lecturerUid does not match the unique source email mapping.",
    );
  }
}

export function parseBootstrapAdminEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): BootstrapAdminEnvironment {
  const result = bootstrapAdminEnvironmentSchema.safeParse({
    DATABASE_URL: source.DATABASE_URL,
    BOOTSTRAP_ADMIN_EMAIL: source.BOOTSTRAP_ADMIN_EMAIL,
    BOOTSTRAP_ADMIN_PASSWORD: source.BOOTSTRAP_ADMIN_PASSWORD,
    BOOTSTRAP_ADMIN_NAME: source.BOOTSTRAP_ADMIN_NAME,
    AUDIT_HMAC_SECRET: source.AUDIT_HMAC_SECRET,
  });

  if (!result.success) {
    throw new Error(formatValidationIssues(result.error));
  }

  assertLocalPostgresDatabaseUrl(result.data.DATABASE_URL);
  if (result.data.BOOTSTRAP_ADMIN_EMAIL.endsWith(".invalid")) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL must not use a sample domain.");
  }

  return {
    databaseUrl: result.data.DATABASE_URL,
    email: result.data.BOOTSTRAP_ADMIN_EMAIL,
    password: result.data.BOOTSTRAP_ADMIN_PASSWORD,
    name: result.data.BOOTSTRAP_ADMIN_NAME,
    auditHmacSecret: result.data.AUDIT_HMAC_SECRET,
  };
}

export function assertLocalPostgresDatabaseUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid local PostgreSQL URL.");
  }

  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    url.pathname.length <= 1
  ) {
    throw new Error(
      "DATABASE_URL must target an explicit local PostgreSQL database.",
    );
  }
}

export function createOrganizationUnitKey(sourceValue: string): string {
  if (sourceValue.trim().length === 0) {
    throw new Error("approval_unit must not be empty or whitespace-only.");
  }

  return `unit_${createHash("sha256").update(sourceValue, "utf8").digest("hex").slice(0, 40)}`;
}

export function isSamplePassword(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    value.trim() !== value ||
    SAMPLE_PASSWORDS.has(normalized) ||
    normalized.includes("replace_with") ||
    normalized.includes("example_password")
  );
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
}
