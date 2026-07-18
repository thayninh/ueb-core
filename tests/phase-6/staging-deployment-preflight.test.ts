// @vitest-environment node

import { describe, expect, it } from "vitest";

import { parseDeploymentPreflightCommand } from "../../scripts/phase-6/lib/staging-deployment";

const gitSha = "a".repeat(40);
const baseArguments = [
  `--expected-git-commit=${gitSha}`,
  `--expected-image-archive-sha256=${"b".repeat(64)}`,
  `--expected-image-id=sha256:${"c".repeat(64)}`,
  `--image-tag=ueb-core:${gitSha}`,
  "--image-archive=/private/tmp/ueb-core-app.tar",
  `--expected-operator-image-archive-sha256=${"d".repeat(64)}`,
  `--expected-operator-image-id=sha256:${"e".repeat(64)}`,
  `--operator-image-tag=ueb-core-operator:${gitSha}`,
  "--operator-image-archive=/private/tmp/ueb-core-operator.tar",
  "--target-host=103.200.25.54",
  "--target-database=ueb_core_staging",
  "--deployment-directory=/opt/ueb-core",
  "--proxy-network=ueb-core-proxy",
  "--caddy-container=khtc-ueb-prod-caddy-1",
  "--ssh-alias=ueb-core-staging",
  "--secret-file=/private/tmp/app-runtime.env",
  "--rollback-evidence=/private/tmp/rollback.txt",
  "--confirm-authorized-staging-deployment",
];

describe("Phase 6 two-image deployment preflight contract", () => {
  it("requires immutable app and operator artifacts from the same commit", () => {
    expect(parseDeploymentPreflightCommand(baseArguments)).toMatchObject({
      gitCommit: gitSha,
      imageTag: `ueb-core:${gitSha}`,
      operatorImageTag: `ueb-core-operator:${gitSha}`,
    });
  });

  it("rejects a missing or mismatched operator artifact", () => {
    expect(() =>
      parseDeploymentPreflightCommand(
        baseArguments.filter(
          (argument) => !argument.startsWith("--expected-operator-image-id="),
        ),
      ),
    ).toThrow(/incomplete/u);
    expect(() =>
      parseDeploymentPreflightCommand(
        baseArguments.map((argument) =>
          argument.startsWith("--operator-image-tag=")
            ? `--operator-image-tag=ueb-core-operator:${"f".repeat(40)}`
            : argument,
        ),
      ),
    ).toThrow(/exact Git SHA/u);
  });
});
