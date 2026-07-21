import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignInForm } from "@/app/(auth)/sign-in/sign-in-form";

const actionMocks = vi.hoisted(() => ({
  signInAction: vi.fn(),
}));

vi.mock("@/app/actions/auth", () => ({
  signInAction: actionMocks.signInAction,
}));

describe("SignInForm", () => {
  afterEach(cleanup);

  beforeEach(() => {
    actionMocks.signInAction.mockReset();
  });

  it("renders only controlled sign-in fields and no registration path", () => {
    render(<SignInForm />);

    const email = screen.getByRole("textbox", { name: "Email" });
    const password = screen.getByLabelText("Mật khẩu");

    expect(email).toHaveAttribute("name", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(password).toHaveAttribute("name", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(
      screen.getByRole("button", { name: "Đăng nhập" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/đăng ký|sign up/iu)).not.toBeInTheDocument();
  });

  it("submits the unchanged credential fields and renders the existing error", async () => {
    actionMocks.signInAction.mockResolvedValueOnce({
      error: "Thông tin đăng nhập không hợp lệ.",
    });
    const { container } = render(<SignInForm />);

    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "operator@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), {
      target: { value: "not-a-real-password" },
    });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() =>
      expect(actionMocks.signInAction).toHaveBeenCalledOnce(),
    );
    const submitted = actionMocks.signInAction.mock.calls[0]?.[1] as FormData;
    expect(Array.from(submitted.keys())).toEqual(["email", "password"]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Thông tin đăng nhập không hợp lệ.",
    );
  });
});
