// @vitest-environment node

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  ApprovedWorkflowEvent,
  BusinessFieldName,
  EditableBusinessFieldName,
  ReadOnlyBusinessFieldName,
  RejectedWorkflowEvent,
  RowSubmissionPayload,
  SubmissionPayloadFieldName,
  SubmissionReadOnlyFieldName,
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
    expectTypeOf<SubmissionPayloadFieldName>().toEqualTypeOf<
      keyof RowSubmissionPayload
    >();
    expectTypeOf<EditableBusinessFieldName>().toMatchTypeOf<BusinessFieldName>();
    expectTypeOf<ReadOnlyBusinessFieldName>().toMatchTypeOf<BusinessFieldName>();
    expectTypeOf<SubmissionReadOnlyFieldName>().toMatchTypeOf<SubmissionPayloadFieldName>();
    expectTypeOf<
      Extract<"stt", keyof RowSubmissionPayload>
    >().toEqualTypeOf<never>();
  });

  it("keeps technical metadata out of RowSubmissionPayload", () => {
    type TechnicalField =
      | "eventId"
      | "submissionId"
      | "parentSubmissionId"
      | "lecturerUid"
      | "recordUid"
      | "snapshotId"
      | "versionNo"
      | "sourceSubmissionId"
      | "approvalUnit"
      | "approvedBy"
      | "approvedAt"
      | "createdAt"
      | "payloadChecksum"
      | "baseStt"
      | "baseVersionNo"
      | "resultStt"
      | "resultVersionNo";
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
    const source = [
      "checksum.ts",
      "errors.ts",
      "field-policy.ts",
      "index.ts",
      "payload-schema.ts",
      "state-machine.ts",
      "types.ts",
    ]
      .map((file) => readFileSync(new URL(file, workflowDirectory), "utf8"))
      .join("\n");

    expect(source).not.toMatch(
      /PrismaClient|getPrismaClient|@prisma|generated\/prisma|next\/headers|next\/cookies|server-only|better-auth|src\/lib\/data/u,
    );
  });

  it("locks the current Prisma schema and keeps the base Phase 4 migration unchanged", () => {
    const repositoryRoot = new URL("../../", import.meta.url);
    const files = [
      [
        "prisma/schema.prisma",
        "69818041f9cb17351a08b9ba70a633fb54656ef2070e3bf8ef7dc53922ccecd4",
      ],
      [
        "prisma/migrations/20260716040000_phase_4_row_workflow_contract/migration.sql",
        "6045e43735abfa55d6953178794532f99f664a0772d23894ceb92285ffcff398",
      ],
    ] as const;

    for (const [path, expectedHash] of files) {
      const source = readFileSync(new URL(path, repositoryRoot));
      expect(createHash("sha256").update(source).digest("hex")).toBe(
        expectedHash,
      );
    }
  });
});
