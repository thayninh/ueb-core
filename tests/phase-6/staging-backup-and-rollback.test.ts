// @vitest-environment node

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { verifyStagingBackup } from "../../scripts/phase-6/lib/staging-backup";
import {
  parseRollbackCommand,
  verifyRollbackImage,
} from "../../scripts/phase-6/lib/staging-deployment";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryFile(name: string, content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ueb-core-phase6-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

describe("Phase 6 backup verification", () => {
  it("blocks a checksum mismatch before catalog inspection", async () => {
    const backup = await temporaryFile("staging.dump", "not-a-real-dump");
    await writeFile(`${backup}.sha256`, `${"0".repeat(64)}  staging.dump\n`, {
      mode: 0o600,
    });
    await writeFile(
      `${backup}.meta.json`,
      `${JSON.stringify({
        database: "ueb_core_staging",
        createdAt: new Date().toISOString(),
        tier: "daily",
        checksum: "0".repeat(64),
      })}\n`,
      { mode: 0o600 },
    );
    await expect(verifyStagingBackup({ backupPath: backup })).rejects.toThrow(
      "checksum mismatch",
    );
  });
});

describe("Phase 6 rollback compatibility", () => {
  it("blocks incompatible architecture, service, schema, or migration metadata", async () => {
    const metadata = await temporaryFile(
      "rollback.json",
      JSON.stringify({
        imageId: `sha256:${"a".repeat(64)}`,
        imageTag: `ueb-core:${"b".repeat(40)}`,
        architecture: "linux/arm64",
        composeService: "worker",
        migrationCount: 6,
        schemaCompatible: false,
      }),
    );
    const command = parseRollbackCommand([
      `--previous-image-metadata=${metadata}`,
      "--expected-architecture=linux/amd64",
    ]);
    await expect(
      verifyRollbackImage({
        command,
        environment: {},
        inspectImage: async () => ({
          imageId: `sha256:${"a".repeat(64)}`,
          architecture: "linux/amd64",
        }),
      }),
    ).rejects.toThrow("incompatible");
  });

  it("accepts compatible immutable previous-image metadata", async () => {
    const metadata = await temporaryFile(
      "rollback.json",
      JSON.stringify({
        imageId: `sha256:${"a".repeat(64)}`,
        imageTag: `ueb-core:${"b".repeat(40)}`,
        architecture: "linux/amd64",
        composeService: "app",
        migrationCount: 7,
        schemaCompatible: true,
      }),
    );
    const command = parseRollbackCommand([
      `--previous-image-metadata=${metadata}`,
      "--expected-architecture=linux/amd64",
    ]);
    await expect(
      verifyRollbackImage({
        command,
        environment: {},
        inspectImage: async () => ({
          imageId: `sha256:${"a".repeat(64)}`,
          architecture: "linux/amd64",
        }),
      }),
    ).resolves.toMatchObject({
      mode: "PREVIOUS_IMAGE",
      architecture: "linux/amd64",
      migrationCount: 7,
      rollbackVerify: "PASS",
    });
  });

  it("requires explicit approval for first-deployment stack removal", async () => {
    const command = parseRollbackCommand([
      "--first-deployment",
      "--confirm-remove-new-staging-stack",
    ]);
    await expect(
      verifyRollbackImage({ command, environment: {} }),
    ).rejects.toThrow();
    await expect(
      verifyRollbackImage({
        command,
        environment: { STAGING_FIRST_DEPLOYMENT_ROLLBACK_APPROVED: "YES" },
      }),
    ).resolves.toMatchObject({ mode: "REMOVE_NEW_STAGING_STACK" });
  });
});
