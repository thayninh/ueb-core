// @vitest-environment node

import { execFileSync } from "node:child_process";
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts/phase-7/monitor-production.sh");
const temporaryDirectories: string[] = [];

async function temporaryDirectory(name: string): Promise<string> {
  const directory = join(
    process.env.TMPDIR ?? "/tmp",
    `ueb-core-monitor-${name}-${crypto.randomUUID()}`,
  );
  await mkdir(directory, { mode: 0o700, recursive: true });
  temporaryDirectories.push(directory);
  return directory;
}

function bash(command: string, environment: Record<string, string> = {}) {
  return execFileSync("bash", ["-c", `source "$SCRIPT"; ${command}`], {
    encoding: "utf8",
    env: { ...process.env, ...environment, SCRIPT: script },
  }).trim();
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Phase 7 production monitoring contract", () => {
  it("routes production and staging to their explicit backup directories", async () => {
    const production = await temporaryDirectory("production");
    expect(
      bash('validate_backup_directory production "$BACKUP"; echo PASS', {
        BACKUP: production,
      }),
    ).toBe("PASS");
    expect(() =>
      bash('validate_backup_directory production "$BACKUP"', {
        BACKUP: "/var/backups/ueb-core/staging",
      }),
    ).toThrow();
    expect(() =>
      bash('validate_backup_directory staging "$BACKUP"', {
        BACKUP: production,
      }),
    ).toThrow();
  });

  it("fails closed for missing paths and symlinked directories", async () => {
    const root = await temporaryDirectory("symlink");
    const target = join(root, "target");
    const link = join(root, "link");
    await mkdir(target, { mode: 0o700 });
    await symlink(target, link);
    expect(() =>
      bash('validate_backup_directory production "$BACKUP"', {
        BACKUP: join(root, "missing"),
      }),
    ).toThrow();
    expect(() =>
      bash('validate_backup_directory production "$BACKUP"', { BACKUP: link }),
    ).toThrow();
  });

  it("accepts only fresh checksum-verified production backups", async () => {
    const directory = await temporaryDirectory("freshness");
    const dump = join(directory, "production.dump");
    await writeFile(dump, "verified production backup", { mode: 0o600 });
    const checksum = execFileSync("sha256sum", [dump], {
      encoding: "utf8",
    }).split(" ")[0];
    await writeFile(`${dump}.sha256`, `${checksum}  production.dump\n`, {
      mode: 0o600,
    });
    expect(
      bash('verified_backup_age_seconds "$BACKUP" "$NOW"', {
        BACKUP: directory,
        NOW: String(Math.floor(Date.now() / 1000)),
      }),
    ).toMatch(/^\d+$/u);
    await writeFile(dump, "tampered", { mode: 0o600 });
    expect(() =>
      bash('verified_backup_age_seconds "$BACKUP" "$NOW"', {
        BACKUP: directory,
        NOW: String(Math.floor(Date.now() / 1000)),
      }),
    ).toThrow();
  });

  it("classifies 82 percent as warning and the 85 percent threshold as high", () => {
    expect(bash("classify_disk_usage 82")).toBe("WARNING");
    expect(bash("classify_disk_usage 85")).toBe("HIGH");
    expect(bash("classify_disk_usage 69")).toBe("PASS");
  });

  it("requires a strict 0600 configuration with only non-secret monitor keys", async () => {
    const directory = await temporaryDirectory("config");
    const config = join(directory, "monitor.env");
    await writeFile(
      config,
      `MONITOR_ENVIRONMENT=production\nMONITOR_BACKUP_DIRECTORY=${directory}\n`,
      { mode: 0o600 },
    );
    expect(
      bash(
        'load_monitor_config "$CONFIG"; printf "%s|%s" "$monitor_environment" "$monitor_backup_directory"',
        { CONFIG: config },
      ),
    ).toBe(`production|${directory}`);
    await chmod(config, 0o644);
    expect(() =>
      bash('load_monitor_config "$CONFIG"', { CONFIG: config }),
    ).toThrow();
    expect(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(script, "utf8"),
      ),
    ).not.toMatch(/DATABASE_URL|PASSWORD=|TOKEN=|COOKIE=/u);
  });
});
