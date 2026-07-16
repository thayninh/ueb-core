import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmUnchangedForm } from "@/components/workflow/confirm-unchanged-form";
import { EditableRowForm } from "@/components/workflow/editable-row-form";
import { LecturerRowsTable } from "@/components/workflow/lecturer-rows-table";
import {
  CORE_DISPLAY_FIELD_NAMES,
  EDITABLE_BUSINESS_FIELD_NAMES,
  SUBMISSION_PAYLOAD_FIELD_NAMES,
} from "@/lib/workflow/field-policy";
import { coreRowDtoToBusinessRow } from "@/lib/workflow/field-display";

const mocks = vi.hoisted(() => ({
  submitUnchanged: vi.fn(),
  submitUpdated: vi.fn(),
  submitNew: vi.fn(),
}));

vi.mock("@/app/actions/workflow-submit", () => ({
  submitUnchangedRowAction: mocks.submitUnchanged,
  submitUpdatedRowAction: mocks.submitUpdated,
  submitNewRowAction: mocks.submitNew,
  submitUnchangedRowFormAction: mocks.submitUnchanged,
  submitUpdatedRowFormAction: mocks.submitUpdated,
  submitNewRowFormAction: mocks.submitNew,
}));

const SUBMISSION_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_UID = "22222222-2222-4222-8222-222222222222";
const failedResult = {
  success: false,
  fieldErrors: {},
  formError: null,
  errorCode: null,
  submission: null,
} as const;

const latestRow = {
  stt: 42,
  donViPhuTrachHocPhan: "Đơn vị A",
  boMonPhuTrachHocPhan: "Bộ môn A",
  khoiKienThuc: 1,
  maHocPhan: "P4-101",
  tenHocPhan: "Học phần Phase 4",
  tenGiangVien: "Giảng viên A",
  maSoCanBo: "GV-A",
  emailTaiKhoanVnu: "a@vnu.edu.vn",
  boMon: "Bộ môn A",
  donVi: "Đơn vị A",
  core123: "1",
  tc1TroGiang: "Có",
  tc2ShChuyenMon: "Có",
  tc3TongHop: "Có",
  tc31NganhTotNghiepPhuHop: "Có",
  tc32BienSoanDeCuongGiaoTrinh: "Có",
  tc33ChuNhiemDeTaiNckhLienQuan: "Có",
  tc34BaiBaoLienQuan: "Có",
  tc4GiangThu: "Có",
  recordUid: RECORD_UID,
  snapshotId: "33333333-3333-4333-8333-333333333333",
  versionNo: 2,
  identityStatus: "RESOLVED" as const,
  approvalUnit: "Đơn vị A",
  origin: "LEGACY_IMPORT" as const,
  approvedAt: new Date("2026-07-16T00:00:00.000Z"),
  createdAt: new Date("2026-07-16T00:00:00.000Z"),
};

