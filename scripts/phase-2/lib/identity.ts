import { v5 as uuidV5 } from "uuid";

import type { CanonicalBusinessValue } from "./canonicalize";

export const LEGACY_IDENTITY_NAMESPACES = {
  lecturer: "e8b7e7a0-60d1-5cf0-9fb0-199326abf8b7",
  record: "3c28e33d-3911-5d17-8ec6-513fa8dc8bdb",
  snapshot: "3140c346-5494-5c36-9132-5e18a389620c",
  importRun: "df28bb1d-19f8-560b-bcd8-c1dd4ca0e2b0",
} as const;

export type IdentityStatus = "RESOLVED" | "UNRESOLVED";

export interface LegacyIdentityInput {
  staffCode: string | null;
  email: string | null;
  lecturerName: string | null;
  approvalUnit: string | null;
}

export interface LegacyTechnicalIdentity {
  identityKey: string;
  identityStatus: IdentityStatus;
  lecturerUid: string;
}

export function createLegacyTechnicalIdentity(
  input: LegacyIdentityInput,
): LegacyTechnicalIdentity {
  let identityKey: string;
  let identityStatus: IdentityStatus;

  if (input.staffCode !== null) {
    identityKey = `staff:${input.staffCode}`;
    identityStatus = "RESOLVED";
  } else if (input.email !== null) {
    identityKey = `email:${input.email.toLocaleLowerCase("en-US")}`;
    identityStatus = "RESOLVED";
  } else {
    identityKey = `unresolved:${normalizeIdentityPart(input.lecturerName)}|${normalizeIdentityPart(input.approvalUnit)}`;
    identityStatus = "UNRESOLVED";
  }

  return {
    identityKey,
    identityStatus,
    lecturerUid: uuidV5(identityKey, LEGACY_IDENTITY_NAMESPACES.lecturer),
  };
}

export function createLegacyRecordUid(stt: number): string {
  if (!Number.isInteger(stt)) throw new Error("Legacy stt must be an integer.");
  return uuidV5(`legacy-stt:${stt}`, LEGACY_IDENTITY_NAMESPACES.record);
}

export function createLegacySnapshotId(lecturerUid: string): string {
  return uuidV5(
    `lecturer:${lecturerUid}|version:1`,
    LEGACY_IDENTITY_NAMESPACES.snapshot,
  );
}

export function createLegacyImportRunId(sourceSha256: string): string {
  return uuidV5(
    `source-sha256:${sourceSha256}`,
    LEGACY_IDENTITY_NAMESPACES.importRun,
  );
}

export function unresolvedIdentitySignature(
  lecturerName: CanonicalBusinessValue,
  approvalUnit: CanonicalBusinessValue,
): string {
  return JSON.stringify([lecturerName, approvalUnit]);
}

function normalizeIdentityPart(value: string | null): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("vi-VN");
}
