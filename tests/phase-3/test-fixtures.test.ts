import { describe, expect, it } from "vitest";

import { parsePhase3FixtureEnvironment } from "../../scripts/phase-3/lib/test-fixtures";

const fixtureEnvironment = {
  PHASE3_FIXTURE_PASSWORD: "phase3-local-password",
  PHASE3_FIXTURE_ADMIN_EMAIL: " ADMIN@example.invalid ",
  PHASE3_FIXTURE_LECTURER_A_EMAIL: "lecturer-a@example.invalid",
  PHASE3_FIXTURE_LECTURER_B_EMAIL: "lecturer-b@example.invalid",
  PHASE3_FIXTURE_LEADER_A_EMAIL: "leader-a@example.invalid",
  PHASE3_FIXTURE_LEADER_MULTI_UNIT_EMAIL: "leader-multi@example.invalid",
  PHASE3_FIXTURE_DISABLED_USER_EMAIL: "disabled@example.invalid",
  PHASE3_FIXTURE_NEW_USER_EMAIL: "new-user@example.invalid",
};

describe("Phase 3 environment-only test fixtures", () => {
  it("normalizes fake fixture emails without accepting real data in source", () => {
    expect(parsePhase3FixtureEnvironment(fixtureEnvironment)).toMatchObject({
      PHASE3_FIXTURE_ADMIN_EMAIL: "admin@example.invalid",
    });
  });

  it("rejects duplicate fixture identities and placeholder passwords", () => {
    expect(() =>
      parsePhase3FixtureEnvironment({
        ...fixtureEnvironment,
        PHASE3_FIXTURE_LECTURER_B_EMAIL:
          fixtureEnvironment.PHASE3_FIXTURE_LECTURER_A_EMAIL,
      }),
    ).toThrow(/must be unique/u);
    expect(() =>
      parsePhase3FixtureEnvironment({
        ...fixtureEnvironment,
        PHASE3_FIXTURE_PASSWORD: "replace_with_local_test_password",
      }),
    ).toThrow(/placeholder/u);
  });
});
