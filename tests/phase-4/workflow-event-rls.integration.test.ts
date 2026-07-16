// @vitest-environment node

import "dotenv/config";

import { randomUUID } from "node:crypto";

import {
  Client,
  Pool,
  type ClientBase,
  type PoolClient,
  type QueryResultRow,
} from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  dropPhase4LatestReadModelTestDatabase,
  preparePhase4LatestReadModelTestDatabase,
} from "../../scripts/phase-4/prepare-latest-read-model-test-database";
import {
  readPhase4TestDatabaseUrls,
  type Phase4TestDatabaseUrls,
} from "../../scripts/phase-4/lib/test-database";

const integrationEnabled = process.env.PHASE4_WORKFLOW_RLS_INTEGRATION === "1";
const isolatedDescribe = integrationEnabled
  ? describe.sequential
  : describe.skip;

type Role = "LECTURER" | "FACULTY_LEADER" | "ADMIN";
type ProfileStatus = "ACTIVE" | "DISABLED";

interface TestIdentity {
  readonly userId: string;
  readonly roleId: string;
  readonly lecturerUid: string | null;
  readonly scopeIds: string[];
}

interface WorkflowEventFixture {
  readonly eventId: string;
  readonly submissionId: string;
  readonly eventType: "SUBMITTED" | "REJECTED" | "APPROVED";
  readonly submissionType:
    "CONFIRM_UNCHANGED" | "UPDATE_EXISTING" | "CREATE_NEW" | null;
  readonly recordUid: string;
  readonly lecturerUid: string;
  readonly approvalUnit: string;
  readonly payload: Record<string, unknown> | null;
  readonly payloadChecksum: string | null;
  readonly actorUserId: string;
  readonly reason: string | null;
  readonly resultStt: number | null;
  readonly resultVersionNo: number | null;
}

const UNIT_A = "Phase 4 Test Unit A";
const UNIT_B = "Phase 4 Test Unit B";

let urls: Phase4TestDatabaseUrls;
let owner: Client;
let runtimePool: Pool;
let unitAId: string;
let unitBId: string;
let admin: TestIdentity;
let lecturerA: TestIdentity;
let lecturerB: TestIdentity;
let leaderA: TestIdentity;
let leaderB: TestIdentity;
let multiUnitLeader: TestIdentity;
let noScopeLeader: TestIdentity;
let disabledUser: TestIdentity;
let revocableLecturer: TestIdentity;
let revocableLeader: TestIdentity;
let disabledLecturer: TestIdentity;
let disabledLeader: TestIdentity;
let revokedDecisionLeader: TestIdentity;

