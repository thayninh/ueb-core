import "dotenv/config";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { readPhase4LecturerPortalDatabaseUrls } from "../../scripts/phase-4/lib/lecturer-portal-test-database";
import { readPhase4LecturerPortalFixtures } from "../../scripts/phase-4/lib/lecturer-portal-fixtures";

const fixture = readPhase4LecturerPortalFixtures(process.env);
const urls = readPhase4LecturerPortalDatabaseUrls(process.env);
const UNIT_A = "Phase 4 E2E Unit A";

let owner: Client;
let lecturerBSubmissionId: string;
let initialCoreCount: number;
let recordA1: string;
let recordA2: string;
let confirmSubmissionId: string;

test.describe.serial("Phase 4 lecturer portal", () => {
  test.beforeAll(async () => {
    owner = new Client({ connectionString: urls.migrationUrl });
    await owner.connect();
    const core = await owner.query<{
      record_uid: string;
      ma_hoc_phan: string;
    }>(
      "SELECT record_uid::text, ma_hoc_phan FROM public.ueb_core_data WHERE ma_hoc_phan IN ('P4-A1-v2', 'P4-A2') ORDER BY ma_hoc_phan",
    );
    const count = await owner.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.ueb_core_data",
    );
    initialCoreCount = count.rows[0]!.count;
    recordA1 = core.rows.find(
      (row) => row.ma_hoc_phan === "P4-A1-v2",
    )!.record_uid;
    recordA2 = core.rows.find((row) => row.ma_hoc_phan === "P4-A2")!.record_uid;
    const foreign = await owner.query<{ submission_id: string }>(
      "SELECT submission_id::text FROM public.workflow_event ORDER BY created_at LIMIT 1",
    );
    lecturerBSubmissionId = foreign.rows[0]!.submission_id;
  });

  test.afterAll(async () => {
    await owner.end();
  });

  test("lecturer logs in and sees only three latest logical rows", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto("/lecturer/profile");
    await expect(
      page.getByRole("heading", { name: "Hồ sơ giảng viên" }),
    ).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await expect(page.getByText("P4-A1-v2", { exact: true })).toBeVisible();
    await expect(page.getByText("P4-A1-v1", { exact: true })).toHaveCount(0);
  });

  test("confirms unchanged and exposes a PENDING detail", async ({ page }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto("/lecturer/profile");
    const row = page.locator("tbody tr").filter({ hasText: "P4-A1-v2" });
    await row.getByText("Xác nhận không thay đổi", { exact: true }).click();
    await row.getByRole("button", { name: "Xác nhận và gửi" }).click();
    await expect(row.getByRole("status")).toContainText("đang chờ phê duyệt");
    const stored = await owner.query<{ submission_id: string }>(
      "SELECT submission_id::text FROM public.workflow_event WHERE record_uid = $1::uuid AND event_type = 'SUBMITTED' ORDER BY created_at DESC LIMIT 1",
      [recordA1],
    );
    confirmSubmissionId = stored.rows[0]!.submission_id;
    await page.goto("/lecturer/submissions/" + confirmSubmissionId);
    await expect(page.getByText("Đang chờ phê duyệt")).toBeVisible();
  });

  test("pending row cannot submit a second time", async ({ page }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto("/lecturer/profile");
    const row = page.locator("tbody tr").filter({ hasText: "P4-A1-v2" });
    await expect(row.getByText("Đang chờ phê duyệt")).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Xác nhận và gửi" }),
    ).toHaveCount(0);
    await expect(row.getByText("Chỉnh sửa và gửi")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("updates a different record and creates a new-row submission", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto("/lecturer/rows/" + recordA2 + "/edit");
    await page.getByLabel("Tên học phần").fill("Học phần A2 đã sửa");
    await page.getByRole("button", { name: "Gửi bản chờ phê duyệt" }).click();
    await expect(page.getByRole("status")).toContainText("đang chờ phê duyệt");

    await page.goto("/lecturer/rows/new");
    await page.getByLabel("Đơn vị phụ trách học phần").fill(UNIT_A);
    await page.getByLabel("Khối kiến thức").fill("2");
    await page.getByLabel("Mã học phần").fill("P4-NEW");
    await page.getByLabel("Tên học phần").fill("Học phần mới");
    await page.getByRole("button", { name: "Gửi bản chờ phê duyệt" }).click();
    await expect(page.getByRole("status")).toContainText("đang chờ phê duyệt");
  });

  test("detail contains 19 payload fields without STT or decision controls", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto("/lecturer/submissions/" + confirmSubmissionId);
    await expect(page.locator("[data-submission-payload-field]")).toHaveCount(
      19,
    );
    await expect(
      page.locator('[data-submission-payload-field="stt"]'),
    ).toHaveCount(0);
    await expect(page.getByText(/checksum/iu)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /phê duyệt|từ chối/iu }),
    ).toHaveCount(0);
  });

  test("lecturer A cannot open lecturer B submission detail", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    const response = await page.goto(
      "/lecturer/submissions/" + lecturerBSubmissionId,
    );
    expect(response?.status()).toBe(404);
  });

  test("lecturer workflow writes no core rows", async () => {
    const core = await owner.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.ueb_core_data",
    );
    const submitted = await owner.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.workflow_event WHERE event_type = 'SUBMITTED'",
    );
    expect(core.rows[0]?.count).toBe(initialCoreCount);
    expect(submitted.rows[0]?.count).toBe(4);
  });
});

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in?reauth=1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(fixture.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}
