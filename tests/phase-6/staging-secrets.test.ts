// @vitest-environment node

import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  generateStagingSecrets,
  STAGING_SECRET_MANIFEST,
  validateStagingSecrets,
} from "../../scripts/phase-6/lib/staging-secrets";

const temporaryDirectories: string[] = [];
const repositoryDirectory = process.cwd();

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Phase 6 guarded staging secret generation", () => {
  it("creates only the approved files with restricted modes", async () => {
    const outputDirectory = await newOutputDirectory();
    await expect(generate(outputDirectory)).resolves.toMatchObject({
      fileCount: 6,
    });
    await expect(
      validateStagingSecrets({ inputDirectory: outputDirectory }),
    ).resolves.toMatchObject({ fileCount: 6 });
  });

  it("rejects output inside the repository", async () => {
    const outputDirectory = join(
      repositoryDirectory,
      ".phase6-forbidden-secret-test",
    );
    await expect(generate(outputDirectory)).rejects.toThrow(
      /outside repository/u,
    );
  });

  it("rejects symbolic-link path components", async () => {
    const root = await temporaryRoot();
    const real = join(root, "real");
    const alias = join(root, "alias");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(real));
    await symlink(real, alias);
    await expect(generate(join(alias, "secrets"))).rejects.toThrow(
      /Symbolic links/u,
    );
  });

  it("rejects overwrite of an existing output directory", async () => {
    const outputDirectory = await newOutputDirectory();
    await generate(outputDirectory);
    await expect(generate(outputDirectory)).rejects.toThrow(/overwrite/u);
  });

  it("rejects a wrong database name and invalid monitoring email", async () => {
    await expect(
      generate(await newOutputDirectory(), {
        databaseName: "ueb_core_uat_phase5",
      }),
    ).rejects.toThrow(/approved contract/u);
    await expect(
      generate(await newOutputDirectory(), {
        monitoringEmail: "replace-me@example.invalid",
      }),
    ).rejects.toThrow(/STAGING_MONITORING_EMAIL/u);
  });
});

describe("Phase 6 staging secret validation", () => {
  it("rejects role collisions", async () => {
    const outputDirectory = await generatedDirectory();
    const path = join(outputDirectory, STAGING_SECRET_MANIFEST);
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      roles: { owner: string; runtime: string };
    };
    manifest.roles.runtime = manifest.roles.owner;
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    await expect(
      validateStagingSecrets({ inputDirectory: outputDirectory }),
    ).rejects.toThrow(/manifest contract/u);
  });

  it("rejects UAT references even with a matching manifest checksum", async () => {
    const outputDirectory = await generatedDirectory();
    await tamperSecret(
      outputDirectory,
      "app-runtime.env",
      (content) => `${content}FORBIDDEN_REFERENCE=ueb_core_uat_phase5\n`,
    );
    await expect(
      validateStagingSecrets({ inputDirectory: outputDirectory }),
    ).rejects.toThrow(/forbidden UAT/u);
  });

  it("rejects migration or provisioning credentials in runtime secrets", async () => {
    for (const forbidden of [
      "MIGRATION_DATABASE_URL=postgresql://forbidden\n",
      "PHASE6_PROVISIONING_DATABASE_URL=postgresql://forbidden\n",
    ]) {
      const outputDirectory = await generatedDirectory();
      await tamperSecret(
        outputDirectory,
        "app-runtime.env",
        (content) => `${content}${forbidden}`,
      );
      await expect(
        validateStagingSecrets({ inputDirectory: outputDirectory }),
      ).rejects.toThrow(/operator credential/u);
    }
  });

  it("rejects unapproved files, keys, and weakened values", async () => {
    const extraFileDirectory = await generatedDirectory();
    await writeFile(
      join(extraFileDirectory, "unexpected.env"),
      "SAFE=value\n",
      {
        mode: 0o600,
      },
    );
    await expect(
      validateStagingSecrets({ inputDirectory: extraFileDirectory }),
    ).rejects.toThrow(/file set/u);

    const extraKeyDirectory = await generatedDirectory();
    await tamperSecret(
      extraKeyDirectory,
      "app-runtime.env",
      (content) => `${content}UNAPPROVED_VALUE=safe\n`,
    );
    await expect(
      validateStagingSecrets({ inputDirectory: extraKeyDirectory }),
    ).rejects.toThrow(/key set/u);

    const weakSecretDirectory = await generatedDirectory();
    await tamperSecret(weakSecretDirectory, "app-runtime.env", (content) =>
      content.replace(/^BETTER_AUTH_SECRET=.*$/mu, "BETTER_AUTH_SECRET=weak"),
    );
    await expect(
      validateStagingSecrets({ inputDirectory: weakSecretDirectory }),
    ).rejects.toThrow(/strength/u);
  });

  it("rejects secret files with modes other than 0600", async () => {
    const outputDirectory = await generatedDirectory();
    await chmod(join(outputDirectory, "monitoring.env"), 0o644);
    await expect(
      validateStagingSecrets({ inputDirectory: outputDirectory }),
    ).rejects.toThrow(/mode/u);
  });
});

