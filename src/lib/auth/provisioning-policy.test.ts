// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assertLecturerEmailMapping,
  assertLocalPostgresDatabaseUrl,
  createOrganizationUnitKey,
  parseBootstrapAdminEnvironment,
  validateProvisionUserInput,
} from "@/lib/auth/provisioning-policy";

const lecturerUid = "11111111-1111-4111-8111-111111111111";
const unitId = "22222222-2222-4222-8222-222222222222";
const secondUnitId = "33333333-3333-4333-8333-333333333333";

describe("controlled authentication provisioning policy", () => {
  it("rejects passwords shorter than 12 characters", () => {
    expect(() =>
      validateProvisionUserInput({
        email: "admin@example.edu",
        temporaryPassword: "short-pass",
        roles: ["ADMIN"],
        requirePasswordChange: false,
      }),
    ).toThrow(/temporaryPassword/u);
  });

  it("normalizes email and rejects invalid role mappings", () => {
    expect(
      validateProvisionUserInput({
        email: " Admin@Example.edu ",
        temporaryPassword: "a-secure-temporary-password",
        roles: ["ADMIN", "ADMIN"],
        requirePasswordChange: false,
      }),
    ).toMatchObject({
      email: "admin@example.edu",
      name: "admin@example.edu",
      roles: ["ADMIN"],
      unitIds: [],
    });

    expect(() =>
      validateProvisionUserInput({
        email: "lecturer@example.edu",
        temporaryPassword: "a-secure-temporary-password",
        roles: ["LECTURER"],
        requirePasswordChange: true,
      }),
    ).toThrow(/LECTURER requires a lecturerUid/u);

    expect(() =>
      validateProvisionUserInput({
        email: "leader@example.edu",
        temporaryPassword: "a-secure-temporary-password",
        roles: ["FACULTY_LEADER"],
        requirePasswordChange: false,
      }),
    ).toThrow(/at least one organization unit/u);

    expect(() =>
      validateProvisionUserInput({
        email: "admin@example.edu",
        temporaryPassword: "a-secure-temporary-password",
        roles: ["ADMIN"],
        unitIds: [unitId],
        requirePasswordChange: false,
      }),
    ).toThrow(/require the FACULTY_LEADER role/u);
  });

  it("accepts explicit lecturer and multi-unit leader mappings", () => {
    expect(
      validateProvisionUserInput({
        email: "leader@example.edu",
        temporaryPassword: "a-secure-temporary-password",
        roles: ["LECTURER", "FACULTY_LEADER"],
        lecturerUid,
        unitIds: [unitId, secondUnitId, unitId],
        name: " Faculty Leader ",
        requirePasswordChange: true,
      }),
    ).toMatchObject({
      lecturerUid,
      unitIds: [unitId, secondUnitId],
      name: "Faculty Leader",
      requirePasswordChange: true,
    });
  });

  it("allows an ADMIN without lecturer identity or unit scope", () => {
    expect(
      validateProvisionUserInput({
        email: "admin@example.edu",
        temporaryPassword: "a-secure-temporary-password",
        roles: ["ADMIN"],
        requirePasswordChange: false,
      }),
    ).toMatchObject({
      roles: ["ADMIN"],
      unitIds: [],
      lecturerUid: undefined,
      requirePasswordChange: false,
    });
  });

  it("blocks ambiguous or mismatched lecturer email mappings", () => {
    expect(() =>
      assertLecturerEmailMapping(lecturerUid, [lecturerUid]),
    ).not.toThrow();
    expect(() =>
      assertLecturerEmailMapping(undefined, [lecturerUid]),
    ).not.toThrow();
    expect(() =>
      assertLecturerEmailMapping(lecturerUid, [
        lecturerUid,
        "33333333-3333-4333-8333-333333333333",
      ]),
    ).toThrow(/multiple lecturer_uid/u);
    expect(() => assertLecturerEmailMapping(lecturerUid, [])).toThrow(
      /does not match/u,
    );
  });

  it("rejects sample bootstrap values and non-local databases", () => {
    const validEnvironment = {
      DATABASE_URL: "postgresql://app:secret@127.0.0.1:55432/ueb_core",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.edu",
      BOOTSTRAP_ADMIN_PASSWORD: "a-secure-temporary-password",
      BOOTSTRAP_ADMIN_NAME: "Local Administrator",
      AUDIT_HMAC_SECRET: "a".repeat(32),
    };

    expect(parseBootstrapAdminEnvironment(validEnvironment)).toMatchObject({
      email: "admin@example.edu",
      name: "Local Administrator",
    });
    expect(() =>
      parseBootstrapAdminEnvironment({
        ...validEnvironment,
        BOOTSTRAP_ADMIN_PASSWORD: "replace_with_local_password",
      }),
    ).toThrow(/sample/u);
    expect(() =>
      parseBootstrapAdminEnvironment({
        ...validEnvironment,
        BOOTSTRAP_ADMIN_EMAIL: "admin@example.invalid",
      }),
    ).toThrow(/sample domain/u);
    expect(() =>
      assertLocalPostgresDatabaseUrl(
        "postgresql://app:secret@database.example.edu/ueb_core",
      ),
    ).toThrow(/explicit local PostgreSQL/u);
  });

  it("derives case-sensitive deterministic unit keys without changing source", () => {
    const lower = createOrganizationUnitKey("khoa kinh tế");
    const upper = createOrganizationUnitKey("Khoa Kinh tế");

    expect(lower).toMatch(/^unit_[a-f0-9]{40}$/u);
    expect(createOrganizationUnitKey("khoa kinh tế")).toBe(lower);
    expect(upper).not.toBe(lower);
    expect(() => createOrganizationUnitKey("   ")).toThrow(
      /must not be empty/u,
    );
  });
});
