import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import {
  assertExactArguments,
  assertImageId,
  assertImageTag,
  assertMonitoringEmail,
  assertProductionStagingDatabase,
  assertSha256,
  normalizeArguments,
  parseChangeWindow,
  SafePhase6StagingError,
  STAGING_CADDY_CONTAINER,
  STAGING_DATABASE,
  STAGING_DEPLOYMENT_DIRECTORY,
  STAGING_PROXY_NETWORK,
  STAGING_SSH_ALIAS,
  STAGING_VPS_HOST,
  valuesFor,
} from "./staging-contracts";

const execFileAsync = promisify(execFile);
const EXPECTED_BRANCH = "feat/phase-6-staging-rollout-validation";

export interface DeploymentPreflightCommand {
  readonly gitCommit: string;
  readonly archiveSha256: string;
  readonly imageId: string;
  readonly imageTag: string;
  readonly imageArchive: string;
  readonly operatorArchiveSha256: string;
  readonly operatorImageId: string;
  readonly operatorImageTag: string;
  readonly operatorImageArchive: string;
  readonly targetHost: typeof STAGING_VPS_HOST;
  readonly targetDatabase: typeof STAGING_DATABASE;
  readonly deploymentDirectory: typeof STAGING_DEPLOYMENT_DIRECTORY;
  readonly proxyNetwork: typeof STAGING_PROXY_NETWORK;
  readonly caddyContainer: typeof STAGING_CADDY_CONTAINER;
  readonly sshAlias: typeof STAGING_SSH_ALIAS;
  readonly secretFile: string;
  readonly rollbackEvidence: string;
}

export interface RollbackReport {
  readonly mode: "PREVIOUS_IMAGE" | "REMOVE_NEW_STAGING_STACK";
  readonly imageId?: string;
  readonly architecture?: string;
  readonly migrationCount?: number;
  readonly rollbackVerify: "PASS";
}

interface RollbackMetadata {
  readonly imageId: string;
  readonly imageTag: string;
  readonly architecture: string;
  readonly composeService: string;
  readonly migrationCount: number;
  readonly schemaCompatible: boolean;
}

export function parseDeploymentPreflightCommand(
  arguments_: readonly string[],
): DeploymentPreflightCommand {
  const args = normalizeArguments(arguments_);
  const confirmation = "--confirm-authorized-staging-deployment";
  const prefixes = [
    "--expected-git-commit=",
    "--expected-image-archive-sha256=",
    "--expected-image-id=",
    "--image-tag=",
    "--image-archive=",
    "--expected-operator-image-archive-sha256=",
    "--expected-operator-image-id=",
    "--operator-image-tag=",
    "--operator-image-archive=",
    "--target-host=",
    "--target-database=",
    "--deployment-directory=",
    "--proxy-network=",
    "--caddy-container=",
    "--ssh-alias=",
    "--secret-file=",
    "--rollback-evidence=",
  ];
  assertExactArguments(args, [confirmation], prefixes);
  if (!args.includes(confirmation)) {
    throw new SafePhase6StagingError(
      "Deployment preflight requires explicit non-secret authorization.",
    );
  }
  const value = (prefix: string) => {
    const values = valuesFor(args, prefix);
    if (values.length !== 1) {
      throw new SafePhase6StagingError(
        "Deployment preflight input is incomplete.",
      );
    }
    return values[0]!;
  };
  const gitCommit = value("--expected-git-commit=");
  const archiveSha256 = assertSha256(
    value("--expected-image-archive-sha256="),
    "Image archive SHA-256",
  );
  const imageId = assertImageId(value("--expected-image-id="));
  const imageTag = value("--image-tag=");
  assertImageTag(imageTag, gitCommit);
  const operatorArchiveSha256 = assertSha256(
    value("--expected-operator-image-archive-sha256="),
    "Operator image archive SHA-256",
  );
  const operatorImageId = assertImageId(value("--expected-operator-image-id="));
  const operatorImageTag = value("--operator-image-tag=");
  if (operatorImageTag !== `ueb-core-operator:${gitCommit}`) {
    throw new SafePhase6StagingError(
      "Operator image tag must contain the exact Git SHA.",
    );
  }
  const targetHost = value("--target-host=");
  const targetDatabase = value("--target-database=");
  const deploymentDirectory = value("--deployment-directory=");
  const proxyNetwork = value("--proxy-network=");
  const caddyContainer = value("--caddy-container=");
  const sshAlias = value("--ssh-alias=");
  if (
    targetHost !== STAGING_VPS_HOST ||
    targetDatabase !== STAGING_DATABASE ||
    deploymentDirectory !== STAGING_DEPLOYMENT_DIRECTORY ||
    proxyNetwork !== STAGING_PROXY_NETWORK ||
    caddyContainer !== STAGING_CADDY_CONTAINER ||
    sshAlias !== STAGING_SSH_ALIAS
  ) {
    throw new SafePhase6StagingError(
      "Deployment preflight target does not match the approved staging contract.",
    );
  }
  assertProductionStagingDatabase(targetDatabase);
  return {
    gitCommit,
    archiveSha256,
    imageId,
    imageTag,
    imageArchive: assertOutsideRepository(value("--image-archive=")),
    operatorArchiveSha256,
    operatorImageId,
    operatorImageTag,
    operatorImageArchive: assertOutsideRepository(
      value("--operator-image-archive="),
    ),
    targetHost: STAGING_VPS_HOST,
    targetDatabase: STAGING_DATABASE,
    deploymentDirectory: STAGING_DEPLOYMENT_DIRECTORY,
    proxyNetwork: STAGING_PROXY_NETWORK,
    caddyContainer: STAGING_CADDY_CONTAINER,
    sshAlias: STAGING_SSH_ALIAS,
    secretFile: assertOutsideRepository(value("--secret-file=")),
    rollbackEvidence: assertOutsideRepository(value("--rollback-evidence=")),
  };
}

