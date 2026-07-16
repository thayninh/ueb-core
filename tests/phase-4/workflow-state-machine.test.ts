// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  WorkflowError,
  assertSubmissionCanBeApproved,
  assertSubmissionCanBeRejected,
  resolveSubmission,
} from "../../src/lib/workflow";

import type {
  ApprovedWorkflowEvent,
  RejectedWorkflowEvent,
  RowSubmissionPayload,
  SubmittedWorkflowEvent,
  WorkflowEvent,
} from "../../src/lib/workflow";

const PAYLOAD = {
  don_vi_phu_trach_hoc_phan: null,
  bo_mon_phu_trach_hoc_phan: null,
  khoi_kien_thuc: 1,
  ma_hoc_phan: null,
  ten_hoc_phan: null,
  ten_giang_vien: null,
  ma_so_can_bo: null,
  email_tai_khoan_vnu: null,
  bo_mon: null,
  don_vi: null,
  core_1_2_3: null,
  tc1_tro_giang: null,
  tc2_sh_chuyen_mon: null,
  tc3_tong_hop: null,
  tc3_1_nganh_tot_nghiep_phu_hop: null,
  tc3_2_bien_soan_de_cuong_giao_trinh: null,
  tc3_3_chu_nhiem_de_tai_nckh_lien_quan: null,
  tc3_4_bai_bao_lien_quan: null,
  tc4_giang_thu: null,
} as const satisfies RowSubmissionPayload;

const SUBMITTED = {
  eventId: "10000000-0000-4000-8000-000000000001",
  eventType: "SUBMITTED",
  submissionType: "UPDATE_EXISTING",
  submissionId: "20000000-0000-4000-8000-000000000001",
  parentSubmissionId: null,
  recordUid: "30000000-0000-4000-8000-000000000001",
  lecturerUid: "40000000-0000-4000-8000-000000000001",
  approvalUnit: "TEST_UNIT",
  baseStt: 42,
  baseVersionNo: 1,
  payload: PAYLOAD,
  payloadChecksum: "a".repeat(64),
  actorUserId: "50000000-0000-4000-8000-000000000001",
  createdAt: new Date("2026-07-16T00:00:00.000Z"),
} as const satisfies SubmittedWorkflowEvent;

const REJECTED = {
  eventId: "10000000-0000-4000-8000-000000000002",
  eventType: "REJECTED",
  submissionId: SUBMITTED.submissionId,
  recordUid: SUBMITTED.recordUid,
  lecturerUid: SUBMITTED.lecturerUid,
  approvalUnit: SUBMITTED.approvalUnit,
  actorUserId: "60000000-0000-4000-8000-000000000001",
  reason: "Contract rejection reason",
  createdAt: new Date("2026-07-16T00:01:00.000Z"),
} as const satisfies RejectedWorkflowEvent;

const APPROVED = {
  eventId: "10000000-0000-4000-8000-000000000003",
  eventType: "APPROVED",
  submissionId: SUBMITTED.submissionId,
  recordUid: SUBMITTED.recordUid,
  lecturerUid: SUBMITTED.lecturerUid,
  approvalUnit: SUBMITTED.approvalUnit,
  actorUserId: "60000000-0000-4000-8000-000000000001",
  resultStt: 2570,
  resultVersionNo: 2,
  createdAt: new Date("2026-07-16T00:01:00.000Z"),
} as const satisfies ApprovedWorkflowEvent;

function expectInvalid(events: readonly WorkflowEvent[]): void {
  try {
    resolveSubmission(events);
    throw new Error("Expected invalid workflow history");
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowError);
    expect((error as WorkflowError).code).toBe("WORKFLOW_INVALID_STATE");
  }
}

