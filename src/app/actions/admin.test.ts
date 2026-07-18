// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createUserAction,
  revokeUserSessionsAction,
  setLecturerMappingAction,
  setUserRoleAction,
  setUserStatusAction,
  setUserUnitScopeAction,
} from "@/app/actions/admin";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  provisionUser: vi.fn(),
  activateUser: vi.fn(),
  disableUserAndRevokeSessions: vi.fn(),
  setUserRole: vi.fn(),
  setUserUnitScope: vi.fn(),
  setLecturerMapping: vi.fn(),
  revokeUserSessions: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/auth/provision-user", () => ({
  provisionUser: mocks.provisionUser,
}));
vi.mock("@/lib/auth/account-lifecycle", () => ({
  disableUserAndRevokeSessions: mocks.disableUserAndRevokeSessions,
}));
vi.mock("@/lib/auth/admin-user-management", () => ({
  activateUser: mocks.activateUser,
  revokeUserSessions: mocks.revokeUserSessions,
  setLecturerMapping: mocks.setLecturerMapping,
  setUserRole: mocks.setUserRole,
  setUserUnitScope: mocks.setUserUnitScope,
}));

const actorUserId = "11111111-1111-4111-8111-111111111111";
const targetUserId = "22222222-2222-4222-8222-222222222222";
const unitId = "33333333-3333-4333-8333-333333333333";
const lecturerUid = "44444444-4444-4444-8444-444444444444";

describe("admin Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ userId: actorUserId });
    mocks.provisionUser.mockResolvedValue({ status: "CREATED" });
  });

  it("re-authorizes create account inside the action", async () => {
    const form = new FormData();
    form.set("name", "Test Administrator");
    form.set("email", "test-admin@example.edu");
    form.set("temporaryPassword", "secure-temporary-password");
    form.set("requirePasswordChange", "false");
    form.append("roles", "ADMIN");

    await expect(
      createUserAction({ status: "IDLE", message: null }, form),
    ).resolves.toMatchObject({ status: "SUCCESS" });
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.provisionUser).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId,
        roles: ["ADMIN"],
        requirePasswordChange: false,
      }),
    );
  });

  it("re-authorizes every account mutation action", async () => {
    const statusForm = targetForm();
    statusForm.set("status", "DISABLED");
    await setUserStatusAction(statusForm);

    const roleForm = targetForm();
    roleForm.set("role", "LECTURER");
    roleForm.set("enabled", "true");
    await setUserRoleAction(roleForm);

    const unitForm = targetForm();
    unitForm.set("organizationUnitId", unitId);
    unitForm.set("enabled", "true");
    await setUserUnitScopeAction(unitForm);

    const mappingForm = targetForm();
    mappingForm.set("lecturerUid", lecturerUid);
    await setLecturerMappingAction(mappingForm);

    await revokeUserSessionsAction(targetForm());

    expect(mocks.requireAdmin).toHaveBeenCalledTimes(5);
    expect(mocks.disableUserAndRevokeSessions).toHaveBeenCalledOnce();
    expect(mocks.setUserRole).toHaveBeenCalledOnce();
    expect(mocks.setUserUnitScope).toHaveBeenCalledOnce();
    expect(mocks.setLecturerMapping).toHaveBeenCalledOnce();
    expect(mocks.revokeUserSessions).toHaveBeenCalledOnce();
  });

  it("does not trust a forged target user form when the actor is not ADMIN", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(new Error("FORBIDDEN"));
    const roleForm = targetForm();
    roleForm.set("role", "ADMIN");
    roleForm.set("enabled", "true");

    await expect(setUserRoleAction(roleForm)).rejects.toThrow(/FORBIDDEN/u);
    expect(mocks.setUserRole).not.toHaveBeenCalled();
  });
});

function targetForm(): FormData {
  const form = new FormData();
  form.set("targetUserId", targetUserId);
  return form;
}
