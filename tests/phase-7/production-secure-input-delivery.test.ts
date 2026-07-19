// @vitest-environment node

import {
  chmod,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertSecureDirectory,
  assertSecureFile,
  matchesProductionSecureInputMetadata,
} from "../../scripts/phase-7/production-roster-workflow";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await chmod(directory, 0o700).catch(() => undefined);
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("Phase 7 production secure input delivery", () => {
  it("accepts host 0700/0600 and rejects host files staged as 0400", async () => {
    const directory = await secureDirectory();
    const file = join(directory, "phase7-secrets.env");
    await writeFile(file, "SAFE_FIXTURE=present\n", { mode: 0o600 });

    const resolved = await assertSecureDirectory(directory, "HOST");
    await expect(
      assertSecureFile(file, 1024, "HOST", resolved),
    ).resolves.toBeUndefined();

    await chmod(file, 0o400);
    await expect(
      assertSecureFile(file, 1024, "HOST", resolved),
    ).rejects.toThrow(/SECURE_FILE_GUARD_FAILED/u);
  });

  it("accepts operator-owned runtime 0500/0400 and rejects runtime 0600", async () => {
    const directory = await secureDirectory();
    const file = join(directory, "phase7-secrets.env");
    await writeFile(file, "SAFE_FIXTURE=present\n", { mode: 0o400 });
    await chmod(directory, 0o500);

    const resolved = await assertSecureDirectory(directory, "RUNTIME_STAGED");
    await expect(
      assertSecureFile(file, 1024, "RUNTIME_STAGED", resolved),
    ).resolves.toBeUndefined();

    await chmod(directory, 0o700);
    await chmod(file, 0o600);
    await chmod(directory, 0o500);
    await expect(
      assertSecureFile(file, 1024, "RUNTIME_STAGED", resolved),
    ).rejects.toThrow(/SECURE_FILE_GUARD_FAILED/u);
  });

  it("rejects group or other permission bits and a wrong owner", () => {
    const base = {
      uid: 998,
      gid: 998,
      isFile: true,
      isDirectory: false,
      isSymbolicLink: false,
      linkCount: 1,
    };
    expect(
      matchesProductionSecureInputMetadata({
        metadata: { ...base, mode: 0o440 },
        delivery: "RUNTIME_STAGED",
        kind: "FILE",
        expectedUid: 998,
        expectedGid: 998,
      }),
    ).toBe(false);
    expect(
      matchesProductionSecureInputMetadata({
        metadata: { ...base, mode: 0o400, uid: 999 },
        delivery: "RUNTIME_STAGED",
        kind: "FILE",
        expectedUid: 998,
        expectedGid: 998,
      }),
    ).toBe(false);
  });

  it("rejects symlinks and resolved paths outside the guarded directory", async () => {
    const directory = await secureDirectory();
    const outsideDirectory = await secureDirectory();
    const outside = join(outsideDirectory, "phase7-secrets.env");
    const linked = join(directory, "phase7-secrets.env");
    await writeFile(outside, "SAFE_FIXTURE=present\n", { mode: 0o400 });
    await symlink(outside, linked);
    await chmod(directory, 0o500);
    await chmod(outsideDirectory, 0o500);

    const resolved = await realpath(directory);
    await expect(
      assertSecureFile(linked, 1024, "RUNTIME_STAGED", resolved),
    ).rejects.toThrow(/SECURE_FILE_GUARD_FAILED/u);
    await expect(
      assertSecureFile(outside, 1024, "RUNTIME_STAGED", resolved),
    ).rejects.toThrow(/SECURE_FILE_GUARD_FAILED/u);
  });
});

async function secureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ueb-core-phase7-secure-"));
  temporaryDirectories.push(directory);
  await chmod(directory, 0o700);
  return directory;
}
