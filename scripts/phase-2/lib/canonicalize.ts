import { sha256Bytes } from "./checksum";

export type CanonicalBusinessValue = string | number | null;

export const CANONICALIZATION_VERSION = "ueb-core-source-row-v1";
export const DATASET_CANONICALIZATION_VERSION = "ueb-core-source-dataset-v1";

export function serializeBusinessValues(
  orderedValues: readonly CanonicalBusinessValue[],
): string {
  const encoded = orderedValues.map((value) => {
    if (value === null) return ["null"] as const;
    if (typeof value === "string") return ["string", value] as const;
    if (Number.isInteger(value)) return ["integer", value] as const;
    throw new Error("Canonical business numbers must be integers.");
  });

  return JSON.stringify([CANONICALIZATION_VERSION, encoded]);
}

export function calculateRowChecksum(
  orderedValues: readonly CanonicalBusinessValue[],
): string {
  return sha256Bytes(
    Buffer.from(serializeBusinessValues(orderedValues), "utf8"),
  );
}

export function calculateDatasetChecksum(
  rows: readonly { stt: number; rowChecksum: string }[],
): string {
  const orderedChecksums = [...rows]
    .sort((left, right) => left.stt - right.stt)
    .map((row) => [row.stt, row.rowChecksum] as const);
  const serialized = JSON.stringify([
    DATASET_CANONICALIZATION_VERSION,
    orderedChecksums,
  ]);
  return sha256Bytes(Buffer.from(serialized, "utf8"));
}
