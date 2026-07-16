import { z } from "zod";

export const APPROVED_UNIT_UIDS = [
  "KTPT",
  "QTKD",
  "KTKDQT",
  "KTCT",
  "TCNH",
  "KTKT",
] as const;

export const IDENTITY_INPUT_ERROR_CODES = [
  "DOCUMENT_NOT_ARRAY",
  "INPUT_RECORD_LIMIT_EXCEEDED",
  "ROW_SCHEMA_INVALID",
  "APPROVAL_BATCH_AMBIGUOUS",
  "DUPLICATE_EMAIL",
  "DUPLICATE_LECTURER_UID",
  "DUPLICATE_ROLE",
  "DUPLICATE_SCOPE",
  "UNKNOWN_UNIT",
  "LECTURER_ROLE_MISSING",
  "LEADER_ROLE_MISSING",
  "LEADER_SCOPE_MISSING",
  "UNSUPPORTED_ROLE_FOR_INPUT",
  "INPUT_FILE_GUARD_FAILED",
  "INPUT_PARSE_FAILED",
] as const;

export type IdentityInputErrorCode =
  (typeof IDENTITY_INPUT_ERROR_CODES)[number];
export type IdentityInputSource = "LECTURERS" | "LEADERS" | "BATCH";

export interface IdentityInputIssue {
  readonly source: IdentityInputSource;
  readonly rowNumber: number;
  readonly code: IdentityInputErrorCode;
}

export interface IdentityInputValidationSummary {
  readonly approvalBatchCount: number;
  readonly lecturerRecordCount: number;
  readonly leaderRecordCount: number;
  readonly unitScopeCount: number;
  readonly duplicateEmailCount: number;
  readonly duplicateLecturerUidCount: number;
  readonly duplicateRoleCount: number;
  readonly duplicateScopeCount: number;
  readonly unknownUnitCount: number;
  readonly unresolvedAmbiguityCount: number;
  readonly issues: readonly IdentityInputIssue[];
}

const MAX_RECORDS_PER_INPUT = 100;
const BUSINESS_ROLES = ["LECTURER", "FACULTY_LEADER", "ADMIN"] as const;
const approvedTimestamp = z
  .string()
  .trim()
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
        value,
      ) && !Number.isNaN(Date.parse(value)),
  );
const opaqueApprovalValue = z.string().trim().min(1).max(128);
const commonApprovalFields = {
  approval_batch_id: opaqueApprovalValue,
  approved_at: approvedTimestamp,
  approved_by: opaqueApprovalValue,
  email: z.string().trim().toLowerCase().pipe(z.email()),
  requested_roles: z.array(z.enum(BUSINESS_ROLES)).min(1),
} as const;

export const approvedLecturerSchema = z
  .object({
    ...commonApprovalFields,
    lecturer_uid: z.uuid(),
    account_action: z.enum(["CREATE", "REUSE"]),
  })
  .strict();

export const approvedLeaderSchema = z
  .object({
    ...commonApprovalFields,
    unit_uid: z.array(z.string().trim().min(1)).min(1),
    scope_action: z.enum(["ASSIGN", "RETAIN"]),
  })
  .strict();

export type ApprovedLecturerInput = z.infer<typeof approvedLecturerSchema>;
export type ApprovedLeaderInput = z.infer<typeof approvedLeaderSchema>;

interface Row<T> {
  readonly rowNumber: number;
  readonly value: T;
}

