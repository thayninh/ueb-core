ALTER TABLE "public"."access_profile"
ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "password_changed_at" TIMESTAMPTZ(6);
