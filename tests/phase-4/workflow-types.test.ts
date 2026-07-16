// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  ApprovedWorkflowEvent,
  BusinessFieldName,
  EditableBusinessFieldName,
  ReadOnlyBusinessFieldName,
  RejectedWorkflowEvent,
  RowSubmissionPayload,
  SubmissionState,
  SubmissionType,
  SubmittedWorkflowEvent,
  WorkflowEventType,
} from "../../src/lib/workflow";

describe("Phase 4 workflow domain types", () => {
  it("locks the three submission types", () => {
    expectTypeOf<SubmissionType>().toEqualTypeOf<
      "CONFIRM_UNCHANGED" | "UPDATE_EXISTING" | "CREATE_NEW"
    >();
  });

  it("locks the three event types and three derived states", () => {
    expectTypeOf<WorkflowEventType>().toEqualTypeOf<
      "SUBMITTED" | "REJECTED" | "APPROVED"
    >();
    expectTypeOf<SubmissionState>().toEqualTypeOf<
      "PENDING" | "REJECTED" | "APPROVED"
    >();
  });

  it("derives all field-name types from the committed field contract", () => {
    expectTypeOf<BusinessFieldName>().toMatchTypeOf<
      keyof RowSubmissionPayload
    >();
    expectTypeOf<EditableBusinessFieldName>().toMatchTypeOf<BusinessFieldName>();
    expectTypeOf<ReadOnlyBusinessFieldName>().toMatchTypeOf<BusinessFieldName>();
  });

  it("keeps technical metadata out of RowSubmissionPayload", () => {
    type TechnicalField =
      | "event_id"
      | "submission_id"
      | "parent_submission_id"
      | "lecturer_uid"
      | "record_uid"
      | "snapshot_id"
      | "version_no"
      | "source_submission_id"
      | "approval_unit"
      | "approved_by"
      | "approved_at"
      | "created_at"
      | "payload_checksum"
      | "base_stt"
      | "base_version_no"
      | "result_stt"
      | "result_version_no";
    type TechnicalOverlap = Extract<keyof RowSubmissionPayload, TechnicalField>;

    expectTypeOf<TechnicalOverlap>().toEqualTypeOf<never>();
  });

  it("uses discriminated immutable event shapes", () => {
    const common = {
      eventId: "10000000-0000-4000-8000-000000000001",
      submissionId: "20000000-0000-4000-8000-000000000001",
      recordUid: "30000000-0000-4000-8000-000000000001",
      lecturerUid: "40000000-0000-4000-8000-000000000001",
      approvalUnit: "TEST_UNIT",
      actorUserId: "50000000-0000-4000-8000-000000000001",
      createdAt: new Date("2026-07-16T00:00:00.000Z"),
    } as const;
    const payload = {
      stt: null,
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

    const submitted = {
      ...common,
      eventType: "SUBMITTED",
      submissionType: "CREATE_NEW",
      parentSubmissionId: null,
      baseStt: null,
      baseVersionNo: null,
      payload,
      payloadChecksum: "a".repeat(64),
    } as const satisfies SubmittedWorkflowEvent;
    const rejected = {
      ...common,
      eventType: "REJECTED",
      reason: "Contract reason",
    } as const satisfies RejectedWorkflowEvent;
    const approved = {
      ...common,
      eventType: "APPROVED",
      resultStt: 2570,
      resultVersionNo: 1,
    } as const satisfies ApprovedWorkflowEvent;

    expect([
      submitted.eventType,
      rejected.eventType,
      approved.eventType,
    ]).toEqual(["SUBMITTED", "REJECTED", "APPROVED"]);
  });

  it("has no database, Prisma runtime, Next.js, or auth imports", () => {
    const workflowDirectory = new URL(
      "../../src/lib/workflow/",
      import.meta.url,
    );
    const source = readdirSync(workflowDirectory)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(new URL(file, workflowDirectory), "utf8"))
      .join("\n");

    expect(source).not.toMatch(
      /PrismaClient|getPrismaClient|@prisma|generated\/prisma|next\/headers|next\/cookies|server-only|better-auth|src\/lib\/data/u,
    );
  });
});
