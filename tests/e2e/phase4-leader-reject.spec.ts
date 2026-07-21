import "dotenv/config";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { readPhase4LecturerPortalDatabaseUrls } from "../../scripts/phase-4/lib/lecturer-portal-test-database";
import { readPhase4LecturerPortalFixtures } from "../../scripts/phase-4/lib/lecturer-portal-fixtures";

const fixture = readPhase4LecturerPortalFixtures(process.env);
const urls = readPhase4LecturerPortalDatabaseUrls(process.env);
const reason = "Cần bổ sung minh chứng chuyên môn trước khi gửi lại.";
const RESPONSIVE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

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
    await expect(
      page.getByRole("button", { name: "Phê duyệt bản gửi" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Từ chối bản gửi" }),
    ).toBeVisible();
  });

  test("Leader B cannot open the Unit A submission", async ({ page }) => {
    await login(page, fixture.leaderBEmail);
    const response = await page.goto(`/leader/submissions/${submissionId}`);
    expect(response?.status()).toBe(404);
  });

  test("leader presentation surfaces reflow without document overflow", async ({
    page,
  }) => {
    await login(page, fixture.leaderAEmail);
    const routes = [
      "/leader/data",
      "/leader/submissions",
      `/leader/submissions/${submissionId}`,
    ];

    for (const viewport of RESPONSIVE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(route);
        await assertPresentationReflow(page, viewport.width);
      }
    }

    // A 720 CSS-pixel viewport represents a 1440-pixel desktop at 200% zoom.
    await page.setViewportSize({ width: 720, height: 450 });
    for (const route of routes) {
      await page.goto(route);
      await assertPresentationReflow(page, 720);
    }
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

async function assertPresentationReflow(
  page: Page,
  viewportWidth: number,
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);

  const clippedControls = await page
    .locator(
      'input:visible:not([type="hidden"]):not([type="checkbox"]), select:visible, textarea:visible, button:visible:not([data-next-mark])',
    )
    .evaluateAll(
      (controls, width) =>
        controls
          .filter((control) => {
            const box = control.getBoundingClientRect();
            return box.left < -1 || box.right > width + 1 || box.height < 44;
          })
          .map((control) => {
            const box = control.getBoundingClientRect();
            return {
              element: control.outerHTML.slice(0, 180),
              height: box.height,
              left: box.left,
              right: box.right,
            };
          }),
      viewportWidth,
    );
  expect(clippedControls).toEqual([]);

  const checkboxLabels = page.locator(
    'label:has(input[type="checkbox"]):visible',
  );
  for (let index = 0; index < (await checkboxLabels.count()); index += 1) {
    const box = await checkboxLabels.nth(index).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const tableRegions = page.getByRole("region");
  for (let index = 0; index < (await tableRegions.count()); index += 1) {
    await expect(tableRegions.nth(index)).toHaveAttribute("tabindex", "0");
  }

  const firstInteractive = page
    .locator(
      'main a:visible, main button:visible, main input:visible:not([type="hidden"]), main select:visible, main textarea:visible',
    )
    .first();
  await firstInteractive.focus();
  expect(
    await firstInteractive.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return (
        style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2
      );
    }),
  ).toBe(true);
}
