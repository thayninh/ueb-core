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

describe("controlled authentication provisioning policy", () => {
  it("normalizes email and rejects invalid role mappings", () => {
    expect(
      validateProvisionUserInput({
        email: " Admin@Example.edu ",
        temporaryPassword: "a-secure-temporary-password",
        roles: ["ADMIN", "ADMIN"],
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
      }),
    ).toThrow(/LECTURER requires a lecturerUid/u);

    expect(() =>
      validateProvisionUserInput({
        email: "leader@example.edu",
        temporaryPassword: "a-secure-temporary-password",
        roles: ["FACULTY_LEADER"],
      }),
    ).toThrow(/at least one organization unit/u);

    expect(() =>
      validateProvisionUserInput({
        email: "admin@example.edu",
        temporaryPassword: "a-secure-temporary-password",
        roles: ["ADMIN"],
        unitIds: [unitId],
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
        unitIds: [unitId, unitId],
        name: " Faculty Leader ",
      }),
    ).toMatchObject({
      lecturerUid,
      unitIds: [unitId],
      name: "Faculty Leader",
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
