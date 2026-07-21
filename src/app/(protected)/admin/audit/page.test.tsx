// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminAuditPage: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/data/admin-audit", () => ({
  AUTH_AUDIT_OUTCOMES: ["SUCCESS", "FAILED"],
  getAdminAuditPage: mocks.getAdminAuditPage,
  parseAuditEventType: (value: string | undefined) =>
    value === undefined || value === "ROLE_GRANTED" ? (value ?? null) : null,
  parseAuditOutcome: (value: string | undefined) =>
    value === undefined || value === "SUCCESS" || value === "FAILED"
      ? (value ?? null)
      : null,
}));

import AdminAuditPage from "@/app/(protected)/admin/audit/page";

describe("Phase 8 admin audit presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminAuditPage.mockResolvedValue(auditFixture());
  });

  afterEach(cleanup);

  it("preserves filter names, values, and pagination query construction", async () => {
    render(
      await AdminAuditPage({
        searchParams: Promise.resolve({
          eventType: "ROLE_GRANTED",
          outcome: "SUCCESS",
          page: "2",
        }),
      }),
    );

    const form = screen.getByRole("button", { name: "Lọc" }).closest("form")!;
    expect(
      [...form.querySelectorAll("[name]")].map((field) =>
        field.getAttribute("name"),
      ),
    ).toEqual(["eventType", "outcome"]);
    expect(screen.getByLabelText("Loại sự kiện")).toHaveValue("ROLE_GRANTED");
    expect(screen.getByLabelText("Kết quả")).toHaveValue("SUCCESS");
    expect(screen.getByRole("link", { name: "Trang trước" })).toHaveAttribute(
      "href",
      "/admin/audit?page=1&eventType=ROLE_GRANTED&outcome=SUCCESS",
    );
    expect(screen.getByRole("link", { name: "Trang sau" })).toHaveAttribute(
      "href",
      "/admin/audit?page=3&eventType=ROLE_GRANTED&outcome=SUCCESS",
    );
  });

  it("keeps the seven audit columns ordered in one accessible scroll region", async () => {
    render(await AdminAuditPage({ searchParams: Promise.resolve({}) }));

    const tableRegion = screen.getByLabelText("Nhật ký bảo mật");
    expect(tableRegion).toHaveAttribute("tabindex", "0");
    expect(
      within(tableRegion)
        .getAllByRole("columnheader")
        .map((header) => header.textContent?.trim()),
    ).toEqual([
      "Thời điểm",
      "Sự kiện",
      "Kết quả",
      "Actor ID",
      "Target ID",
      "Session ID",
      "Metadata an toàn",
    ]);
    expect(screen.getByText("role: ADMIN")).toBeVisible();
    expect(tableRegion.textContent).not.toContain("password");
    expect(tableRegion.textContent).not.toContain("token");
  });

  it("preserves the existing empty state and fail-closed filters", async () => {
    mocks.getAdminAuditPage.mockResolvedValue({
      ...auditFixture(),
      rows: [],
      totalRows: 0,
      totalPages: 1,
      page: 1,
    });
    render(await AdminAuditPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Không có sự kiện phù hợp bộ lọc.")).toBeVisible();

    await expect(
      AdminAuditPage({
        searchParams: Promise.resolve({ eventType: "UNKNOWN_EVENT" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

function auditFixture() {
  return {
    rows: [
      {
        id: "event-1",
        eventType: "ROLE_GRANTED",
        outcome: "SUCCESS",
        actorUserId: "actor-1",
        targetUserId: "target-1",
        sessionId: null,
        metadata: { role: "ADMIN" },
        occurredAt: new Date("2026-07-22T00:00:00Z"),
      },
    ],
    page: 2,
    pageSize: 50,
    totalRows: 101,
    totalPages: 3,
    eventType: "ROLE_GRANTED",
    outcome: "SUCCESS",
  };
}