describe("Phase 4 workflow state resolver", () => {
  it("resolves SUBMITTED as PENDING", () => {
    const resolved = resolveSubmission([SUBMITTED]);

    expect(resolved.state).toBe("PENDING");
    expect(resolved.terminalEvent).toBeNull();
    expect(resolved.submittedEvent).toBe(SUBMITTED);
  });

  it("resolves SUBMITTED then REJECTED as REJECTED", () => {
    const resolved = resolveSubmission([SUBMITTED, REJECTED]);

    expect(resolved.state).toBe("REJECTED");
    expect(resolved.terminalEvent).toBe(REJECTED);
  });

  it("resolves SUBMITTED then APPROVED as APPROVED", () => {
    const resolved = resolveSubmission([SUBMITTED, APPROVED]);

    expect(resolved.state).toBe("APPROVED");
    expect(resolved.terminalEvent).toBe(APPROVED);
  });

  it("rejects a history without SUBMITTED", () => {
    expectInvalid([REJECTED]);
  });

  it("rejects two SUBMITTED events", () => {
    const duplicateSubmitted = {
      ...SUBMITTED,
      eventId: "10000000-0000-4000-8000-000000000004",
      createdAt: new Date("2026-07-16T00:00:30.000Z"),
    } as const satisfies SubmittedWorkflowEvent;

    expectInvalid([SUBMITTED, duplicateSubmitted]);
  });

  it("rejects two terminal events of the same type", () => {
    const secondRejected = {
      ...REJECTED,
      eventId: "10000000-0000-4000-8000-000000000005",
      createdAt: new Date("2026-07-16T00:02:00.000Z"),
    } as const satisfies RejectedWorkflowEvent;

    expectInvalid([SUBMITTED, REJECTED, secondRejected]);
  });

  it("rejects both APPROVED and REJECTED", () => {
    expectInvalid([SUBMITTED, APPROVED, REJECTED]);
  });

  it("rejects a terminal event chronologically before SUBMITTED", () => {
    const earlyRejected = {
      ...REJECTED,
      createdAt: new Date("2026-07-15T23:59:00.000Z"),
    } as const satisfies RejectedWorkflowEvent;

    expectInvalid([SUBMITTED, earlyRejected]);
  });

  it("rejects a mismatched submissionId", () => {
    expectInvalid([
      SUBMITTED,
      {
        ...APPROVED,
        submissionId: "20000000-0000-4000-8000-000000000002",
      },
    ]);
  });

  it("rejects a mismatched recordUid", () => {
    expectInvalid([
      SUBMITTED,
      {
        ...APPROVED,
        recordUid: "30000000-0000-4000-8000-000000000002",
      },
    ]);
  });

  it("rejects a mismatched lecturerUid", () => {
    expectInvalid([
      SUBMITTED,
      {
        ...APPROVED,
        lecturerUid: "40000000-0000-4000-8000-000000000002",
      },
    ]);
  });

  it("rejects a mismatched approvalUnit", () => {
    expectInvalid([
      SUBMITTED,
      { ...APPROVED, approvalUnit: "OTHER_TEST_UNIT" },
    ]);
  });

  it("rejects duplicate event identifiers that would break tie ordering", () => {
    expectInvalid([SUBMITTED, { ...APPROVED, eventId: SUBMITTED.eventId }]);
  });

  it("does not approve an already approved submission", () => {
    const resolved = resolveSubmission([SUBMITTED, APPROVED]);

    expect(() => assertSubmissionCanBeApproved(resolved)).toThrowError(
      expect.objectContaining({ code: "WORKFLOW_ALREADY_TERMINAL" }),
    );
  });

  it("does not reject an already rejected submission", () => {
    const resolved = resolveSubmission([SUBMITTED, REJECTED]);

    expect(() => assertSubmissionCanBeRejected(resolved)).toThrowError(
      expect.objectContaining({ code: "WORKFLOW_ALREADY_TERMINAL" }),
    );
  });

  it("allows both terminal actions only while pending", () => {
    const resolved = resolveSubmission([SUBMITTED]);

    expect(() => assertSubmissionCanBeApproved(resolved)).not.toThrow();
    expect(() => assertSubmissionCanBeRejected(resolved)).not.toThrow();
  });

  it("resolves correctly when input order differs but chronology is valid", () => {
    const input = [APPROVED, SUBMITTED] as const;
    const inputBefore = [...input];
    const resolved = resolveSubmission(input);

    expect(resolved.state).toBe("APPROVED");
    expect(input).toEqual(inputBefore);
  });

  it("preserves parent lineage without changing the current state", () => {
    const submittedWithParent = {
      ...SUBMITTED,
      parentSubmissionId: "70000000-0000-4000-8000-000000000001",
    } as const satisfies SubmittedWorkflowEvent;
    const resolved = resolveSubmission([submittedWithParent]);

    expect(resolved.state).toBe("PENDING");
    expect(resolved.parentSubmissionId).toBe(
      submittedWithParent.parentSubmissionId,
    );
  });
});
