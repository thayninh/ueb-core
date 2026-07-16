import { createHash } from "node:crypto";

import { BUSINESS_FIELD_NAMES } from "./field-policy";
import { rowSubmissionPayloadSchema } from "./payload-schema";

export function canonicalizeRowSubmissionPayload(payload: unknown): string {
  const validatedPayload = rowSubmissionPayloadSchema.parse(payload);
  const canonicalPayload = Object.fromEntries(
    BUSINESS_FIELD_NAMES.map((field) => [field, validatedPayload[field]]),
  );

  return JSON.stringify(canonicalPayload);
}

export function calculateRowSubmissionChecksum(payload: unknown): string {
  return createHash("sha256")
    .update(canonicalizeRowSubmissionPayload(payload), "utf8")
    .digest("hex");
}

export function verifyRowSubmissionChecksum(
  payload: unknown,
  checksum: string,
): boolean {
  if (!/^[0-9a-f]{64}$/u.test(checksum)) {
    return false;
  }

  return calculateRowSubmissionChecksum(payload) === checksum;
}
