// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { MigrationLedger } from "../../scripts/phase-6/lib/migration-ledger";
import {
  verifyLocalCandidateArtifacts,
  type CandidateImageMetadata,
} from "../../scripts/phase-9/candidate-image-verification";

const releaseSha = "a".repeat(40);
const fingerprint = "b".repeat(64);
const ledger: MigrationLedger = {
  version: 1,
  count: 2,
  fingerprint,
  migrations: [
    { name: "20260101000000_one", checksum: "1".repeat(64) },
    { name: "20260102000000_two", checksum: "2".repeat(64) },
  ],
};
const metadata: CandidateImageMetadata = {
  imageId: `sha256:${"c".repeat(64)}`,
  os: "linux",
  architecture: "amd64",
  labels: {
    "org.opencontainers.image.revision": releaseSha,
    "io.ueb-core.migration-count": "2",
    "io.ueb-core.migration-ledger-fingerprint": fingerprint,
  },
};

const arguments_ = [
  `--release-sha=${releaseSha}`,
  `--app-image=ueb-core:${releaseSha}`,
  `--operator-image=ueb-core-operator:${releaseSha}`,
  "--verify-local",
];

const dependencies = (
  inspectImage: (tag: string) => Promise<CandidateImageMetadata> = async () =>
    metadata,
) => ({
  inspectImage,
  verifyRelease: async () => undefined,
  assertClean: async () => undefined,
  ledger,
});

describe("Phase 9C3 local candidate artifact gate", () => {
  it("verifies exact app and operator SHA labels, ledger, IDs, and platform", async () => {
    const inspected: string[] = [];
    const report = await verifyLocalCandidateArtifacts(
      arguments_,
      dependencies(async (tag) => {
        inspected.push(tag);
        return metadata;
      }),
    );
    expect(inspected).toEqual([
      `ueb-core:${releaseSha}`,
      `ueb-core-operator:${releaseSha}`,
    ]);
    expect(report).toMatchObject({
      status: "PASS",
      gate: "LOCAL_CANDIDATE_ARTIFACT",
      architecture: "linux/amd64",
      mutationCommandCount: 0,
      serverConnectionPerformed: false,
      secretLeakageCount: 0,
    });
  });

  it("rejects a different tag, latest, or malformed release SHA", async () => {
    await expect(
      verifyLocalCandidateArtifacts(
        arguments_.map((argument) =>
          argument.startsWith("--app-image=")
            ? "--app-image=ueb-core:latest"
            : argument,
        ),
        dependencies(),
      ),
    ).rejects.toThrow(/exact release SHA/u);
    await expect(
      verifyLocalCandidateArtifacts(
        arguments_.map((argument) =>
          argument.startsWith("--release-sha=")
            ? "--release-sha=invalid"
            : argument,
        ),
        dependencies(),
      ),
    ).rejects.toThrow(/release SHA/u);
  });

  it.each([
    {
      name: "source SHA",
      metadata: {
        ...metadata,
        labels: {
          ...metadata.labels,
          "org.opencontainers.image.revision": "f".repeat(40),
        },
      },
    },
    {
      name: "migration count",
      metadata: {
        ...metadata,
        labels: {
          ...metadata.labels,
          "io.ueb-core.migration-count": "3",
        },
      },
    },
    {
      name: "migration fingerprint",
      metadata: {
        ...metadata,
        labels: {
          ...metadata.labels,
          "io.ueb-core.migration-ledger-fingerprint": "0".repeat(64),
        },
      },
    },
  ])(
    "fails closed for a mismatched $name label",
    async ({ metadata: value }) => {
      await expect(
        verifyLocalCandidateArtifacts(
          arguments_,
          dependencies(async () => value),
        ),
      ).rejects.toThrow(/labels mismatch/u);
    },
  );

  it("rejects a wrong architecture or non-immutable image ID", async () => {
    await expect(
      verifyLocalCandidateArtifacts(
        arguments_,
        dependencies(async () => ({ ...metadata, architecture: "arm64" })),
      ),
    ).rejects.toThrow(/linux\/amd64/u);
    await expect(
      verifyLocalCandidateArtifacts(
        arguments_,
        dependencies(async () => ({ ...metadata, imageId: "candidate" })),
      ),
    ).rejects.toThrow(/image ID/u);
  });
});
