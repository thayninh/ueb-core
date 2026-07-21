import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("renders the UEB Core heading in the responsive design-system shell", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: "UEB Core" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("overflow-hidden");
    expect(screen.getByText("Project foundation")).toHaveClass(
      "text-brand-700",
    );
  });
});
