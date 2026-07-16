import { z } from "zod";

const fixtureEnvironmentSchema = z.object({
  PHASE3_FIXTURE_PASSWORD: z.string().min(12).max(128),
  PHASE3_FIXTURE_ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  PHASE3_FIXTURE_LECTURER_A_EMAIL: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email()),
  PHASE3_FIXTURE_LECTURER_B_EMAIL: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email()),
  PHASE3_FIXTURE_LEADER_A_EMAIL: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email()),
  PHASE3_FIXTURE_LEADER_MULTI_UNIT_EMAIL: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email()),
  PHASE3_FIXTURE_DISABLED_USER_EMAIL: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email()),
  PHASE3_FIXTURE_NEW_USER_EMAIL: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email()),
});

export type Phase3FixtureEnvironment = z.infer<typeof fixtureEnvironmentSchema>;

export function parsePhase3FixtureEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Phase3FixtureEnvironment {
  const result = fixtureEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(
      `Phase 3 fixture environment is invalid: ${result.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }

  const emails = [
    result.data.PHASE3_FIXTURE_ADMIN_EMAIL,
    result.data.PHASE3_FIXTURE_LECTURER_A_EMAIL,
    result.data.PHASE3_FIXTURE_LECTURER_B_EMAIL,
    result.data.PHASE3_FIXTURE_LEADER_A_EMAIL,
    result.data.PHASE3_FIXTURE_LEADER_MULTI_UNIT_EMAIL,
    result.data.PHASE3_FIXTURE_DISABLED_USER_EMAIL,
    result.data.PHASE3_FIXTURE_NEW_USER_EMAIL,
  ];
  if (new Set(emails).size !== emails.length) {
    throw new Error("Every Phase 3 fixture email must be unique.");
  }
  if (result.data.PHASE3_FIXTURE_PASSWORD.includes("replace_with")) {
    throw new Error("Phase 3 fixture password must not be a placeholder.");
  }
  return result.data;
}
