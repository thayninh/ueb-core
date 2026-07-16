import "dotenv/config";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { readPhase4LecturerPortalDatabaseUrls } from "../../scripts/phase-4/lib/lecturer-portal-test-database";
import { readPhase4LecturerPortalFixtures } from "../../scripts/phase-4/lib/lecturer-portal-fixtures";

const fixture = readPhase4LecturerPortalFixtures(process.env);
const urls = readPhase4LecturerPortalDatabaseUrls(process.env);

let owner: Client;
let initialCoreCount: number;
let recordA1: string;
let recordA2: string;
let confirmSubmissionId: string;
let updateSubmissionId: string;
let createSubmissionId: string;
let createRecordUid: string;
let originalA1Version: unknown;

test.describe.serial("Phase 4 leader approval UI", () => {
  test.beforeAll(async () => {
    owner = new Client({ connectionString: urls.migrationUrl });
    await owner.connect();
    const core = await owner.query<{
      count: number;
      record_a1: string;
      record_a2: string;
    }>(`
      SELECT
        count(*)::integer AS count,
        max(record_uid::text) FILTER (WHERE ma_hoc_phan = 'P4-A1-v2') AS record_a1,
        max(record_uid::text) FILTER (WHERE ma_hoc_phan = 'P4-A2') AS record_a2
      FROM public.ueb_core_data
    `);
    initialCoreCount = core.rows[0]!.count;
    recordA1 = core.rows[0]!.record_a1;
    recordA2 = core.rows[0]!.record_a2;
    const original = await owner.query<{ row: unknown }>(
      "SELECT to_jsonb(core) AS row FROM public.ueb_core_data AS core WHERE record_uid = $1::uuid AND version_no = 2",
      [recordA1],
    );
    originalA1Version = original.rows[0]!.row;
  });

  test.afterAll(async () => {
    await owner.end();
  });

  test("lecturer submits CONFIRM_UNCHANGED", async ({ page }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto("/lecturer/profile");
    const row = page.locator("tbody tr").filter({ hasText: "P4-A1-v2" });
    await row.getByText("Xác nhận không thay đổi", { exact: true }).click();
    await row.getByRole("button", { name: "Xác nhận và gửi" }).click();
    await expect(row.getByRole("status")).toContainText("đang chờ phê duyệt");
    confirmSubmissionId = await latestSubmittedId(recordA1);
  });

  test("Leader B cannot open or approve Unit A submission", async ({
    page,
  }) => {
    await login(page, fixture.leaderBEmail);
    const response = await page.goto(
      `/leader/submissions/${confirmSubmissionId}`,
    );
    expect(response?.status()).toBe(404);
  });

  test("Leader A reviews, confirms and double-clicks approval safely", async ({
    page,
  }) => {
    await login(page, fixture.leaderAEmail);
    await page.goto("/leader/submissions");
    await expect(page.getByText("1 bản gửi đang chờ")).toBeVisible();
    await page.getByRole("link", { name: "Xem và xử lý" }).click();
    await expect(page.locator("[data-workflow-diff-field]")).toHaveCount(19);
    await expect(
      page.getByText(
        "Phê duyệt sẽ tạo một phiên bản dữ liệu mới và không thay đổi phiên bản cũ.",
      ),
    ).toBeVisible();
    await page.getByLabel(/Tôi đã kiểm tra nội dung/iu).check();
    await page
      .getByRole("button", { name: "Phê duyệt bản gửi" })
      .evaluate((element) => {
        const button = element as HTMLButtonElement;
        button.click();
        button.click();
      });
    await expect(page.getByText("Đã phê duyệt", { exact: true })).toBeVisible();
    await expect(page.getByText("Kết quả phê duyệt")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /phê duyệt|từ chối/iu }),
    ).toHaveCount(0);
    await assertApprovedExactlyOnce(confirmSubmissionId, initialCoreCount + 1);

    await page.goto("/leader/submissions");
    await expect(page.getByText("Không có bản gửi đang chờ")).toBeVisible();
  });

  test("lecturer sees the new latest row, approved result and immutable history", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto("/lecturer/profile");
    const latest = page.locator("tbody tr").filter({ hasText: "P4-A1-v2" });
    await expect(latest).toHaveAttribute("data-version-no", "3");
    await expect(latest).not.toHaveAttribute("data-stt", "41002");

    await page.goto(`/lecturer/submissions/${confirmSubmissionId}`);
    await expect(page.getByText("Đã phê duyệt", { exact: true })).toBeVisible();
    await expect(page.getByText(/STT kết quả:/u)).toBeVisible();
    await expect(page.getByText(/Thời điểm phê duyệt/iu)).toBeVisible();

    await page.goto(`/lecturer/rows/${recordA1}/history`);
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await expect(
      page.locator('tbody tr[data-current-version="true"]'),
    ).toHaveAttribute("data-version-no", "3");
    await expect(page.getByText("Hiện hành", { exact: true })).toBeVisible();

    const old = await owner.query<{ row: unknown }>(
      "SELECT to_jsonb(core) AS row FROM public.ueb_core_data AS core WHERE record_uid = $1::uuid AND version_no = 2",
      [recordA1],
    );
    expect(old.rows[0]!.row).toEqual(originalA1Version);
  });

  test("approves UPDATE_EXISTING as exactly one new core row", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto(`/lecturer/rows/${recordA2}/edit`);
    await page.getByLabel("Tên học phần").fill("Học phần A2 đã phê duyệt");
    await page.getByRole("button", { name: "Gửi bản chờ phê duyệt" }).click();
    await expect(page.getByRole("status")).toContainText("đang chờ phê duyệt");
    updateSubmissionId = await latestSubmittedId(recordA2);

    await approveAsLeader(page, updateSubmissionId);
    await assertApprovedExactlyOnce(updateSubmissionId, initialCoreCount + 2);
    const latest = await owner.query<{ version_no: number; name: string }>(
      "SELECT version_no, ten_hoc_phan AS name FROM public.ueb_core_data WHERE record_uid = $1::uuid ORDER BY version_no DESC, stt DESC LIMIT 1",
      [recordA2],
    );
    expect(latest.rows[0]).toEqual({
      version_no: 2,
      name: "Học phần A2 đã phê duyệt",
    });
  });

  test("approves CREATE_NEW as exactly one version-one core row", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto("/lecturer/rows/new");
    await page.getByLabel("Khối kiến thức").fill("4");
    await page.getByLabel("Mã học phần").fill("P4-APPROVED-NEW");
    await page.getByLabel("Tên học phần").fill("Học phần mới đã phê duyệt");
    await page.getByRole("button", { name: "Gửi bản chờ phê duyệt" }).click();
    await expect(page.getByRole("status")).toContainText("đang chờ phê duyệt");
    const submitted = await owner.query<{
      submission_id: string;
      record_uid: string;
    }>(`
      SELECT submission_id::text, record_uid::text
      FROM public.workflow_event
      WHERE event_type = 'SUBMITTED'
        AND submission_type = 'CREATE_NEW'
        AND payload ->> 'ma_hoc_phan' = 'P4-APPROVED-NEW'
      ORDER BY created_at DESC, event_id DESC
      LIMIT 1
    `);
    createSubmissionId = submitted.rows[0]!.submission_id;
    createRecordUid = submitted.rows[0]!.record_uid;

    await approveAsLeader(page, createSubmissionId);
    await assertApprovedExactlyOnce(createSubmissionId, initialCoreCount + 3);
    const core = await owner.query<{
      version_no: number;
      record_uid: string;
      course_code: string;
    }>(
      "SELECT version_no, record_uid::text, ma_hoc_phan AS course_code FROM public.ueb_core_data WHERE source_submission_id = $1::uuid",
      [createSubmissionId],
    );
    expect(core.rows).toEqual([
      {
        version_no: 1,
        record_uid: createRecordUid,
        course_code: "P4-APPROVED-NEW",
      },
    ]);
  });
});

