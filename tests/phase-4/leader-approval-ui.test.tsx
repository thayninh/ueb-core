import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUBMISSION_PAYLOAD_FIELD_NAMES } from "@/lib/workflow/field-policy";

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/workflow/leader-submission-query", () => ({
  getLeaderSubmissionDetail: mocks.detail,
}));
vi.mock("@/app/actions/workflow-approve", () => ({
  approveSubmissionAction: mocks.approve,
  approveSubmissionFormAction: mocks.approve,
}));
vi.mock("@/app/actions/workflow-reject", () => ({
  rejectSubmissionAction: mocks.reject,
  rejectSubmissionFormAction: mocks.reject,
}));

import LeaderSubmissionDetailPage from "@/app/(protected)/leader/submissions/[submissionId]/page";

const SUBMISSION_ID = "11111111-1111-4111-8111-111111111111";

describe("Phase 4 leader approval UI", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detail.mockResolvedValue(detailFixture("PENDING"));
    mocks.approve.mockResolvedValue(emptyApprovalResult());
    mocks.reject.mockResolvedValue(emptyRejectionResult());
  });

  it("renders Approve and Reject for a PENDING detail", async () => {
    render(await renderDetail());
    expect(
      screen.getByRole("button", { name: "Phê duyệt bản gửi" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Từ chối bản gửi" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Phê duyệt sẽ tạo một phiên bản dữ liệu mới và không thay đổi phiên bản cũ.",
      ),
    ).toBeInTheDocument();
  });

  it("submits only submissionId and no identity or routing fields", async () => {
    render(await renderDetail());
    const form = screen
      .getByRole("button", { name: "Phê duyệt bản gửi" })
      .closest("form")!;
    expect([...new FormData(form).keys()]).toEqual(["submissionId"]);
    expect(
      screen.getByLabelText(/Tôi đã kiểm tra nội dung/iu),
    ).not.toHaveAttribute("name");
    for (const field of [
      "recordUid",
      "lecturerUid",
      "approvalUnit",
      "payload",
      "versionNo",
      "stt",
      "approvedBy",
      "approvedAt",
    ]) {
      expect(form.querySelector(`[name="${field}"]`)).toBeNull();
    }

    fireEvent.submit(form);
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledOnce());
    const sent = mocks.approve.mock.calls[0]![1] as FormData;
    expect([...sent.keys()]).toEqual(["submissionId"]);
    expect(sent.get("submissionId")).toBe(SUBMISSION_ID);
  });

  it("disables the button and exposes a pending state while approving", async () => {
    let finish!: (value: ReturnType<typeof emptyApprovalResult>) => void;
    mocks.approve.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(await renderDetail());
    const confirmation = screen.getByLabelText(/Tôi đã kiểm tra nội dung/iu);
    fireEvent.click(confirmation);
    fireEvent.submit(confirmation.closest("form")!);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Đang phê duyệt…" }),
      ).toBeDisabled(),
    );
    finish(emptyApprovalResult());
  });

  it("warns and disables approval when the submitted base is stale", async () => {
    mocks.detail.mockResolvedValue({
      ...detailFixture("PENDING"),
      stale: true,
    });
    render(await renderDetail());
    expect(
      screen.getByText(/Dữ liệu lõi đã thay đổi kể từ khi bản gửi được tạo/iu),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Không thể phê duyệt dữ liệu đã thay đổi",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Từ chối bản gửi" }),
    ).toBeEnabled();
  });

  it("shows APPROVED result and removes both terminal actions", async () => {
    mocks.detail.mockResolvedValue(detailFixture("APPROVED"));
    render(await renderDetail());
    const result = screen.getByText("Kết quả phê duyệt").closest("section")!;
    expect(within(result).getByText("50001")).toBeInTheDocument();
    expect(within(result).getByText("3")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /phê duyệt|từ chối/iu }),
    ).not.toBeInTheDocument();
  });
});

function renderDetail() {
  return LeaderSubmissionDetailPage({
    params: Promise.resolve({ submissionId: SUBMISSION_ID }),
    searchParams: Promise.resolve({}),
  });
}

function detailFixture(state: "PENDING" | "APPROVED") {
  const submittedPayload = payload();
  return {
    submissionId: SUBMISSION_ID,
    submissionType: "UPDATE_EXISTING" as const,
    recordUid: "22222222-2222-4222-8222-222222222222",
    state,
    approvalUnit: "Unit A",
    lecturerName: "Giảng viên A",
    lecturerCode: "CB-A",
    lecturerEmail: "a@example.invalid",
    courseCode: "P4-UI",
    courseName: "Học phần UI",
    submittedAt: new Date("2026-07-16T01:00:00Z"),
    terminalAt: state === "APPROVED" ? new Date("2026-07-16T02:00:00Z") : null,
    resultStt: state === "APPROVED" ? 50001 : null,
    resultVersionNo: state === "APPROVED" ? 3 : null,
    baseStt: 42,
    baseVersionNo: 2,
    currentStt: state === "APPROVED" ? 50001 : 42,
    currentVersionNo: state === "APPROVED" ? 3 : 2,
    stale: state === "APPROVED",
    parentSubmissionId: null,
    payload: submittedPayload,
    rejectionReason: null,
    diff: SUBMISSION_PAYLOAD_FIELD_NAMES.map((field) => ({
      field,
      label: field,
      before: submittedPayload[field],
      after: submittedPayload[field],
      changeType: "UNCHANGED" as const,
    })),
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

function emptyApprovalResult() {
  return {
    success: false,
    fieldErrors: {},
    formError: null,
    errorCode: null,
    approval: null,
  } as const;
}

function emptyRejectionResult() {
  return {
    success: false,
    fieldErrors: {},
    formError: null,
    errorCode: null,
    rejection: null,
  } as const;
}
