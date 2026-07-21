import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dataPage: vi.fn(),
  units: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/data/leader-data", () => ({
  getLeaderDataPage: mocks.dataPage,
  getLeaderUnits: mocks.units,
}));

import LeaderDataPage from "@/app/(protected)/leader/data/page";

const UNIT_ID = "33333333-3333-4333-8333-333333333333";

describe("Phase 8 leader data presentation", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.units.mockResolvedValue([
      { id: UNIT_ID, displayName: "Unit A", sourceValue: "Unit A" },
    ]);
    mocks.dataPage.mockResolvedValue({
      rows: [],
      unit: { id: UNIT_ID, displayName: "Unit A", sourceValue: "Unit A" },
      search: "Học phần",
      page: 2,
      pageSize: 25,
      totalRows: 51,
      totalPages: 3,
    });
  });

  it("preserves filter names, values, and pagination query construction", async () => {
    render(
      await LeaderDataPage({
        searchParams: Promise.resolve({}),
      }),
    );

    const form = screen.getByRole("button", { name: "Tra cứu" }).closest("form")!;
    expect(
      [...form.querySelectorAll("[name]")].map((field) =>
        field.getAttribute("name"),
      ),
    ).toEqual(["unitId", "q"]);
    expect(screen.getByLabelText("Đơn vị")).toHaveValue(UNIT_ID);
    expect(screen.getByLabelText("Tìm kiếm")).toHaveValue("Học phần");
    expect(screen.getByRole("link", { name: "Trang trước" })).toHaveAttribute(
      "href",
      `/leader/data?unitId=${UNIT_ID}&page=1&q=H%E1%BB%8Dc+ph%E1%BA%A7n`,
    );
    expect(screen.getByRole("link", { name: "Trang sau" })).toHaveAttribute(
      "href",
      `/leader/data?unitId=${UNIT_ID}&page=3&q=H%E1%BB%8Dc+ph%E1%BA%A7n`,
    );
  });
});
