import { z } from "zod";

export const REJECT_REASON_MAX_LENGTH = 2_000;

export const rejectSubmissionInputSchema = z
  .object({
    submissionId: z.uuid(),
    reason: z
      .string()
      .trim()
      .min(3, "Lý do từ chối phải có ít nhất 3 ký tự.")
      .max(
        REJECT_REASON_MAX_LENGTH,
        `Lý do từ chối không được vượt quá ${REJECT_REASON_MAX_LENGTH} ký tự.`,
      ),
  })
  .strict();

export type RejectSubmissionInput = z.infer<typeof rejectSubmissionInputSchema>;
