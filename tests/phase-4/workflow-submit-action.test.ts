// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  submitNewRowAction,
  submitUnchangedRowAction,
  submitUpdatedRowAction,
} from "@/app/actions/workflow-submit";
import { WorkflowError } from "@/lib/workflow/errors";

const mocks = vi.hoisted(() => ({
  requireLecturerIdentity: vi.fn(),
  revalidatePath: vi.fn(),
  submitUnchangedRow: vi.fn(),
  submitUpdatedRow: vi.fn(),
  submitNewRow: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/authorization", () => ({
  requireLecturerIdentity: mocks.requireLecturerIdentity,
}));
vi.mock("@/lib/workflow/submit-service", () => ({
  submitUnchangedRow: mocks.submitUnchangedRow,
  submitUpdatedRow: mocks.submitUpdatedRow,
  submitNewRow: mocks.submitNewRow,
}));

const SUBMISSION_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_UID = "22222222-2222-4222-8222-222222222222";
const LECTURER_UID = "33333333-3333-4333-8333-333333333333";
const submittedAt = new Date("2026-07-16T04:00:00.000Z");

const editableFields = {
  don_vi_phu_trach_hoc_phan: "Unit A",
  bo_mon_phu_trach_hoc_phan: "Department A",
  khoi_kien_thuc: 1,
  ma_hoc_phan: "P4-101",
  ten_hoc_phan: "Phase 4",
  core_1_2_3: "1",
  tc1_tro_giang: "yes",
  tc2_sh_chuyen_mon: "yes",
  tc3_tong_hop: "yes",
  tc3_1_nganh_tot_nghiep_phu_hop: "yes",
  tc3_2_bien_soan_de_cuong_giao_trinh: "yes",
  tc3_3_chu_nhiem_de_tai_nckh_lien_quan: "yes",
  tc3_4_bai_bao_lien_quan: "yes",
  tc4_giang_thu: "yes",
} as const;

