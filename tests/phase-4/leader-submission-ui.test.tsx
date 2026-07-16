import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUBMISSION_PAYLOAD_FIELD_NAMES } from "@/lib/workflow/field-policy";

const mocks = vi.hoisted(() => ({
  queue: vi.fn(),
  leaderDetail: vi.fn(),
  lecturerDetail: vi.fn(),
  rejectAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/workflow/leader-submission-query", () => ({
  getLeaderSubmissionQueue: mocks.queue,
  getLeaderSubmissionDetail: mocks.leaderDetail,
}));
vi.mock("@/lib/workflow/lecturer-submission-query", () => ({
  getLecturerSubmissionDetail: mocks.lecturerDetail,
}));
vi.mock("@/app/actions/workflow-reject", () => ({
  rejectSubmissionAction: mocks.rejectAction,
  rejectSubmissionFormAction: mocks.rejectAction,
}));

import LeaderSubmissionDetailPage from "@/app/(protected)/leader/submissions/[submissionId]/page";
import LeaderSubmissionsPage from "@/app/(protected)/leader/submissions/page";
import LecturerSubmissionDetailPage from "@/app/(protected)/lecturer/submissions/[submissionId]/page";

const SUBMISSION_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_UID = "22222222-2222-4222-8222-222222222222";

describe("Phase 4 leader reject UI", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rejectAction.mockResolvedValue({
      success: false,
      fieldErrors: {},
      formError: null,
      errorCode: null,
      rejection: null,
    });
    mocks.queue.mockResolvedValue(queueFixture());
    mocks.leaderDetail.mockResolvedValue(detailFixture("PENDING"));
    mocks.lecturerDetail.mockResolvedValue(lecturerDetailFixture());
  });

  it("renders only PENDING queue entries and no approve button", async () => {
    render(
      await LeaderSubmissionsPage({
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByText("Giảng viên A")).toBeInTheDocument();
    expect(screen.getByText("Xem và xử lý")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /phê duyệt/iu }),
    ).not.toBeInTheDocument();
  });

  it("renders a required reject form and nineteen diff rows for PENDING", async () => {
    const { container } = render(
      await LeaderSubmissionDetailPage({
        params: Promise.resolve({ submissionId: SUBMISSION_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      container.querySelectorAll("[data-workflow-diff-field]"),
    ).toHaveLength(19);
    expect(screen.getByLabelText("Lý do từ chối")).toBeRequired();
    expect(
      screen.getByRole("button", { name: "Từ chối bản gửi" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /phê duyệt/iu }),
    ).not.toBeInTheDocument();
  });

  it("shows stale warning while still allowing rejection", async () => {
    mocks.leaderDetail.mockResolvedValue({
      ...detailFixture("PENDING"),
      stale: true,
    });
    render(
      await LeaderSubmissionDetailPage({
        params: Promise.resolve({ submissionId: SUBMISSION_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      screen.getByText(/Dữ liệu lõi hiện tại đã thay đổi/iu),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Từ chối bản gửi" }),
    ).toBeInTheDocument();
  });

  it("does not render a reject action for terminal detail", async () => {
    mocks.leaderDetail.mockResolvedValue(detailFixture("REJECTED"));
    render(
      await LeaderSubmissionDetailPage({
        params: Promise.resolve({ submissionId: SUBMISSION_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByText("Lý do từ chối")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Từ chối bản gửi" }),
    ).not.toBeInTheDocument();
  });

  it("shows rejection reason and timestamp to the lecturer", async () => {
    render(
      await LecturerSubmissionDetailPage({
        params: Promise.resolve({ submissionId: SUBMISSION_ID }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByText("Cần bổ sung minh chứng.")).toBeInTheDocument();
    expect(screen.getByText(/Thời điểm từ chối/iu)).toBeInTheDocument();
  });
});

function queueFixture() {
  return {
    submissions: [summaryFixture("PENDING")],
    units: [
      { id: "33333333-3333-4333-8333-333333333333", displayName: "Unit A" },
    ],
    page: 1,
    pageSize: 20,
    totalSubmissions: 1,
    totalPages: 1,
    search: "",
    unitId: null,
    submissionType: null,
  };
}

function summaryFixture(state: "PENDING" | "REJECTED") {
  return {
    submissionId: SUBMISSION_ID,
    submissionType: "UPDATE_EXISTING" as const,
    recordUid: RECORD_UID,
    state,
    approvalUnit: "Unit A",
    lecturerName: "Giảng viên A",
    lecturerCode: "CB-A",
    lecturerEmail: "a@example.invalid",
    courseCode: "P4-UI",
    courseName: "Học phần UI",
    submittedAt: new Date("2026-07-16T01:00:00Z"),
    terminalAt: state === "REJECTED" ? new Date("2026-07-16T02:00:00Z") : null,
    baseStt: 42,
    baseVersionNo: 1,
    currentStt: 42,
    currentVersionNo: 1,
    stale: false,
  };
}

function detailFixture(state: "PENDING" | "REJECTED") {
  const submittedPayload = payload();
  return {
    ...summaryFixture(state),
    parentSubmissionId: null,
    payload: submittedPayload,
    rejectionReason: state === "REJECTED" ? "Cần bổ sung minh chứng." : null,
    diff: SUBMISSION_PAYLOAD_FIELD_NAMES.map((field) => ({
      field,
      label: field,
      before: submittedPayload[field],
      after: submittedPayload[field],
      changeType: "UNCHANGED" as const,
    })),
  };
}

function lecturerDetailFixture() {
  return {
    submissionId: SUBMISSION_ID,
    submissionType: "UPDATE_EXISTING" as const,
    recordUid: RECORD_UID,
    state: "REJECTED" as const,
    submittedAt: new Date("2026-07-16T01:00:00Z"),
    terminalAt: new Date("2026-07-16T02:00:00Z"),
    rejectionReason: "Cần bổ sung minh chứng.",
    baseStt: 42,
    baseVersionNo: 1,
    parentSubmissionId: null,
    payload: payload(),
    resultStt: null,
    resultVersionNo: null,
  };
}

function payload() {
  return {
    don_vi_phu_trach_hoc_phan: "Unit A",
    bo_mon_phu_trach_hoc_phan: "Bộ môn A",
    khoi_kien_thuc: 1,
    ma_hoc_phan: "P4-UI",
    ten_hoc_phan: "Học phần UI",
    ten_giang_vien: "Giảng viên A",
    ma_so_can_bo: "CB-A",
    email_tai_khoan_vnu: "a@example.invalid",
    bo_mon: "Bộ môn A",
    don_vi: "Unit A",
    core_1_2_3: "1",
    tc1_tro_giang: null,
    tc2_sh_chuyen_mon: null,
    tc3_tong_hop: null,
    tc3_1_nganh_tot_nghiep_phu_hop: null,
    tc3_2_bien_soan_de_cuong_giao_trinh: null,
    tc3_3_chu_nhiem_de_tai_nckh_lien_quan: null,
    tc3_4_bai_bao_lien_quan: null,
    tc4_giang_thu: null,
  };
}
