import "dotenv/config";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { readPhase4LecturerPortalDatabaseUrls } from "../../scripts/phase-4/lib/lecturer-portal-test-database";
import { readPhase4LecturerPortalFixtures } from "../../scripts/phase-4/lib/lecturer-portal-fixtures";

const fixture = readPhase4LecturerPortalFixtures(process.env);
const urls = readPhase4LecturerPortalDatabaseUrls(process.env);
const updateReason = "Cần chỉnh lại tên học phần trước khi gửi lại.";
const createReason = "Cần bổ sung mô tả cho dòng mới trước khi gửi lại.";

let owner: Client;
let recordA2: string;
let recordA3: string;
let coreCountBeforeResubmissions: number;
let approvedSubmissionId: string;
let updateParentId: string;
let updateResubmissionId: string;
let createParentId: string;
let createParentRecordUid: string;
let createResubmissionId: string;

test.describe.serial("Phase 4 lecturer resubmission", () => {
  test.beforeAll(async () => {
    owner = new Client({ connectionString: urls.migrationUrl });
    await owner.connect();
    const records = await owner.query<{ code: string; record_uid: string }>(
      "SELECT ma_hoc_phan AS code, record_uid::text FROM public.ueb_core_data WHERE ma_hoc_phan IN ('P4-A2', 'P4-A3')",
    );
    recordA2 = records.rows.find(({ code }) => code === "P4-A2")!.record_uid;
    recordA3 = records.rows.find(({ code }) => code === "P4-A3")!.record_uid;
  });

  test.afterAll(async () => {
    await owner.end();
  });

  test("PENDING has no resubmit action and APPROVED remains blocked", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto("/lecturer/profile");
    const row = page.locator("tbody tr").filter({ hasText: "P4-A3" });
    await row.getByText("Xác nhận không thay đổi", { exact: true }).click();
    await row.getByRole("button", { name: "Xác nhận và gửi" }).click();
    await expect(row.getByRole("status")).toContainText("đang chờ phê duyệt");
    approvedSubmissionId = await latestSubmittedId(recordA3);

    await page.goto(`/lecturer/submissions/${approvedSubmissionId}`);
    await expect(page.getByText("Đang chờ phê duyệt")).toBeVisible();
    await expect(page.getByRole("link", { name: /gửi lại/iu })).toHaveCount(0);

    await login(page, fixture.leaderAEmail);
    await page.goto(`/leader/submissions/${approvedSubmissionId}`);
    await page.getByLabel(/Tôi đã kiểm tra nội dung/iu).check();
    await page.getByRole("button", { name: "Phê duyệt bản gửi" }).click();
    await expect(page.getByText("Đã phê duyệt", { exact: true })).toBeVisible();

    await login(page, fixture.lecturerAEmail);
    await page.goto(`/lecturer/submissions/${approvedSubmissionId}`);
    await expect(page.getByText("Đã phê duyệt", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /gửi lại/iu })).toHaveCount(0);
    const core = await coreCount();
    coreCountBeforeResubmissions = core;
  });

  test("UPDATE_EXISTING is rejected and exposes the reason and action", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto(`/lecturer/rows/${recordA2}/edit`);
    await page.getByLabel("Tên học phần").fill("Rejected update draft");
    await page.getByRole("button", { name: "Gửi bản chờ phê duyệt" }).click();
    await expect(page.getByRole("status")).toContainText("đang chờ phê duyệt");
    updateParentId = await latestSubmittedId(recordA2);

    await login(page, fixture.leaderAEmail);
    await rejectAsLeader(page, updateParentId, updateReason);

    await login(page, fixture.lecturerAEmail);
    await page.goto(`/lecturer/submissions/${updateParentId}`);
    await expect(page.getByText(updateReason)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Chỉnh sửa và gửi lại" }),
    ).toBeVisible();
  });

  test("Lecturer B cannot open or resubmit Lecturer A parent", async ({
    page,
  }) => {
    await login(page, fixture.lecturerBEmail);
    const detailResponse = await page.goto(
      `/lecturer/submissions/${updateParentId}`,
    );
    expect(detailResponse?.status()).toBe(404);
    const resubmitResponse = await page.goto(
      `/lecturer/submissions/${updateParentId}/resubmit`,
    );
    expect(resubmitResponse?.status()).toBe(404);
  });

  test("UPDATE_EXISTING uses rejected draft, allows edits and creates one linked PENDING submission", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto(`/lecturer/submissions/${updateParentId}`);
    await page.getByRole("link", { name: "Chỉnh sửa và gửi lại" }).click();
    await expect(page.getByText(updateReason)).toBeVisible();
    await expect(page.getByLabel("Tên học phần")).toHaveValue(
      "Rejected update draft",
    );
    await page.getByLabel("Tên học phần").fill("Update draft reviewed again");
    const submissionId = await page
      .locator('input[name="submissionId"]')
      .inputValue();
    expect(submissionId).not.toBe(updateParentId);
    await page
      .getByRole("button", { name: "Gửi bản chờ phê duyệt" })
      .evaluate((element) => {
        const button = element as HTMLButtonElement;
        button.click();
        button.click();
      });
    await expect(page.getByRole("status")).toContainText("đang chờ phê duyệt");
    updateResubmissionId = submissionId;

    const rows = await owner.query<{
      parent_submission_id: string;
      record_uid: string;
      event_type: string;
      course_name: string;
    }>(
      "SELECT parent_submission_id::text, record_uid::text, event_type::text, payload ->> 'ten_hoc_phan' AS course_name FROM public.workflow_event WHERE submission_id = $1::uuid",
      [updateResubmissionId],
    );
    expect(rows.rows).toEqual([
      {
        parent_submission_id: updateParentId,
        record_uid: recordA2,
        event_type: "SUBMITTED",
        course_name: "Update draft reviewed again",
      },
    ]);
    expect(await submissionState(updateParentId)).toBe("REJECTED");
    expect(await submissionState(updateResubmissionId)).toBe("PENDING");
    expect(await coreCount()).toBe(coreCountBeforeResubmissions);
  });

  test("CREATE_NEW is rejected and its draft is shown without record input", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto("/lecturer/rows/new");
    await page.getByLabel("Khối kiến thức").fill("4");
    await page.getByLabel("Mã học phần").fill("P4-RESUBMIT-NEW");
    await page.getByLabel("Tên học phần").fill("Rejected create draft");
    await page.getByRole("button", { name: "Gửi bản chờ phê duyệt" }).click();
    await expect(page.getByRole("status")).toContainText("đang chờ phê duyệt");
    const parent = await owner.query<{
      submission_id: string;
      record_uid: string;
    }>(
      "SELECT submission_id::text, record_uid::text FROM public.workflow_event WHERE event_type = 'SUBMITTED' AND submission_type = 'CREATE_NEW' AND payload ->> 'ma_hoc_phan' = 'P4-RESUBMIT-NEW' ORDER BY created_at DESC, event_id DESC LIMIT 1",
    );
    createParentId = parent.rows[0]!.submission_id;
    createParentRecordUid = parent.rows[0]!.record_uid;

    await login(page, fixture.leaderAEmail);
    await rejectAsLeader(page, createParentId, createReason);

    await login(page, fixture.lecturerAEmail);
    await page.goto(`/lecturer/submissions/${createParentId}/resubmit`);
    await expect(page.getByText(createReason)).toBeVisible();
    await expect(page.getByLabel("Tên học phần")).toHaveValue(
      "Rejected create draft",
    );
    await expect(page.locator('input[name="recordUid"]')).toHaveCount(0);
    await expect(page.locator('input[name="baseStt"]')).toHaveCount(0);
    await expect(page.locator('input[name="baseVersionNo"]')).toHaveCount(0);
  });

  test("CREATE_NEW resubmit reuses the parent record UID and writes no core", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto(`/lecturer/submissions/${createParentId}/resubmit`);
    const submissionIdInput = page.locator('input[name="submissionId"]');
    await expect(submissionIdInput).not.toHaveValue("");
    createResubmissionId = await submissionIdInput.inputValue();
    expect(createResubmissionId).not.toBe(createParentId);
    await page.getByRole("button", { name: "Gửi bản chờ phê duyệt" }).click();
    await expect(page.getByRole("status")).toContainText("đang chờ phê duyệt");

    const rows = await owner.query<{
      parent_submission_id: string;
      record_uid: string;
      base_stt: number | null;
      base_version_no: number | null;
      has_stt: boolean;
    }>(
      "SELECT parent_submission_id::text, record_uid::text, base_stt, base_version_no, payload ? 'stt' AS has_stt FROM public.workflow_event WHERE submission_id = $1::uuid",
      [createResubmissionId],
    );
    expect(rows.rows).toEqual([
      {
        parent_submission_id: createParentId,
        record_uid: createParentRecordUid,
        base_stt: null,
        base_version_no: null,
        has_stt: false,
      },
    ]);
    expect(await submissionState(createParentId)).toBe("REJECTED");
    expect(await submissionState(createResubmissionId)).toBe("PENDING");
    expect(await coreCount()).toBe(coreCountBeforeResubmissions);
  });
});

