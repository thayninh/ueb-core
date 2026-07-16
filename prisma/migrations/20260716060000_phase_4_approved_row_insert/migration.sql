-- Phase4ApprovedRowInsert
-- Approved workflow rows use database-generated identity, snapshot and time
-- metadata. Legacy provenance remains mandatory for the legacy import path and
-- nullable only for APPROVED_SUBMISSION rows validated by the trigger below.
ALTER TABLE "public"."ueb_core_data"
  ALTER COLUMN "snapshot_id" SET DEFAULT pg_catalog.gen_random_uuid(),
  ALTER COLUMN "identity_status" SET DEFAULT 'RESOLVED',
  ALTER COLUMN "source_row_number" DROP NOT NULL,
  ALTER COLUMN "source_row_checksum" DROP NOT NULL,
  ALTER COLUMN "source_import_run_id" DROP NOT NULL,
  ALTER COLUMN "approved_at" SET DEFAULT clock_timestamp();

-- A logical record may have only one row for each version, independently of
-- any forged lecturer identity.
CREATE UNIQUE INDEX "ueb_core_data_record_uid_version_no_key"
ON "public"."ueb_core_data"("record_uid", "version_no");

-- Reconstruct the exact application canonical JSON order. The function does
-- not include stt, base/result metadata or technical fields.
CREATE FUNCTION "public"."phase4_row_submission_canonical_json"("row_payload" JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT concat(
    '{',
    '"don_vi_phu_trach_hoc_phan":', coalesce(("row_payload" -> 'don_vi_phu_trach_hoc_phan')::text, 'null'), ',',
    '"bo_mon_phu_trach_hoc_phan":', coalesce(("row_payload" -> 'bo_mon_phu_trach_hoc_phan')::text, 'null'), ',',
    '"khoi_kien_thuc":', coalesce(("row_payload" -> 'khoi_kien_thuc')::text, 'null'), ',',
    '"ma_hoc_phan":', coalesce(("row_payload" -> 'ma_hoc_phan')::text, 'null'), ',',
    '"ten_hoc_phan":', coalesce(("row_payload" -> 'ten_hoc_phan')::text, 'null'), ',',
    '"ten_giang_vien":', coalesce(("row_payload" -> 'ten_giang_vien')::text, 'null'), ',',
    '"ma_so_can_bo":', coalesce(("row_payload" -> 'ma_so_can_bo')::text, 'null'), ',',
    '"email_tai_khoan_vnu":', coalesce(("row_payload" -> 'email_tai_khoan_vnu')::text, 'null'), ',',
    '"bo_mon":', coalesce(("row_payload" -> 'bo_mon')::text, 'null'), ',',
    '"don_vi":', coalesce(("row_payload" -> 'don_vi')::text, 'null'), ',',
    '"core_1_2_3":', coalesce(("row_payload" -> 'core_1_2_3')::text, 'null'), ',',
    '"tc1_tro_giang":', coalesce(("row_payload" -> 'tc1_tro_giang')::text, 'null'), ',',
    '"tc2_sh_chuyen_mon":', coalesce(("row_payload" -> 'tc2_sh_chuyen_mon')::text, 'null'), ',',
    '"tc3_tong_hop":', coalesce(("row_payload" -> 'tc3_tong_hop')::text, 'null'), ',',
    '"tc3_1_nganh_tot_nghiep_phu_hop":', coalesce(("row_payload" -> 'tc3_1_nganh_tot_nghiep_phu_hop')::text, 'null'), ',',
    '"tc3_2_bien_soan_de_cuong_giao_trinh":', coalesce(("row_payload" -> 'tc3_2_bien_soan_de_cuong_giao_trinh')::text, 'null'), ',',
    '"tc3_3_chu_nhiem_de_tai_nckh_lien_quan":', coalesce(("row_payload" -> 'tc3_3_chu_nhiem_de_tai_nckh_lien_quan')::text, 'null'), ',',
    '"tc3_4_bai_bao_lien_quan":', coalesce(("row_payload" -> 'tc3_4_bai_bao_lien_quan')::text, 'null'), ',',
    '"tc4_giang_thu":', coalesce(("row_payload" -> 'tc4_giang_thu')::text, 'null'),
    '}'
  )
$$;

CREATE FUNCTION "public"."phase4_row_submission_checksum"("row_payload" JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        "public"."phase4_row_submission_canonical_json"("row_payload"),
        'UTF8'
      )
    ),
    'hex'
  )