async function approveAsLeader(
  page: Page,
  submissionId: string,
): Promise<void> {
  await login(page, fixture.leaderAEmail);
  await page.goto(`/leader/submissions/${submissionId}`);
  await page.getByLabel(/Tôi đã kiểm tra nội dung/iu).check();
  await page.getByRole("button", { name: "Phê duyệt bản gửi" }).click();
  await expect(page.getByText("Đã phê duyệt", { exact: true })).toBeVisible();
}

async function assertApprovedExactlyOnce(
  submissionId: string,
  expectedCoreCount: number,
): Promise<void> {
  const rows = await owner.query<{
    core_count: number;
    submitted_count: number;
    approved_count: number;
    rejected_count: number;
    total_core_count: number;
  }>(
    `SELECT
       (SELECT count(*)::integer FROM public.ueb_core_data WHERE source_submission_id = $1::uuid) AS core_count,
       (SELECT count(*)::integer FROM public.workflow_event WHERE submission_id = $1::uuid AND event_type = 'SUBMITTED') AS submitted_count,
       (SELECT count(*)::integer FROM public.workflow_event WHERE submission_id = $1::uuid AND event_type = 'APPROVED') AS approved_count,
       (SELECT count(*)::integer FROM public.workflow_event WHERE submission_id = $1::uuid AND event_type = 'REJECTED') AS rejected_count,
       (SELECT count(*)::integer FROM public.ueb_core_data) AS total_core_count`,
    [submissionId],
  );
  expect(rows.rows[0]).toEqual({
    core_count: 1,
    submitted_count: 1,
    approved_count: 1,
    rejected_count: 0,
    total_core_count: expectedCoreCount,
  });
}

async function latestSubmittedId(recordUid: string): Promise<string> {
  const stored = await owner.query<{ submission_id: string }>(
    "SELECT submission_id::text FROM public.workflow_event WHERE record_uid = $1::uuid AND event_type = 'SUBMITTED' ORDER BY created_at DESC, event_id DESC LIMIT 1",
    [recordUid],
  );
  return stored.rows[0]!.submission_id;
}

async function login(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/sign-in?reauth=1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(fixture.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}
