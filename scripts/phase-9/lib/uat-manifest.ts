export interface UatCase {
  readonly id: `P9-UAT-${string}`;
  readonly role: string;
  readonly route: string;
  readonly dataMutation: boolean;
}

const definition = (
  id: number,
  role: string,
  route: string,
  dataMutation = false,
): UatCase => ({
  id: `P9-UAT-${String(id).padStart(2, "0")}`,
  role,
  route,
  dataMutation,
});

export const PHASE9_UAT_CASES = [
  definition(1, "SYSTEM", "/api/health,/api/ready"),
  definition(2, "ANONYMOUS", "/sign-in"),
  definition(3, "APPROVED_SMOKE_USER", "/sign-in", true),
  definition(4, "FORCED_CHANGE_USER", "/change-password", true),
  definition(5, "ALL_AUTHENTICATED_ROLES", "/dashboard"),
  definition(6, "LECTURER", "/lecturer/profile"),
  definition(7, "LECTURER", "/lecturer/rows/new"),
  definition(8, "LECTURER", "/lecturer/rows/new", true),
  definition(9, "LECTURER", "/lecturer/rows/[recordUid]/edit", true),
  definition(10, "LECTURER", "/lecturer/rows/[recordUid]/history"),
  definition(11, "LECTURER", "/lecturer/submissions"),
  definition(12, "LECTURER", "/lecturer/submissions/[submissionId]"),
  definition(13, "FACULTY_LEADER", "/leader/data"),
  definition(14, "FACULTY_LEADER", "/leader/submissions"),
  definition(15, "FACULTY_LEADER", "/leader/submissions/[submissionId]"),
  definition(16, "FACULTY_LEADER", "/leader/*"),
  definition(17, "FACULTY_LEADER", "/leader/submissions/[submissionId]", true),
  definition(
    18,
    "LECTURER",
    "/lecturer/submissions/[submissionId]/resubmit",
    true,
  ),
  definition(19, "FACULTY_LEADER", "/leader/submissions/[submissionId]", true),
  definition(20, "ADMIN", "/admin/data"),
  definition(21, "ADMIN", "/admin/users"),
  definition(22, "ADMIN", "/admin/audit"),
  definition(23, "UNAUTHORIZED_ROLE", "/forbidden"),
  definition(24, "ALL", "RESPONSIVE_MATRIX"),
  definition(25, "ALL", "ZOOM_200"),
  definition(26, "ALL", "KEYBOARD_FOCUS"),
  definition(27, "ALL", "TABLE_OVERFLOW"),
  definition(28, "AUTHENTICATED_USERS", "LOGOUT", true),
  definition(29, "SYSTEM", "/api/health,/api/ready"),
] as const satisfies readonly UatCase[];

export const PHASE9_NON_MUTATING_UAT_CASES = PHASE9_UAT_CASES.filter(
  (testCase) => !testCase.dataMutation,
);
export const PHASE9_MUTATING_UAT_CASES = PHASE9_UAT_CASES.filter(
  (testCase) => testCase.dataMutation,
);
