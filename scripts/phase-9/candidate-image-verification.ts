import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  readSourceMigrationLedger,
  type MigrationLedger,
} from "../phase-6/lib/migration-ledger";
import { SafePhase6StagingError } from "../phase-6/lib/staging-contracts";

const execFileAsync = promisify(execFile);
const GIT_SHA = /^[a-f0-9]{40}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;

export interface CandidateImageMetadata {
  readonly imageId: string;
  readonly os: string;
  readonly architecture: string;
  readonly labels: Readonly<Record<string, string>>;
}

export interface LocalCandidateVerificationReport {
  readonly status: "PASS";
  readonly gate: "LOCAL_CANDIDATE_ARTIFACT";
  readonly releaseSha: string;
  readonly appImage: string;
  readonly appImageId: string;
  readonly operatorImage: string;
  readonly operatorImageId: string;
  readonly architecture: "linux/amd64";
  readonly migrationCount: number;
  readonly migrationLedgerFingerprint: string;
  readonly mutationCommandCount: 0;
  readonly serverConnectionPerformed: false;
  readonly secretLeakageCount: 0;
}

export async function verifyLocalCandidateArtifacts(
  arguments_: readonly string[],
  dependencies: {
    readonly inspectImage?: (tag: string) => Promise<CandidateImageMetadata>;
    readonly verifyRelease?: (sha: string) => Promise<void>;
    readonly assertClean?: () => Promise<void>;
    readonly ledger?: MigrationLedger;
  } = {},
): Promise<LocalCandidateVerificationReport> {
  const args = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  if (args.length !== 4 || !args.includes("--verify-local")) {
    throw safeError("Local candidate verification arguments are incomplete.");
  }
  const releaseSha = singleValue(args, "--release-sha=");
  const appImage = singleValue(args, "--app-image=");
  const operatorImage = singleValue(args, "--operator-image=");
  if (!GIT_SHA.test(releaseSha)) {
    throw safeError("Candidate release SHA is invalid.");
  }
  if (
    appImage !== `ueb-core:${releaseSha}` ||
    operatorImage !== `ueb-core-operator:${releaseSha}` ||
    /(?:^|:)latest$/u.test(appImage) ||
    /(?:^|:)latest$/u.test(operatorImage)
  ) {
    throw safeError("Candidate image tags must contain the exact release SHA.");
  }
  await (dependencies.verifyRelease ?? verifyLocalRelease)(releaseSha);
  await (dependencies.assertClean ?? assertCleanWorkingTree)();
  const ledger = dependencies.ledger ?? (await readSourceMigrationLedger());
  const inspect = dependencies.inspectImage ?? inspectLocalImage;
  const [app, operator] = await Promise.all([
    inspect(appImage),
    inspect(operatorImage),
  ]);
  assertCandidateMetadata("App", app, releaseSha, ledger);
  assertCandidateMetadata("Operator", operator, releaseSha, ledger);
  return {
    status: "PASS",
    gate: "LOCAL_CANDIDATE_ARTIFACT",
    releaseSha,
    appImage,
    appImageId: app.imageId,
    operatorImage,
    operatorImageId: operator.imageId,
    architecture: "linux/amd64",
    migrationCount: ledger.count,
    migrationLedgerFingerprint: ledger.fingerprint,
    mutationCommandCount: 0,
    serverConnectionPerformed: false,
    secretLeakageCount: 0,
  };
}

function assertCandidateMetadata(
  label: string,
  metadata: CandidateImageMetadata,
  releaseSha: string,
  ledger: MigrationLedger,
): void {
  if (!IMAGE_ID.test(metadata.imageId)) {
    throw safeError(`${label} candidate image ID is invalid.`);
  }
  if (metadata.os !== "linux" || metadata.architecture !== "amd64") {
    throw safeError(`${label} candidate architecture is not linux/amd64.`);
  }
  if (
    metadata.labels["org.opencontainers.image.revision"] !== releaseSha ||
    metadata.labels["io.ueb-core.migration-count"] !== String(ledger.count) ||
    metadata.labels["io.ueb-core.migration-ledger-fingerprint"] !==
      ledger.fingerprint
  ) {
    throw safeError(`${label} candidate source or migration labels mismatch.`);
  }
}

async function inspectLocalImage(tag: string): Promise<CandidateImageMetadata> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["image", "inspect", tag, "--format", "{{json .}}"],
      { cwd: process.cwd(), maxBuffer: 64 * 1024 },
    );
    const value = JSON.parse(stdout) as {
      Id?: string;
      Os?: string;
      Architecture?: string;
      Config?: { Labels?: Record<string, string> };
    };
    return {
      imageId: value.Id ?? "",
      os: value.Os ?? "",
      architecture: value.Architecture ?? "",
      labels: value.Config?.Labels ?? {},
    };
  } catch {
    throw safeError("Candidate image is unavailable for local inspection.");
  }
}

async function verifyLocalRelease(releaseSha: string): Promise<void> {
  await execFileAsync("git", ["cat-file", "-e", `${releaseSha}^{commit}`], {
    cwd: process.cwd(),
  }).catch(() => {
    throw safeError("Candidate release SHA is not available locally.");
  });
}

async function assertCleanWorkingTree(): Promise<void> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
    cwd: process.cwd(),
  });
  if (stdout.trim())
    throw safeError("Candidate verification requires a clean tree.");
}

function singleValue(arguments_: readonly string[], prefix: string): string {
  const values = arguments_
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length));
  if (values.length !== 1 || !values[0]) {
    throw safeError(
      "Candidate verification argument is missing or duplicated.",
    );
  }
  return values[0];
}

function safeError(message: string): SafePhase6StagingError {
  return new SafePhase6StagingError(message);
}

export async function main(arguments_ = process.argv.slice(2)): Promise<void> {
  const report = await verifyLocalCandidateArtifacts(arguments_);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