describe("Phase 4 lecturer submission UI", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitUnchanged.mockResolvedValue(failedResult);
    mocks.submitUpdated.mockResolvedValue(failedResult);
    mocks.submitNew.mockResolvedValue(failedResult);
  });

  it("renders every latest-row display field and workflow metadata", () => {
    render(<LecturerRowsTable pendingSubmissions={[]} rows={[latestRow]} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(
      CORE_DISPLAY_FIELD_NAMES.length + 3,
    );
    expect(screen.getByText(RECORD_UID)).toBeInTheDocument();
    expect(screen.getByText("Xem lịch sử phiên bản")).toBeInTheDocument();
  });

  it("locks new actions when the row already has a pending submission", () => {
    render(
      <LecturerRowsTable
        pendingSubmissions={[
          {
            submissionId: SUBMISSION_ID,
            submissionType: "UPDATE_EXISTING",
            recordUid: RECORD_UID,
            submittedAt: new Date("2026-07-16T04:00:00.000Z"),
          },
        ]}
        rows={[latestRow]}
      />,
    );
    expect(screen.getByText("Đang chờ phê duyệt")).toBeInTheDocument();
    expect(screen.queryByText("Xác nhận và gửi")).not.toBeInTheDocument();
    expect(screen.getByText("Chỉnh sửa và gửi")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("confirm unchanged sends only immutable request metadata", async () => {
    render(
      <ConfirmUnchangedForm
        baseStt={42}
        baseVersionNo={2}
        recordUid={RECORD_UID}
        submissionId={SUBMISSION_ID}
      />,
    );
    fireEvent.submit(
      screen.getByRole("button", { name: "Xác nhận và gửi" }).closest("form")!,
    );
    await waitFor(() => expect(mocks.submitUnchanged).toHaveBeenCalledOnce());
    const sent = mocks.submitUnchanged.mock.calls[0]![1] as FormData;
    expect([...sent.keys()].sort()).toEqual([
      "baseStt",
      "baseVersionNo",
      "recordUid",
      "submissionId",
    ]);
    expect(sent.get("submissionId")).toBe(SUBMISSION_ID);
  });

  it("edit renders 14 editable inputs and does not submit six read-only fields", async () => {
    const { container } = render(
      <EditableRowForm
        baseStt={42}
        baseVersionNo={2}
        currentRow={coreRowDtoToBusinessRow(latestRow)}
        kind="UPDATE_EXISTING"
        recordUid={RECORD_UID}
        submissionId={SUBMISSION_ID}
      />,
    );
    expect(
      container.querySelectorAll("[data-workflow-editable-field]"),
    ).toHaveLength(14);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(mocks.submitUpdated).toHaveBeenCalledOnce());
    const sent = mocks.submitUpdated.mock.calls[0]![1] as FormData;
    expect([...sent.keys()].sort()).toEqual([
      "baseStt",
      "baseVersionNo",
      "editableFields",
      "recordUid",
      "submissionId",
    ]);
    const payload = JSON.parse(String(sent.get("editableFields"))) as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload)).toEqual([...EDITABLE_BUSINESS_FIELD_NAMES]);
    expect(payload).not.toHaveProperty("stt");
    expect(payload).not.toHaveProperty("ten_giang_vien");
  });

  it("create renders no identity, routing, generated, or base inputs", async () => {
    const { container } = render(
      <EditableRowForm kind="CREATE_NEW" submissionId={SUBMISSION_ID} />,
    );
    const forbidden = [
      "recordUid",
      "stt",
      "lecturerUid",
      "approvalUnit",
      "versionNo",
      "baseStt",
      "baseVersionNo",
    ];
    for (const name of forbidden) {
      expect(container.querySelector('[name="' + name + '"]')).toBeNull();
    }
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(mocks.submitNew).toHaveBeenCalledOnce());
    const sent = mocks.submitNew.mock.calls[0]![1] as FormData;
    expect([...sent.keys()].sort()).toEqual(["editableFields", "submissionId"]);
  });

  it("keeps the same submission ID across retries", async () => {
    render(
      <ConfirmUnchangedForm
        baseStt={42}
        baseVersionNo={2}
        recordUid={RECORD_UID}
        submissionId={SUBMISSION_ID}
      />,
    );
    const form = screen
      .getByRole("button", { name: "Xác nhận và gửi" })
      .closest("form")!;
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.submitUnchanged).toHaveBeenCalledTimes(1));
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.submitUnchanged).toHaveBeenCalledTimes(2));
    for (const [, formData] of mocks.submitUnchanged.mock.calls) {
      expect((formData as FormData).get("submissionId")).toBe(SUBMISSION_ID);
    }
  });

  it("keeps STT outside the 19-field payload contract", () => {
    expect(SUBMISSION_PAYLOAD_FIELD_NAMES).toHaveLength(19);
    expect(SUBMISSION_PAYLOAD_FIELD_NAMES).not.toContain("stt");
  });
});
