import "dotenv/config";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { readPhase4LecturerPortalDatabaseUrls } from "../../scripts/phase-4/lib/lecturer-portal-test-database";
import { readPhase4LecturerPortalFixtures } from "../../scripts/phase-4/lib/lecturer-portal-fixtures";

const fixture = readPhase4LecturerPortalFixtures(process.env);
const urls = readPhase4LecturerPortalDatabaseUrls(process.env);
const reason = "Cần bổ sung minh chứng chuyên môn trước khi gửi lại.";

let owner: Client;
let submissionId: string;
let initialCoreCount: number;

test.describe.serial("Phase 4 leader rejection", () => {
  test.beforeAll(async () => {
    owner = new Client({ connectionString: urls.migrationUrl });
    await owner.connect();
    const core = await owner.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.ueb_core_data",
    );
    initialCoreCount = core.rows[0]!.count;
  });

  test.afterAll(async () => {
    await owner.end();
  });

  test("lecturer submits a row for Unit A", async ({ page }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto("/lecturer/profile");
    const row = page.locator("tbody tr").filter({ hasText: "P4-A1-v2" });
    await row.getByText("Xác nhận không thay đổi", { exact: true }).click();
    await row.getByRole("button", { name: "Xác nhận và gửi" }).click();
    await expect(row.getByRole("status")).toContainText("đang chờ phê duyệt");
    const stored = await owner.query<{ submission_id: string }>(
      "SELECT submission_id::text FROM public.workflow_event WHERE record_uid = (SELECT record_uid FROM public.ueb_core_data WHERE ma_hoc_phan = 'P4-A1-v2') AND event_type = 'SUBMITTED' ORDER BY created_at DESC LIMIT 1",
    );
    submissionId = stored.rows[0]!.submission_id;
  });

  test("Leader A sees the scoped queue and nineteen-field diff", async ({
    page,
  }) => {
    await login(page, fixture.leaderAEmail);
    await page.goto("/leader/submissions");
    await expect(
      page.getByRole("heading", { name: "Bản gửi chờ xử lý" }),
    ).toBeVisible();
    await expect(
      page.getByText("Phase 4 Lecturer", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Xem và xử lý" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/leader/submissions/${submissionId}$`, "u"),
    );
    await expect(page.locator("[data-workflow-diff-field]")).toHaveCount(19);
    await expect(page.getByRole("button", { name: /phê duyệt/iu })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Từ chối bản gửi" }),
    ).toBeVisible();
  });

  test("Leader B cannot open the Unit A submission", async ({ page }) => {
    await login(page, fixture.leaderBEmail);
    const response = await page.goto(`/leader/submissions/${submissionId}`);
    expect(response?.status()).toBe(404);
  });

  test("Leader A rejects and the submission leaves the pending queue", async ({
    page,
  }) => {
    await login(page, fixture.leaderAEmail);
    await page.goto(`/leader/submissions/${submissionId}`);
    await page.getByLabel("Lý do từ chối").fill(reason);
    await page.getByLabel(/Tôi xác nhận từ chối/iu).check();
    await page.getByRole("button", { name: "Từ chối bản gửi" }).click();
    await expect(page.getByText(reason)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Từ chối bản gửi" }),
    ).toHaveCount(0);

    await page.goto("/leader/submissions");
    await expect(page.getByText("Không có bản gửi đang chờ")).toBeVisible();
  });

  test("lecturer sees REJECTED state, reason and rejected time", async ({
    page,
  }) => {
    await login(page, fixture.lecturerAEmail);
    await page.goto(`/lecturer/submissions/${submissionId}`);
    await expect(page.getByText("Đã từ chối")).toBeVisible();
    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByText(/Thời điểm từ chối/iu)).toBeVisible();
  });

  test("rejection creates no core or APPROVED event", async () => {
    const core = await owner.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM public.ueb_core_data",
    );
    const events = await owner.query<{ approved: number; rejected: number }>(
      "SELECT count(*) FILTER (WHERE event_type = 'APPROVED')::integer AS approved, count(*) FILTER (WHERE event_type = 'REJECTED')::integer AS rejected FROM public.workflow_event WHERE submission_id = $1::uuid",
      [submissionId],
    );
    expect(core.rows[0]?.count).toBe(initialCoreCount);
    expect(events.rows[0]).toEqual({ approved: 0, rejected: 1 });
  });
});

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in?reauth=1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(fixture.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}