$$;

-- The policy is deliberately independent of an APPROVED event: the core row
-- is inserted first and the terminal event is appended from INSERT RETURNING.
CREATE POLICY "ueb_core_data_phase_4_insert_approved"
ON "public"."ueb_core_data"
FOR INSERT
WITH CHECK (
  current_setting('app.current_user_id', true) IS NOT NULL
  AND "origin" = 'APPROVED_SUBMISSION'
  AND "source_submission_id" IS NOT NULL
  AND "approved_by"::text = current_setting('app.current_user_id', true)
  AND "source_row_number" IS NULL
  AND "source_row_checksum" IS NULL
  AND "source_import_run_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "public"."access_profile" AS "profile"
    INNER JOIN "public"."role_assignment" AS "role_assignment"
      ON "role_assignment"."user_id" = "profile"."user_id"
     AND "role_assignment"."revoked_at" IS NULL
    WHERE "profile"."user_id"::text = current_setting('app.current_user_id', true)
      AND "profile"."status" = 'ACTIVE'::"public"."access_profile_status"
      AND (
        "role_assignment"."role" = 'ADMIN'::"public"."business_role"
        OR (
          "role_assignment"."role" = 'FACULTY_LEADER'::"public"."business_role"
          AND EXISTS (
            SELECT 1
            FROM "public"."unit_scope_assignment" AS "unit_scope"
            INNER JOIN "public"."organization_unit" AS "organization_unit"
              ON "organization_unit"."id" = "unit_scope"."organization_unit_id"
             AND "organization_unit"."is_active" = true
            WHERE "unit_scope"."user_id" = "profile"."user_id"
              AND "unit_scope"."revoked_at" IS NULL
              AND "organization_unit"."source_value" = "ueb_core_data"."approval_unit"
          )
        )
      )
  )
  AND 1 = (
    SELECT count(*)
    FROM "public"."workflow_event" AS "submitted"
    WHERE "submitted"."submission_id" = "ueb_core_data"."source_submission_id"
      AND "submitted"."event_type" = 'SUBMITTED'::"public"."workflow_event_type"
      AND "submitted"."lecturer_uid" = "ueb_core_data"."lecturer_uid"
      AND "submitted"."record_uid" = "ueb_core_data"."record_uid"
      AND "submitted"."approval_unit" = "ueb_core_data"."approval_unit"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "public"."workflow_event" AS "terminal"
    WHERE "terminal"."submission_id" = "ueb_core_data"."source_submission_id"
      AND "terminal"."event_type" IN (
        'APPROVED'::"public"."workflow_event_type",
        'REJECTED'::"public"."workflow_event_type"
      )
  )
);

CREATE FUNCTION "public"."validate_phase4_approved_core_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "current_actor" UUID;
  "submitted_count" INTEGER;
  "submitted_event" "public"."workflow_event"%ROWTYPE;
  "current_core" "public"."ueb_core_data"%ROWTYPE;
