-- Phase4WorkflowEventRls
-- The application runtime role is deliberately not the table owner and has
-- NOBYPASSRLS. Request identity remains transaction-local in
-- app.current_user_id; lecturer and unit scope are resolved from RBAC tables.
ALTER TABLE "public"."workflow_event" ENABLE ROW LEVEL SECURITY;

-- Active ADMIN sees all workflow events. Active LECTURER sees its mapped
-- lecturer events. Active FACULTY_LEADER sees events in exact active scopes.
CREATE POLICY "workflow_event_phase_4_select"
ON "public"."workflow_event"
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
                  AND profile."lecturer_uid" = "workflow_event"."lecturer_uid"
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
                        AND organization_unit."source_value" = "workflow_event"."approval_unit"
                  )
              )
          )
    )
);

-- Only an active lecturer may append its own SUBMITTED event. The active unit
-- check permits unassigned units while rejecting non-canonical unit strings.
CREATE POLICY "workflow_event_phase_4_insert_submitted"
ON "public"."workflow_event"
FOR INSERT
WITH CHECK (
    "event_type" = 'SUBMITTED'::"public"."workflow_event_type"
    AND "actor_user_id"::text = current_setting('app.current_user_id', true)
    AND EXISTS (
        SELECT 1
        FROM "public"."access_profile" AS profile
        INNER JOIN "public"."role_assignment" AS role_assignment
            ON role_assignment."user_id" = profile."user_id"
           AND role_assignment."revoked_at" IS NULL
           AND role_assignment."role" = 'LECTURER'::"public"."business_role"
        WHERE profile."user_id"::text = current_setting('app.current_user_id', true)
          AND profile."status" = 'ACTIVE'::"public"."access_profile_status"
          AND profile."lecturer_uid" IS NOT NULL
          AND profile."lecturer_uid" = "workflow_event"."lecturer_uid"
    )
    AND EXISTS (
        SELECT 1
        FROM "public"."organization_unit" AS organization_unit
        WHERE organization_unit."is_active" = true
          AND organization_unit."source_value" = "workflow_event"."approval_unit"
    )
);

-- An active ADMIN may append any terminal decision. An active
-- FACULTY_LEADER may append a decision only for an exact active unit scope.
CREATE POLICY "workflow_event_phase_4_insert_terminal"
ON "public"."workflow_event"
FOR INSERT
WITH CHECK (
    "event_type" IN (
        'APPROVED'::"public"."workflow_event_type",
        'REJECTED'::"public"."workflow_event_type"
    )
    AND "actor_user_id"::text = current_setting('app.current_user_id', true)
    AND EXISTS (
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
                  role_assignment."role" = 'FACULTY_LEADER'::"public"."business_role"
                  AND EXISTS (
                      SELECT 1
                      FROM "public"."unit_scope_assignment" AS unit_scope
                      INNER JOIN "public"."organization_unit" AS organization_unit
                          ON organization_unit."id" = unit_scope."organization_unit_id"
                         AND organization_unit."is_active" = true
                      WHERE unit_scope."user_id" = profile."user_id"
                        AND unit_scope."revoked_at" IS NULL
                        AND organization_unit."source_value" = "workflow_event"."approval_unit"
                  )
              )
          )
    )
);
