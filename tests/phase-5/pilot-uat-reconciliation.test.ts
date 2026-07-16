// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  assertPilotIdentityIntegrity,
  parsePilotUatReconciliationCommand,
  type PilotIdentityReport,
} from "../../scripts/phase-5/reconcile-pilot-uat";

const checksum = "a".repeat(64);
const arguments_ = [
  "--target-database=ueb_core_uat_phase5",
  "--approval-batch-id=phase5-pilot-ktpt-20260716",
  `--input-checksum=${checksum}`,
  "--pilot-unit=KTPT",
] as const;

const passingIdentityReport: PilotIdentityReport = {
  pilotTargetCount: 6,
  activePilotLecturerCount: 5,
  lecturerMappingCount: 5,
  activePilotLeaderCount: 1,
  activePilotScopeCount: 1,
  usersWithoutRole: 0,
  lecturersWithoutMapping: 0,
  leadersWithoutScope: 0,
  duplicateActiveRoleGroups: 0,
  duplicateActiveScopeGroups: 0,
};

describe("Phase 5 pilot UAT reconciliation", () => {
  it("accepts the exact sanitized KTPT pilot command", () => {
    expect(parsePilotUatReconciliationCommand(arguments_)).toEqual({
      targetDatabase: "ueb_core_uat_phase5",
      approvalBatchId: "phase5-pilot-ktpt-20260716",
      inputChecksum: checksum,
      pilotUnit: "KTPT",
    });
  });

  it("rejects canonical, non-KTPT and ambiguous arguments", () => {
    expect(() =>
      parsePilotUatReconciliationCommand(
        arguments_.map((argument) =>
          argument.startsWith("--target-database=")
            ? "--target-database=ueb_core"
            : argument,
        ),
      ),
    ).toThrow();
    expect(() =>
      parsePilotUatReconciliationCommand(
        arguments_.map((argument) =>
          argument.startsWith("--pilot-unit=") ? "--pilot-unit=QTKD" : argument,
        ),
      ),
    ).toThrow();
    expect(() =>
      parsePilotUatReconciliationCommand([
        ...arguments_,
        "--target-database=ueb_core_uat_other",
      ]),
    ).toThrow();
  });

  it("requires exact pilot identity integrity without drift", () => {
    expect(() =>
      assertPilotIdentityIntegrity(passingIdentityReport),
    ).not.toThrow();
    expect(() =>
      assertPilotIdentityIntegrity({
        ...passingIdentityReport,
        duplicateActiveRoleGroups: 1,
      }),
    ).toThrow();
    expect(() =>
      assertPilotIdentityIntegrity({
        ...passingIdentityReport,
        activePilotLecturerCount: 4,
      }),
    ).toThrow();
  });

  it("uses one read-only snapshot and never consumes the STT sequence", () => {
    const source = readFileSync(
      new URL("../../scripts/phase-5/reconcile-pilot-uat.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(source).not.toMatch(/nextval\s*\(/iu);
    expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/gu);
  });

  it("selects opaque targets from exact batch evidence and logs aggregates only", () => {
    const source = readFileSync(
      new URL("../../scripts/phase-5/reconcile-pilot-uat.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("phase5ApprovalBatchId");
    expect(source).toContain("phase5InputChecksum");
    expect(source).toContain("phase5Operation");
    expect(source).not.toMatch(
      /(?:EMAIL|NAME|PASSWORD|TOKEN|INTERNAL_USER_ID)=/u,
    );
  });
});