export function validateIdentityInputDocuments(
  lecturerDocument: unknown,
  leaderDocument: unknown,
): IdentityInputValidationSummary {
  const issues: IdentityInputIssue[] = [];
  const lecturers = parseRows(
    lecturerDocument,
    approvedLecturerSchema,
    "LECTURERS",
    issues,
  );
  const leaders = parseRows(
    leaderDocument,
    approvedLeaderSchema,
    "LEADERS",
    issues,
  );

  let duplicateRoleCount = 0;
  let duplicateScopeCount = 0;
  let unknownUnitCount = 0;
  let unitScopeCount = 0;
  for (const row of lecturers) {
    if (hasDuplicates(row.value.requested_roles)) {
      duplicateRoleCount += 1;
      issues.push(issue("LECTURERS", row.rowNumber, "DUPLICATE_ROLE"));
    }
    if (!row.value.requested_roles.includes("LECTURER")) {
      issues.push(issue("LECTURERS", row.rowNumber, "LECTURER_ROLE_MISSING"));
    }
    if (row.value.requested_roles.some((role) => role !== "LECTURER")) {
      issues.push(
        issue("LECTURERS", row.rowNumber, "UNSUPPORTED_ROLE_FOR_INPUT"),
      );
    }
  }

  const approvedUnits = new Set<string>(APPROVED_UNIT_UIDS);
  const scopeKeys = new Map<string, Array<Row<ApprovedLeaderInput>>>();
  for (const row of leaders) {
    if (hasDuplicates(row.value.requested_roles)) {
      duplicateRoleCount += 1;
      issues.push(issue("LEADERS", row.rowNumber, "DUPLICATE_ROLE"));
    }
    if (!row.value.requested_roles.includes("FACULTY_LEADER")) {
      issues.push(issue("LEADERS", row.rowNumber, "LEADER_ROLE_MISSING"));
    }
    if (row.value.requested_roles.some((role) => role !== "FACULTY_LEADER")) {
      issues.push(
        issue("LEADERS", row.rowNumber, "UNSUPPORTED_ROLE_FOR_INPUT"),
      );
    }
    if (row.value.unit_uid.length === 0) {
      issues.push(issue("LEADERS", row.rowNumber, "LEADER_SCOPE_MISSING"));
    }
    const distinctScopes = new Set(row.value.unit_uid);
    unitScopeCount += distinctScopes.size;
    if (distinctScopes.size !== row.value.unit_uid.length) {
      duplicateScopeCount += 1;
      issues.push(issue("LEADERS", row.rowNumber, "DUPLICATE_SCOPE"));
    }
    for (const unitUid of distinctScopes) {
      if (!approvedUnits.has(unitUid)) {
        unknownUnitCount += 1;
        issues.push(issue("LEADERS", row.rowNumber, "UNKNOWN_UNIT"));
      }
      const key = `${row.value.email}\u0000${unitUid}`;
      const matches = scopeKeys.get(key) ?? [];
      matches.push(row);
      scopeKeys.set(key, matches);
    }
  }
  for (const matches of scopeKeys.values()) {
    if (matches.length <= 1) continue;
    duplicateScopeCount += 1;
    for (const match of matches) {
      issues.push(issue("LEADERS", match.rowNumber, "DUPLICATE_SCOPE"));
    }
  }

  const allIdentities = [
    ...lecturers.map((row) => ({ ...row, source: "LECTURERS" as const })),
    ...leaders.map((row) => ({ ...row, source: "LEADERS" as const })),
  ];
  const emailGroups = groupBy(allIdentities, (row) => row.value.email);
  let duplicateEmailCount = 0;
  for (const matches of emailGroups.values()) {
    if (matches.length <= 1) continue;
    duplicateEmailCount += 1;
    for (const match of matches) {
      issues.push(issue(match.source, match.rowNumber, "DUPLICATE_EMAIL"));
    }
  }

  const lecturerUidGroups = groupBy(lecturers, (row) => row.value.lecturer_uid);
  let duplicateLecturerUidCount = 0;
  for (const matches of lecturerUidGroups.values()) {
    if (matches.length <= 1) continue;
    duplicateLecturerUidCount += 1;
    for (const match of matches) {
      issues.push(
        issue("LECTURERS", match.rowNumber, "DUPLICATE_LECTURER_UID"),
      );
    }
  }

  const batchRows = allIdentities.map((row) => ({
    ...row,
    batchId: row.value.approval_batch_id,
  }));
  const batchGroups = groupBy(batchRows, (row) => row.batchId);
  if (batchGroups.size !== 1) {
    issues.push(issue("BATCH", 0, "APPROVAL_BATCH_AMBIGUOUS"));
  }

  const deduplicatedIssues = uniqueIssues(issues);
  return {
    approvalBatchCount: batchGroups.size,
    lecturerRecordCount: Array.isArray(lecturerDocument)
      ? lecturerDocument.length
      : 0,
    leaderRecordCount: Array.isArray(leaderDocument)
      ? leaderDocument.length
      : 0,
    unitScopeCount,
    duplicateEmailCount,
    duplicateLecturerUidCount,
    duplicateRoleCount,
    duplicateScopeCount,
    unknownUnitCount,
    unresolvedAmbiguityCount: deduplicatedIssues.length,
    issues: deduplicatedIssues,
  };
}

function parseRows<T>(
  document: unknown,
  schema: z.ZodType<T>,
  source: Exclude<IdentityInputSource, "BATCH">,
  issues: IdentityInputIssue[],
): Array<Row<T>> {
  if (!Array.isArray(document)) {
    issues.push(issue(source, 0, "DOCUMENT_NOT_ARRAY"));
    return [];
  }
  if (document.length > MAX_RECORDS_PER_INPUT) {
    issues.push(issue(source, 0, "INPUT_RECORD_LIMIT_EXCEEDED"));
    return [];
  }
  const rows: Array<Row<T>> = [];
  for (const [index, candidate] of document.entries()) {
    const result = schema.safeParse(candidate);
    if (!result.success) {
      issues.push(issue(source, index + 1, "ROW_SCHEMA_INVALID"));
      continue;
    }
    rows.push({ rowNumber: index + 1, value: result.data });
  }
  return rows;
}

function issue(
  source: IdentityInputSource,
  rowNumber: number,
  code: IdentityInputErrorCode,
): IdentityInputIssue {
  return { source, rowNumber, code };
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function groupBy<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const matches = groups.get(key) ?? [];
    matches.push(value);
    groups.set(key, matches);
  }
  return groups;
}

function uniqueIssues(
  issues: readonly IdentityInputIssue[],
): IdentityInputIssue[] {
  const seen = new Set<string>();
  return issues.filter((candidate) => {
    const key = `${candidate.source}\u0000${candidate.rowNumber}\u0000${candidate.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
