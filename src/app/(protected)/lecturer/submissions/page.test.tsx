import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LecturerSubmissionsPage from "@/app/(protected)/lecturer/submissions/page";

const mocks = vi.hoisted(() => ({
  getLecturerSubmissions: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/workflow/lecturer-submission-query", () => ({
  getLecturerSubmissions: mocks.getLecturerSubmissions,
}));

describe("LecturerSubmissionsPage presentation", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLecturerSubmissions.mockResolvedValue({
      page: 1,
      pageSize: 20,
      search: "opaque-record",
      state: "PENDING",
      submissionType: "UPDATE_EXISTING",
      submissions: [
        {
          baseStt: 42,
          baseVersionNo: 2,
          recordUid: "22222222-2222-4222-8222-222222222222",
          rejectionReason: null,
          resultStt: null,
          resultVersionNo: null,
          state: "PENDING",
          submissionId: "11111111-1111-4111-8111-111111111111",
          submissionType: "UPDATE_EXISTING",
          submittedAt: new Date("2026-07-16T04:00:00.000Z"),
          terminalAt: null,
        },
      ],
      totalPages: 2,
      totalSubmissions: 21,
    });
  });

  it("preserves filter names, query values, links and one table tree", async () => {
    const { container } = render(
      await LecturerSubmissionsPage({
        searchParams: Promise.resolve({
          page: "1",
          q: "opaque-record",
          state: "PENDING",
          type: "UPDATE_EXISTING",
        }),
      }),
    );

    expect(
      Array.from(
        container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
          'form[method="get"] [name]',
        ),
      ).map(({ name }) => name),
    ).toEqual(["q", "state", "type"]);
    expect(container.querySelectorAll('form[method="get"]')).toHaveLength(1);
    expect(screen.getByLabelText("Danh sách bản gửi của tôi")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("link", { name: "Xóa lọc" })).toHaveAttribute(
      "href",
      "/lecturer/submissions",
    );
    expect(screen.getByRole("link", { name: "Xem" })).toHaveAttribute(
      "href",
      "/lecturer/submissions/11111111-1111-4111-8111-111111111111",
    );
    expect(screen.getByRole("link", { name: "Trang sau" })).toHaveAttribute(
      "href",
      "/lecturer/submissions?page=2&q=opaque-record&state=PENDING&type=UPDATE_EXISTING",
    );
  });
});