isolatedDescribe("Phase 4 isolated workflow_event RLS", () => {
  beforeAll(async () => {
    urls = readPhase4TestDatabaseUrls(process.env);
    await preparePhase4LatestReadModelTestDatabase(process.env);
    owner = new Client({
      connectionString: urls.migrationUrl,
      application_name: "ueb-core-phase4-workflow-rls-owner-test",
    });
    runtimePool = new Pool({
      connectionString: urls.runtimeUrl,
      application_name: "ueb-core-phase4-workflow-rls-runtime-test",
      max: 4,
    });
    await owner.connect();
    await seedFixtures();
    await assertRuntimeBoundary();
  }, 60_000);

  afterAll(async () => {
    await runtimePool?.end().catch(() => undefined);
    await owner?.end().catch(() => undefined);
    if (urls) {
      await dropPhase4LatestReadModelTestDatabase(urls);
    }
  }, 30_000);

  it("1. returns zero rows without request context", async () => {
    await expect(runtimeCount()).resolves.toBe(0);
  });

  it("2. lets lecturer A see events mapped to lecturer A", async () => {
    await expect(runtimeCount(lecturerA.userId)).resolves.toBe(2);
  });

  it("3. hides lecturer B events from lecturer A", async () => {
    await expect(
      runtimeCount(lecturerA.userId, {
        text: "SELECT count(*)::int AS count FROM public.workflow_event WHERE lecturer_uid = $1::uuid",
        values: [lecturerB.lecturerUid],
      }),
    ).resolves.toBe(0);
  });

  it("4. lets the Unit A leader see Unit A events", async () => {
    await expect(runtimeCount(leaderA.userId)).resolves.toBe(3);
  });

  it("5. hides Unit B events from the Unit A leader", async () => {
    await expect(
      runtimeCount(leaderA.userId, {
        text: "SELECT count(*)::int AS count FROM public.workflow_event WHERE approval_unit = $1",
        values: [UNIT_B],
      }),
    ).resolves.toBe(0);
  });

  it("6. gives a multi-unit leader the exact union of both units", async () => {
    await expect(runtimeCount(multiUnitLeader.userId)).resolves.toBe(4);
  });

  it("7. gives a leader without scope zero rows", async () => {
    await expect(runtimeCount(noScopeLeader.userId)).resolves.toBe(0);
  });

  it("8. lets admin see every seeded workflow event", async () => {
    await expect(runtimeCount(admin.userId)).resolves.toBe(4);
  });

  it("9. gives a disabled user zero rows", async () => {
    await expect(runtimeCount(disabledUser.userId)).resolves.toBe(0);
  });

  it("10. removes lecturer SELECT access immediately after role revocation", async () => {
    await expect(runtimeCount(revocableLecturer.userId)).resolves.toBe(1);
    await revokeRole(revocableLecturer);
    await expect(runtimeCount(revocableLecturer.userId)).resolves.toBe(0);
  });

  it("11. removes leader SELECT access immediately after scope revocation", async () => {
    await expect(runtimeCount(revocableLeader.userId)).resolves.toBe(3);
    await revokeScope(revocableLeader, revocableLeader.scopeIds[0]!);
    await expect(runtimeCount(revocableLeader.userId)).resolves.toBe(0);
  });

  it("12. lets lecturer A insert its own SUBMITTED event", async () => {
    const event = submittedEvent(
      lecturerA.lecturerUid!,
      UNIT_A,
      lecturerA.userId,
    );
    await expect(runtimeInsert(lecturerA.userId, event)).resolves.toBe(
      event.eventId,
    );
  });

  it("13. rejects lecturer A impersonating lecturer B", async () => {
    await expect(
      runtimeInsert(
        lecturerA.userId,
        submittedEvent(lecturerB.lecturerUid!, UNIT_B, lecturerA.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("14. rejects a SUBMITTED event whose actor differs from current user", async () => {
    await expect(
      runtimeInsert(
        lecturerA.userId,
        submittedEvent(lecturerA.lecturerUid!, UNIT_A, lecturerB.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("15. rejects SUBMITTED from a disabled lecturer", async () => {
    await expect(
      runtimeInsert(
        disabledLecturer.userId,
        submittedEvent(
          disabledLecturer.lecturerUid!,
          UNIT_A,
          disabledLecturer.userId,
        ),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("16. rejects SUBMITTED from a pure leader", async () => {
    await expect(
      runtimeInsert(
        leaderA.userId,
        submittedEvent(lecturerA.lecturerUid!, UNIT_A, leaderA.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("17. rejects SUBMITTED from a pure admin", async () => {
    await expect(
      runtimeInsert(
        admin.userId,
        submittedEvent(lecturerA.lecturerUid!, UNIT_A, admin.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("18. rejects SUBMITTED without request context", async () => {
    await expect(
      runtimeInsert(
        undefined,
        submittedEvent(lecturerA.lecturerUid!, UNIT_A, lecturerA.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("19. lets a scoped leader insert REJECTED in Unit A", async () => {
    const base = await seedTerminalBase(lecturerA.lecturerUid!, UNIT_A);
    const event = terminalEvent(base, "REJECTED", leaderA.userId);
    await expect(runtimeInsert(leaderA.userId, event)).resolves.toBe(
      event.eventId,
    );
  });

  it("20. lets a scoped leader insert APPROVED in Unit A", async () => {
    const base = await seedTerminalBase(lecturerA.lecturerUid!, UNIT_A);
    const event = terminalEvent(base, "APPROVED", leaderA.userId);
    await expect(runtimeInsert(leaderA.userId, event)).resolves.toBe(
      event.eventId,
    );
  });

  it("21. rejects a Unit A leader decision for Unit B", async () => {
    const base = await seedTerminalBase(lecturerB.lecturerUid!, UNIT_B);
    await expect(
      runtimeInsert(
        leaderA.userId,
        terminalEvent(base, "REJECTED", leaderA.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("22. rejects a terminal event from a pure lecturer", async () => {
    const base = await seedTerminalBase(lecturerA.lecturerUid!, UNIT_A);
    await expect(
      runtimeInsert(
        lecturerA.userId,
        terminalEvent(base, "REJECTED", lecturerA.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("23. lets admin insert a terminal event", async () => {
    const base = await seedTerminalBase(lecturerB.lecturerUid!, UNIT_B);
    const event = terminalEvent(base, "REJECTED", admin.userId);
    await expect(runtimeInsert(admin.userId, event)).resolves.toBe(
      event.eventId,
    );
  });

  it("24. rejects a terminal event whose actor differs from current user", async () => {
    const base = await seedTerminalBase(lecturerA.lecturerUid!, UNIT_A);
    await expect(
      runtimeInsert(
        leaderA.userId,
        terminalEvent(base, "REJECTED", leaderB.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("25. rejects a terminal event from a disabled leader", async () => {
    const base = await seedTerminalBase(lecturerA.lecturerUid!, UNIT_A);
    await expect(
      runtimeInsert(
        disabledLeader.userId,
        terminalEvent(base, "REJECTED", disabledLeader.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("26. rejects a terminal event after leader role and scope revocation", async () => {
    const base = await seedTerminalBase(lecturerA.lecturerUid!, UNIT_A);
    await expect(
      runtimeInsert(
        revokedDecisionLeader.userId,
        terminalEvent(base, "REJECTED", revokedDecisionLeader.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("27. denies runtime UPDATE on workflow_event", async () => {
    await expect(
      runtimePool.query(
        "UPDATE public.workflow_event SET reason = reason WHERE false",
      ),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("28. denies runtime DELETE on workflow_event", async () => {
    await expect(
      runtimePool.query("DELETE FROM public.workflow_event WHERE false"),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("29. denies runtime TRUNCATE on workflow_event", async () => {
    await expect(
      runtimePool.query("TRUNCATE TABLE public.workflow_event"),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("30. creates exactly one approved-workflow core INSERT policy", async () => {
    const result = await owner.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'ueb_core_data'
        AND cmd = 'INSERT'
    `);
    expect(result.rows[0]?.count).toBe(1);
  });

  it("31. grants only column-scoped core INSERT and rejects default rows", async () => {
    const privilege = await runtimePool.query<{
      table_insert: boolean;
      any_column_insert: boolean;
      stt_insert: boolean;
    }>(`
      SELECT has_table_privilege(
        current_user,
        'public.ueb_core_data',
        'INSERT'
      ) AS table_insert,
      has_any_column_privilege(
        current_user,
        'public.ueb_core_data',
        'INSERT'
      ) AS any_column_insert,
      has_column_privilege(
        current_user,
        'public.ueb_core_data',
        'stt',
        'INSERT'
      ) AS stt_insert
    `);
    expect(privilege.rows[0]).toEqual({
      table_insert: false,
      any_column_insert: true,
      stt_insert: false,
    });
    await expect(
      runtimePool.query("INSERT INTO public.ueb_core_data DEFAULT VALUES"),
    ).rejects.toThrow(/permission denied|row-level security/iu);
  });
});

async function seedFixtures(): Promise<void> {
  unitAId = randomUUID();
  unitBId = randomUUID();
  await owner.query(
    `
      INSERT INTO public.organization_unit
        (id, unit_key, source_value, display_name)
      VALUES
        ($1::uuid, 'phase4-test-unit-a', $2, $2),
        ($3::uuid, 'phase4-test-unit-b', $4, $4)
    `,
    [unitAId, UNIT_A, unitBId, UNIT_B],
  );
  await seedCoreFixture();

  admin = await createIdentity("ACTIVE", "ADMIN");
  lecturerA = await createIdentity("ACTIVE", "LECTURER", randomUUID());
  lecturerB = await createIdentity("ACTIVE", "LECTURER", randomUUID());
  leaderA = await createIdentity("ACTIVE", "FACULTY_LEADER");
  leaderB = await createIdentity("ACTIVE", "FACULTY_LEADER");
  multiUnitLeader = await createIdentity("ACTIVE", "FACULTY_LEADER");
  noScopeLeader = await createIdentity("ACTIVE", "FACULTY_LEADER");
  disabledUser = await createIdentity("DISABLED", "ADMIN");
  revocableLecturer = await createIdentity("ACTIVE", "LECTURER", randomUUID());
  revocableLeader = await createIdentity("ACTIVE", "FACULTY_LEADER");
  disabledLecturer = await createIdentity("DISABLED", "LECTURER", randomUUID());
  disabledLeader = await createIdentity("DISABLED", "FACULTY_LEADER");
  revokedDecisionLeader = await createIdentity("ACTIVE", "FACULTY_LEADER");

  await assignUnit(leaderA, unitAId);
  await assignUnit(leaderB, unitBId);
  await assignUnit(multiUnitLeader, unitAId);
  await assignUnit(multiUnitLeader, unitBId);
  await assignUnit(revocableLeader, unitAId);
  await assignUnit(disabledLeader, unitAId);
  await assignUnit(revokedDecisionLeader, unitAId);
  await revokeRole(revokedDecisionLeader);
  await revokeScope(revokedDecisionLeader, revokedDecisionLeader.scopeIds[0]!);

  const submittedA = submittedEvent(
    lecturerA.lecturerUid!,
    UNIT_A,
    lecturerA.userId,
  );
  await insertEvent(owner, submittedA);
  await insertEvent(owner, terminalEvent(submittedA, "REJECTED", admin.userId));
  await insertEvent(
    owner,
    submittedEvent(lecturerB.lecturerUid!, UNIT_B, lecturerB.userId),
  );
  await insertEvent(
    owner,
    submittedEvent(
      revocableLecturer.lecturerUid!,
      UNIT_A,
      revocableLecturer.userId,
    ),
  );
}

async function seedCoreFixture(): Promise<void> {
  const importRunId = randomUUID();
  await owner.query(
    `
      INSERT INTO public.import_run (
        id, source_filename, source_sha256, source_sheet,
        source_contract_version, source_row_count, source_min_stt,
        source_max_stt, canonical_dataset_sha256, report, imported_at
      ) VALUES (
        $1::uuid, 'phase4-workflow-rls-fixture.xlsx', $2, 'fixture',
        'phase4-workflow-rls-test', 1, 1, 1, $3, '{}'::jsonb,
        clock_timestamp()
      )
    `,
    [importRunId, "a".repeat(64), "b".repeat(64)],
  );
  await owner.query(
    `
      INSERT INTO public.ueb_core_data (
        khoi_kien_thuc, lecturer_uid, record_uid, snapshot_id, version_no,
        identity_status, source_row_number, source_row_checksum,
        source_import_run_id, approval_unit, origin, approved_at
      ) VALUES (
        1, $1::uuid, $2::uuid, $3::uuid, 1, 'RESOLVED', 1, $4,
        $5::uuid, $6, 'LEGACY_IMPORT', clock_timestamp()
      )
    `,
    [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      "c".repeat(64),
      importRunId,
      UNIT_A,
    ],
  );
}

async function createIdentity(
  status: ProfileStatus,
  role: Role,
  lecturerUid: string | null = null,
): Promise<TestIdentity> {
  const identity: TestIdentity = {
    userId: randomUUID(),
    roleId: randomUUID(),
    lecturerUid,
    scopeIds: [],
  };
  await owner.query("BEGIN");
  try {
    await owner.query(
      `
        INSERT INTO public.auth_user
          (id, name, email, "emailVerified", "updatedAt")
        VALUES ($1::uuid, 'Phase 4 RLS Test Identity', $2, false, clock_timestamp())
      `,
      [identity.userId, `phase4-${identity.userId}@example.invalid`],
    );
    await owner.query(
      `
        INSERT INTO public.access_profile
          (id, user_id, lecturer_uid, status, updated_at, created_by)
        VALUES ($1::uuid, $2::uuid, $3::uuid,
          $4::public.access_profile_status, clock_timestamp(), $2::uuid)
      `,
      [randomUUID(), identity.userId, lecturerUid, status],
    );
    await owner.query(
      `
        INSERT INTO public.role_assignment
          (id, user_id, role, granted_by)
        VALUES ($1::uuid, $2::uuid, $3::public.business_role, $2::uuid)
      `,
      [identity.roleId, identity.userId, role],
    );
    await owner.query("COMMIT");
    return identity;
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function assignUnit(
  identity: TestIdentity,
  organizationUnitId: string,
): Promise<void> {
  const scopeId = randomUUID();
  await owner.query(
    `
      INSERT INTO public.unit_scope_assignment
        (id, user_id, organization_unit_id, granted_by)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $2::uuid)
    `,
    [scopeId, identity.userId, organizationUnitId],
  );
  identity.scopeIds.push(scopeId);
}

async function revokeRole(identity: TestIdentity): Promise<void> {
  await owner.query(
    `
      UPDATE public.role_assignment
      SET revoked_by = $1::uuid, revoked_at = clock_timestamp()
      WHERE id = $2::uuid
    `,
    [identity.userId, identity.roleId],
  );
}

async function revokeScope(
  identity: TestIdentity,
  scopeId: string,
): Promise<void> {
  await owner.query(
    `
      UPDATE public.unit_scope_assignment
      SET revoked_by = $1::uuid, revoked_at = clock_timestamp()
      WHERE id = $2::uuid
    `,
    [identity.userId, scopeId],
  );
}

async function assertRuntimeBoundary(): Promise<void> {
  const result = await runtimePool.query<{
    runtime_user: string;
    table_owner: string;
    rolbypassrls: boolean;
    can_select: boolean;
    can_insert: boolean;
    can_update: boolean;
    can_delete: boolean;
    can_truncate: boolean;
  }>(`
    SELECT
      current_user AS runtime_user,
      table_row.tableowner AS table_owner,
      role_row.rolbypassrls,
      has_table_privilege(current_user, 'public.workflow_event', 'SELECT') AS can_select,
      has_table_privilege(current_user, 'public.workflow_event', 'INSERT') AS can_insert,
      has_table_privilege(current_user, 'public.workflow_event', 'UPDATE') AS can_update,
      has_table_privilege(current_user, 'public.workflow_event', 'DELETE') AS can_delete,
      has_table_privilege(current_user, 'public.workflow_event', 'TRUNCATE') AS can_truncate
    FROM pg_catalog.pg_roles AS role_row
    CROSS JOIN pg_catalog.pg_tables AS table_row
    WHERE role_row.rolname = current_user
      AND table_row.schemaname = 'public'
      AND table_row.tablename = 'workflow_event'
  `);
  const boundary = result.rows[0];
  expect(boundary?.runtime_user).not.toBe(boundary?.table_owner);
  expect(boundary?.rolbypassrls).toBe(false);
  expect(boundary?.can_select).toBe(true);
  expect(boundary?.can_insert).toBe(true);
  expect(boundary?.can_update).toBe(false);
  expect(boundary?.can_delete).toBe(false);
  expect(boundary?.can_truncate).toBe(false);
}

function submittedEvent(
  lecturerUid: string,
  approvalUnit: string,
  actorUserId: string,
): WorkflowEventFixture {
  return {
    eventId: randomUUID(),
    submissionId: randomUUID(),
    eventType: "SUBMITTED",
    submissionType: "CREATE_NEW",
    recordUid: randomUUID(),
    lecturerUid,
    approvalUnit,
    payload: { fixture: true },
    payloadChecksum: "phase4-workflow-rls-fixture-checksum",
    actorUserId,
    reason: null,
    resultStt: null,
    resultVersionNo: null,
  };
}

function terminalEvent(
  submitted: WorkflowEventFixture,
  eventType: "REJECTED" | "APPROVED",
  actorUserId: string,
): WorkflowEventFixture {
  return {
    eventId: randomUUID(),
    submissionId: submitted.submissionId,
    eventType,
    submissionType: null,
    recordUid: submitted.recordUid,
    lecturerUid: submitted.lecturerUid,
    approvalUnit: submitted.approvalUnit,
    payload: null,
    payloadChecksum: null,
    actorUserId,
    reason: eventType === "REJECTED" ? "Phase 4 RLS fixture rejection" : null,
    resultStt: eventType === "APPROVED" ? 9001 : null,
    resultVersionNo: eventType === "APPROVED" ? 1 : null,
  };
}

async function seedTerminalBase(
  lecturerUid: string,
  approvalUnit: string,
): Promise<WorkflowEventFixture> {
  const base = submittedEvent(lecturerUid, approvalUnit, lecturerA.userId);
  await insertEvent(owner, base);
  return base;
}

async function runtimeCount(
  userId?: string,
  query: { text: string; values: readonly unknown[] } = {
    text: "SELECT count(*)::int AS count FROM public.workflow_event",
    values: [],
  },
): Promise<number> {
  const connection = await runtimePool.connect();
  try {
    await connection.query("BEGIN");
    if (userId) await setCurrentUser(connection, userId);
    const result = await queryWithValues<{ count: number }>(connection, query);
    await connection.query("COMMIT");
    return result.rows[0]?.count ?? -1;
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function runtimeInsert(
  userId: string | undefined,
  event: WorkflowEventFixture,
): Promise<string> {
  const connection = await runtimePool.connect();
  try {
    await connection.query("BEGIN");
    if (userId) await setCurrentUser(connection, userId);
    const result = await insertEvent(connection, event);
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function setCurrentUser(
  connection: PoolClient,
  userId: string,
): Promise<void> {
  await connection.query("SELECT set_config('app.current_user_id', $1, true)", [
    userId,
  ]);
}

async function insertEvent(
  connection: ClientBase,
  event: WorkflowEventFixture,
): Promise<string> {
  const result = await connection.query<{ event_id: string }>(
    `
      INSERT INTO public.workflow_event (
        event_id, submission_id, event_type, submission_type, record_uid,
        lecturer_uid, approval_unit, payload, payload_checksum, actor_user_id,
        reason, result_stt, result_version_no
      ) VALUES (
        $1::uuid, $2::uuid, $3::public.workflow_event_type,
        $4::public.workflow_submission_type, $5::uuid, $6::uuid, $7,
        $8::jsonb, $9, $10::uuid, $11, $12, $13
      )
      RETURNING event_id::text
    `,
    [
      event.eventId,
      event.submissionId,
      event.eventType,
      event.submissionType,
      event.recordUid,
      event.lecturerUid,
      event.approvalUnit,
      event.payload ? JSON.stringify(event.payload) : null,
      event.payloadChecksum,
      event.actorUserId,
      event.reason,
      event.resultStt,
      event.resultVersionNo,
    ],
  );
  const eventId = result.rows[0]?.event_id;
  if (!eventId) throw new Error("Workflow fixture insert returned no event.");
  return eventId;
}

function queryWithValues<Row extends QueryResultRow>(
  connection: PoolClient,
  query: { text: string; values: readonly unknown[] },
) {
  return connection.query<Row>(query.text, [...query.values]);
}
