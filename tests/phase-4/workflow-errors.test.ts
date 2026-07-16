// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  WORKFLOW_ERROR_CODES,
  WorkflowError,
  getWorkflowHttpStatus,
  isWorkflowError,
} from "../../src/lib/workflow";

describe("Phase 4 workflow errors", () => {
  it("defines every required stable error code", () => {
    expect(WORKFLOW_ERROR_CODES).toEqual([
      "WORKFLOW_INVALID_STATE",
      "WORKFLOW_ALREADY_PENDING",
      "WORKFLOW_STALE_BASE",
      "WORKFLOW_NOT_OWNER",
      "WORKFLOW_UNIT_UNRESOLVED",
      "WORKFLOW_SCOPE_DENIED",
      "WORKFLOW_ALREADY_TERMINAL",
      "WORKFLOW_PAYLOAD_MISMATCH",
      "WORKFLOW_INVALID_PAYLOAD",
      "WORKFLOW_RECORD_NOT_FOUND",
      "WORKFLOW_SUBMISSION_NOT_FOUND",
    ]);
  });

  it("maps every code to a reviewed HTTP status", () => {
    for (const code of WORKFLOW_ERROR_CODES) {
      expect([400, 403, 404, 409]).toContain(getWorkflowHttpStatus(code));
      expect(new WorkflowError(code).httpStatus).toBe(
        getWorkflowHttpStatus(code),
      );
    }
    expect(getWorkflowHttpStatus("WORKFLOW_INVALID_PAYLOAD")).toBe(400);
    expect(getWorkflowHttpStatus("WORKFLOW_SCOPE_DENIED")).toBe(403);
    expect(getWorkflowHttpStatus("WORKFLOW_RECORD_NOT_FOUND")).toBe(404);
    expect(getWorkflowHttpStatus("WORKFLOW_STALE_BASE")).toBe(409);
  });

  it("uses generic default messages without identifiers or PII", () => {
    for (const code of WORKFLOW_ERROR_CODES) {
      const error = new WorkflowError(code);
      expect(error.message).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f-]{27,}/iu);
      expect(error.message).not.toContain("lecturer@example.test");
      expect(error.name).toBe("WorkflowError");
    }
  });

  it("recognizes only WorkflowError instances", () => {
    expect(isWorkflowError(new WorkflowError("WORKFLOW_INVALID_STATE"))).toBe(
      true,
    );
    expect(isWorkflowError(new Error("unknown"))).toBe(false);
    expect(isWorkflowError({ code: "WORKFLOW_INVALID_STATE" })).toBe(false);
    expect(isWorkflowError(null)).toBe(false);
  });
});
