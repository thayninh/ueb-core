// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUserAction: vi.fn(),
  getAdminUserManagement: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  revokeUserSessionsAction: vi.fn(),
  setLecturerMappingAction: vi.fn(),
  setUserRoleAction: vi.fn(),
  setUserStatusAction: vi.fn(),
  setUserUnitScopeAction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/app/actions/admin", () => ({
  createUserAction: mocks.createUserAction,
  revokeUserSessionsAction: mocks.revokeUserSessionsAction,
  setLecturerMappingAction: mocks.setLecturerMappingAction,
  setUserRoleAction: mocks.setUserRoleAction,
  setUserStatusAction: mocks.setUserStatusAction,
  setUserUnitScopeAction: mocks.setUserUnitScopeAction,
}));
vi.mock("@/lib/data/admin-data", () => ({
  getAdminUserManagement: mocks.getAdminUserManagement,
}));

import AdminUsersPage from "@/app/(protected)/admin/users/page";

const TARGET_USER_ID = "11111111-1111-4111-8111-111111111111";
const LECTURER_UID = "22222222-2222-4222-8222-222222222222";
const UNIT_A_ID = "33333333-3333-4333-8333-333333333333";
const UNIT_B_ID = "44444444-4444-4444-8444-444444444444";

describe("Phase 8 admin user presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUserAction.mockResolvedValue({
      status: "SUCCESS",
      message: "Đã tạo tài khoản có kiểm soát.",
    });
    mocks.getAdminUserManagement.mockResolvedValue({
      users: [
        {
          id: TARGET_USER_ID,
          name: "Admin Fixture",
          email: "admin-fixture@example.invalid",
          createdAt: new Date("2026-07-22T00:00:00Z"),
          status: "ACTIVE",
          lecturerUid: LECTURER_UID,
          roles: ["LECTURER", "ADMIN"],
          units: [
            { id: UNIT_A_ID, displayName: "Unit A", sourceValue: "Unit A" },
          ],
          sessionCount: 2,
        },
      ],
      units: [
        { id: UNIT_A_ID, displayName: "Unit A", sourceValue: "Unit A" },
        { id: UNIT_B_ID, displayName: "Unit B", sourceValue: "Unit B" },
      ],
      lecturerCandidates: [
        {
          lecturerUid: LECTURER_UID,
          lecturerName: "Lecturer Fixture",
          email: "lecturer-fixture@example.invalid",
        },
      ],
    });
  });

  afterEach(cleanup);

  it("preserves create-user field order and password policy attributes", async () => {
    const { container } = render(await renderPage());
    const createForm = screen
      .getByRole("button", { name: "Tạo tài khoản" })
      .closest("form")!;

    expect(fieldNames(createForm)).toEqual([
      "name",
      "email",
      "temporaryPassword",
      "lecturerUid",
      "requirePasswordChange",
      "roles",
      "roles",
      "roles",
      "unitIds",
      "unitIds",
    ]);
    expect(screen.getByLabelText("Mật khẩu tạm")).toHaveAttribute(
      "minlength",
      "12",
    );
    expect(screen.getByLabelText("Mật khẩu tạm")).toHaveAttribute(
      "maxlength",
      "128",
    );
    expect(screen.getByLabelText("Mật khẩu tạm")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.getByLabelText("Yêu cầu đổi mật khẩu lần đầu"),
    ).toHaveAttribute("name", "requirePasswordChange");
    expect(container.querySelector('[name="mustChangePassword"]')).toBeNull();
  });

  it("keeps every user mutation in its own form with exact hidden payload", async () => {
    const { container } = render(await renderPage());
    const forms = [...container.querySelectorAll("form")];

    expect(forms).toHaveLength(9);
    expect(formValues(findForm(forms, "status"))).toEqual({
      status: "DISABLED",
      targetUserId: TARGET_USER_ID,
    });
    expect(formValues(findFormByButton(forms, "Thu hồi session"))).toEqual({
      targetUserId: TARGET_USER_ID,
    });
    expect(formValues(findForm(forms, "role", "ADMIN"))).toEqual({
      enabled: "false",
      role: "ADMIN",
      targetUserId: TARGET_USER_ID,
    });
    expect(
      formValues(findForm(forms, "organizationUnitId", UNIT_B_ID)),
    ).toEqual({
      enabled: "true",
      organizationUnitId: UNIT_B_ID,
      targetUserId: TARGET_USER_ID,
    });
    expect(formValues(findFormByButton(forms, "Lưu ánh xạ"))).toEqual({
      lecturerUid: LECTURER_UID,
      targetUserId: TARGET_USER_ID,
    });
  });

  it("retains action bindings and state-derived labels without duplication", async () => {
    const { container } = render(await renderPage());
    const forms = [...container.querySelectorAll("form")];
    const createForm = screen
      .getByRole("button", { name: "Tạo tài khoản" })
      .closest("form")!;
    const statusForm = findForm(forms, "status");
    const sessionForm = findFormByButton(forms, "Thu hồi session");
    const roleForm = findForm(forms, "role", "ADMIN");
    const unitForm = findForm(forms, "organizationUnitId", UNIT_B_ID);
    const mappingForm = findFormByButton(forms, "Lưu ánh xạ");

    expect(screen.getByRole("button", { name: "Vô hiệu hóa" })).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Thu hồi session" }),
    ).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Lưu ánh xạ" })).toHaveLength(
      1,
    );

    fireEvent.submit(createForm);
    fireEvent.submit(statusForm);
    fireEvent.submit(sessionForm);
    fireEvent.submit(roleForm);
    fireEvent.submit(unitForm);
    fireEvent.submit(mappingForm);

    await waitFor(() => {
      expect(mocks.createUserAction).toHaveBeenCalledOnce();
      expect(mocks.setUserStatusAction).toHaveBeenCalledOnce();
      expect(mocks.revokeUserSessionsAction).toHaveBeenCalledOnce();
      expect(mocks.setUserRoleAction).toHaveBeenCalledOnce();
      expect(mocks.setUserUnitScopeAction).toHaveBeenCalledOnce();
      expect(mocks.setLecturerMappingAction).toHaveBeenCalledOnce();
    });
  });
});

function renderPage() {
  return AdminUsersPage({ searchParams: Promise.resolve({}) });
}

function fieldNames(form: HTMLFormElement): string[] {
  return [...form.querySelectorAll("[name]")].map((field) =>
    field.getAttribute("name")!,
  );
}

function findForm(
  forms: HTMLFormElement[],
  fieldName: string,
  value?: string,
): HTMLFormElement {
  const form = forms.find((candidate) => {
    const field = candidate.querySelector(`[name="${fieldName}"]`);
    return (
      field && (value === undefined || field.getAttribute("value") === value)
    );
  });
  if (!form) throw new Error(`Missing form for ${fieldName}.`);
  return form;
}

function findFormByButton(
  forms: HTMLFormElement[],
  label: string,
): HTMLFormElement {
  const form = forms.find(
    (candidate) =>
      candidate.querySelector("button")?.textContent?.trim() === label,
  );
  if (!form) throw new Error(`Missing form for ${label}.`);
  return form;
}

function formValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    [...new FormData(form)].map(([key, value]) => [key, String(value)]),
  );
}
