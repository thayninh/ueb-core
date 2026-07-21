import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ForbiddenPage from "./forbidden";

describe("ForbiddenPage", () => {
  it("keeps the HTTP 403 contract in the responsive design-system shell", () => {
    render(<ForbiddenPage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Không có quyền truy cập",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("HTTP 403")).toHaveClass("text-danger-text");
    expect(screen.getByRole("main")).toHaveClass("overflow-hidden");
    expect(
      screen.getByRole("link", { name: "Về bảng điều khiển" }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
