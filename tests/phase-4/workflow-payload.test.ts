// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  BUSINESS_FIELD_NAMES,
  buildConfirmUnchangedPayload,
  buildCreateNewPayload,
  buildUpdateExistingPayload,
  confirmUnchangedInputSchema,
  createNewInputSchema,
  rowSubmissionPayloadSchema,
  updateExistingInputSchema,
} from "../../src/lib/workflow";

import type {
  CoreBusinessRow,
  CreateNewServerDerivedFields,
  EditableBusinessFields,
} from "../../src/lib/workflow";

const SUBMISSION_ID = "10000000-0000-4000-8000-000000000001";
const RECORD_UID = "20000000-0000-4000-8000-000000000001";

const CURRENT_ROW = {
  stt: 42,
  don_vi_phu_trach_hoc_phan: "Unit A",
  bo_mon_phu_trach_hoc_phan: null,
  khoi_kien_thuc: 1,
  ma_hoc_phan: "COURSE-1",
  ten_hoc_phan: "Course name",
  ten_giang_vien: "Test Lecturer",
  ma_so_can_bo: "TEST-001",
  email_tai_khoan_vnu: "lecturer@example.test",
  bo_mon: "Test Department",
  don_vi: "Test Faculty",
  core_1_2_3: "1",
  tc1_tro_giang: null,
  tc2_sh_chuyen_mon: "Yes",
  tc3_tong_hop: null,
  tc3_1_nganh_tot_nghiep_phu_hop: null,
  tc3_2_bien_soan_de_cuong_giao_trinh: "2026-01-01",
  tc3_3_chu_nhiem_de_tai_nckh_lien_quan: null,
  tc3_4_bai_bao_lien_quan: null,
  tc4_giang_thu: "No",
} as const satisfies CoreBusinessRow;

const EDITABLE_FIELDS = {
  don_vi_phu_trach_hoc_phan: "Unit B",
  bo_mon_phu_trach_hoc_phan: "Department B",
  khoi_kien_thuc: 2,
  ma_hoc_phan: "COURSE-2",
  ten_hoc_phan: "Updated course",
  core_1_2_3: "2",
  tc1_tro_giang: "Yes",
  tc2_sh_chuyen_mon: null,
  tc3_tong_hop: "Eligible",
  tc3_1_nganh_tot_nghiep_phu_hop: "2025-01-01",
  tc3_2_bien_soan_de_cuong_giao_trinh: null,
  tc3_3_chu_nhiem_de_tai_nckh_lien_quan: "2024-01-01",
  tc3_4_bai_bao_lien_quan: null,
  tc4_giang_thu: "Yes",
} as const satisfies EditableBusinessFields;

const CREATE_SERVER_FIELDS = {
  stt: null,
  ten_giang_vien: "Test Lecturer",
  ma_so_can_bo: "TEST-001",
  email_tai_khoan_vnu: "lecturer@example.test",
  bo_mon: "Test Department",
  don_vi: "Test Faculty",
} as const satisfies CreateNewServerDerivedFields;

