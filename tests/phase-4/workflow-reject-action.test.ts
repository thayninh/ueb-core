// @vitest-environment node

import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowError } from "@/lib/workflow/errors";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  reject: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/authorization", () => ({
  requireAnyRole: mocks.authorize,
}));
vi.mock("@/lib/workflow/reject-service", () => ({
  rejectSubmission: mocks.reject,
}));

import { rejectSubmissionAction } from "@/app/actions/workflow-reject";

describe("Phase 4 workflow reject action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ userId: randomUUID() });
    mocks.reject.mockResolvedValue({
      submissionId: randomUUID(),
      submissionType: "UPDATE_EXISTING",
      recordUid: randomUUID(),
      state: "REJECTED",
      reason: "Cần bổ sung minh chứng.",
      rejectedAt: new Date("2026-07-16T00:00:00Z"),
    });
  });

  it.each(["", "   "])("rejects an empty reason %#", async (reason) => {
    const result = await rejectSubmissionAction(form(reason));
    expect(result).toMatchObject({
      success: false,
      errorCode: "VALIDATION_ERROR",
    });
    expect(mocks.reject).not.toHaveBeenCalled();
  });

  it("rejects a reason over 2,000 characters", async () => {
    const result = await rejectSubmissionAction(form("x".repeat(2_001)));
    expect(result.errorCode).toBe("VALIDATION_ERROR");
    expect(mocks.reject).not.toHaveBeenCalled();
  });

  it.each(["approvalUnit", "actorUserId", "lecturerUid"])(
    "rejects forbidden hidden field %s",
    async (field) => {
      const input = form("Lý do hợp lệ");
      input.set(field, "forged");
      const result = await rejectSubmissionAction(input);
      expect(result.errorCode).toBe("VALIDATION_ERROR");
      expect(mocks.reject).not.toHaveBeenCalled();
    },
  );

  it("trims the reason, reauthorizes and revalidates affected paths", async () => {
    const submissionId = randomUUID();
    const rejection = {
      submissionId,
      submissionType: "CREATE_NEW",
      recordUid: randomUUID(),
      state: "REJECTED",
      reason: "Lý do hợp lệ",
      rejectedAt: new Date(),
    };
    mocks.reject.mockResolvedValue(rejection);
    const result = await rejectSubmissionAction(
      form("  Lý do hợp lệ  ", submissionId),
    );
    expect(result).toMatchObject({ success: true, rejection });
    expect(mocks.authorize).toHaveBeenCalledOnce();
    expect(mocks.reject).toHaveBeenCalledWith({
      submissionId,
      reason: "Lý do hợp lệ",
    });
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/leader/submissions",
      `/leader/submissions/${submissionId}`,
      "/lecturer/submissions",
      `/lecturer/submissions/${submissionId}`,
      "/dashboard",
    ]);
  });

  it("maps terminal conflicts without exposing database details", async () => {
    mocks.reject.mockRejectedValue(
      new WorkflowError("WORKFLOW_ALREADY_TERMINAL"),
    );
    const result = await rejectSubmissionAction(form("Lý do hợp lệ"));
    expect(result).toMatchObject({
      success: false,
      errorCode: "WORKFLOW_ALREADY_TERMINAL",
      formError: "Bản gửi này đã được xử lý trước đó.",
    });
  });

  it("does not expose unknown SQL errors", async () => {
    mocks.reject.mockRejectedValue(
      new Error(
        'duplicate key violates constraint "workflow_event_one_terminal_per_submission_key"',
      ),
    );
    const result = await rejectSubmissionAction(form("Lý do hợp lệ"));
    expect(result.formError).toBe(
      "Không thể hoàn tất quyết định. Vui lòng thử lại.",
    );
    expect(JSON.stringify(result)).not.toContain("constraint");
  });
});

function form(reason: string, submissionId = randomUUID()): FormData {
  const data = new FormData();
  data.set("submissionId", submissionId);
  data.set("reason", reason);
  return data;
}
