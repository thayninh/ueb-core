import { describe, expect, it } from "vitest";

import { diffSubmittedRow } from "@/lib/workflow/diff";
import { SUBMISSION_PAYLOAD_FIELD_NAMES } from "@/lib/workflow/field-policy";

import type {
  CoreBusinessRow,
  RowSubmissionPayload,
} from "@/lib/workflow/types";

describe("Phase 4 workflow diff", () => {
  it("marks a CONFIRM_UNCHANGED payload as unchanged", () => {
    const current = coreRow();
    const diff = diffSubmittedRow({
      currentRow: current,
      submittedPayload: payload(current),
      submissionType: "CONFIRM_UNCHANGED",
    });
    expect(diff).toHaveLength(19);
    expect(diff.every(({ changeType }) => changeType === "UNCHANGED")).toBe(
      true,
    );
  });

  it("marks only changed UPDATE_EXISTING values as modified", () => {
    const current = coreRow();
    const submitted = {
      ...payload(current),
      ten_hoc_phan: "Tên học phần đã sửa",
      tc1_tro_giang: "Có",
    };
    const diff = diffSubmittedRow({
      currentRow: current,
      submittedPayload: submitted,
      submissionType: "UPDATE_EXISTING",
    });
    expect(
      diff
        .filter(({ changeType }) => changeType === "MODIFIED")
        .map(({ field }) => field),
    ).toEqual(["ten_hoc_phan", "tc1_tro_giang"]);
  });

  it("marks all nineteen CREATE_NEW fields as new", () => {
    const diff = diffSubmittedRow({
      currentRow: null,
      submittedPayload: payload(coreRow()),
      submissionType: "CREATE_NEW",
    });
    expect(diff).toHaveLength(19);
    expect(diff.every(({ changeType }) => changeType === "NEW")).toBe(true);
  });

  it("never includes generated STT in the payload diff", () => {
    const diff = diffSubmittedRow({
      currentRow: coreRow(),
      submittedPayload: payload(coreRow()),
      submissionType: "UPDATE_EXISTING",
    });
    expect(diff.map(({ field }) => field)).not.toContain("stt");
  });

  it("does not normalize null and empty string to the same value", () => {
    const current = coreRow();
    const submitted = { ...payload(current), tc1_tro_giang: "" };
    const item = diffSubmittedRow({
      currentRow: current,
      submittedPayload: submitted,
      submissionType: "UPDATE_EXISTING",
    }).find(({ field }) => field === "tc1_tro_giang");
    expect(item).toMatchObject({
      before: null,
      after: "",
      changeType: "MODIFIED",
    });
  });

  it("does not mutate either input", () => {
    const current = coreRow();
    const submitted = payload(current);
    const currentBefore = structuredClone(current);
    const submittedBefore = structuredClone(submitted);
    diffSubmittedRow({
      currentRow: current,
      submittedPayload: submitted,
      submissionType: "CONFIRM_UNCHANGED",
    });
    expect(current).toEqual(currentBefore);
    expect(submitted).toEqual(submittedBefore);
  });
});

function coreRow(): CoreBusinessRow {
  return {
    stt: 42,
    don_vi_phu_trach_hoc_phan: "Unit A",
    bo_mon_phu_trach_hoc_phan: "Bộ môn A",
    khoi_kien_thuc: 1,
    ma_hoc_phan: "P4-DIFF",
    ten_hoc_phan: "Học phần diff",
    ten_giang_vien: "Giảng viên A",
    ma_so_can_bo: "CB-A",
    email_tai_khoan_vnu: "a@example.invalid",
    bo_mon: "Bộ môn A",
    don_vi: "Unit A",
    core_1_2_3: "1",
    tc1_tro_giang: null,
    tc2_sh_chuyen_mon: null,
    tc3_tong_hop: null,
    tc3_1_nganh_tot_nghiep_phu_hop: null,
    tc3_2_bien_soan_de_cuong_giao_trinh: null,
    tc3_3_chu_nhiem_de_tai_nckh_lien_quan: null,
    tc3_4_bai_bao_lien_quan: null,
    tc4_giang_thu: null,
  };
}

function payload(row: CoreBusinessRow): RowSubmissionPayload {
  return Object.fromEntries(
    SUBMISSION_PAYLOAD_FIELD_NAMES.map((field) => [field, row[field]]),
  ) as unknown as RowSubmissionPayload;
}