describe("Phase 4 workflow payload schemas and builders", () => {
  it("accepts the exact confirm-unchanged locator and base metadata", () => {
    expect(
      confirmUnchangedInputSchema.safeParse({
        submissionId: SUBMISSION_ID,
        recordUid: RECORD_UID,
        baseStt: 42,
        baseVersionNo: 1,
      }).success,
    ).toBe(true);
  });

  it("accepts an optional rejected-parent locator for confirm resubmission", () => {
    expect(
      confirmUnchangedInputSchema.safeParse({
        submissionId: SUBMISSION_ID,
        recordUid: RECORD_UID,
        baseStt: 42,
        baseVersionNo: 1,
        parentSubmissionId: "30000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
  });

  it("rejects any business override on confirm unchanged", () => {
    expect(
      confirmUnchangedInputSchema.safeParse({
        submissionId: SUBMISSION_ID,
        recordUid: RECORD_UID,
        baseStt: 42,
        baseVersionNo: 1,
        editableFields: EDITABLE_FIELDS,
      }).success,
    ).toBe(false);
  });

  it("accepts all fourteen editable fields for update existing", () => {
    expect(
      updateExistingInputSchema.safeParse({
        submissionId: SUBMISSION_ID,
        recordUid: RECORD_UID,
        baseStt: 42,
        baseVersionNo: 1,
        editableFields: EDITABLE_FIELDS,
        parentSubmissionId: null,
      }).success,
    ).toBe(true);
  });

  it("rejects an update when any editable field is missing", () => {
    const incompleteEditableFields = Object.fromEntries(
      Object.entries(EDITABLE_FIELDS).filter(
        ([field]) => field !== "tc4_giang_thu",
      ),
    );

    expect(
      updateExistingInputSchema.safeParse({
        submissionId: SUBMISSION_ID,
        recordUid: RECORD_UID,
        baseStt: 42,
        baseVersionNo: 1,
        editableFields: incompleteEditableFields,
      }).success,
    ).toBe(false);
  });

  it("rejects read-only tampering inside editable fields", () => {
    expect(
      updateExistingInputSchema.safeParse({
        submissionId: SUBMISSION_ID,
        recordUid: RECORD_UID,
        baseStt: 42,
        baseVersionNo: 1,
        editableFields: { ...EDITABLE_FIELDS, ten_giang_vien: "Tampered" },
      }).success,
    ).toBe(false);
  });

  it("rejects technical-field tampering at every input boundary", () => {
    expect(
      updateExistingInputSchema.safeParse({
        submissionId: SUBMISSION_ID,
        recordUid: RECORD_UID,
        baseStt: 42,
        baseVersionNo: 1,
        editableFields: EDITABLE_FIELDS,
        approvalUnit: "Tampered unit",
      }).success,
    ).toBe(false);
    expect(
      updateExistingInputSchema.safeParse({
        submissionId: SUBMISSION_ID,
        recordUid: RECORD_UID,
        baseStt: 42,
        baseVersionNo: 1,
        editableFields: { ...EDITABLE_FIELDS, versionNo: 99 },
      }).success,
    ).toBe(false);
  });

  it("accepts create-new input without recordUid or read-only fields", () => {
    expect(
      createNewInputSchema.safeParse({
        submissionId: SUBMISSION_ID,
        editableFields: EDITABLE_FIELDS,
      }).success,
    ).toBe(true);
  });

  it("rejects client-supplied recordUid and stt for create new", () => {
    expect(
      createNewInputSchema.safeParse({
        submissionId: SUBMISSION_ID,
        recordUid: RECORD_UID,
        editableFields: EDITABLE_FIELDS,
      }).success,
    ).toBe(false);
    expect(
      createNewInputSchema.safeParse({
        submissionId: SUBMISSION_ID,
        editableFields: { ...EDITABLE_FIELDS, stt: 2570 },
      }).success,
    ).toBe(false);
  });

  it("builds confirm unchanged from exactly the current row", () => {
    const payload = buildConfirmUnchangedPayload(CURRENT_ROW);

    expect(payload).toEqual(CURRENT_ROW);
    expect(Object.keys(payload)).toEqual(BUSINESS_FIELD_NAMES);
    expect(payload).not.toBe(CURRENT_ROW);
  });

  it("builds update with six current read-only and fourteen edited fields", () => {
    const payload = buildUpdateExistingPayload(CURRENT_ROW, EDITABLE_FIELDS);

    expect(payload.ten_giang_vien).toBe(CURRENT_ROW.ten_giang_vien);
    expect(payload.ma_so_can_bo).toBe(CURRENT_ROW.ma_so_can_bo);
    expect(payload.email_tai_khoan_vnu).toBe(CURRENT_ROW.email_tai_khoan_vnu);
    expect(payload.bo_mon).toBe(CURRENT_ROW.bo_mon);
    expect(payload.don_vi).toBe(CURRENT_ROW.don_vi);
    expect(payload.stt).toBe(CURRENT_ROW.stt);
    expect(payload.ten_hoc_phan).toBe(EDITABLE_FIELDS.ten_hoc_phan);
    expect(payload.khoi_kien_thuc).toBe(EDITABLE_FIELDS.khoi_kien_thuc);
  });

  it("builds create new with server identity and a null unassigned STT", () => {
    const payload = buildCreateNewPayload(
      CREATE_SERVER_FIELDS,
      EDITABLE_FIELDS,
    );

    expect(payload.stt).toBeNull();
    expect(payload.ten_giang_vien).toBe(CREATE_SERVER_FIELDS.ten_giang_vien);
    expect(payload.don_vi).toBe(CREATE_SERVER_FIELDS.don_vi);
    expect(payload.ma_hoc_phan).toBe(EDITABLE_FIELDS.ma_hoc_phan);
    expect(Object.keys(payload)).toEqual(BUSINESS_FIELD_NAMES);
  });

  it("does not mutate current, editable, or server-derived arguments", () => {
    const currentBefore = structuredClone(CURRENT_ROW);
    const editableBefore = structuredClone(EDITABLE_FIELDS);
    const serverBefore = structuredClone(CREATE_SERVER_FIELDS);

    buildConfirmUnchangedPayload(CURRENT_ROW);
    buildUpdateExistingPayload(CURRENT_ROW, EDITABLE_FIELDS);
    buildCreateNewPayload(CREATE_SERVER_FIELDS, EDITABLE_FIELDS);

    expect(CURRENT_ROW).toEqual(currentBefore);
    expect(EDITABLE_FIELDS).toEqual(editableBefore);
    expect(CREATE_SERVER_FIELDS).toEqual(serverBefore);
  });

  it("rejects unknown builder input instead of silently dropping it", () => {
    const tamperedEditable = {
      ...EDITABLE_FIELDS,
      approvalUnit: "Tampered unit",
    };
    const tamperedCurrent = { ...CURRENT_ROW, recordUid: RECORD_UID };

    expect(() =>
      buildUpdateExistingPayload(
        CURRENT_ROW,
        tamperedEditable as EditableBusinessFields,
      ),
    ).toThrow();
    expect(() =>
      buildConfirmUnchangedPayload(tamperedCurrent as CoreBusinessRow),
    ).toThrow();
  });

  it("rejects invalid number and text data types", () => {
    expect(
      rowSubmissionPayloadSchema.safeParse({
        ...CURRENT_ROW,
        khoi_kien_thuc: "1",
      }).success,
    ).toBe(false);
    expect(
      rowSubmissionPayloadSchema.safeParse({
        ...CURRENT_ROW,
        ten_hoc_phan: 123,
      }).success,
    ).toBe(false);
  });

  it("preserves empty strings and accepts null only on nullable text fields", () => {
    const emptyTextPayload = rowSubmissionPayloadSchema.parse({
      ...CURRENT_ROW,
      ten_hoc_phan: "",
      tc1_tro_giang: null,
    });

    expect(emptyTextPayload.ten_hoc_phan).toBe("");
    expect(emptyTextPayload.tc1_tro_giang).toBeNull();
    expect(
      rowSubmissionPayloadSchema.safeParse({
        ...CURRENT_ROW,
        khoi_kien_thuc: null,
      }).success,
    ).toBe(false);
  });
});
