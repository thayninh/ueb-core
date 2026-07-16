import type {
  IdentityInputIssue,
  IdentityInputValidationSummary,
} from "./identity-input-schema";

export function formatIdentityValidationReport(
  summary: IdentityInputValidationSummary,
  inputChecksum: string,
): string {
  const status = summary.unresolvedAmbiguityCount === 0 ? "PASS" : "FAIL";
  const lines = [
    `IDENTITY_INPUT_VALIDATION=${status}`,
    "MODE=DRY_RUN",
    `APPROVAL_BATCH_COUNT=${summary.approvalBatchCount}`,
    `LECTURER_RECORD_COUNT=${summary.lecturerRecordCount}`,
    `LEADER_RECORD_COUNT=${summary.leaderRecordCount}`,
    `UNIT_SCOPE_COUNT=${summary.unitScopeCount}`,
    `DUPLICATE_EMAIL_COUNT=${summary.duplicateEmailCount}`,
    `DUPLICATE_LECTURER_UID_COUNT=${summary.duplicateLecturerUidCount}`,
    `DUPLICATE_ROLE_COUNT=${summary.duplicateRoleCount}`,
    `DUPLICATE_SCOPE_COUNT=${summary.duplicateScopeCount}`,
    `UNKNOWN_UNIT_COUNT=${summary.unknownUnitCount}`,
    `UNRESOLVED_AMBIGUITY_COUNT=${summary.unresolvedAmbiguityCount}`,
    `INPUT_CHECKSUM=${inputChecksum}`,
    "DATABASE_CONNECTIONS=0",
    "DATABASE_WRITES=0",
  ];
  summary.issues.forEach((issue, index) => {
    lines.push(...formatIssue(issue, index + 1));
  });
  return lines.join("\n");
}

function formatIssue(
  issue: IdentityInputIssue,
  index: number,
): readonly string[] {
  return [
    `ERROR_${index}_ROW=${issue.source}:${issue.rowNumber}`,
    `ERROR_${index}_CODE=${issue.code}`,
  ];
}
