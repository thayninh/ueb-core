import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthLayout } from "@/components/ui/auth-layout";

vi.mock("next/image", () => ({
  default: ({
    alt,
    className,
  }: Readonly<{ alt: string; className?: string }>) => (
    <span aria-label={alt} className={className} role="img" />
  ),
}));

describe("AuthLayout", () => {
  afterEach(cleanup);

  it("uses one main landmark, the canonical UEB identity and responsive shell", () => {
    render(
      <AuthLayout description="Mô tả" title="Tiêu đề">
        <form aria-label="Biểu mẫu" />
      </AuthLayout>,
    );

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Tiêu đề",
    );
    expect(screen.getByRole("img", { name: "Logo UEB" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Biểu mẫu" })).toBeInTheDocument();
    expect(screen.getByRole("main").className).toContain("px-4");
    expect(screen.getByRole("main").className).toContain("sm:px-6");
    expect(screen.getByRole("main").className).toContain("lg:px-8");
  });
});
