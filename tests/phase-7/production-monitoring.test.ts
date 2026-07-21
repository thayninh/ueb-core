// @vitest-environment node

import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
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

  it("accepts the deployed raw SHA-256 sidecar contract", async () => {
    const directory = await temporaryDirectory("raw-sidecar");
    const dump = join(directory, "production.dump");
    await writeFile(dump, "verified production backup", { mode: 0o600 });
    const checksum = execFileSync("sha256sum", [dump], { encoding: "utf8" })
      .split(" ")[0]
      ?.trim();
    await writeFile(`${dump}.sha256`, `${checksum}\n`, { mode: 0o600 });
    expect(
      bash('verified_backup_age_seconds "$BACKUP" "$NOW"', {
        BACKUP: directory,
        NOW: String(Math.floor(Date.now() / 1000)),
      }),
    ).toMatch(/^\d+$/u);
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

  it("atomically records successful cron evidence with mode 0600", async () => {
    const directory = await temporaryDirectory("cron-success");
    const started = "2026-07-21T13:15:00+07:00";
    const finished = "2026-07-21T13:15:04+07:00";
    bash(
      `cron_started_at='${started}'; cron_finished_at='${finished}'; backup_freshness_status=PASS; production_health_status=PASS; staging_health_status=PASS; caddy_health_status=PASS; disk_evidence_status=WARNING; duplicate_alert_guard_status=PASS; secret_leakage_count=0; write_cron_status 0`,
      { MONITOR_EVIDENCE_DIRECTORY: directory },
    );
    const evidencePath = join(directory, "cron-status.json");
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    expect(evidence).toMatchObject({
      environment: "production",
      started_at: started,
      finished_at: finished,
      exit_code: 0,
      backup_freshness_status: "PASS",
      production_health_status: "PASS",
      staging_health_status: "PASS",
      caddy_health_status: "PASS",
      disk_status: "WARNING",
      duplicate_alert_guard_status: "PASS",
      secret_leakage_count: 0,
    });
    expect((await stat(evidencePath)).mode & 0o777).toBe(0o600);
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith(".cron-status.json."),
      ),
    ).toEqual([]);
  });

  it("records failed cron evidence with a non-zero exit code", async () => {
    const directory = await temporaryDirectory("cron-failure");
    bash(
      "cron_started_at='2026-07-21T13:20:00+07:00'; cron_finished_at='2026-07-21T13:20:03+07:00'; write_cron_status 2",
      { MONITOR_EVIDENCE_DIRECTORY: directory },
    );
    const evidence = JSON.parse(
      await readFile(join(directory, "cron-status.json"), "utf8"),
    );
    expect(evidence.exit_code).toBe(2);
    expect(evidence.backup_freshness_status).toBe("FAIL");
  });

  it("replaces evidence atomically with increasing run timestamps", async () => {
    const directory = await temporaryDirectory("cron-replace");
    const environment = { MONITOR_EVIDENCE_DIRECTORY: directory };
    bash(
      "cron_started_at='2026-07-21T13:25:00+07:00'; cron_finished_at='2026-07-21T13:25:02+07:00'; write_cron_status 1",
      environment,
    );
    bash(
      "cron_started_at='2026-07-21T13:30:00+07:00'; cron_finished_at='2026-07-21T13:30:02+07:00'; backup_freshness_status=PASS; production_health_status=PASS; staging_health_status=PASS; caddy_health_status=PASS; disk_evidence_status=PASS; duplicate_alert_guard_status=PASS; write_cron_status 0",
      environment,
    );
    const evidence = JSON.parse(
      await readFile(join(directory, "cron-status.json"), "utf8"),
    );
    expect(Date.parse(evidence.started_at)).toBeGreaterThan(
      Date.parse("2026-07-21T13:25:00+07:00"),
    );
    expect(evidence.exit_code).toBe(0);
  });

  it("rejects malformed, stale and secret-bearing cron evidence", async () => {
    const directory = await temporaryDirectory("cron-invalid");
    const evidencePath = join(directory, "cron-status.json");
    await writeFile(evidencePath, "not-json\n", { mode: 0o600 });
    expect(() =>
      bash('validate_cron_status "$EVIDENCE" "$NOW"', {
        EVIDENCE: evidencePath,
        MONITOR_EVIDENCE_DIRECTORY: directory,
        NOW: String(Math.floor(Date.now() / 1000)),
      }),
    ).toThrow();

    bash(
      "cron_started_at='2026-07-21T13:35:00+07:00'; cron_finished_at='2026-07-21T13:35:02+07:00'; backup_freshness_status=PASS; production_health_status=PASS; staging_health_status=PASS; caddy_health_status=PASS; disk_evidence_status=PASS; duplicate_alert_guard_status=PASS; write_cron_status 0",
      { MONITOR_EVIDENCE_DIRECTORY: directory },
    );
    const finished = Math.floor(Date.parse("2026-07-21T13:35:02+07:00") / 1000);
    expect(() =>
      bash('validate_cron_status "$EVIDENCE" "$NOW"', {
        EVIDENCE: evidencePath,
        MONITOR_EVIDENCE_DIRECTORY: directory,
        NOW: String(finished + 601),
      }),
    ).toThrow();

    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.secret_leakage_count = 1;
    await writeFile(evidencePath, `${JSON.stringify(evidence)}\n`, {
      mode: 0o600,
    });
    expect(() =>
      bash('validate_cron_status "$EVIDENCE" "$NOW"', {
        EVIDENCE: evidencePath,
        MONITOR_EVIDENCE_DIRECTORY: directory,
        NOW: String(finished + 1),
      }),
    ).toThrow();
  });
});
