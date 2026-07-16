export interface Phase4LecturerPortalFixtures {
  readonly password: string;
  readonly lecturerAEmail: string;
  readonly lecturerBEmail: string;
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
  };
  if (
    fixtures.password.length < 12 ||
    fixtures.lecturerAEmail === fixtures.lecturerBEmail
  ) {
    throw new Error("Phase 4 lecturer portal fixtures are invalid.");
  }
  return fixtures;
}