BEGIN
  IF NEW."source_submission_id" IS NULL THEN
    IF NEW."origin" = 'APPROVED_SUBMISSION' THEN
      RAISE EXCEPTION 'Approved workflow row requires source submission metadata';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."origin" <> 'APPROVED_SUBMISSION'
     OR NEW."source_row_number" IS NOT NULL
     OR NEW."source_row_checksum" IS NOT NULL
     OR NEW."source_import_run_id" IS NOT NULL
     OR NEW."identity_status" <> 'RESOLVED'
     OR NEW."snapshot_id" IS NULL
     OR NEW."approved_at" IS NULL THEN
    RAISE EXCEPTION 'Approved workflow row has invalid server metadata';
  END IF;

  "current_actor" := nullif(current_setting('app.current_user_id', true), '')::uuid;
  IF "current_actor" IS NULL OR NEW."approved_by" IS DISTINCT FROM "current_actor" THEN
    RAISE EXCEPTION 'Approved workflow actor does not match request context';
  END IF;

  SELECT count(*)::integer
  INTO "submitted_count"
  FROM "public"."workflow_event" AS "submitted"
  WHERE "submitted"."submission_id" = NEW."source_submission_id"
    AND "submitted"."event_type" = 'SUBMITTED'::"public"."workflow_event_type";

  IF "submitted_count" <> 1 THEN
    RAISE EXCEPTION 'Approved workflow row requires exactly one submitted event';
  END IF;

  SELECT *
  INTO STRICT "submitted_event"
  FROM "public"."workflow_event" AS "submitted"
  WHERE "submitted"."submission_id" = NEW."source_submission_id"
    AND "submitted"."event_type" = 'SUBMITTED'::"public"."workflow_event_type";

  IF EXISTS (
    SELECT 1
    FROM "public"."workflow_event" AS "terminal"
    WHERE "terminal"."submission_id" = NEW."source_submission_id"
      AND "terminal"."event_type" IN (
        'APPROVED'::"public"."workflow_event_type",
        'REJECTED'::"public"."workflow_event_type"
      )
  ) THEN
    RAISE EXCEPTION 'Approved workflow row cannot follow a terminal event';
  END IF;

  IF "submitted_event"."submission_type" IS NULL
     OR "submitted_event"."payload" IS NULL
     OR jsonb_typeof("submitted_event"."payload") <> 'object'
     OR (
       SELECT count(*)
       FROM jsonb_object_keys("submitted_event"."payload")
     ) <> 19
     OR NOT "submitted_event"."payload" ?& ARRAY[
       'don_vi_phu_trach_hoc_phan',
       'bo_mon_phu_trach_hoc_phan',
       'khoi_kien_thuc',
       'ma_hoc_phan',
       'ten_hoc_phan',
       'ten_giang_vien',
       'ma_so_can_bo',
       'email_tai_khoan_vnu',
       'bo_mon',
       'don_vi',
       'core_1_2_3',
       'tc1_tro_giang',
       'tc2_sh_chuyen_mon',
       'tc3_tong_hop',
       'tc3_1_nganh_tot_nghiep_phu_hop',
       'tc3_2_bien_soan_de_cuong_giao_trinh',
       'tc3_3_chu_nhiem_de_tai_nckh_lien_quan',
       'tc3_4_bai_bao_lien_quan',
       'tc4_giang_thu'
     ]::text[]
     OR jsonb_typeof("submitted_event"."payload" -> 'khoi_kien_thuc') <> 'number'
     OR ("submitted_event"."payload" ->> 'khoi_kien_thuc') !~ '^-?(0|[1-9][0-9]*)$'
     OR "submitted_event"."payload_checksum" IS DISTINCT FROM
        "public"."phase4_row_submission_checksum"("submitted_event"."payload") THEN
    RAISE EXCEPTION 'Submitted workflow payload or checksum is invalid';
  END IF;

  IF NEW."lecturer_uid" IS DISTINCT FROM "submitted_event"."lecturer_uid"
     OR NEW."record_uid" IS DISTINCT FROM "submitted_event"."record_uid"
     OR NEW."approval_unit" IS DISTINCT FROM "submitted_event"."approval_unit" THEN
    RAISE EXCEPTION 'Approved workflow identity or routing does not match submission';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "public"."access_profile" AS "profile"
    INNER JOIN "public"."role_assignment" AS "role_assignment"
      ON "role_assignment"."user_id" = "profile"."user_id"
     AND "role_assignment"."revoked_at" IS NULL
    WHERE "profile"."user_id" = "current_actor"
      AND "profile"."status" = 'ACTIVE'::"public"."access_profile_status"
      AND (
        "role_assignment"."role" = 'ADMIN'::"public"."business_role"
        OR (
          "role_assignment"."role" = 'FACULTY_LEADER'::"public"."business_role"
          AND EXISTS (
            SELECT 1
            FROM "public"."unit_scope_assignment" AS "unit_scope"
            INNER JOIN "public"."organization_unit" AS "organization_unit"
              ON "organization_unit"."id" = "unit_scope"."organization_unit_id"
             AND "organization_unit"."is_active" = true
            WHERE "unit_scope"."user_id" = "profile"."user_id"
              AND "unit_scope"."revoked_at" IS NULL
              AND "organization_unit"."source_value" = NEW."approval_unit"
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Approved workflow actor is outside the decision scope';
  END IF;

  -- Exactly 19 payload fields; generated stt is intentionally absent.
  IF coalesce(to_jsonb(NEW."don_vi_phu_trach_hoc_phan"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'don_vi_phu_trach_hoc_phan'
     OR coalesce(to_jsonb(NEW."bo_mon_phu_trach_hoc_phan"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'bo_mon_phu_trach_hoc_phan'
     OR coalesce(to_jsonb(NEW."khoi_kien_thuc"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'khoi_kien_thuc'
     OR coalesce(to_jsonb(NEW."ma_hoc_phan"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'ma_hoc_phan'
     OR coalesce(to_jsonb(NEW."ten_hoc_phan"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'ten_hoc_phan'
     OR coalesce(to_jsonb(NEW."ten_giang_vien"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'ten_giang_vien'
     OR coalesce(to_jsonb(NEW."ma_so_can_bo"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'ma_so_can_bo'
     OR coalesce(to_jsonb(NEW."email_tai_khoan_vnu"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'email_tai_khoan_vnu'
     OR coalesce(to_jsonb(NEW."bo_mon"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'bo_mon'
     OR coalesce(to_jsonb(NEW."don_vi"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'don_vi'
     OR coalesce(to_jsonb(NEW."core_1_2_3"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'core_1_2_3'
     OR coalesce(to_jsonb(NEW."tc1_tro_giang"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'tc1_tro_giang'
     OR coalesce(to_jsonb(NEW."tc2_sh_chuyen_mon"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'tc2_sh_chuyen_mon'
     OR coalesce(to_jsonb(NEW."tc3_tong_hop"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'tc3_tong_hop'
     OR coalesce(to_jsonb(NEW."tc3_1_nganh_tot_nghiep_phu_hop"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'tc3_1_nganh_tot_nghiep_phu_hop'
     OR coalesce(to_jsonb(NEW."tc3_2_bien_soan_de_cuong_giao_trinh"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'tc3_2_bien_soan_de_cuong_giao_trinh'
     OR coalesce(to_jsonb(NEW."tc3_3_chu_nhiem_de_tai_nckh_lien_quan"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'tc3_3_chu_nhiem_de_tai_nckh_lien_quan'
     OR coalesce(to_jsonb(NEW."tc3_4_bai_bao_lien_quan"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'tc3_4_bai_bao_lien_quan'
     OR coalesce(to_jsonb(NEW."tc4_giang_thu"), 'null'::jsonb) IS DISTINCT FROM "submitted_event"."payload" -> 'tc4_giang_thu' THEN
    RAISE EXCEPTION 'Approved workflow row does not match the 19-field payload';
  END IF;

  IF "submitted_event"."submission_type" IN (
    'CONFIRM_UNCHANGED'::"public"."workflow_submission_type",
    'UPDATE_EXISTING'::"public"."workflow_submission_type"
  ) THEN
    SELECT *
    INTO "current_core"
    FROM "public"."ueb_core_data" AS "core"
    WHERE "core"."record_uid" = NEW."record_uid"
    ORDER BY "core"."version_no" DESC, "core"."stt" DESC
    LIMIT 1;

    IF NOT FOUND
       OR "current_core"."stt" IS DISTINCT FROM "submitted_event"."base_stt"
       OR "current_core"."version_no" IS DISTINCT FROM "submitted_event"."base_version_no"
       OR "current_core"."lecturer_uid" IS DISTINCT FROM "submitted_event"."lecturer_uid"
       OR "current_core"."approval_unit" IS DISTINCT FROM "submitted_event"."approval_unit"
       OR NEW."version_no" IS DISTINCT FROM "current_core"."version_no" + 1
       OR NEW."ten_giang_vien" IS DISTINCT FROM "current_core"."ten_giang_vien"
       OR NEW."ma_so_can_bo" IS DISTINCT FROM "current_core"."ma_so_can_bo"
       OR NEW."email_tai_khoan_vnu" IS DISTINCT FROM "current_core"."email_tai_khoan_vnu"
       OR NEW."bo_mon" IS DISTINCT FROM "current_core"."bo_mon"
       OR NEW."don_vi" IS DISTINCT FROM "current_core"."don_vi" THEN
      RAISE EXCEPTION 'Approved existing-row submission has a stale or invalid base';
    END IF;

    IF "submitted_event"."submission_type" = 'CONFIRM_UNCHANGED'::"public"."workflow_submission_type"
       AND (
         NEW."don_vi_phu_trach_hoc_phan" IS DISTINCT FROM "current_core"."don_vi_phu_trach_hoc_phan"
         OR NEW."bo_mon_phu_trach_hoc_phan" IS DISTINCT FROM "current_core"."bo_mon_phu_trach_hoc_phan"
         OR NEW."khoi_kien_thuc" IS DISTINCT FROM "current_core"."khoi_kien_thuc"
         OR NEW."ma_hoc_phan" IS DISTINCT FROM "current_core"."ma_hoc_phan"
         OR NEW."ten_hoc_phan" IS DISTINCT FROM "current_core"."ten_hoc_phan"
         OR NEW."core_1_2_3" IS DISTINCT FROM "current_core"."core_1_2_3"
         OR NEW."tc1_tro_giang" IS DISTINCT FROM "current_core"."tc1_tro_giang"
         OR NEW."tc2_sh_chuyen_mon" IS DISTINCT FROM "current_core"."tc2_sh_chuyen_mon"
         OR NEW."tc3_tong_hop" IS DISTINCT FROM "current_core"."tc3_tong_hop"
         OR NEW."tc3_1_nganh_tot_nghiep_phu_hop" IS DISTINCT FROM "current_core"."tc3_1_nganh_tot_nghiep_phu_hop"
         OR NEW."tc3_2_bien_soan_de_cuong_giao_trinh" IS DISTINCT FROM "current_core"."tc3_2_bien_soan_de_cuong_giao_trinh"
         OR NEW."tc3_3_chu_nhiem_de_tai_nckh_lien_quan" IS DISTINCT FROM "current_core"."tc3_3_chu_nhiem_de_tai_nckh_lien_quan"
         OR NEW."tc3_4_bai_bao_lien_quan" IS DISTINCT FROM "current_core"."tc3_4_bai_bao_lien_quan"
         OR NEW."tc4_giang_thu" IS DISTINCT FROM "current_core"."tc4_giang_thu"
       ) THEN
      RAISE EXCEPTION 'Confirmed row content differs from the current core row';
    END IF;
  ELSIF "submitted_event"."submission_type" = 'CREATE_NEW'::"public"."workflow_submission_type" THEN
    IF "submitted_event"."base_stt" IS NOT NULL
       OR "submitted_event"."base_version_no" IS NOT NULL
       OR NEW."version_no" <> 1
       OR EXISTS (
         SELECT 1
         FROM "public"."ueb_core_data" AS "core"
         WHERE "core"."record_uid" = NEW."record_uid"
       ) THEN
      RAISE EXCEPTION 'Approved create-new submission has invalid base or version';
    END IF;
  ELSE
    RAISE EXCEPTION 'Approved workflow submission type is invalid';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ueb_core_data_validate_phase_4_approved_insert"
BEFORE INSERT ON "public"."ueb_core_data"
FOR EACH ROW
EXECUTE FUNCTION "public"."validate_phase4_approved_core_insert"();
