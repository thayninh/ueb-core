// @vitest-environment node

import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowError } from "@/lib/workflow/errors";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  approve: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/authorization", () => ({
  requireAnyRole: mocks.authorize,
}));
vi.mock("@/lib/workflow/approve-service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/workflow/approve-service")>();
  return { ...original, approveSubmission: mocks.approve };
});

import { approveSubmissionAction } from "@/app/actions/workflow-approve";

describe("Phase 4 workflow approve action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ userId: randomUUID() });
    mocks.approve.mockResolvedValue({
      submissionId: randomUUID(),
      submissionType: "UPDATE_EXISTING",
      recordUid: randomUUID(),
      state: "APPROVED",
      resultStt: 2570,
      resultVersionNo: 2,
      approvedAt: new Date("2026-07-16T00:00:00Z"),
    });
  });

  it("strictly accepts only submissionId", async () => {
    const submissionId = randomUUID();
    const result = await approveSubmissionAction(form(submissionId));
    expect(result.success).toBe(true);
    expect(mocks.authorize).toHaveBeenCalledOnce();
    expect(mocks.approve).toHaveBeenCalledWith({ submissionId });
  });

  it.each([
    "lecturerUid",
    "recordUid",
    "approvalUnit",
    "payload",
    "versionNo",
    "stt",
    "approvedBy",
    "approvedAt",
  ])("rejects forbidden field %s", async (field) => {
    const input = form(randomUUID());
    input.set(field, "forged");
    const result = await approveSubmissionAction(input);
    expect(result.errorCode).toBe("VALIDATION_ERROR");
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("rejects duplicate fields", async () => {
    const input = new FormData();
    input.append("submissionId", randomUUID());
    input.append("submissionId", randomUUID());
    const result = await approveSubmissionAction(input);
    expect(result.errorCode).toBe("VALIDATION_ERROR");
  });

  it("maps stale and terminal conflicts safely", async () => {
    mocks.approve.mockRejectedValueOnce(
      new WorkflowError("WORKFLOW_STALE_BASE"),
    );
    const stale = await approveSubmissionAction(form(randomUUID()));
    expect(stale).toMatchObject({
      success: false,
      errorCode: "WORKFLOW_STALE_BASE",
    });

    mocks.approve.mockRejectedValueOnce(
      new WorkflowError("WORKFLOW_ALREADY_TERMINAL"),
    );
    const terminal = await approveSubmissionAction(form(randomUUID()));
    expect(terminal).toMatchObject({
      success: false,
      errorCode: "WORKFLOW_ALREADY_TERMINAL",
    });
  });

  it("does not expose SQL, constraint or trigger errors", async () => {
    mocks.approve.mockRejectedValue(
      new Error(
        'duplicate key violates constraint "ueb_core_data_source_submission_id_key" in validate_phase4_approved_core_insert',
      ),
    );
    const result = await approveSubmissionAction(form(randomUUID()));
    expect(result.formError).toBe(
      "Không thể hoàn tất phê duyệt. Vui lòng thử lại.",
    );
    expect(JSON.stringify(result)).not.toMatch(/constraint|trigger|payload/iu);
  });

  it("revalidates all affected leader, lecturer and dashboard paths", async () => {
    const submissionId = randomUUID();
    mocks.approve.mockResolvedValue({
      submissionId,
      submissionType: "CREATE_NEW",
      recordUid: randomUUID(),
      state: "APPROVED",
      resultStt: 2571,
      resultVersionNo: 1,
      approvedAt: new Date(),
    });
    await approveSubmissionAction(form(submissionId));
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/leader/submissions",
      `/leader/submissions/${submissionId}`,
      "/lecturer/profile",
      "/lecturer/submissions",
      `/lecturer/submissions/${submissionId}`,
      "/dashboard",
    ]);
  });
});

function form(submissionId: string): FormData {
  const data = new FormData();
  data.set("submissionId", submissionId);
  return data;
}
