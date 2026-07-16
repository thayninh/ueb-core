-- CreateEnum
CREATE TYPE "access_profile_status" AS ENUM ('PENDING_MAPPING', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "business_role" AS ENUM ('LECTURER', 'FACULTY_LEADER', 'ADMIN');

-- CreateTable
CREATE TABLE "auth_user" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" UUID NOT NULL,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_account" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_verification" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_profile" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "lecturer_uid" UUID,
    "status" "access_profile_status" NOT NULL DEFAULT 'PENDING_MAPPING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,

    CONSTRAINT "access_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignment" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "business_role" NOT NULL,
    "granted_by" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_unit" (
    "id" UUID NOT NULL,
    "unit_key" VARCHAR(64) NOT NULL,
    "source_value" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_scope_assignment" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_unit_id" UUID NOT NULL,
    "granted_by" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "unit_scope_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_audit_event" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(32) NOT NULL,
    "actor_user_id" UUID,
    "target_user_id" UUID,
    "session_id" UUID,
    "identifier_hash" CHAR(64),
    "metadata" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_email_key" ON "auth_user"("email");

-- CreateIndex
CREATE INDEX "auth_session_userId_idx" ON "auth_session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_token_key" ON "auth_session"("token");

-- CreateIndex
CREATE INDEX "auth_account_userId_idx" ON "auth_account"("userId");

-- CreateIndex
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "access_profile_user_id_key" ON "access_profile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_profile_lecturer_uid_key" ON "access_profile"("lecturer_uid");

-- CreateIndex
CREATE INDEX "access_profile_status_idx" ON "access_profile"("status");

-- CreateIndex
CREATE INDEX "role_assignment_user_id_idx" ON "role_assignment"("user_id");

-- CreateIndex
CREATE INDEX "role_assignment_role_idx" ON "role_assignment"("role");

-- CreateIndex
CREATE UNIQUE INDEX "organization_unit_unit_key_key" ON "organization_unit"("unit_key");

-- CreateIndex
CREATE UNIQUE INDEX "organization_unit_source_value_key" ON "organization_unit"("source_value");

-- CreateIndex
CREATE INDEX "organization_unit_is_active_idx" ON "organization_unit"("is_active");

-- CreateIndex
CREATE INDEX "unit_scope_assignment_user_id_idx" ON "unit_scope_assignment"("user_id");

-- CreateIndex
CREATE INDEX "unit_scope_assignment_organization_unit_id_idx" ON "unit_scope_assignment"("organization_unit_id");

-- CreateIndex
CREATE INDEX "auth_audit_event_type_occurred_at_idx" ON "auth_audit_event"("event_type", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "auth_audit_event_actor_user_id_occurred_at_idx" ON "auth_audit_event"("actor_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "auth_audit_event_target_user_id_occurred_at_idx" ON "auth_audit_event"("target_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "auth_audit_event_session_id_idx" ON "auth_audit_event"("session_id");

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_profile" ADD CONSTRAINT "access_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_profile" ADD CONSTRAINT "access_profile_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_scope_assignment" ADD CONSTRAINT "unit_scope_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_scope_assignment" ADD CONSTRAINT "unit_scope_assignment_organization_unit_id_fkey" FOREIGN KEY ("organization_unit_id") REFERENCES "organization_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_scope_assignment" ADD CONSTRAINT "unit_scope_assignment_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_scope_assignment" ADD CONSTRAINT "unit_scope_assignment_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ActiveAssignmentUniqueness
CREATE UNIQUE INDEX "role_assignment_active_user_role_key"
ON "role_assignment"("user_id", "role")
WHERE "revoked_at" IS NULL;

CREATE UNIQUE INDEX "unit_scope_assignment_active_user_unit_key"
ON "unit_scope_assignment"("user_id", "organization_unit_id")
WHERE "revoked_at" IS NULL;

-- RevocationConsistency
ALTER TABLE "role_assignment"
ADD CONSTRAINT "role_assignment_revocation_pair_check"
CHECK (
    ("revoked_at" IS NULL AND "revoked_by" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
);

ALTER TABLE "unit_scope_assignment"
ADD CONSTRAINT "unit_scope_assignment_revocation_pair_check"
CHECK (
    ("revoked_at" IS NULL AND "revoked_by" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
);

-- LecturerRoleMappingInvariant
CREATE FUNCTION "enforce_lecturer_role_mapping"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."role" = 'LECTURER'::"business_role"
       AND NEW."revoked_at" IS NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "access_profile"
           WHERE "user_id" = NEW."user_id"
             AND "lecturer_uid" IS NOT NULL
       ) THEN
        RAISE EXCEPTION 'An active LECTURER role requires an access profile with lecturer_uid';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "role_assignment_enforce_lecturer_mapping"
BEFORE INSERT OR UPDATE ON "role_assignment"
FOR EACH ROW
EXECUTE FUNCTION "enforce_lecturer_role_mapping"();

CREATE FUNCTION "protect_active_lecturer_mapping"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF EXISTS (
            SELECT 1
            FROM "role_assignment"
            WHERE "user_id" = OLD."user_id"
              AND "role" = 'LECTURER'::"business_role"
              AND "revoked_at" IS NULL
        ) THEN
            RAISE EXCEPTION 'Cannot delete an access profile with an active LECTURER role';
        END IF;

        RETURN OLD;
    END IF;

    IF (NEW."user_id" IS DISTINCT FROM OLD."user_id" OR NEW."lecturer_uid" IS NULL)
       AND EXISTS (
           SELECT 1
           FROM "role_assignment"
           WHERE "user_id" = OLD."user_id"
             AND "role" = 'LECTURER'::"business_role"
             AND "revoked_at" IS NULL
       ) THEN
        RAISE EXCEPTION 'Cannot remove the lecturer mapping while a LECTURER role is active';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "access_profile_protect_lecturer_mapping"
BEFORE UPDATE OR DELETE ON "access_profile"
FOR EACH ROW
EXECUTE FUNCTION "protect_active_lecturer_mapping"();

-- AppendOnlyTriggers: auth_audit_event
CREATE TRIGGER "auth_audit_event_reject_update_delete"
BEFORE UPDATE OR DELETE ON "auth_audit_event"
FOR EACH ROW
EXECUTE FUNCTION "reject_append_only_mutation"();

CREATE TRIGGER "auth_audit_event_reject_truncate"
BEFORE TRUNCATE ON "auth_audit_event"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_append_only_mutation"();
