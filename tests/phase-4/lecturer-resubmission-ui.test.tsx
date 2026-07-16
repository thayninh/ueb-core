import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmUnchangedForm } from "@/components/workflow/confirm-unchanged-form";
import { EditableRowForm } from "@/components/workflow/editable-row-form";
import { LecturerResubmissionAction } from "@/components/workflow/lecturer-resubmission-action";
import { EDITABLE_BUSINESS_FIELD_NAMES } from "@/lib/workflow/field-policy";

import type {
  CoreBusinessRow,
  EditableBusinessFields,
} from "@/lib/workflow/types";

const mocks = vi.hoisted(() => ({
  submitUnchanged: vi.fn(),
  submitUpdated: vi.fn(),
  submitNew: vi.fn(),
}));

vi.mock("@/app/actions/workflow-submit", () => ({
  submitUnchangedRowFormAction: mocks.submitUnchanged,
  submitUpdatedRowFormAction: mocks.submitUpdated,
  submitNewRowFormAction: mocks.submitNew,
}));

const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const NEW_ID = "22222222-2222-4222-8222-222222222222";
const RECORD_UID = "33333333-3333-4333-8333-333333333333";
const failedResult = {
  success: false,
  fieldErrors: {},
  formError: null,
  errorCode: null,
  submission: null,
} as const;

const currentRow: CoreBusinessRow = {
  stt: 102,
  don_vi_phu_trach_hoc_phan: "Đơn vị hiện hành",
  bo_mon_phu_trach_hoc_phan: "Bộ môn hiện hành",
  khoi_kien_thuc: 2,
  ma_hoc_phan: "CURRENT-102",
  ten_hoc_phan: "Tên hiện hành",
  ten_giang_vien: "Giảng viên hiện hành",
  ma_so_can_bo: "GV-102",
  email_tai_khoan_vnu: "current@vnu.edu.vn",
  bo_mon: "Bộ môn hiện hành",
  don_vi: "Đơn vị hiện hành",
  core_1_2_3: "2",
  tc1_tro_giang: "Hiện hành",
  tc2_sh_chuyen_mon: null,
  tc3_tong_hop: null,
  tc3_1_nganh_tot_nghiep_phu_hop: null,
  tc3_2_bien_soan_de_cuong_giao_trinh: null,
  tc3_3_chu_nhiem_de_tai_nckh_lien_quan: null,
  tc3_4_bai_bao_lien_quan: null,
  tc4_giang_thu: null,
};

const rejectedDraft = Object.fromEntries(
  EDITABLE_BUSINESS_FIELD_NAMES.map((field) => [
    field,
    field === "khoi_kien_thuc" ? 7 : `Rejected ${field}`,
  ]),
) as unknown as EditableBusinessFields;

