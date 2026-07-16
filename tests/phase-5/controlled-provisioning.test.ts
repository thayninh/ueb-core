// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import {
  assertActiveAdminActor,
  buildProvisioningPlan,
  assertExternalOutputPath,
  parseProvisioningCommand,
  parseReconciliationCommand,
  parseRollbackCommand,
  type ProvisioningBundle,
} from "../../scripts/phase-5/lib/provisioning-guards";
import { formatProvisioningReport } from "../../scripts/phase-5/provision-approved-users";
import { toRollbackTargets } from "../../scripts/phase-5/rollback-provisioning-batch";

vi.mock("server-only", () => ({}));

const checksum = "a".repeat(64);
const actorUserId = "20000000-0000-4000-8000-000000000002";
const commonArguments = [
  "--input=/secure/approved-phase5.json",
  "--approval-batch-id=phase5-pilot-01",
  `--input-checksum=${checksum}`,
  "--expected-database=ueb_core_uat",
  `--actor-user-id=${actorUserId}`,
] as const;
const approval = {
  approval_batch_id: "phase5-pilot-01",
  approved_at: "2026-07-16T13:00:00+07:00",
  approved_by: "approved-authority-reference",
} as const;
const lecturerUid = "10000000-0000-4000-8000-000000000001";

function lecturerBundle(): ProvisioningBundle {
  return {
    lecturers: [
      {
        ...approval,
        email: "lecturer-one@example.com",
        lecturer_uid: lecturerUid,
        requested_roles: ["LECTURER"],
        account_action: "CREATE",
      },
    ],
    leaders: [],
  };
}

function leaderBundle(): ProvisioningBundle {
  return {
    lecturers: [],
    leaders: [
      {
        ...approval,
        email: "leader-one@example.com",
        unit_uid: ["KTPT"],
        requested_roles: ["FACULTY_LEADER"],
        scope_action: "ASSIGN",
      },
    ],
  };
}

function prismaMock(input: {
  users?: unknown[];
  units?: unknown[];
  coreRows?: unknown[];
  evidence?: unknown[];
}): PrismaClient {
  return {
    auth_user: { findMany: vi.fn().mockResolvedValue(input.users ?? []) },
    organizationUnit: {
      findMany: vi.fn().mockResolvedValue(input.units ?? []),
    },
    uebCoreData: {
      findMany: vi.fn().mockResolvedValue(input.coreRows ?? []),
    },
    authAuditEvent: {
      findMany: vi.fn().mockResolvedValue(input.evidence ?? []),
    },
  } as unknown as PrismaClient;
}

