-- Phase3CoreReadRls
-- The application runtime role is deliberately not the table owner and has
-- NOBYPASSRLS. The migration owner remains migration-only.
ALTER TABLE "public"."ueb_core_data" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ueb_core_data_phase_3_select"
ON "public"."ueb_core_data"
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM "public"."access_profile" AS profile
        INNER JOIN "public"."role_assignment" AS role_assignment
            ON role_assignment."user_id" = profile."user_id"
           AND role_assignment."revoked_at" IS NULL
        WHERE profile."user_id"::text = current_setting('app.current_user_id', true)
          AND profile."status" = 'ACTIVE'::"public"."access_profile_status"
          AND (
              role_assignment."role" = 'ADMIN'::"public"."business_role"
              OR (
                  role_assignment."role" = 'LECTURER'::"public"."business_role"
                  AND profile."lecturer_uid" = "ueb_core_data"."lecturer_uid"
              )
              OR (
                  role_assignment."role" = 'FACULTY_LEADER'::"public"."business_role"
                  AND EXISTS (
                      SELECT 1
                      FROM "public"."unit_scope_assignment" AS unit_scope
                      INNER JOIN "public"."organization_unit" AS organization_unit
                          ON organization_unit."id" = unit_scope."organization_unit_id"
                         AND organization_unit."is_active" = true
                      WHERE unit_scope."user_id" = profile."user_id"
                        AND unit_scope."revoked_at" IS NULL
                        AND organization_unit."source_value" = "ueb_core_data"."approval_unit"
                  )
              )
          )
    )
);