export async function runDeploymentPreflight(input: {
  readonly command: DeploymentPreflightCommand;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  assertMonitoringEmail(input.environment.STAGING_MONITORING_EMAIL);
  parseChangeWindow(input.environment);
  if (input.environment.STAGING_UAT_CREDENTIAL_REFERENCE) {
    throw new SafePhase6StagingError(
      "UAT credential references are forbidden in staging deployment preflight.",
    );
  }
  const [{ stdout: branch }, { stdout: commit }, { stdout: status }] =
    await Promise.all([
      execFileAsync("git", ["branch", "--show-current"], {
        cwd: process.cwd(),
      }),
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() }),
      execFileAsync("git", ["status", "--porcelain"], {
        cwd: process.cwd(),
      }),
    ]);
  if (
    branch.trim() !== EXPECTED_BRANCH ||
    commit.trim() !== input.command.gitCommit ||
    status.trim() !== ""
  ) {
    throw new SafePhase6StagingError(
      "Git branch or commit does not match approval.",
    );
  }
  const archive = await stat(input.command.imageArchive).catch(() => undefined);
  const operatorArchive = await stat(input.command.operatorImageArchive).catch(
    () => undefined,
  );
  const secret = await stat(input.command.secretFile).catch(() => undefined);
  const rollback = await stat(input.command.rollbackEvidence).catch(
    () => undefined,
  );
  if (
    !archive?.isFile() ||
    !operatorArchive?.isFile() ||
    !secret?.isFile() ||
    !rollback?.isFile()
  ) {
    throw new SafePhase6StagingError(
      "Image, secret or rollback evidence file is missing.",
    );
  }
  if ((secret.mode & 0o777) !== 0o600) {
    throw new SafePhase6StagingError("Secret file mode must be 0600.");
  }
  const actualArchiveSha = await sha256File(input.command.imageArchive);
  if (actualArchiveSha !== input.command.archiveSha256) {
    throw new SafePhase6StagingError("Image archive SHA-256 mismatch.");
  }
  const actualOperatorArchiveSha = await sha256File(
    input.command.operatorImageArchive,
  );
  if (actualOperatorArchiveSha !== input.command.operatorArchiveSha256) {
    throw new SafePhase6StagingError(
      "Operator image archive SHA-256 mismatch.",
    );
  }
  const [{ stdout: actualImageId }, { stdout: actualOperatorImageId }] =
    await Promise.all([
      execFileAsync(
        "docker",
        ["image", "inspect", input.command.imageTag, "--format", "{{.Id}}"],
        { cwd: process.cwd() },
      ),
      execFileAsync(
        "docker",
        [
          "image",
          "inspect",
          input.command.operatorImageTag,
          "--format",
          "{{.Id}}",
        ],
        { cwd: process.cwd() },
      ),
    ]);
  if (
    actualImageId.trim() !== input.command.imageId ||
    actualOperatorImageId.trim() !== input.command.operatorImageId
  ) {
    throw new SafePhase6StagingError("Docker image ID mismatch.");
  }
  const rollbackEvidence = await readFile(
    input.command.rollbackEvidence,
    "utf8",
  );
  if (!rollbackEvidence.includes("ROLLBACK_VERIFY=PASS")) {
    throw new SafePhase6StagingError(
      "Rollback verification evidence is invalid.",
    );
  }
  const changePlan = await readFile(
    resolve(
      process.cwd(),
      "docs/phase-6/07_staging_change_and_rollback_plan.md",
    ),
    "utf8",
  );
  if (
    !changePlan.includes("CADDY_BACKUP=") ||
    !changePlan.includes("caddy validate") ||
    !changePlan.includes("caddy reload")
  ) {
    throw new SafePhase6StagingError(
      "Caddy backup/validate/reload plan is absent.",
    );
  }
}

