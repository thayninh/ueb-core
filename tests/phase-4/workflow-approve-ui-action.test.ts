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

import {
  approveSubmissionFormAction,
  type WorkflowApproveActionResult,
} from "@/app/actions/workflow-approve";

const INITIAL: WorkflowApproveActionResult = {
  success: false,
  fieldErrors: {},
  formError: null,
  errorCode: null,
  approval: null,
};

describe("Phase 4 approval UI action boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ userId: randomUUID() });
    mocks.approve.mockResolvedValue({
      submissionId: randomUUID(),
      submissionType: "CONFIRM_UNCHANGED",
      recordUid: randomUUID(),
      state: "APPROVED",
      resultStt: 50001,
      resultVersionNo: 2,
      approvedAt: new Date(),
    });
  });

  it("passes only submissionId through the useActionState adapter", async () => {
    const submissionId = randomUUID();
    const result = await approveSubmissionFormAction(
      INITIAL,
      form(submissionId),
    );
    expect(result.success).toBe(true);
    expect(mocks.approve).toHaveBeenCalledWith({ submissionId });
  });

  it.each([
    ["WORKFLOW_ALREADY_TERMINAL", "Bản gửi này đã được xử lý."],
    [
      "WORKFLOW_STALE_BASE",
      "Dữ liệu đã thay đổi; bản gửi không thể được phê duyệt.",
    ],
    ["WORKFLOW_SCOPE_DENIED", "Bạn không có quyền xử lý bản gửi này."],
    [
      "WORKFLOW_SUBMISSION_NOT_FOUND",
      "Không tìm thấy bản gửi hoặc bạn không có quyền truy cập.",
    ],
  ] as const)("maps %s without internal details", async (code, message) => {
    mocks.approve.mockRejectedValue(new WorkflowError(code));
    const result = await approveSubmissionFormAction(
      INITIAL,
      form(randomUUID()),
    );
    expect(result).toMatchObject({
      success: false,
      errorCode: code,
      formError: message,
    });
  });

  it("does not expose an unexpected database error", async () => {
    mocks.approve.mockRejectedValue(
      new Error(
        'validate_phase4_approved_core_insert violated constraint "secret"',
      ),
    );
    const result = await approveSubmissionFormAction(
      INITIAL,
      form(randomUUID()),
    );
    expect(result.formError).toBe(
      "Không thể hoàn tất phê duyệt. Vui lòng thử lại.",
    );
    expect(JSON.stringify(result)).not.toMatch(
      /constraint|trigger|sql|prisma/iu,
    );
  });

  it("rejects forged identity and routing fields before service execution", async () => {
    const input = form(randomUUID());
    input.set("approvalUnit", "Unit B");
    const result = await approveSubmissionFormAction(INITIAL, input);
    expect(result.errorCode).toBe("VALIDATION_ERROR");
    expect(mocks.approve).not.toHaveBeenCalled();
  });
});

function form(submissionId: string): FormData {
  const input = new FormData();
  input.set("submissionId", submissionId);
  return input;
}