describe("Phase 5 controlled provisioning", () => {
  it("uses dry-run by default and requires every apply hard-gate flag", () => {
    expect(parseProvisioningCommand(commonArguments)).toMatchObject({
      apply: false,
      expectedDatabase: "ueb_core_uat",
    });
    expect(() =>
      parseProvisioningCommand([...commonArguments, "--confirm-apply"]),
    ).toThrow();
    expect(
      parseProvisioningCommand([
        ...commonArguments,
        "--confirm-apply",
        "--confirm-rollback-dry-run-pass",
        "--credential-output=/secure/generated-credentials.json",
        `--restore-rehearsal-checksum=${"b".repeat(64)}`,
      ]),
    ).toMatchObject({ apply: true });
  });

  it("requires an explicit actor for dry-run", () => {
    expect(() =>
      parseProvisioningCommand(
        commonArguments.filter(
          (argument) => !argument.startsWith("--actor-user-id="),
        ),
      ),
    ).toThrow();
  });

  it("rejects canonical acceptance and non-UAT database targets", () => {
    expect(() =>
      parseProvisioningCommand(
        commonArguments.map((argument) =>
          argument === "--expected-database=ueb_core_uat"
            ? "--expected-database=ueb_core"
            : argument,
        ),
      ),
    ).toThrow();
    expect(() =>
      parseRollbackCommand([
        "--approval-batch-id=phase5-pilot-01",
        `--input-checksum=${checksum}`,
        "--expected-database=postgres",
        `--actor-user-id=${actorUserId}`,
      ]),
    ).toThrow();
  });

  it("requires the approved bundle for pre-apply rollback dry-run", () => {
    expect(() =>
      parseRollbackCommand([
        "--approval-batch-id=phase5-pilot-01",
        `--input-checksum=${checksum}`,
        "--expected-database=ueb_core_uat",
        `--actor-user-id=${actorUserId}`,
      ]),
    ).toThrow();
    expect(
      parseRollbackCommand([
        "--input=/secure/approved-phase5.json",
        "--approval-batch-id=phase5-pilot-01",
        `--input-checksum=${checksum}`,
        "--expected-database=ueb_core_uat",
        `--actor-user-id=${actorUserId}`,
      ]),
    ).toMatchObject({ apply: false });
  });

  it("requires an explicit actor for rollback dry-run and reconciliation", () => {
    const withoutActor = commonArguments.filter(
      (argument) => !argument.startsWith("--actor-user-id="),
    );
    expect(() => parseRollbackCommand(withoutActor)).toThrow();
    expect(() => parseReconciliationCommand(withoutActor)).toThrow();
    expect(parseRollbackCommand(commonArguments)).toMatchObject({
      actorUserId,
      apply: false,
    });
    expect(parseReconciliationCommand(commonArguments)).toMatchObject({
      actorUserId,
    });
  });

  it("refuses a credential output path inside the repository", async () => {
    await expect(
      assertExternalOutputPath(
        resolve(process.cwd(), "phase5-generated-credentials.json"),
      ),
    ).rejects.toThrow();
  });

  it("plans only an explicitly approved lecturer CREATE", async () => {
    const plan = await buildProvisioningPlan({
      prisma: prismaMock({
        coreRows: [
          {
            emailTaiKhoanVnu: "lecturer-one@example.com",
            lecturerUid,
          },
        ],
      }),
      bundle: lecturerBundle(),
      approvalBatchId: approval.approval_batch_id,
      inputChecksum: checksum,
    });

    expect(plan).toMatchObject({
      createCount: 1,
      roleAssignmentCount: 1,
      lecturerMappingCount: 1,
      unitScopeAssignmentCount: 0,
      blockers: [],
    });
  });

  it("fails lecturer source matching when RLS returns no rows without context", async () => {
    const plan = await buildProvisioningPlan({
      prisma: prismaMock({ coreRows: [] }),
      bundle: lecturerBundle(),
      approvalBatchId: approval.approval_batch_id,
      inputChecksum: checksum,
    });

    expect(plan.blockers).toEqual([
      expect.objectContaining({ code: "LECTURER_SOURCE_MISMATCH" }),
    ]);
  });

  it("validates an active ADMIN and matches all five RLS-visible lecturer rows", async () => {
    const lecturers = Array.from({ length: 5 }, (_, index) => ({
      ...approval,
      email: `lecturer-${index + 1}@example.com`,
      lecturer_uid: `10000000-0000-4000-8000-00000000000${index + 1}`,
      requested_roles: ["LECTURER" as const],
      account_action: "CREATE" as const,
    }));
    const roleAssignment = {
      findFirst: vi.fn().mockResolvedValue({ id: "active-admin-role" }),
    };
    await assertActiveAdminActor({
      prisma: { roleAssignment } as unknown as Pick<
        PrismaClient,
        "roleAssignment"
      >,
      actorUserId,
    });
    const plan = await buildProvisioningPlan({
      prisma: prismaMock({
        coreRows: lecturers.map((row) => ({
          emailTaiKhoanVnu: row.email,
          lecturerUid: row.lecturer_uid,
        })),
      }),
      bundle: { lecturers, leaders: [] },
      approvalBatchId: approval.approval_batch_id,
      inputChecksum: checksum,
    });

    expect(roleAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: actorUserId,
          role: "ADMIN",
          revokedAt: null,
        }),
      }),
    );
    expect(plan).toMatchObject({ createCount: 5, blockers: [] });
  });

  it("fails closed when the actor is not an active ADMIN", async () => {
    await expect(
      assertActiveAdminActor({
        prisma: {
          roleAssignment: { findFirst: vi.fn().mockResolvedValue(null) },
        } as unknown as Pick<PrismaClient, "roleAssignment">,
        actorUserId,
      }),
    ).rejects.toMatchObject({ code: "ACTOR_NOT_ACTIVE_ADMIN" });
  });

  it("reports zero database writes for a successful dry-run plan", async () => {
    const plan = await buildProvisioningPlan({
      prisma: prismaMock({
        coreRows: [
          {
            emailTaiKhoanVnu: "lecturer-one@example.com",
            lecturerUid,
          },
        ],
      }),
      bundle: lecturerBundle(),
      approvalBatchId: approval.approval_batch_id,
      inputChecksum: checksum,
    });

    expect(formatProvisioningReport(false, plan)).toContain(
      "DATABASE_WRITES=0",
    );
  });

  it("never creates a leader account and resolves only an approved exact unit", async () => {
    const missingAccount = await buildProvisioningPlan({
      prisma: prismaMock({ units: [] }),
      bundle: leaderBundle(),
      approvalBatchId: approval.approval_batch_id,
      inputChecksum: checksum,
    });
    expect(missingAccount.blockers).toContainEqual(
      expect.objectContaining({ code: "ACCOUNT_NOT_FOUND" }),
    );

    const planned = await buildProvisioningPlan({
      prisma: prismaMock({
        users: [
          {
            id: "30000000-0000-4000-8000-000000000003",
            email: "leader-one@example.com",
            accessProfile: { lecturerUid: null, status: "ACTIVE" },
            roleAssignments: [],
            unitScopeAssignments: [],
          },
        ],
        units: [
          {
            id: "40000000-0000-4000-8000-000000000004",
            sourceValue: "Khoa KTPT",
          },
        ],
      }),
      bundle: leaderBundle(),
      approvalBatchId: approval.approval_batch_id,
      inputChecksum: checksum,
    });
    expect(planned).toMatchObject({
      createCount: 0,
      updateCount: 1,
      roleAssignmentCount: 1,
      unitScopeAssignmentCount: 1,
      blockers: [],
    });
  });

  it("is a no-op when the same CREATE batch is already evidenced", async () => {
    const targetUserId = "30000000-0000-4000-8000-000000000003";
    const plan = await buildProvisioningPlan({
      prisma: prismaMock({
        users: [
          {
            id: targetUserId,
            email: "lecturer-one@example.com",
            accessProfile: { lecturerUid, status: "ACTIVE" },
            roleAssignments: [{ role: "LECTURER" }],
            unitScopeAssignments: [],
          },
        ],
        coreRows: [
          {
            emailTaiKhoanVnu: "lecturer-one@example.com",
            lecturerUid,
          },
        ],
        evidence: [
          {
            targetUserId,
            metadata: {
              phase5InputChecksum: checksum,
              phase5Operation: "APPLY",
            },
          },
        ],
      }),
      bundle: lecturerBundle(),
      approvalBatchId: approval.approval_batch_id,
      inputChecksum: checksum,
    });

    expect(plan).toMatchObject({
      createCount: 0,
      updateCount: 0,
      blockers: [],
    });
  });

  it("builds rollback only from changes evidenced by the exact batch", () => {
    expect(
      toRollbackTargets([
        {
          targetUserId: "target-1",
          eventType: "USER_CREATED",
        },
        {
          targetUserId: "target-1",
          eventType: "ROLE_GRANTED",
          role: "LECTURER",
        },
        {
          targetUserId: "target-2",
          eventType: "UNIT_SCOPE_GRANTED",
          organizationUnitId: "unit-1",
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetUserId: "target-1",
          createdByBatch: true,
          roles: ["LECTURER"],
        }),
        expect.objectContaining({
          targetUserId: "target-2",
          organizationUnitIds: ["unit-1"],
        }),
      ]),
    );
  });

  it("does not use raw mutation SQL or print identity fields", () => {
    const sources = [
      "provision-approved-users.ts",
      "reconcile-provisioning-batch.ts",
      "rollback-provisioning-batch.ts",
    ].map((file) =>
      readFileSync(
        new URL(`../../scripts/phase-5/${file}`, import.meta.url),
        "utf8",
      ),
    );
    for (const source of sources) {
      expect(source).not.toMatch(
        /\$(?:executeRaw|queryRaw)|DELETE\s+FROM|UPDATE\s+/iu,
      );
      expect(source).not.toMatch(
        /console\.(?:log|error)\([^)]*(?:email|password|token|name)/iu,
      );
      expect(source).toContain("withAuthorizedProvisioningReadContext");
    }
  });
});
