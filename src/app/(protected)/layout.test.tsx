import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProtectedLayout from "@/app/(protected)/layout";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  requireBusinessSession: vi.fn(),
  signOutAction: vi.fn(),
}));

vi.mock("next/image", () => ({
  default: ({
    alt,
    className,
  }: Readonly<{ alt: string; className?: string }>) => (
    <span aria-label={alt} className={className} role="img" />
  ),
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/app/actions/auth", () => ({
  signOutAction: mocks.signOutAction,
}));
vi.mock("@/lib/auth/session", () => ({
  requireBusinessSession: mocks.requireBusinessSession,
}));

describe("ProtectedLayout", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.mockResolvedValue(undefined);
    mocks.requireBusinessSession.mockResolvedValue({
      mustChangePassword: false,
      userId: "opaque-user",
    });
    mocks.signOutAction.mockResolvedValue(undefined);
  });

  it("keeps the canonical brand, dashboard link and logout action exactly once", async () => {
    const view = await ProtectedLayout({
      children: <main>Protected content</main>,
    });
    const { container } = render(view);

    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.requireBusinessSession).toHaveBeenCalledOnce();
    expect(screen.getByRole("img", { name: "Logo UEB" })).toBeInTheDocument();

    const brand = screen.getByRole("link", { name: "UEB Core" });
    const dashboard = screen.getByRole("link", {
      name: "Bảng điều khiển",
    });
    expect(brand).toHaveAttribute("href", "/dashboard");
    expect(dashboard).toHaveAttribute("href", "/dashboard");
    expect(screen.getAllByText("UEB Core")).toHaveLength(1);
    expect(screen.getAllByText("Bảng điều khiển")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Đăng xuất" })).toHaveLength(
      1,
    );

    const logoutForm = screen
      .getByRole("button", { name: "Đăng xuất" })
      .closest("form");
    expect(logoutForm).not.toBeNull();
    fireEvent.submit(logoutForm!);
    await waitFor(() => expect(mocks.signOutAction).toHaveBeenCalledOnce());

    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header?.querySelector(".flex-wrap")?.className).toContain(
      "sm:flex-nowrap",
    );
    expect(header?.textContent).not.toMatch(/menu|sidebar|drawer|hamburger/iu);
  });

  it("preserves logical keyboard order and minimum touch targets", async () => {
    const view = await ProtectedLayout({ children: <main /> });
    const { container } = render(view);

    const interactive = Array.from(
      container.querySelectorAll<HTMLElement>("header a, header button"),
    );
    expect(interactive.map((element) => element.textContent?.trim())).toEqual([
      "UEB Core",
      "Bảng điều khiển",
      "Đăng xuất",
    ]);
    for (const element of interactive) {
      expect(element.className).toContain("min-h-11");
    }
  });
});