async function rejectAsLeader(
  page: Page,
  submissionId: string,
  reason: string,
): Promise<void> {
  await page.goto(`/leader/submissions/${submissionId}`);
  await page.getByLabel("Lý do từ chối").fill(reason);
  await page.getByLabel(/Tôi xác nhận từ chối/iu).check();
  await page.getByRole("button", { name: "Từ chối bản gửi" }).click();
  await expect(page.getByText(reason)).toBeVisible();
}

async function latestSubmittedId(recordUid: string): Promise<string> {
  const result = await owner.query<{ submission_id: string }>(
    "SELECT submission_id::text FROM public.workflow_event WHERE record_uid = $1::uuid AND event_type = 'SUBMITTED' ORDER BY created_at DESC, event_id DESC LIMIT 1",
    [recordUid],
  );
  return result.rows[0]!.submission_id;
}

async function submissionState(submissionId: string): Promise<string> {
  const result = await owner.query<{ state: string }>(
    "SELECT coalesce(max(event_type::text) FILTER (WHERE event_type IN ('APPROVED', 'REJECTED')), 'PENDING') AS state FROM public.workflow_event WHERE submission_id = $1::uuid",
    [submissionId],
  );
  return result.rows[0]!.state;
}

async function coreCount(): Promise<number> {
  const result = await owner.query<{ count: number }>(
    "SELECT count(*)::integer AS count FROM public.ueb_core_data",
  );
  return result.rows[0]!.count;
}

async function login(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/sign-in?reauth=1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(fixture.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}
