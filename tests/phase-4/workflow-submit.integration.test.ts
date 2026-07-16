// @vitest-environment node

import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";

import { Client, Pool, type PoolClient } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { AccessProfileStatus, BusinessRole } from "@/generated/prisma/client";
import type { Principal } from "@/lib/auth/principal";
import type {
  EditableBusinessFields,
  RowSubmissionPayload,
} from "@/lib/workflow/types";
import {
  dropPhase4LatestReadModelTestDatabase,
  preparePhase4LatestReadModelTestDatabase,
} from "../../scripts/phase-4/prepare-latest-read-model-test-database";
import type { Phase4TestDatabaseUrls } from "../../scripts/phase-4/lib/test-database";

const auth = vi.hoisted(() => ({
  principal: null as Principal | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/authorization", () => ({
  requireLecturerIdentity: async () => {
    const principal = auth.principal;
    if (
      !principal ||
      principal.status !== AccessProfileStatus.ACTIVE ||
      !principal.roles.includes(BusinessRole.LECTURER) ||
      !principal.lecturerUid
    ) {
      throw new Error("FORBIDDEN");
    }
    return principal as Principal & { lecturerUid: string };
  },
}));

type SubmitModule = typeof import("@/lib/workflow/submit-service");
type LockModule = typeof import("@/lib/workflow/locks");
type PrismaModule = typeof import("@/lib/server/prisma");
type PostgresModule = typeof import("@/lib/server/postgres");

interface IdentityFixture {
  readonly userId: string;
  readonly lecturerUid: string;
  readonly roles: readonly BusinessRole[];
  readonly status: AccessProfileStatus;
}

interface CoreFixture {
  readonly recordUid: string;
  readonly stt: number;
  readonly versionNo: number;
  readonly lecturerUid: string;
  readonly approvalUnit: string | null;
}

interface IdentityFields {
  readonly ten_giang_vien: string | null;
  readonly ma_so_can_bo: string | null;
  readonly email_tai_khoan_vnu: string | null;
  readonly bo_mon: string | null;
  readonly don_vi: string | null;
}

interface EventRow {
  readonly event_id: string;
  readonly submission_id: string;
  readonly parent_submission_id: string | null;
  readonly event_type: string;
  readonly submission_type: string | null;
  readonly record_uid: string;
  readonly lecturer_uid: string;
  readonly approval_unit: string;
  readonly base_stt: number | null;
  readonly base_version_no: number | null;
  readonly payload: Record<string, unknown> | null;
  readonly payload_checksum: string | null;
  readonly actor_user_id: string;
  readonly reason: string | null;
  readonly result_stt: number | null;
  readonly result_version_no: number | null;
}

const UNIT_A = "Phase 4 Submit Unit A";
const UNIT_B = "Phase 4 Submit Unit B";
const IDENTITY_A = {
  ten_giang_vien: "Lecturer A",
  ma_so_can_bo: "P4-A",
  email_tai_khoan_vnu: "lecturer-a@example.invalid",
  bo_mon: "Department A",
  don_vi: "Faculty A",
} as const;

let urls: Phase4TestDatabaseUrls;
let owner: Client;
let runtimePool: Pool;
let submit: SubmitModule;
let locks: LockModule;
let prismaModule: PrismaModule;
let postgresModule: PostgresModule;
let importRunId: string;
let lecturerA: IdentityFixture;
let lecturerB: IdentityFixture;
let noRoleUser: IdentityFixture;
let disabledLecturer: IdentityFixture;
let noUnitLecturer: IdentityFixture;
let multiUnitLecturer: IdentityFixture;
let recordsA: CoreFixture[];
let recordB: CoreFixture;
let initialCoreCount = 0;
let intentionalCoreFixtureWrites = 0;
let confirmSubmissionId: string;
let updateSubmissionId: string;
let createSubmissionId: string;
let createRecordUid: string;
let updateEventBeforeMutation: EventRow;
let rejectedExistingParentId: string;
let rejectedCreateParentId: string;
let rejectedCreateRecordUid: string;

