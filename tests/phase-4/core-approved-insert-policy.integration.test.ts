// @vitest-environment node

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupApprovalDatabase,
  prepareApprovalDatabase,
  runtimeInsertCore,
  seedApprovalSubmission,
  type ApprovalDatabaseFixture,
} from "./helpers/approval-database";

const integrationEnabled = process.env.PHASE4_APPROVAL_INTEGRATION === "1";
const isolatedDescribe = integrationEnabled
  ? describe.sequential
  : describe.skip;

let fixture: ApprovalDatabaseFixture;

isolatedDescribe("Phase 4 approved core INSERT policy and trigger", () => {
  beforeAll(async () => {
    fixture = await prepareApprovalDatabase();
  }, 60_000);

  afterAll(async () => {
    await cleanupApprovalDatabase(fixture);
  }, 30_000);

  it("grants only approved columns and sequence USAGE", async () => {
    const result = await fixture.runtime.query<{
      table_insert: boolean;
      any_insert: boolean;
      stt_insert: boolean;
      sequence_usage: boolean;
      sequence_select: boolean;
      sequence_update: boolean;
    }>(`
      SELECT
        has_table_privilege(current_user, 'public.ueb_core_data', 'INSERT') AS table_insert,
        has_any_column_privilege(current_user, 'public.ueb_core_data', 'INSERT') AS any_insert,
        has_column_privilege(current_user, 'public.ueb_core_data', 'stt', 'INSERT') AS stt_insert,
        has_sequence_privilege(current_user, 'public.ueb_core_data_stt_seq', 'USAGE') AS sequence_usage,
        has_sequence_privilege(current_user, 'public.ueb_core_data_stt_seq', 'SELECT') AS sequence_select,
        has_sequence_privilege(current_user, 'public.ueb_core_data_stt_seq', 'UPDATE') AS sequence_update
    `);
    expect(result.rows[0]).toEqual({
      table_insert: false,
      any_insert: true,
      stt_insert: false,
      sequence_usage: true,
      sequence_select: false,
      sequence_update: false,
    });
  });

  it("blocks core insert without transaction-local request context", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "no-context",
    });
    await expect(runtimeInsertCore(fixture, submission)).rejects.toThrow();
  });

  it("blocks a pure lecturer and disabled leader", async () => {
    const lecturerSubmission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "lecturer-direct",
    });
    await expect(
      runtimeInsertCore(fixture, lecturerSubmission, {
        currentUserId: fixture.lecturerA.userId,
      }),
    ).rejects.toThrow();

    const disabledSubmission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "disabled-direct",
    });
    await expect(
      runtimeInsertCore(fixture, disabledSubmission, {
        currentUserId: fixture.disabledLeader.userId,
      }),
    ).rejects.toThrow();
  });

  it.each([
    ["lecturer UID", { lecturerUid: randomUUID() }],
    ["record UID", { recordUid: randomUUID() }],
    ["approval unit", { approvalUnit: "Forged Unit" }],
    ["approved_by", { approvedBy: randomUUID() }],
  ] as const)("blocks forged %s", async (_label, override) => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: `forged-${_label}`,
    });
    await expect(
      runtimeInsertCore(fixture, submission, {
        currentUserId: fixture.leaderA.userId,
        ...override,
      }),
    ).rejects.toThrow();
  });

  it("blocks a forged payload field", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "forged-payload",
    });
    await expect(
      runtimeInsertCore(fixture, submission, {
        currentUserId: fixture.leaderA.userId,
        payload: { ...submission.payload, ten_hoc_phan: "Forged course" },
      }),
    ).rejects.toThrow();
  });

  it("blocks an invalid submitted checksum", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "forged-checksum",
      checksum: "0".repeat(64),
    });
    await expect(
      runtimeInsertCore(fixture, submission, {
        currentUserId: fixture.leaderA.userId,
      }),
    ).rejects.toThrow();
  });

  it("blocks invalid CREATE_NEW and existing-row versions", async () => {
    const createSubmission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "wrong-create-version",
    });
    await expect(
      runtimeInsertCore(fixture, createSubmission, {
        currentUserId: fixture.leaderA.userId,
        versionNo: 2,
      }),
    ).rejects.toThrow();

    const existingSubmission = await seedApprovalSubmission(fixture, {
      submissionType: "UPDATE_EXISTING",
      seed: "wrong-existing-version",
    });
    await expect(
      runtimeInsertCore(fixture, existingSubmission, {
        currentUserId: fixture.leaderA.userId,
        versionNo: 99,
      }),
    ).rejects.toThrow();
  });

  it("blocks missing or nonexistent source_submission_id", async () => {
    const missing = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "missing-source",
    });
    await expect(
      runtimeInsertCore(fixture, missing, {
        currentUserId: fixture.leaderA.userId,
        sourceSubmissionId: null,
      }),
    ).rejects.toThrow();

    const nonexistent = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "unknown-source",
    });
    await expect(
      runtimeInsertCore(fixture, nonexistent, {
        currentUserId: fixture.leaderA.userId,
        sourceSubmissionId: randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it("blocks a terminal submission", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "terminal-source",
      terminal: "REJECTED",
    });
    await expect(
      runtimeInsertCore(fixture, submission, {
        currentUserId: fixture.leaderA.userId,
      }),
    ).rejects.toThrow();
  });

  it("blocks explicit STT at the column privilege boundary", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "explicit-stt",
    });
    await expect(
      runtimeInsertCore(fixture, submission, {
        currentUserId: fixture.leaderA.userId,
        stt: 123456,
      }),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("enforces global source_submission_id uniqueness", async () => {
    const submission = await seedApprovalSubmission(fixture, {
      submissionType: "CREATE_NEW",
      seed: "unique-source",
    });
    await runtimeInsertCore(fixture, submission, {
      currentUserId: fixture.leaderA.userId,
    });
    await expect(
      runtimeInsertCore(fixture, submission, {
        currentUserId: fixture.leaderA.userId,
        recordUid: randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it("keeps core and workflow events append-only for runtime", async () => {
    await expect(
      fixture.runtime.query(
        "UPDATE public.ueb_core_data SET stt = stt WHERE false",
      ),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      fixture.runtime.query("DELETE FROM public.ueb_core_data WHERE false"),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      fixture.runtime.query("TRUNCATE TABLE public.ueb_core_data"),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      fixture.runtime.query(
        "UPDATE public.workflow_event SET reason = reason WHERE false",
      ),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      fixture.runtime.query("DELETE FROM public.workflow_event WHERE false"),
    ).rejects.toThrow(/permission denied/iu);
  });
});
