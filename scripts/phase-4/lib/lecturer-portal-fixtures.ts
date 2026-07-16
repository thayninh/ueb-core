export interface Phase4LecturerPortalFixtures {
  readonly password: string;
  readonly lecturerAEmail: string;
  readonly lecturerBEmail: string;
  readonly leaderAEmail: string;
  readonly leaderBEmail: string;
}

export function readPhase4LecturerPortalFixtures(
  environment: Readonly<Record<string, string | undefined>>,
): Phase4LecturerPortalFixtures {
  const fixtures = {
    password: environment.PHASE4_E2E_PASSWORD ?? "Phase4LocalTestPassword!2026",
    lecturerAEmail:
      environment.PHASE4_E2E_LECTURER_A_EMAIL ??
      "phase4-lecturer-a@example.invalid",
    lecturerBEmail:
      environment.PHASE4_E2E_LECTURER_B_EMAIL ??
      "phase4-lecturer-b@example.invalid",
    leaderAEmail:
      environment.PHASE4_E2E_LEADER_A_EMAIL ??
      "phase4-leader-a@example.invalid",
    leaderBEmail:
      environment.PHASE4_E2E_LEADER_B_EMAIL ??
      "phase4-leader-b@example.invalid",
  };
  const emails = [
    fixtures.lecturerAEmail,
    fixtures.lecturerBEmail,
    fixtures.leaderAEmail,
    fixtures.leaderBEmail,
  ];
  if (fixtures.password.length < 12 || new Set(emails).size !== emails.length) {
    throw new Error("Phase 4 lecturer portal fixtures are invalid.");
  }
  return fixtures;
}
