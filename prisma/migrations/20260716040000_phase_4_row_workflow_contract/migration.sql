-- CreateEnum
CREATE TYPE "workflow_event_type" AS ENUM ('SUBMITTED', 'REJECTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "workflow_submission_type" AS ENUM ('CONFIRM_UNCHANGED', 'UPDATE_EXISTING', 'CREATE_NEW');

-- ValidateEventTypeCast
DO $$
DECLARE
    invalid_event_types TEXT;
BEGIN
    SELECT string_agg(DISTINCT "event_type", ', ' ORDER BY "event_type")
    INTO invalid_event_types
    FROM "workflow_event"
    WHERE "event_type" NOT IN ('SUBMITTED', 'REJECTED', 'APPROVED');

    IF invalid_event_types IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot migrate workflow_event.event_type: unsupported values: %',
            invalid_event_types;
    END IF;
END
$$;

-- AlterEventTypeWithoutDroppingHistory
DO $$
DECLARE
    event_type_default_expression TEXT;
    event_type_default_value TEXT;
BEGIN
    SELECT pg_get_expr(attribute_default.adbin, attribute_default.adrelid)
    INTO event_type_default_expression
    FROM pg_catalog.pg_attrdef AS attribute_default
    INNER JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = attribute_default.adrelid
       AND attribute.attnum = attribute_default.adnum
    WHERE attribute_default.adrelid = 'workflow_event'::regclass
      AND attribute.attname = 'event_type';

    IF event_type_default_expression IS NOT NULL THEN
        EXECUTE format('SELECT (%s)::text', event_type_default_expression)
        INTO event_type_default_value;

        IF event_type_default_value NOT IN ('SUBMITTED', 'REJECTED', 'APPROVED') THEN
            RAISE EXCEPTION
                'Cannot migrate workflow_event.event_type default: unsupported value: %',
                event_type_default_value;
        END IF;
    END IF;

    EXECUTE 'ALTER TABLE "workflow_event" ALTER COLUMN "event_type" DROP DEFAULT';
    EXECUTE 'ALTER TABLE "workflow_event" ALTER COLUMN "event_type" TYPE "workflow_event_type" USING ("event_type"::text::"workflow_event_type")';

    IF event_type_default_value IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE "workflow_event" ALTER COLUMN "event_type" SET DEFAULT %L::"workflow_event_type"',
            event_type_default_value
        );
    END IF;
END
$$;

-- AlterTable
ALTER TABLE "workflow_event"
ADD COLUMN "submission_type" "workflow_submission_type",
ADD COLUMN "record_uid" UUID,
ADD COLUMN "base_stt" INTEGER,
ADD COLUMN "base_version_no" INTEGER,
ADD COLUMN "payload_checksum" TEXT,
ADD COLUMN "result_stt" INTEGER,
ADD COLUMN "result_version_no" INTEGER,
ALTER COLUMN "payload" DROP NOT NULL;

-- EventShapeConstraints
ALTER TABLE "workflow_event"
ADD CONSTRAINT "workflow_event_event_shape_check"
CHECK (
    (
        "event_type" = 'SUBMITTED'
        AND "submission_type" IS NOT NULL
        AND "record_uid" IS NOT NULL
        AND "payload" IS NOT NULL
        AND jsonb_typeof("payload") = 'object'
        AND "payload_checksum" IS NOT NULL
        AND btrim("payload_checksum") <> ''
        AND "reason" IS NULL
        AND "result_stt" IS NULL
        AND "result_version_no" IS NULL
    )
    OR (
        "event_type" = 'REJECTED'
        AND "reason" IS NOT NULL
        AND btrim("reason") <> ''
        AND "payload" IS NULL
        AND "payload_checksum" IS NULL
        AND "result_stt" IS NULL
        AND "result_version_no" IS NULL
    )
    OR (
        "event_type" = 'APPROVED'
        AND "reason" IS NULL
        AND "payload" IS NULL
        AND "payload_checksum" IS NULL
        AND "result_stt" IS NOT NULL
        AND "result_version_no" IS NOT NULL
        AND "result_version_no" >= 1
    )
) NOT VALID;

ALTER TABLE "workflow_event"
ADD CONSTRAINT "workflow_event_submitted_base_metadata_check"
CHECK (
    "event_type" <> 'SUBMITTED'
    OR (
        "submission_type" IN ('CONFIRM_UNCHANGED', 'UPDATE_EXISTING')
        AND "base_stt" IS NOT NULL
        AND "base_version_no" IS NOT NULL
        AND "base_version_no" >= 1
    )
    OR (
        "submission_type" = 'CREATE_NEW'
        AND "base_stt" IS NULL
        AND "base_version_no" IS NULL
    )
) NOT VALID;

ALTER TABLE "workflow_event"
ADD CONSTRAINT "workflow_event_parent_submission_check"
CHECK (
    "parent_submission_id" IS NULL
    OR (
        "event_type" = 'SUBMITTED'
        AND "parent_submission_id" <> "submission_id"
    )
) NOT VALID;

-- SubmissionStateUniqueness
CREATE UNIQUE INDEX "workflow_event_one_submitted_per_submission_key"
ON "workflow_event"("submission_id")
WHERE "event_type" = 'SUBMITTED';

CREATE UNIQUE INDEX "workflow_event_one_terminal_per_submission_key"
ON "workflow_event"("submission_id")
WHERE "event_type" IN ('APPROVED', 'REJECTED');

-- CoreApprovalIdempotency
CREATE UNIQUE INDEX "ueb_core_data_source_submission_id_key"
ON "ueb_core_data"("source_submission_id")
WHERE "source_submission_id" IS NOT NULL;

-- QueryIndexes
CREATE INDEX "workflow_event_lecturer_uid_created_at_idx"
ON "workflow_event"("lecturer_uid", "created_at");

CREATE INDEX "workflow_event_lecturer_uid_record_uid_created_at_idx"
ON "workflow_event"("lecturer_uid", "record_uid", "created_at");

CREATE INDEX "workflow_event_approval_unit_created_at_idx"
ON "workflow_event"("approval_unit", "created_at");

CREATE INDEX "workflow_event_event_type_created_at_idx"
ON "workflow_event"("event_type", "created_at");

CREATE INDEX "workflow_event_record_uid_created_at_idx"
ON "workflow_event"("record_uid", "created_at");

CREATE INDEX "workflow_event_parent_submission_id_created_at_idx"
ON "workflow_event"("parent_submission_id", "created_at");