export function parseRollbackCommand(arguments_: readonly string[]):
  | { readonly firstDeployment: true }
  | {
      readonly firstDeployment: false;
      readonly metadataPath: string;
      readonly expectedArchitecture: string;
    } {
  const args = normalizeArguments(arguments_);
  const first = args.includes("--first-deployment");
  if (first) {
    assertExactArguments(
      args,
      ["--first-deployment", "--confirm-remove-new-staging-stack"],
      [],
    );
    if (!args.includes("--confirm-remove-new-staging-stack")) {
      throw new SafePhase6StagingError(
        "First-deployment rollback requires explicit removal confirmation.",
      );
    }
    return { firstDeployment: true };
  }
  assertExactArguments(
    args,
    [],
    ["--previous-image-metadata=", "--expected-architecture="],
  );
  const metadata = valuesFor(args, "--previous-image-metadata=");
  const architectures = valuesFor(args, "--expected-architecture=");
  if (metadata.length !== 1 || architectures.length !== 1) {
    throw new SafePhase6StagingError(
      "Rollback verification requires metadata and expected architecture.",
    );
  }
  if (!/^linux\/(?:amd64|arm64)$/u.test(architectures[0]!)) {
    throw new SafePhase6StagingError("Rollback architecture is invalid.");
  }
  return {
    firstDeployment: false,
    metadataPath: assertOutsideRepository(metadata[0]!),
    expectedArchitecture: architectures[0]!,
  };
}

export async function verifyRollbackImage(input: {
  readonly command: ReturnType<typeof parseRollbackCommand>;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly inspectImage?: (
    imageTag: string,
  ) => Promise<{ readonly imageId: string; readonly architecture: string }>;
}): Promise<RollbackReport> {
  if (input.command.firstDeployment) {
    if (
      input.environment.STAGING_FIRST_DEPLOYMENT_ROLLBACK_APPROVED !== "YES"
    ) {
      throw new SafePhase6StagingError(
        "First-deployment remove-stack rollback contract is not approved.",
      );
    }
    return {
      mode: "REMOVE_NEW_STAGING_STACK",
      rollbackVerify: "PASS",
    };
  }
  const metadata = JSON.parse(
    await readFile(input.command.metadataPath, "utf8"),
  ) as Partial<RollbackMetadata>;
  if (
    !metadata.imageId ||
    !metadata.imageTag ||
    metadata.architecture !== input.command.expectedArchitecture ||
    metadata.composeService !== "app" ||
    metadata.migrationCount !== 7 ||
    metadata.schemaCompatible !== true
  ) {
    throw new SafePhase6StagingError(
      "Rollback image metadata is incompatible with the staging contract.",
    );
  }
  assertImageId(metadata.imageId);
  if (/(?:^|:)latest$/u.test(metadata.imageTag)) {
    throw new SafePhase6StagingError("Rollback image must not use latest.");
  }
  const inspectImage = input.inspectImage ?? inspectLocalImage;
  const actual = await inspectImage(metadata.imageTag);
  if (
    actual.imageId !== metadata.imageId ||
    actual.architecture !== metadata.architecture
  ) {
    throw new SafePhase6StagingError(
      "Rollback image is missing or does not match its metadata.",
    );
  }
  return {
    mode: "PREVIOUS_IMAGE",
    imageId: metadata.imageId,
    architecture: metadata.architecture,
    migrationCount: metadata.migrationCount,
    rollbackVerify: "PASS",
  };
}

async function inspectLocalImage(
  imageTag: string,
): Promise<{ readonly imageId: string; readonly architecture: string }> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "image",
        "inspect",
        imageTag,
        "--format",
        "{{.Id}} {{.Os}}/{{.Architecture}}",
      ],
      { cwd: process.cwd() },
    );
    const [imageId, architecture, ...extra] = stdout.trim().split(/\s+/u);
    if (!imageId || !architecture || extra.length > 0) {
      throw new Error("Unexpected Docker image metadata.");
    }
    return { imageId, architecture };
  } catch {
    throw new SafePhase6StagingError(
      "Rollback image is not available for read-only inspection.",
    );
  }
}

export function formatRollbackReport(report: RollbackReport): string {
  return [
    `ROLLBACK_MODE=${report.mode}`,
    ...(report.imageId ? [`ROLLBACK_IMAGE_ID=${report.imageId}`] : []),
    ...(report.architecture
      ? [`ROLLBACK_IMAGE_ARCHITECTURE=${report.architecture}`]
      : []),
    ...(report.migrationCount !== undefined
      ? [`ROLLBACK_MIGRATION_COUNT=${report.migrationCount}`]
      : []),
    "DATABASE_ROLLBACK=FORBIDDEN",
    `ROLLBACK_VERIFY=${report.rollbackVerify}`,
  ].join("\n");
}

function assertOutsideRepository(path: string, cwd = process.cwd()): string {
  if (!isAbsolute(path)) {
    throw new SafePhase6StagingError(
      "Sensitive artifact path must be absolute.",
    );
  }
  const absolute = resolve(path);
  const repository = resolve(cwd);
  const repositoryRelative = relative(repository, absolute);
  if (
    repositoryRelative === "" ||
    (repositoryRelative !== ".." &&
      !repositoryRelative.startsWith(`..${sep}`) &&
      !isAbsolute(repositoryRelative))
  ) {
    throw new SafePhase6StagingError(
      "Sensitive artifact must remain outside Git.",
    );
  }
  return absolute;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}