describe.sequential("Phase 4 isolated lecturer row submission service", () => {
  beforeAll(async () => {
    urls = await preparePhase4LatestReadModelTestDatabase(process.env);
    owner = new Client({
      connectionString: urls.migrationUrl,
      application_name: "ueb-core-phase4-submit-owner-test",
    });
    runtimePool = new Pool({
      connectionString: urls.runtimeUrl,
      application_name: "ueb-core-phase4-submit-runtime-test",
      max: 12,
    });
    await owner.connect();
    await seedFixtures();
    initialCoreCount = await coreCount();

    process.env.DATABASE_URL = urls.runtimeUrl;
    vi.resetModules();
    submit = await import("@/lib/workflow/submit-service");
    locks = await import("@/lib/workflow/locks");
    prismaModule = await import("@/lib/server/prisma");
    postgresModule = await import("@/lib/server/postgres");
  }, 60_000);

  beforeEach(() => {
    auth.principal = principal(lecturerA);
  });

  afterAll(async () => {
    if (!urls) return;
    await prismaModule
      ?.getPrismaClient()
      .$disconnect()
      .catch(() => undefined);
    await postgresModule
      ?.getPostgresPool()
      .end()
      .catch(() => undefined);
    await runtimePool?.end().catch(() => undefined);
    await owner?.end().catch(() => undefined);
    await dropPhase4LatestReadModelTestDatabase(urls);
  }, 30_000);

  it("uses deterministic, namespace-separated advisory lock resources", () => {
    const id = randomUUID();
    expect(locks.workflowLockResource("submission", id)).toBe(
      locks.workflowLockResource("submission", id),
    );
    expect(locks.workflowLockResource("submission", id)).not.toBe(
      locks.workflowLockResource("record", id),
    );
  });

  it("1. CONFIRM_UNCHANGED creates exactly one SUBMITTED event", async () => {
    confirmSubmissionId = randomUUID();
    const result = await submit.submitUnchangedRow(
      unchangedInput(recordsA[0]!, confirmSubmissionId),
    );
    expect(result).toMatchObject({
      submissionId: confirmSubmissionId,
      submissionType: "CONFIRM_UNCHANGED",
      recordUid: recordsA[0]!.recordUid,
      state: "PENDING",
    });
    expect(await eventCount(confirmSubmissionId)).toBe(1);
    expect((await event(confirmSubmissionId)).event_type).toBe("SUBMITTED");
  });

  it("2. stores exactly nineteen CONFIRM_UNCHANGED payload fields", async () => {
    expect(
      Object.keys((await event(confirmSubmissionId)).payload ?? {}),
    ).toHaveLength(19);
  });

  it("3. excludes STT from the CONFIRM_UNCHANGED payload", async () => {
    expect((await event(confirmSubmissionId)).payload).not.toHaveProperty(
      "stt",
    );
  });

  it("4. stores base STT and version as event metadata", async () => {
    expect(await event(confirmSubmissionId)).toMatchObject({
      base_stt: recordsA[0]!.stt,
      base_version_no: recordsA[0]!.versionNo,
    });
  });

  it("5. derives the approval unit from the latest core row", async () => {
    expect((await event(confirmSubmissionId)).approval_unit).toBe(UNIT_A);
  });

  it("6. does not change core during CONFIRM_UNCHANGED", async () => {
    expect(await coreCount()).toBe(initialCoreCount);
  });

  it("7. UPDATE_EXISTING stores all fourteen editable values", async () => {
    updateSubmissionId = randomUUID();
    const editable = editableFields("update");
    await submit.submitUpdatedRow(
      updateInput(recordsA[1]!, updateSubmissionId, editable),
    );
    const payload = (await event(updateSubmissionId)).payload!;
    for (const [field, value] of Object.entries(editable)) {
      expect(payload[field]).toBe(value);
    }
  });

  it("8. UPDATE_EXISTING takes five read-only identity fields from DB", async () => {
    const payload = (await event(updateSubmissionId)).payload!;
    expect(payload).toMatchObject(IDENTITY_A);
  });

  it("9. rejects read-only tampering in editableFields", async () => {
    await expect(
      submit.submitUpdatedRow({
        ...updateInput(recordsA[2]!, randomUUID(), editableFields("readonly")),
        editableFields: {
          ...editableFields("readonly"),
          ten_giang_vien: "Forged lecturer",
        },
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_INVALID_PAYLOAD" });
  });

  it("10. rejects technical-field tampering", async () => {
    await expect(
      submit.submitUpdatedRow({
        ...updateInput(recordsA[2]!, randomUUID(), editableFields("technical")),
        approvalUnit: UNIT_B,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_INVALID_PAYLOAD" });
  });

  it("11. excludes STT from UPDATE_EXISTING payload", async () => {
    expect((await event(updateSubmissionId)).payload).not.toHaveProperty("stt");
  });

  it("12. does not write core during UPDATE_EXISTING", async () => {
    expect(await coreCount()).toBe(initialCoreCount);
    updateEventBeforeMutation = await event(updateSubmissionId);
  });

  it("13. CREATE_NEW generates record UID on the server", async () => {
    createSubmissionId = randomUUID();
    const result = await submit.submitNewRow({
      submissionId: createSubmissionId,
      editableFields: editableFields("create"),
    });
    createRecordUid = result.recordUid;
    expect(createRecordUid).toMatch(/^[0-9a-f-]{36}$/u);
    expect(createRecordUid).not.toBe(createSubmissionId);
  });

  it("14. CREATE_NEW stores null base metadata", async () => {
    expect(await event(createSubmissionId)).toMatchObject({
      base_stt: null,
      base_version_no: null,
    });
  });

  it("15. excludes STT from CREATE_NEW payload", async () => {
    expect((await event(createSubmissionId)).payload).not.toHaveProperty("stt");
  });

  it("16. resolves CREATE_NEW approval unit from all latest lecturer rows", async () => {
    expect((await event(createSubmissionId)).approval_unit).toBe(UNIT_A);
  });

  it("17. blocks CREATE_NEW when the lecturer has no current unit", async () => {
    auth.principal = principal(noUnitLecturer);
    await expect(
      submit.submitNewRow({
        submissionId: randomUUID(),
        editableFields: editableFields("no-unit"),
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_UNIT_UNRESOLVED" });
  });

  it("18. blocks CREATE_NEW when latest rows have multiple units", async () => {
    auth.principal = principal(multiUnitLecturer);
    await expect(
      submit.submitNewRow({
        submissionId: randomUUID(),
        editableFields: editableFields("multi-unit"),
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_UNIT_UNRESOLVED" });
  });

  it("19. rejects a client record UID in CREATE_NEW", async () => {
    await expect(
      submit.submitNewRow({
        submissionId: randomUUID(),
        recordUid: randomUUID(),
        editableFields: editableFields("forged-record"),
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_INVALID_PAYLOAD" });
  });

  it("20. prevents lecturer A from submitting lecturer B's record", async () => {
    await expect(
      submit.submitUnchangedRow(unchangedInput(recordB, randomUUID())),
    ).rejects.toMatchObject({ code: "WORKFLOW_RECORD_NOT_FOUND" });
  });

  it("21. blocks a disabled lecturer", async () => {
    auth.principal = principal(disabledLecturer);
    await expect(
      submit.submitNewRow({
        submissionId: randomUUID(),
        editableFields: editableFields("disabled"),
      }),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("22. blocks a user without the lecturer role", async () => {
    auth.principal = principal(noRoleUser);
    await expect(
      submit.submitNewRow({
        submissionId: randomUUID(),
        editableFields: editableFields("no-role"),
      }),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("23. RLS rejects actor and lecturer mismatch", async () => {
    await expect(
      runtimeInsertSubmitted(
        lecturerA.userId,
        directSubmittedEvent(lecturerB.lecturerUid, lecturerA.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("24. RLS rejects SUBMITTED without request context", async () => {
    await expect(
      runtimeInsertSubmitted(
        null,
        directSubmittedEvent(lecturerA.lecturerUid, lecturerA.userId),
      ),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("25. allows at most one pending submission per record", async () => {
    await submit.submitUnchangedRow(unchangedInput(recordsA[3]!, randomUUID()));
    await expect(
      submit.submitUpdatedRow(
        updateInput(recordsA[3]!, randomUUID(), editableFields("pending")),
      ),
    ).rejects.toMatchObject({ code: "WORKFLOW_ALREADY_PENDING" });
  });

  it("26. allows different records of one lecturer to be pending", async () => {
    await expect(
      Promise.all([
        submit.submitUnchangedRow(unchangedInput(recordsA[4]!, randomUUID())),
        submit.submitUnchangedRow(unchangedInput(recordsA[5]!, randomUUID())),
      ]),
    ).resolves.toHaveLength(2);
  });

  it("27. idempotent retry creates no second event", async () => {
    const submissionId = randomUUID();
    const input = unchangedInput(recordsA[6]!, submissionId);
    await submit.submitUnchangedRow(input);
    await submit.submitUnchangedRow(input);
    expect(await eventCount(submissionId)).toBe(1);
  });

  it("28. same submission ID with different editable content conflicts", async () => {
    const submissionId = randomUUID();
    await submit.submitUpdatedRow(
      updateInput(recordsA[7]!, submissionId, editableFields("first")),
    );
    await expect(
      submit.submitUpdatedRow(
        updateInput(recordsA[7]!, submissionId, editableFields("different")),
      ),
    ).rejects.toMatchObject({ code: "WORKFLOW_PAYLOAD_MISMATCH" });
  });

  it("29. same submission ID with a different type conflicts", async () => {
    const submissionId = randomUUID();
    await submit.submitUnchangedRow(unchangedInput(recordsA[8]!, submissionId));
    await expect(
      submit.submitUpdatedRow(
        updateInput(recordsA[8]!, submissionId, editableFields("other-type")),
      ),
    ).rejects.toMatchObject({ code: "WORKFLOW_PAYLOAD_MISMATCH" });
  });

  it("30. concurrent same submission ID creates one event", async () => {
    const submissionId = randomUUID();
    const input = unchangedInput(recordsA[9]!, submissionId);
    const results = await Promise.all([
      submit.submitUnchangedRow(input),
      submit.submitUnchangedRow(input),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await eventCount(submissionId)).toBe(1);
  });

  it("31. concurrent submission IDs on one record create one pending event", async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();
    const results = await Promise.allSettled([
      submit.submitUnchangedRow(unchangedInput(recordsA[10]!, firstId)),
      submit.submitUnchangedRow(unchangedInput(recordsA[10]!, secondId)),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(await pendingCount(recordsA[10]!.recordUid)).toBe(1);
  });

  it("32. CREATE_NEW retry returns the stored record UID", async () => {
    const submissionId = randomUUID();
    const input = {
      submissionId,
      editableFields: editableFields("create-retry"),
    };
    const first = await submit.submitNewRow(input);
    const second = await submit.submitNewRow(input);
    expect(second.recordUid).toBe(first.recordUid);
    expect(await eventCount(submissionId)).toBe(1);
  });

  it("33. retry uses stored event after latest core data changes", async () => {
    const submissionId = randomUUID();
    const input = unchangedInput(recordsA[11]!, submissionId);
    const first = await submit.submitUnchangedRow(input);
    await insertNewCoreVersion(recordsA[11]!);
    intentionalCoreFixtureWrites += 1;
    const second = await submit.submitUnchangedRow(input);
    expect(second).toEqual(first);
    expect(await eventCount(submissionId)).toBe(1);
  });

  it("34. rejects stale base STT", async () => {
    const input = unchangedInput(recordsA[12]!, randomUUID());
    await expect(
      submit.submitUnchangedRow({ ...input, baseStt: input.baseStt + 1 }),
    ).rejects.toMatchObject({ code: "WORKFLOW_STALE_BASE" });
  });

  it("35. rejects stale base version", async () => {
    const input = unchangedInput(recordsA[13]!, randomUUID());
    await expect(
      submit.submitUnchangedRow({
        ...input,
        baseVersionNo: input.baseVersionNo + 1,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_STALE_BASE" });
  });

  it("36. creates no event for stale requests", async () => {
    const submissionId = randomUUID();
    await expect(
      submit.submitUnchangedRow({
        ...unchangedInput(recordsA[14]!, submissionId),
        baseStt: -1,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_STALE_BASE" });
    expect(await eventCount(submissionId)).toBe(0);
  });

  it("37. rejects a PENDING parent", async () => {
    const parentId = await seedParent(
      "PENDING",
      "UPDATE_EXISTING",
      recordsA[15]!,
    );
    await expect(
      submit.submitUpdatedRow({
        ...updateInput(
          recordsA[15]!,
          randomUUID(),
          editableFields("pending-parent"),
        ),
        parentSubmissionId: parentId,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_INVALID_STATE" });
  });

  it("38. rejects an APPROVED parent", async () => {
    const parentId = await seedParent(
      "APPROVED",
      "UPDATE_EXISTING",
      recordsA[16]!,
    );
    await expect(
      submit.submitUpdatedRow({
        ...updateInput(
          recordsA[16]!,
          randomUUID(),
          editableFields("approved-parent"),
        ),
        parentSubmissionId: parentId,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_INVALID_STATE" });
  });

  it("39. accepts a matching REJECTED parent", async () => {
    rejectedExistingParentId = await seedParent(
      "REJECTED",
      "UPDATE_EXISTING",
      recordsA[17]!,
    );
    const result = await submit.submitUpdatedRow({
      ...updateInput(
        recordsA[17]!,
        randomUUID(),
        editableFields("rejected-parent"),
      ),
      parentSubmissionId: rejectedExistingParentId,
    });
    expect(result.state).toBe("PENDING");
  });

  it("40. blocks a parent belonging to another lecturer", async () => {
    const parentId = await seedParent("REJECTED", "UPDATE_EXISTING", recordB);
    await expect(
      submit.submitUpdatedRow({
        ...updateInput(
          recordsA[18]!,
          randomUUID(),
          editableFields("other-parent"),
        ),
        parentSubmissionId: parentId,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_SUBMISSION_NOT_FOUND" });
  });

  it("41. CREATE_NEW resubmit reuses the rejected parent record UID", async () => {
    rejectedCreateRecordUid = randomUUID();
    rejectedCreateParentId = await seedCreateParent(
      "REJECTED",
      rejectedCreateRecordUid,
    );
    const result = await submit.submitNewRow({
      submissionId: randomUUID(),
      editableFields: editableFields("create-resubmit"),
      parentSubmissionId: rejectedCreateParentId,
    });
    expect(result.recordUid).toBe(rejectedCreateRecordUid);
  });

  it("42. stores parent_submission_id on a valid resubmit", async () => {
    const rows = await owner.query<{ parent_submission_id: string | null }>(
      `SELECT parent_submission_id::text
       FROM public.workflow_event
       WHERE parent_submission_id = $1::uuid`,
      [rejectedCreateParentId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.parent_submission_id).toBe(rejectedCreateParentId);
  });

  it("43. runtime role still cannot insert, update, or delete core", async () => {
    await expect(
      runtimePool.query("INSERT INTO public.ueb_core_data DEFAULT VALUES"),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      runtimePool.query(
        "UPDATE public.ueb_core_data SET stt = stt WHERE false",
      ),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      runtimePool.query("DELETE FROM public.ueb_core_data WHERE false"),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("44. service operations leave core row count unchanged", async () => {
    expect(await coreCount()).toBe(
      initialCoreCount + intentionalCoreFixtureWrites,
    );
  });

  it("45. old workflow events remain immutable", async () => {
    await expect(
      runtimePool.query(
        "UPDATE public.workflow_event SET payload_checksum = 'forged' WHERE event_id = $1::uuid",
        [updateEventBeforeMutation.event_id],
      ),
    ).rejects.toThrow(/permission denied/iu);
    expect(await event(updateSubmissionId)).toEqual(updateEventBeforeMutation);
  });
});

function principal(identity: IdentityFixture): Principal {
  return {
    userId: identity.userId,
    lecturerUid: identity.lecturerUid,
    roles: identity.roles,
    activeUnitIds: [],
    status: identity.status,
  };
}

function unchangedInput(record: CoreFixture, submissionId: string) {
  return {
    submissionId,
    recordUid: record.recordUid,
    baseStt: record.stt,
    baseVersionNo: record.versionNo,
  };
}

function updateInput(
  record: CoreFixture,
  submissionId: string,
  editable: EditableBusinessFields,
) {
  return {
    ...unchangedInput(record, submissionId),
    editableFields: editable,
  };
}

function editableFields(seed: string): EditableBusinessFields {
  return {
    don_vi_phu_trach_hoc_phan: `${seed}-owner-unit`,
    bo_mon_phu_trach_hoc_phan: `${seed}-department`,
    khoi_kien_thuc: seed.length,
    ma_hoc_phan: `${seed}-course`,
    ten_hoc_phan: `${seed}-name`,
    core_1_2_3: `${seed}-core`,
    tc1_tro_giang: `${seed}-tc1`,
    tc2_sh_chuyen_mon: `${seed}-tc2`,
    tc3_tong_hop: `${seed}-tc3`,
    tc3_1_nganh_tot_nghiep_phu_hop: `${seed}-tc31`,
    tc3_2_bien_soan_de_cuong_giao_trinh: `${seed}-tc32`,
    tc3_3_chu_nhiem_de_tai_nckh_lien_quan: `${seed}-tc33`,
    tc3_4_bai_bao_lien_quan: `${seed}-tc34`,
    tc4_giang_thu: `${seed}-tc4`,
  };
}

function fullPayload(
  editable: EditableBusinessFields,
  identity: IdentityFields = IDENTITY_A,
): RowSubmissionPayload {
  return { ...editable, ...identity };
}

async function seedFixtures(): Promise<void> {
  importRunId = randomUUID();
  const unitAId = randomUUID();
  const unitBId = randomUUID();
  await owner.query(
    `INSERT INTO public.organization_unit
       (id, unit_key, source_value, display_name)
     VALUES ($1::uuid, 'phase4-submit-unit-a', $2, $2),
            ($3::uuid, 'phase4-submit-unit-b', $4, $4)`,
    [unitAId, UNIT_A, unitBId, UNIT_B],
  );
  await owner.query(
    `INSERT INTO public.import_run (
       id, source_filename, source_sha256, source_sheet,
       source_contract_version, source_row_count, source_min_stt,
       source_max_stt, canonical_dataset_sha256, report, imported_at
     ) VALUES (
       $1::uuid, 'phase4-submit-fixture.xlsx', $2, 'fixture',
       'phase4-submit-test', 80, 10000, 10079, $3, '{}'::jsonb,
       clock_timestamp()
     )`,
    [importRunId, "a".repeat(64), "b".repeat(64)],
  );

  lecturerA = await seedIdentity("ACTIVE", [BusinessRole.LECTURER]);
  lecturerB = await seedIdentity("ACTIVE", [BusinessRole.LECTURER]);
  noRoleUser = await seedIdentity("ACTIVE", []);
  disabledLecturer = await seedIdentity("DISABLED", [BusinessRole.LECTURER]);
  noUnitLecturer = await seedIdentity("ACTIVE", [BusinessRole.LECTURER]);
  multiUnitLecturer = await seedIdentity("ACTIVE", [BusinessRole.LECTURER]);

  recordsA = [];
  for (let index = 0; index < 55; index += 1) {
    recordsA.push(
      await seedCoreRow({
        lecturerUid: lecturerA.lecturerUid,
        approvalUnit: UNIT_A,
        identity: IDENTITY_A,
        stt: 10_000 + index,
      }),
    );
  }
  recordB = await seedCoreRow({
    lecturerUid: lecturerB.lecturerUid,
    approvalUnit: UNIT_B,
    identity: {
      ten_giang_vien: "Lecturer B",
      ma_so_can_bo: "P4-B",
      email_tai_khoan_vnu: "lecturer-b@example.invalid",
      bo_mon: "Department B",
      don_vi: "Faculty B",
    },
    stt: 10_060,
  });
  await seedCoreRow({
    lecturerUid: multiUnitLecturer.lecturerUid,
    approvalUnit: UNIT_A,
    identity: IDENTITY_A,
    stt: 10_061,
  });
  await seedCoreRow({
    lecturerUid: multiUnitLecturer.lecturerUid,
    approvalUnit: UNIT_B,
    identity: IDENTITY_A,
    stt: 10_062,
  });
}

async function seedIdentity(
  status: "ACTIVE" | "DISABLED",
  roles: readonly BusinessRole[],
): Promise<IdentityFixture> {
  const identity: IdentityFixture = {
    userId: randomUUID(),
    lecturerUid: randomUUID(),
    roles,
    status:
      status === "ACTIVE"
        ? AccessProfileStatus.ACTIVE
        : AccessProfileStatus.DISABLED,
  };
  await owner.query("BEGIN");
  try {
    await owner.query(
      `INSERT INTO public.auth_user
         (id, name, email, "emailVerified", "updatedAt")
       VALUES ($1::uuid, 'Phase 4 Submit Identity', $2, false, clock_timestamp())`,
      [identity.userId, `${identity.userId}@example.invalid`],
    );
    await owner.query(
      `INSERT INTO public.access_profile
         (id, user_id, lecturer_uid, status, updated_at, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid,
         $4::public.access_profile_status, clock_timestamp(), $2::uuid)`,
      [randomUUID(), identity.userId, identity.lecturerUid, status],
    );
    for (const role of roles) {
      await owner.query(
        `INSERT INTO public.role_assignment (id, user_id, role, granted_by)
         VALUES ($1::uuid, $2::uuid, $3::public.business_role, $2::uuid)`,
        [randomUUID(), identity.userId, role],
      );
    }
    await owner.query("COMMIT");
    return identity;
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function seedCoreRow(input: {
  lecturerUid: string;
  approvalUnit: string | null;
  identity: IdentityFields;
  stt: number;
}): Promise<CoreFixture> {
  const recordUid = randomUUID();
  await owner.query(
    `INSERT INTO public.ueb_core_data (
       stt, don_vi_phu_trach_hoc_phan, bo_mon_phu_trach_hoc_phan,
       khoi_kien_thuc, ma_hoc_phan, ten_hoc_phan,
       ten_giang_vien, ma_so_can_bo, email_tai_khoan_vnu, bo_mon, don_vi,
       core_1_2_3, tc1_tro_giang, tc2_sh_chuyen_mon, tc3_tong_hop,
       tc3_1_nganh_tot_nghiep_phu_hop,
       tc3_2_bien_soan_de_cuong_giao_trinh,
       tc3_3_chu_nhiem_de_tai_nckh_lien_quan,
       tc3_4_bai_bao_lien_quan, tc4_giang_thu,
       lecturer_uid, record_uid, snapshot_id, version_no, identity_status,
       source_row_number, source_row_checksum, source_import_run_id,
       approval_unit, origin, approved_at
     ) VALUES (
       $1, 'Seed owner unit', 'Seed department', 1, 'P4-SEED', 'Seed course',
       $2, $3, $4, $5, $6,
       '1', 'tc1', 'tc2', 'tc3', 'tc31', 'tc32', 'tc33', 'tc34', 'tc4',
       $7::uuid, $8::uuid, $9::uuid, 1, 'RESOLVED',
       $10, $11, $12::uuid, $13, 'LEGACY_IMPORT', clock_timestamp()
     )`,
    [
      input.stt,
      input.identity.ten_giang_vien,
      input.identity.ma_so_can_bo,
      input.identity.email_tai_khoan_vnu,
      input.identity.bo_mon,
      input.identity.don_vi,
      input.lecturerUid,
      recordUid,
      randomUUID(),
      input.stt,
      createHash("sha256").update(recordUid).digest("hex"),
      importRunId,
      input.approvalUnit,
    ],
  );
  return {
    recordUid,
    stt: input.stt,
    versionNo: 1,
    lecturerUid: input.lecturerUid,
    approvalUnit: input.approvalUnit,
  };
}

async function insertNewCoreVersion(record: CoreFixture): Promise<void> {
  await owner.query(
    `INSERT INTO public.ueb_core_data (
       don_vi_phu_trach_hoc_phan, bo_mon_phu_trach_hoc_phan,
       khoi_kien_thuc, ma_hoc_phan, ten_hoc_phan,
       ten_giang_vien, ma_so_can_bo, email_tai_khoan_vnu, bo_mon, don_vi,
       core_1_2_3, tc1_tro_giang, tc2_sh_chuyen_mon, tc3_tong_hop,
       tc3_1_nganh_tot_nghiep_phu_hop,
       tc3_2_bien_soan_de_cuong_giao_trinh,
       tc3_3_chu_nhiem_de_tai_nckh_lien_quan,
       tc3_4_bai_bao_lien_quan, tc4_giang_thu,
       lecturer_uid, record_uid, snapshot_id, version_no, identity_status,
       source_row_number, source_row_checksum, source_import_run_id,
       approval_unit, origin, approved_at
     ) VALUES (
       'Changed owner unit', 'Changed department', 2, 'P4-CHANGED', 'Changed',
       $1, $2, $3, $4, $5,
       '2', 'changed', 'changed', 'changed', 'changed', 'changed', 'changed',
       'changed', 'changed', $6::uuid, $7::uuid, $8::uuid, 2, 'RESOLVED',
       90000, $9, $10::uuid, $11, 'LEGACY_IMPORT', clock_timestamp()
     )`,
    [
      IDENTITY_A.ten_giang_vien,
      IDENTITY_A.ma_so_can_bo,
      IDENTITY_A.email_tai_khoan_vnu,
      IDENTITY_A.bo_mon,
      IDENTITY_A.don_vi,
      record.lecturerUid,
      record.recordUid,
      randomUUID(),
      createHash("sha256").update(`v2:${record.recordUid}`).digest("hex"),
      importRunId,
      record.approvalUnit,
    ],
  );
}

async function seedParent(
  state: "PENDING" | "REJECTED" | "APPROVED",
  submissionType: "UPDATE_EXISTING",
  record: CoreFixture,
): Promise<string> {
  const submissionId = randomUUID();
  await insertOwnerEvent({
    submissionId,
    eventType: "SUBMITTED",
    submissionType,
    recordUid: record.recordUid,
    lecturerUid: record.lecturerUid,
    approvalUnit: record.approvalUnit ?? UNIT_A,
    baseStt: record.stt,
    baseVersionNo: record.versionNo,
    payload: fullPayload(editableFields(`parent-${state}`)),
  });
  if (state !== "PENDING") {
    await insertOwnerEvent({
      submissionId,
      eventType: state,
      submissionType: null,
      recordUid: record.recordUid,
      lecturerUid: record.lecturerUid,
      approvalUnit: record.approvalUnit ?? UNIT_A,
      baseStt: null,
      baseVersionNo: null,
      payload: null,
    });
  }
  return submissionId;
}

async function seedCreateParent(
  state: "REJECTED",
  recordUid: string,
): Promise<string> {
  const submissionId = randomUUID();
  await insertOwnerEvent({
    submissionId,
    eventType: "SUBMITTED",
    submissionType: "CREATE_NEW",
    recordUid,
    lecturerUid: lecturerA.lecturerUid,
    approvalUnit: UNIT_A,
    baseStt: null,
    baseVersionNo: null,
    payload: fullPayload(editableFields("create-parent")),
  });
  await insertOwnerEvent({
    submissionId,
    eventType: state,
    submissionType: null,
    recordUid,
    lecturerUid: lecturerA.lecturerUid,
    approvalUnit: UNIT_A,
    baseStt: null,
    baseVersionNo: null,
    payload: null,
  });
  return submissionId;
}

async function insertOwnerEvent(input: {
  submissionId: string;
  eventType: "SUBMITTED" | "REJECTED" | "APPROVED";
  submissionType: "UPDATE_EXISTING" | "CREATE_NEW" | null;
  recordUid: string;
  lecturerUid: string;
  approvalUnit: string;
  baseStt: number | null;
  baseVersionNo: number | null;
  payload: RowSubmissionPayload | null;
}): Promise<void> {
  const submitted = input.eventType === "SUBMITTED";
  await owner.query(
    `INSERT INTO public.workflow_event (
       event_id, submission_id, event_type, submission_type, record_uid,
       lecturer_uid, approval_unit, base_stt, base_version_no, payload,
       payload_checksum, actor_user_id, reason, result_stt, result_version_no
     ) VALUES (
       $1::uuid, $2::uuid, $3::public.workflow_event_type,
       $4::public.workflow_submission_type, $5::uuid, $6::uuid, $7,
       $8, $9, $10::jsonb, $11, $12::uuid, $13, $14, $15
     )`,
    [
      randomUUID(),
      input.submissionId,
      input.eventType,
      input.submissionType,
      input.recordUid,
      input.lecturerUid,
      input.approvalUnit,
      input.baseStt,
      input.baseVersionNo,
      input.payload ? JSON.stringify(input.payload) : null,
      submitted ? "owner-fixture-checksum" : null,
      lecturerA.userId,
      input.eventType === "REJECTED" ? "Rejected for resubmit test" : null,
      input.eventType === "APPROVED" ? 99999 : null,
      input.eventType === "APPROVED" ? 2 : null,
    ],
  );
}

function directSubmittedEvent(lecturerUid: string, actorUserId: string) {
  return {
    eventId: randomUUID(),
    submissionId: randomUUID(),
    recordUid: randomUUID(),
    lecturerUid,
    approvalUnit: UNIT_A,
    actorUserId,
    payload: fullPayload(editableFields("direct")),
  };
}

async function runtimeInsertSubmitted(
  currentUserId: string | null,
  input: ReturnType<typeof directSubmittedEvent>,
): Promise<void> {
  const connection = await runtimePool.connect();
  try {
    await connection.query("BEGIN");
    if (currentUserId) await setCurrentUser(connection, currentUserId);
    await connection.query(
      `INSERT INTO public.workflow_event (
         event_id, submission_id, event_type, submission_type, record_uid,
         lecturer_uid, approval_unit, payload, payload_checksum, actor_user_id,
         reason, result_stt, result_version_no
       ) VALUES (
         $1::uuid, $2::uuid, 'SUBMITTED', 'CREATE_NEW', $3::uuid,
         $4::uuid, $5, $6::jsonb, $7, $8::uuid, NULL, NULL, NULL
       )`,
      [
        input.eventId,
        input.submissionId,
        input.recordUid,
        input.lecturerUid,
        input.approvalUnit,
        JSON.stringify(input.payload),
        "direct-fixture-checksum",
        input.actorUserId,
      ],
    );
    await connection.query("COMMIT");
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

async function event(submissionId: string): Promise<EventRow> {
  const result = await owner.query<EventRow>(
    `SELECT
       event_id::text, submission_id::text, parent_submission_id::text,
       event_type::text, submission_type::text, record_uid::text,
       lecturer_uid::text, approval_unit, base_stt, base_version_no, payload,
       payload_checksum, actor_user_id::text, reason, result_stt,
       result_version_no
     FROM public.workflow_event
     WHERE submission_id = $1::uuid
       AND event_type = 'SUBMITTED'`,
    [submissionId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Expected a submitted event fixture.");
  return row;
}

async function eventCount(submissionId: string): Promise<number> {
  const result = await owner.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM public.workflow_event WHERE submission_id = $1::uuid",
    [submissionId],
  );
  return result.rows[0]?.count ?? -1;
}

async function pendingCount(recordUid: string): Promise<number> {
  const result = await owner.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM public.workflow_event AS submitted
     WHERE submitted.record_uid = $1::uuid
       AND submitted.event_type = 'SUBMITTED'
       AND NOT EXISTS (
         SELECT 1 FROM public.workflow_event AS terminal
         WHERE terminal.submission_id = submitted.submission_id
           AND terminal.event_type IN ('APPROVED', 'REJECTED')
       )`,
    [recordUid],
  );
  return result.rows[0]?.count ?? -1;
}

async function coreCount(): Promise<number> {
  const result = await owner.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM public.ueb_core_data",
  );
  return result.rows[0]?.count ?? -1;
}
