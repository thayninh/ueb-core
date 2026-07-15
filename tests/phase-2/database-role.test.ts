// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildRoleStatement,
  parseBootstrapEnvironment,
} from "../../scripts/phase-2/bootstrap-runtime-role";

const bootstrapSource = readFileSync(
  new URL("../../scripts/phase-2/bootstrap-runtime-role.ts", import.meta.url),
  "utf8",
);
const prismaConfig = readFileSync(
  new URL("../../prisma.config.ts", import.meta.url),
  "utf8",
);
const compose = readFileSync(
  new URL("../../compose.yaml", import.meta.url),
  "utf8",
);
const envExample = readFileSync(
  new URL("../../.env.example", import.meta.url),
  "utf8",
);
const gitignore = readFileSync(
  new URL("../../.gitignore", import.meta.url),
  "utf8",
);

const LOCAL_ENVIRONMENT = {
  MIGRATION_DATABASE_URL:
    "postgresql://owner:owner-password@127.0.0.1:55432/ueb_core",
  APP_DATABASE_USER: "ueb_core_app",
  APP_DATABASE_PASSWORD: "runtime-password",
} as const;

describe("Phase 2 runtime database role", () => {
  it("validates the three dedicated bootstrap variables", () => {
    expect(parseBootstrapEnvironment(LOCAL_ENVIRONMENT)).toEqual(
      LOCAL_ENVIRONMENT,
    );
    expect(() => parseBootstrapEnvironment({})).toThrow(
      /MIGRATION_DATABASE_URL.*APP_DATABASE_USER.*APP_DATABASE_PASSWORD/u,
    );
  });

  it("does not expose secret values in validation errors", () => {
    const secret = "must-not-appear";

    expect(() =>
      parseBootstrapEnvironment({
        ...LOCAL_ENVIRONMENT,
        MIGRATION_DATABASE_URL: secret,
        APP_DATABASE_PASSWORD: secret,
      }),
    ).toThrowError(expect.not.stringContaining(secret));
  });

  it("creates or alters the role with the same restrictive attributes", () => {
    const expectedAttributes =
      "WITH LOGIN PASSWORD 'runtime-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS";

    expect(
      buildRoleStatement(false, '"ueb_core_app"', "'runtime-password'"),
    ).toBe(`CREATE ROLE "ueb_core_app" ${expectedAttributes}`);
    expect(
      buildRoleStatement(true, '"ueb_core_app"', "'runtime-password'"),
    ).toBe(`ALTER ROLE "ueb_core_app" ${expectedAttributes}`);
  });

  it("grants only runtime table and identity sequence privileges", () => {
    expect(bootstrapSource).toContain(
      "GRANT SELECT, INSERT ON TABLE ${tables} TO ${roleIdentifier}",
    );
    expect(bootstrapSource).toContain(
      "GRANT USAGE, SELECT ON SEQUENCE ${sequence} TO ${roleIdentifier}",
    );
    expect(bootstrapSource).not.toMatch(
      /GRANT\s+(?:[^\n]*,\s*)?(?:UPDATE|DELETE|TRUNCATE|CREATE|ALL)\b/iu,
    );
  });

  it("revokes broad defaults and verifies forbidden privileges", () => {
    expect(bootstrapSource).toContain(
      'REVOKE CREATE ON SCHEMA "public" FROM PUBLIC',
    );
    expect(bootstrapSource).toContain(
      "REVOKE TEMPORARY ON DATABASE ${databaseIdentifier} FROM PUBLIC",
    );
    expect(bootstrapSource).toContain(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public"',
    );
    expect(bootstrapSource).toContain(
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "public"',
    );
    for (const privilege of ["UPDATE", "DELETE", "TRUNCATE"]) {
      expect(bootstrapSource).toContain(`'${privilege}'`);
    }
  });

  it("separates Prisma migration and container runtime credentials", () => {
    expect(prismaConfig).toContain("process.env.MIGRATION_DATABASE_URL");
    expect(prismaConfig).not.toContain("process.env.DATABASE_URL");
    expect(compose).toContain("${APP_DATABASE_USER");
    expect(compose).toContain("${APP_DATABASE_PASSWORD");
    expect(compose).not.toContain(
      "DATABASE_URL: postgresql://${POSTGRES_USER}",
    );
  });

  it("keeps the committed example local and the real env ignored", () => {
    const migrationUrl = readExampleUrl("MIGRATION_DATABASE_URL");
    const runtimeUrl = readExampleUrl("DATABASE_URL");

    expect(migrationUrl.hostname).toBe("127.0.0.1");
    expect(runtimeUrl.hostname).toBe("127.0.0.1");
    expect(migrationUrl.username).not.toBe(runtimeUrl.username);
    expect(gitignore).toMatch(/^\.env$/mu);
    expect(gitignore).toMatch(/^\.env\.\*$/mu);
    expect(gitignore).toMatch(/^!\.env\.example$/mu);
  });
});

function readExampleUrl(variable: string): URL {
  const value = envExample.match(new RegExp(`^${variable}=(.+)$`, "mu"))?.[1];
  if (!value) throw new Error(`Missing ${variable} in .env.example.`);
  return new URL(value);
}
