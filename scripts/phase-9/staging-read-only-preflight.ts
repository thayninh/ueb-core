import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { readSourceMigrationLedger } from "../phase-6/lib/migration-ledger";
import {
  SafePhase6StagingError,
  STAGING_DATABASE,
  STAGING_DOMAIN,
  STAGING_SSH_ALIAS,
  STAGING_URL,
} from "../phase-6/lib/staging-contracts";
import {
  executePostTransferCandidateVerification,
  executeReadOnlyPreflight,
} from "./lib/staging-ssh-executor";

const execFileAsync = promisify(execFile);
const GIT_SHA = /^[a-f0-9]{40}$/u;
const MUTATION_TOKENS =
  /\b(?:docker\s+(?:load|rm|rmi|restart)|compose\s+(?:up|down|restart)|migrate\s+deploy|pg_dump|pg_restore|phase6:backup|chmod|chown|install|mv|cp|rm|sed\s+-i|caddy\s+reload|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/iu;

export interface StagingReadOnlyPreflightPlan {
  readonly target: "staging";
  readonly releaseSha: string;
  readonly mode: "DRY_RUN";
  readonly sourceMigrationCount: number;
  readonly migrationLedgerFingerprint: string;
  readonly checks: readonly {
    readonly id: string;
    readonly command: string;
  }[];
}

export async function createStagingReadOnlyPreflightPlan(
  arguments_: readonly string[],
  dependencies: {
    readonly verifyRelease?: (releaseSha: string) => Promise<void>;
    readonly assertClean?: () => Promise<void>;
  } = {},
): Promise<StagingReadOnlyPreflightPlan> {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  if (
    !args.includes("--dry-run") ||
    args.some(
      (argument) =>
        argument !== "--dry-run" &&
        !argument.startsWith("--target=") &&
        !argument.startsWith("--release-sha="),
    )
  ) {
    throw new SafePhase6StagingError(
      "Staging preflight requires the exact read-only dry-run contract.",
    );
  }
  const target = singleValue(args, "--target=");
  const releaseSha = singleValue(args, "--release-sha=");
  if (target !== "staging" || !GIT_SHA.test(releaseSha)) {
    throw new SafePhase6StagingError(
      "Staging preflight target or release SHA is invalid.",
    );
  }
  await (dependencies.verifyRelease ?? verifyLocalRelease)(releaseSha);
  await (dependencies.assertClean ?? assertCleanWorkingTree)();
  const ledger = await readSourceMigrationLedger();
  const checks = [
    { id: "SERVER_TIME", command: "date -Iseconds" },
    {
      id: "CURRENT_ROLLBACK_IMAGES",
      command:
        "inspect the running staging app image and approved rollback image from restricted rollback metadata",
    },
    {
      id: "COMPOSE_SERVICES",
      command:
        "docker ps --filter label=com.docker.compose.project=ueb-core-staging",
    },
    {
      id: "HEALTH",
      command: `curl --fail --silent --show-error ${STAGING_URL}/api/health`,
    },
    {
      id: "READINESS",
      command: `curl --fail --silent --show-error ${STAGING_URL}/api/ready`,
    },
    {
      id: "MIGRATION_STATUS",
      command: `phase6:fingerprint-staging --expected-database=${STAGING_DATABASE}`,
    },
    {
      id: "BACKUP_EVIDENCE",
      command:
        "find /var/backups/ueb-core/staging -maxdepth 1 -type f -name '*.dump.meta.json' -print",
    },
    {
      id: "ROLLBACK_METADATA",
      command:
        "test -r /opt/ueb-core/evidence/rollback/approved.json && head -c 16385 /opt/ueb-core/evidence/rollback/approved.json",
    },
    {
      id: "CADDY_ROUTE",
      command: `docker exec khtc-ueb-prod-caddy-1 caddy validate --config /etc/caddy/Caddyfile # ${STAGING_DOMAIN}`,
    },
    {
      id: "MONITORING",
      command:
        "test -x /opt/ueb-core/config/monitor-staging.sh && test -r /opt/ueb-core/evidence/monitoring/monitor.log && tail -n 500 /opt/ueb-core/evidence/monitoring/monitor.log",
    },
  ] as const;
  if (checks.some((check) => MUTATION_TOKENS.test(check.command))) {
    throw new SafePhase6StagingError(
      "Staging read-only preflight plan contains a forbidden mutation command.",
    );
  }
  return {
    target: "staging",
    releaseSha,
    mode: "DRY_RUN",
    sourceMigrationCount: ledger.count,
    migrationLedgerFingerprint: ledger.fingerprint,
    checks,
  };
}

async function verifyLocalRelease(releaseSha: string): Promise<void> {
  await execFileAsync("git", ["cat-file", "-e", `${releaseSha}^{commit}`], {
    cwd: process.cwd(),
  }).catch(() => {
    throw new SafePhase6StagingError(
      "Staging preflight release SHA is not available locally.",
    );
  });
}

async function assertCleanWorkingTree(): Promise<void> {
  const status = await execFileAsync("git", ["status", "--porcelain"], {
    cwd: process.cwd(),
  });
  if (status.stdout.trim()) {
    throw new SafePhase6StagingError(
      "Staging preflight requires a clean working tree.",
    );
  }
}

export async function main(arguments_ = process.argv.slice(2)): Promise<void> {
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (normalized.includes("--execute-post-transfer-image-verify")) {
    const report = await executePostTransferCandidateVerification(arguments_);
    process.stdout.write(
      `${JSON.stringify({
        status: report.status,
        gate: "POST_TRANSFER_CANDIDATE_IMAGE",
        reportSchemaVersion: report.reportSchemaVersion,
        outputWritten: true,
        mutationCommands: report.mutationCommandCount,
        serverConnectionPerformed: report.serverConnectionPerformed,
        secretsPrinted: false,
      })}\n`,
    );
    if (report.status !== "PASS") process.exitCode = 2;
    return;
  }
  if (normalized.includes("--execute-read-only")) {
    const report = await executeReadOnlyPreflight(arguments_);
    process.stdout.write(
      `${JSON.stringify({
        status: report.status,
        reportSchemaVersion: report.reportSchemaVersion,
        outputWritten: true,
        mutationCommands: report.mutationCommandCount,
        serverConnectionPerformed: report.serverConnectionPerformed,
        secretsPrinted: false,
      })}\n`,
    );
    if (report.status !== "PASS") process.exitCode = 2;
    return;
  }
  const plan = await createStagingReadOnlyPreflightPlan(arguments_);
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      ...plan,
      sshAlias: STAGING_SSH_ALIAS,
      mutationCommands: 0,
      serverConnectionPerformed: false,
      secretsPrinted: false,
    })}\n`,
  );
}

function singleValue(arguments_: readonly string[], prefix: string): string {
  const values = arguments_
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length));
  if (values.length !== 1 || !values[0]) {
    throw new SafePhase6StagingError(
      "Staging preflight argument is missing or duplicated.",
    );
  }
  return values[0];
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