describe("Phase 6 operator image and Compose isolation", () => {
  it("copies an allowlisted operator source set without runtime exposure", async () => {
    const dockerfile = await readFile("Dockerfile.operator", "utf8");
    expect(dockerfile).toContain("FROM node:24-bookworm-slim");
    expect(dockerfile).toContain("FROM postgres:18.4-bookworm");
    expect(dockerfile).toContain("USER operator");
    expect(dockerfile).not.toMatch(/^EXPOSE\s/mu);
    expect(dockerfile).not.toMatch(/^COPY\s+\.\s+\./mu);
    expect(dockerfile).not.toMatch(
      /COPY.*(?:\.env|backup|credential|\.xlsx)/iu,
    );
  });

  it("keeps operator jobs one-off, private, and without Docker socket", async () => {
    const compose = await readFile("compose.staging.operator.yaml", "utf8");
    expect(compose).toContain('restart: "no"');
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).not.toMatch(/ports:/u);
    expect(compose).not.toMatch(/docker\.sock/u);
    expect(compose).not.toMatch(/\bproxy\b/u);
    expect(compose).not.toMatch(/^\s{2}app:/mu);
    expect(compose).not.toMatch(/BETTER_AUTH_SECRET|AUDIT_HMAC_SECRET/u);
    const runtimeBlock = compose
      .split(/^  operator-runtime:/mu)[1]
      ?.split(/^  operator-provisioner:/mu)[0];
    const provisionerBlock = compose.split(/^  operator-provisioner:/mu)[1];
    expect(runtimeBlock).not.toMatch(
      /phase6-owner-environment|STAGING_BOOTSTRAP|STAGING_ROLE_ADMIN|STAGING_PROVISIONING_PASSWORD/u,
    );
    expect(provisionerBlock).not.toMatch(
      /phase6-owner-environment|STAGING_BOOTSTRAP|STAGING_ROLE_ADMIN|STAGING_RUNTIME_PASSWORD/u,
    );
    expect(provisionerBlock).toContain(
      'DATABASE_URL: "${PHASE6_PROVISIONING_DATABASE_URL:',
    );
    expect(provisionerBlock).not.toMatch(
      /^\s+PHASE6_PROVISIONING_DATABASE_URL:/mu,
    );
  });

  it("keeps application Compose environment free of owner and provisioner URLs", async () => {
    const compose = await readFile("compose.staging.yaml", "utf8");
    const appBlock = compose.split(/^  app:/mu)[1]?.split(/^networks:/mu)[0];
    expect(appBlock).toBeDefined();
    expect(appBlock).not.toMatch(/MIGRATION_DATABASE_URL/u);
    expect(appBlock).not.toMatch(/PHASE6_PROVISIONING_DATABASE_URL/u);
    expect(appBlock).not.toMatch(/STAGING_ROLE_ADMIN_DATABASE_URL/u);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp("/private/tmp/ueb-core-phase6-secrets-");
  temporaryDirectories.push(root);
  return root;
}

async function newOutputDirectory(): Promise<string> {
  return join(await temporaryRoot(), "secrets");
}

async function generatedDirectory(): Promise<string> {
  const outputDirectory = await newOutputDirectory();
  await generate(outputDirectory);
  return outputDirectory;
}

function generate(
  outputDirectory: string,
  overrides: Partial<{
    databaseName: string;
    monitoringEmail: string;
  }> = {},
) {
  return generateStagingSecrets({
    outputDirectory,
    databaseHost: "db",
    databasePort: "5432",
    databaseName: overrides.databaseName ?? "ueb_core_staging",
    publicUrl: "https://ueb-core.cargis.vn",
    monitoringEmail: overrides.monitoringEmail ?? "ops@sample.test",
    repositoryDirectory,
    now: new Date("2026-07-18T00:00:00.000Z"),
  });
}

async function tamperSecret(
  directory: string,
  fileName: string,
  transform: (content: string) => string,
): Promise<void> {
  const filePath = join(directory, fileName);
  const content = transform(await readFile(filePath, "utf8"));
  await writeFile(filePath, content, { mode: 0o600 });
  const manifestPath = join(directory, STAGING_SECRET_MANIFEST);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    files: Array<{ name: string; sha256: string }>;
  };
  const entry = manifest.files.find((candidate) => candidate.name === fileName);
  if (!entry) throw new Error("Test manifest entry is missing.");
  entry.sha256 = createHash("sha256").update(content).digest("hex");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
}