describe("Phase 4 workflow submit Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireLecturerIdentity.mockResolvedValue({
      userId: "44444444-4444-4444-8444-444444444444",
      lecturerUid: LECTURER_UID,
    });
    mocks.submitUnchangedRow.mockResolvedValue(dto("CONFIRM_UNCHANGED"));
    mocks.submitUpdatedRow.mockResolvedValue(dto("UPDATE_EXISTING"));
    mocks.submitNewRow.mockResolvedValue(dto("CREATE_NEW"));
  });

  it("1. sends a valid unchanged request to the unchanged service", async () => {
    const result = await submitUnchangedRowAction(unchangedForm());
    expect(result.success).toBe(true);
    expect(mocks.submitUnchangedRow).toHaveBeenCalledWith({
      submissionId: SUBMISSION_ID,
      recordUid: RECORD_UID,
      baseStt: 42,
      baseVersionNo: 1,
    });
  });

  it("2. sends a valid update request with exact editable fields", async () => {
    const result = await submitUpdatedRowAction(updateForm());
    expect(result.success).toBe(true);
    expect(mocks.submitUpdatedRow).toHaveBeenCalledWith(
      expect.objectContaining({ editableFields }),
    );
  });

  it("3. sends a valid create request without a record UID", async () => {
    const result = await submitNewRowAction(createForm());
    expect(result.success).toBe(true);
    expect(mocks.submitNewRow).toHaveBeenCalledWith({
      submissionId: SUBMISSION_ID,
      editableFields,
    });
  });

  it("4. rejects an unknown top-level field", async () => {
    const form = unchangedForm();
    form.set("unexpected", "value");
    await expect(submitUnchangedRowAction(form)).resolves.toMatchObject({
      success: false,
      submission: null,
    });
    expect(mocks.submitUnchangedRow).not.toHaveBeenCalled();
  });

  it("5. rejects a forged lecturer UID hidden field", async () => {
    const form = createForm();
    form.set("lecturerUid", LECTURER_UID);
    expect((await submitNewRowAction(form)).success).toBe(false);
  });

  it("6. rejects a forged approval unit hidden field", async () => {
    const form = createForm();
    form.set("approvalUnit", "Forged Unit");
    expect((await submitNewRowAction(form)).success).toBe(false);
  });

  it("7. rejects an STT override", async () => {
    const form = updateForm();
    form.set("stt", "9999");
    expect((await submitUpdatedRowAction(form)).success).toBe(false);
  });

  it("8. rejects record UID in CREATE_NEW", async () => {
    const form = createForm();
    form.set("recordUid", RECORD_UID);
    expect((await submitNewRowAction(form)).success).toBe(false);
  });

  it("9. maps WorkflowError to its stable safe message", async () => {
    mocks.submitUnchangedRow.mockRejectedValue(
      new WorkflowError("WORKFLOW_STALE_BASE"),
    );
    const result = await submitUnchangedRowAction(unchangedForm());
    expect(result).toMatchObject({
      success: false,
      formError: "The submission is based on an outdated record version.",
      submission: null,
    });
  });

  it("10. maps an unknown error to a generic message", async () => {
    mocks.submitNewRow.mockRejectedValue(new Error("internal detail"));
    const result = await submitNewRowAction(createForm());
    expect(result.formError).toBe("The submission could not be completed.");
  });

  it("11. never exposes Prisma, SQL, or constraint details", async () => {
    mocks.submitNewRow.mockRejectedValue(
      new Error("Prisma P2002 workflow_event_constraint SQL"),
    );
    const result = await submitNewRowAction(createForm());
    expect(result.formError).not.toMatch(/Prisma|P2002|workflow_event|SQL/u);
  });

  it("12. reauthorizes every valid request inside the action", async () => {
    await submitUnchangedRowAction(unchangedForm());
    await submitUpdatedRowAction(updateForm());
    await submitNewRowAction(createForm());
    expect(mocks.requireLecturerIdentity).toHaveBeenCalledTimes(3);
  });

  it("13. revalidates all three workflow views only after success", async () => {
    await submitUnchangedRowAction(unchangedForm());
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/lecturer/profile"],
      ["/lecturer/submissions"],
      ["/dashboard"],
    ]);

    vi.clearAllMocks();
    mocks.requireLecturerIdentity.mockResolvedValue({});
    mocks.submitUnchangedRow.mockRejectedValue(new Error("failure"));
    await submitUnchangedRowAction(unchangedForm());
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("14. preserves the client submission ID on retry", async () => {
    await submitNewRowAction(createForm());
    await submitNewRowAction(createForm());
    expect(mocks.submitNewRow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ submissionId: SUBMISSION_ID }),
    );
    expect(mocks.submitNewRow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ submissionId: SUBMISSION_ID }),
    );
  });

  it("rejects read-only values embedded in editableFields", async () => {
    const form = updateForm();
    form.set(
      "editableFields",
      JSON.stringify({ ...editableFields, ten_giang_vien: "Forged" }),
    );
    expect((await submitUpdatedRowAction(form)).success).toBe(false);
    expect(mocks.submitUpdatedRow).not.toHaveBeenCalled();
  });

  it("ignores only framework-owned action metadata", async () => {
    const form = unchangedForm();
    form.set("$ACTION_ID_example", "framework metadata");
    expect((await submitUnchangedRowAction(form)).success).toBe(true);
  });

  it("rejects duplicated form keys", async () => {
    const form = unchangedForm();
    form.append("recordUid", RECORD_UID);
    expect((await submitUnchangedRowAction(form)).success).toBe(false);
  });
});

function unchangedForm(): FormData {
  const form = new FormData();
  form.set("submissionId", SUBMISSION_ID);
  form.set("recordUid", RECORD_UID);
  form.set("baseStt", "42");
  form.set("baseVersionNo", "1");
  return form;
}

function updateForm(): FormData {
  const form = unchangedForm();
  form.set("editableFields", JSON.stringify(editableFields));
  return form;
}

function createForm(): FormData {
  const form = new FormData();
  form.set("submissionId", SUBMISSION_ID);
  form.set("editableFields", JSON.stringify(editableFields));
  return form;
}

function dto(
  submissionType: "CONFIRM_UNCHANGED" | "UPDATE_EXISTING" | "CREATE_NEW",
) {
  return {
    submissionId: SUBMISSION_ID,
    submissionType,
    recordUid: RECORD_UID,
    state: "PENDING" as const,
    submittedAt,
    baseStt: submissionType === "CREATE_NEW" ? null : 42,
    baseVersionNo: submissionType === "CREATE_NEW" ? null : 1,
  };
}
