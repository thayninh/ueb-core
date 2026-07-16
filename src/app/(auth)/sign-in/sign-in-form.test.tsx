import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SignInForm } from "@/app/(auth)/sign-in/sign-in-form";

vi.mock("@/app/actions/auth", () => ({
  signInAction: vi.fn(),
}));

describe("SignInForm", () => {
  it("renders only controlled sign-in fields and no registration path", () => {
    render(<SignInForm />);

    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(
      screen.getByRole("button", { name: "Đăng nhập" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/đăng ký|sign up/iu)).not.toBeInTheDocument();
  });
});
