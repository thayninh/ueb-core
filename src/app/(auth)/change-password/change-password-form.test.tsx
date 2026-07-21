import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChangePasswordForm } from "@/app/(auth)/change-password/change-password-form";

const actionMocks = vi.hoisted(() => ({
  changeRequiredPasswordAction: vi.fn(),
}));

vi.mock("@/app/actions/auth", () => ({
  changeRequiredPasswordAction: actionMocks.changeRequiredPasswordAction,
}));

describe("ChangePasswordForm", () => {
  afterEach(cleanup);

  beforeEach(() => {
    actionMocks.changeRequiredPasswordAction.mockReset();
  });

  it("keeps the existing password field and browser validation contract", () => {
    render(<ChangePasswordForm />);

    const fields = [
      ["Mật khẩu hiện tại", "currentPassword", "current-password"],
      ["Mật khẩu mới", "newPassword", "new-password"],
      ["Xác nhận mật khẩu mới", "confirmPassword", "new-password"],
    ] as const;

    for (const [label, name, autoComplete] of fields) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute("name", name);
      expect(field).toHaveAttribute("autocomplete", autoComplete);
      expect(field).toHaveAttribute("minlength", "12");
      expect(field).toHaveAttribute("maxlength", "128");
      expect(field).toBeRequired();
    }

    expect(
      screen.getByRole("button", { name: "Đổi mật khẩu" }),
    ).toHaveAttribute("type", "submit");
  });

  it("submits only the unchanged password fields and renders action errors", async () => {
    actionMocks.changeRequiredPasswordAction.mockResolvedValueOnce({
      error: "Không thể đổi mật khẩu.",
    });
    const { container } = render(<ChangePasswordForm />);

    for (const label of [
      "Mật khẩu hiện tại",
      "Mật khẩu mới",
      "Xác nhận mật khẩu mới",
    ]) {
      fireEvent.change(screen.getByLabelText(label), {
        target: { value: "safe-test-value" },
      });
    }
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() =>
      expect(actionMocks.changeRequiredPasswordAction).toHaveBeenCalledOnce(),
    );
    const submitted = actionMocks.changeRequiredPasswordAction.mock
      .calls[0]?.[1] as FormData;
    expect(Array.from(submitted.keys())).toEqual([
      "currentPassword",
      "newPassword",
      "confirmPassword",
    ]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Không thể đổi mật khẩu.",
    );
  });
});
