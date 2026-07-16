// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  new URL("../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

const modelBlock = schema.match(/model WorkflowEvent \{([\s\S]*?)\n\}/u)?.[1];

function enumValues(name: string): string[] {
  const block = schema.match(
    new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`, "u"),
  )?.[1];

  return (block ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("@@"));
}

describe("Phase 4 workflow Prisma schema", () => {
  it("defines the locked event and submission enums", () => {
    expect(enumValues("WorkflowEventType")).toEqual([
      "SUBMITTED",
      "REJECTED",
      "APPROVED",
    ]);
    expect(enumValues("WorkflowSubmissionType")).toEqual([
      "CONFIRM_UNCHANGED",
      "UPDATE_EXISTING",
      "CREATE_NEW",
    ]);
  });

  it("contains every row-workflow field", () => {
    expect(modelBlock).toBeDefined();

    const fields = [
      "eventId",
      "submissionId",
      "parentSubmissionId",
      "eventType",
      "submissionType",
      "recordUid",
      "lecturerUid",
      "approvalUnit",
      "baseStt",
      "baseVersionNo",
      "payload",
      "payloadChecksum",
      "actorUserId",
      "reason",
      "resultStt",
      "resultVersionNo",
      "createdAt",
    ] as const;

    for (const field of fields) {
      expect(modelBlock).toMatch(new RegExp(`^\\s*${field}\\s`, "mu"));
    }
  });

  it("uses UUID database types for workflow identifiers", () => {
    for (const field of [
      "eventId",
      "submissionId",
      "parentSubmissionId",
      "recordUid",
      "lecturerUid",
      "actorUserId",
    ]) {
      expect(modelBlock).toMatch(
        new RegExp(`^\\s*${field}\\s+[^\\n]*@db\\.Uuid$`, "mu"),
      );
    }
  });

  it("declares all seven workflow query indexes without duplicates", () => {
    const indexNames = [
      "workflow_event_submission_id_created_at_idx",
      "workflow_event_lecturer_uid_created_at_idx",
      "workflow_event_lecturer_uid_record_uid_created_at_idx",
      "workflow_event_approval_unit_created_at_idx",
      "workflow_event_event_type_created_at_idx",
      "workflow_event_record_uid_created_at_idx",
      "workflow_event_parent_submission_id_created_at_idx",
    ] as const;

    for (const indexName of indexNames) {
      expect(modelBlock?.match(new RegExp(indexName, "gu"))).toHaveLength(1);
    }
  });
});