describe("Phase 4 lecturer resubmission UI", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitUnchanged.mockResolvedValue(failedResult);
    mocks.submitUpdated.mockResolvedValue(failedResult);
    mocks.submitNew.mockResolvedValue(failedResult);
  });

  it("shows the resubmit action only for a rejected submission", () => {
    const { rerender } = render(
      <LecturerResubmissionAction
        state="REJECTED"
        submissionId={PARENT_ID}
        submissionType="UPDATE_EXISTING"
      />,
    );
    expect(
      screen.getByRole("link", { name: "Chỉnh sửa và gửi lại" }),
    ).toHaveAttribute("href", `/lecturer/submissions/${PARENT_ID}/resubmit`);
    expect(screen.getByText(/mã submission mới/iu)).toBeInTheDocument();

    rerender(
      <LecturerResubmissionAction
        state="PENDING"
        submissionId={PARENT_ID}
        submissionType="UPDATE_EXISTING"
      />,
    );
    expect(
      screen.queryByRole("link", { name: /gửi lại/iu }),
    ).not.toBeInTheDocument();

    rerender(
      <LecturerResubmissionAction
        state="APPROVED"
        submissionId={PARENT_ID}
        submissionType="UPDATE_EXISTING"
      />,
    );
    expect(
      screen.queryByRole("link", { name: /gửi lại/iu }),
    ).not.toBeInTheDocument();
  });

  it("resubmits CONFIRM_UNCHANGED with latest base and no browser payload", async () => {
    const { container } = render(
      <ConfirmUnchangedForm
        baseStt={102}
        baseVersionNo={3}
        parentSubmissionId={PARENT_ID}
        recordUid={RECORD_UID}
        submissionId={NEW_ID}
      />,
    );
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(mocks.submitUnchanged).toHaveBeenCalledOnce());
    const formData = mocks.submitUnchanged.mock.calls[0]![1] as FormData;
    expect([...formData.keys()].sort()).toEqual([
      "baseStt",
      "baseVersionNo",
      "parentSubmissionId",
      "recordUid",
      "submissionId",
    ]);
    expect(formData.get("submissionId")).toBe(NEW_ID);
    expect(formData.get("parentSubmissionId")).toBe(PARENT_ID);
    expect(formData.get("submissionId")).not.toBe(PARENT_ID);
  });

  it("uses rejected editable values with latest read-only fields for UPDATE_EXISTING", async () => {
    const { container } = render(
      <EditableRowForm
        baseStt={102}
        baseVersionNo={3}
        currentRow={currentRow}
        initialEditableFields={rejectedDraft}
        kind="UPDATE_EXISTING"
        parentSubmissionId={PARENT_ID}
        recordUid={RECORD_UID}
        submissionId={NEW_ID}
      />,
    );
    expect(screen.getByLabelText("Tên học phần")).toHaveValue(
      "Rejected ten_hoc_phan",
    );
    expect(screen.getByText("Giảng viên hiện hành")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tên học phần"), {
      target: { value: "Người dùng đã chỉnh draft" },
    });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(mocks.submitUpdated).toHaveBeenCalledOnce());
    const formData = mocks.submitUpdated.mock.calls[0]![1] as FormData;
    const payload = JSON.parse(
      String(formData.get("editableFields")),
    ) as Record<string, unknown>;
    expect(payload.ten_hoc_phan).toBe("Người dùng đã chỉnh draft");
    expect(payload).not.toHaveProperty("stt");
    expect(payload).not.toHaveProperty("ten_giang_vien");
    expect(formData.get("parentSubmissionId")).toBe(PARENT_ID);
    expect(formData.get("baseStt")).toBe("102");
    expect(formData.get("baseVersionNo")).toBe("3");
  });

  it("resubmits CREATE_NEW without record, identity, STT, or base inputs", async () => {
    const { container } = render(
      <EditableRowForm
        initialEditableFields={rejectedDraft}
        kind="CREATE_NEW"
        parentSubmissionId={PARENT_ID}
        submissionId={NEW_ID}
      />,
    );
    for (const field of [
      "recordUid",
      "stt",
      "lecturerUid",
      "approvalUnit",
      "actorUserId",
      "versionNo",
      "baseStt",
      "baseVersionNo",
      "resultStt",
      "resultVersionNo",
      "payloadChecksum",
    ]) {
      expect(container.querySelector(`[name="${field}"]`)).toBeNull();
    }
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(mocks.submitNew).toHaveBeenCalledOnce());
    const formData = mocks.submitNew.mock.calls[0]![1] as FormData;
    expect([...formData.keys()].sort()).toEqual([
      "editableFields",
      "parentSubmissionId",
      "submissionId",
    ]);
  });

  it("keeps one new submission ID across double-click retries", async () => {
    const { container } = render(
      <EditableRowForm
        initialEditableFields={rejectedDraft}
        kind="CREATE_NEW"
        parentSubmissionId={PARENT_ID}
        submissionId={NEW_ID}
      />,
    );
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.submitNew).toHaveBeenCalledTimes(2));
    for (const [, formData] of mocks.submitNew.mock.calls) {
      expect((formData as FormData).get("submissionId")).toBe(NEW_ID);
      expect((formData as FormData).get("submissionId")).not.toBe(PARENT_ID);
    }
  });
});
