import "dotenv/config";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

import { readPhase3TestDatabaseUrls } from "../../scripts/phase-3/lib/test-database";
import { parsePhase3FixtureEnvironment } from "../../scripts/phase-3/lib/test-fixtures";

const fixture = parsePhase3FixtureEnvironment(process.env);
const urls = readPhase3TestDatabaseUrls(process.env);
const ADMIN_RESPONSIVE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

type LecturerReference = { lecturer_uid: string; row_count: number };
type UnitReference = { id: string; source_value: string; row_count: number };

let lecturerA: LecturerReference;
let lecturerB: LecturerReference;
let unitA: UnitReference;
let unitB: UnitReference;

test.describe.serial("Phase 3 authentication, RBAC, and IDOR", () => {
  test.beforeAll(async () => {
    const owner = new Client({ connectionString: urls.e2eMigrationUrl });
    await owner.connect();
    try {
      const lecturers = await owner.query<LecturerReference>(`
        SELECT lecturer_uid::text, count(*)::int AS row_count
        FROM public.ueb_core_data
        GROUP BY lecturer_uid
        ORDER BY lecturer_uid
        LIMIT 2
      `);
      const units = await owner.query<UnitReference>(`
        SELECT
          organization_unit.id::text,
          organization_unit.source_value,
          count(core.stt)::int AS row_count
        FROM public.organization_unit
        JOIN public.ueb_core_data AS core
          ON core.approval_unit = organization_unit.source_value
        GROUP BY organization_unit.id, organization_unit.source_value
        ORDER BY organization_unit.source_value
        LIMIT 2
      `);
      [lecturerA, lecturerB] = lecturers.rows as [
        LecturerReference,
        LecturerReference,
      ];
      [unitA, unitB] = units.rows as [UnitReference, UnitReference];
    } finally {
      await owner.end();
    }
  });

  test("unauthenticated requests redirect and public sign-up does not exist", async ({
    page,
    request,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in$/u);
    const signup = await request.get("/sign-up", { maxRedirects: 0 });
    expect(signup.status()).toBe(404);
    await expect(page.getByText(/đăng ký|sign up/iu)).toHaveCount(0);
  });

  test("lecturer sees its dashboard and all 20 columns without cross-identity access", async ({
    page,
  }) => {
    await login(page, fixture.PHASE3_FIXTURE_LECTURER_A_EMAIL);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Phase 3 Lecturer A",
    );
    await expect(page.getByText("Giảng viên", { exact: true })).toBeVisible();

    await page.goto("/lecturer/profile");
    await expect(page.getByRole("columnheader")).toHaveCount(20);
    await expect(page.locator("tbody tr")).toHaveCount(lecturerA.row_count);

    const identityTamper = await page.goto(
      `/lecturer/profile?lecturer_uid=${lecturerB.lecturer_uid}`,
    );
    expect(identityTamper?.status()).toBe(404);

    const leaderRoute = await page.goto("/leader/data");
    expect(leaderRoute?.status()).toBe(403);
    const adminRoute = await page.goto("/admin/users");
    expect(adminRoute?.status()).toBe(403);
  });

  test("single-unit leader sees only the assigned unit and cannot tamper scope", async ({
    page,
  }) => {
    await login(page, fixture.PHASE3_FIXTURE_LEADER_A_EMAIL);
    await page.goto("/leader/data");
    await expect(page.getByLabel("Đơn vị")).toHaveValue(unitA.id);
    await expect(page.getByLabel("Đơn vị").locator("option")).toHaveCount(1);
    await expect(
      page.getByText(`${unitA.row_count} dòng`, { exact: false }),
    ).toBeVisible();

    const unitTamper = await page.goto(`/leader/data?unitId=${unitB.id}`);
    expect(unitTamper?.status()).toBe(404);
    const pageTamper = await page.goto(
      `/leader/data?unitId=${unitA.id}&page=1%20OR%201%3D1`,
    );
    expect(pageTamper?.status()).toBe(404);
    const filterTamper = await page.goto(
      `/leader/data?unitId=${unitA.id}&filter%5Bunit_id%5D=${unitB.id}`,
    );
    expect(filterTamper?.status()).toBe(404);
    const adminRoute = await page.goto("/admin/audit");
    expect(adminRoute?.status()).toBe(403);
  });

  test("multi-unit leader receives the union of assigned units", async ({
    page,
  }) => {
    await login(page, fixture.PHASE3_FIXTURE_LEADER_MULTI_UNIT_EMAIL);
    await page.goto("/leader/data");
    const unitOptions = page.getByLabel("Đơn vị").locator("option");
    await expect(unitOptions).toHaveCount(2);
    await expect(unitOptions).toContainText([
      unitA.source_value,
      unitB.source_value,
    ]);
  });

  test("admin presentation surfaces reflow without changing actions", async ({
    page,
  }) => {
    await login(page, fixture.PHASE3_FIXTURE_ADMIN_EMAIL);
    const routes = ["/admin/data", "/admin/users", "/admin/audit"] as const;
    const formCounts = new Map<string, number>();
    const buttonCounts = new Map<string, number>();

    for (const viewport of ADMIN_RESPONSIVE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(route);
        await assertAdminPresentationReflow(page, viewport.width);
        await assertStableCount(page.locator("main form"), formCounts, route);
        await assertStableCount(
          page.locator("main button"),
          buttonCounts,
          route,
        );
      }
    }

    // A 720 CSS-pixel viewport represents a 1440-pixel desktop at 200% zoom.
    await page.setViewportSize({ width: 720, height: 450 });
    for (const route of routes) {
      await page.goto(route);
      await assertAdminPresentationReflow(page, 720);
      await assertStableCount(page.locator("main form"), formCounts, route);
      await assertStableCount(page.locator("main button"), buttonCounts, route);
    }
  });

  test("admin creates a user, changes rights, revokes sessions, and disables login", async ({
    browser,
    page,
  }) => {
    await login(page, fixture.PHASE3_FIXTURE_ADMIN_EMAIL);
    await page.goto("/admin/users");
    await page.getByLabel("Tên hiển thị").fill("Phase 3 Newly Managed User");
    await page
      .getByLabel("Email đăng nhập")
      .fill(fixture.PHASE3_FIXTURE_NEW_USER_EMAIL);
    await page.getByLabel("Mật khẩu tạm").fill(fixture.PHASE3_FIXTURE_PASSWORD);
    await page.getByLabel("Quản trị viên").check();
    await page.getByRole("button", { name: "Tạo tài khoản" }).click();
    await expect(
      page.getByText("Đã tạo tài khoản có kiểm soát."),
    ).toBeVisible();

    let card = managedUserCard(page);
    const unitForm = card
      .locator("form")
      .filter({ hasText: unitA.source_value });
    await unitForm.getByRole("button", { name: "Gán" }).click();
    await expect(
      unitForm.getByRole("button", { name: "Thu hồi" }),
    ).toBeVisible();

    card = managedUserCard(page);
    const leaderRoleForm = card
      .locator("form")
      .filter({ hasText: "Lãnh đạo khoa/đơn vị" });
    await leaderRoleForm.getByRole("button", { name: "Gán" }).click();
    await expect(
      leaderRoleForm.getByRole("button", { name: "Thu hồi" }),
    ).toBeVisible();

    card = managedUserCard(page);
    const adminRoleForm = card
      .locator("form")
      .filter({ hasText: "Quản trị viên" });
    await adminRoleForm.getByRole("button", { name: "Thu hồi" }).click();

    const managedContext = await browser.newContext();
    const managedPage = await managedContext.newPage();
    try {
      await login(managedPage, fixture.PHASE3_FIXTURE_NEW_USER_EMAIL);
      const leaderResponse = await managedPage.goto("/leader/data");
      expect(leaderResponse?.status()).toBe(200);
      await expect(managedPage.getByLabel("Đơn vị")).toHaveValue(unitA.id);
      const adminResponse = await managedPage.goto("/admin/users");
      expect(adminResponse?.status()).toBe(403);

      card = managedUserCard(page);
      await card.getByRole("button", { name: "Thu hồi session" }).click();
      await managedPage.goto("/dashboard");
      await expect(managedPage).toHaveURL(/\/sign-in\?reauth=1$/u);

      card = managedUserCard(page);
      await card.getByRole("button", { name: "Vô hiệu hóa" }).click();
      await loginExpectFailure(
        managedPage,
        fixture.PHASE3_FIXTURE_NEW_USER_EMAIL,
      );
    } finally {
      await managedContext.close();
    }
  });

  test("disabled fixture cannot create a session and IDOR API/form probes disclose nothing", async ({
    page,
  }) => {
    await loginExpectFailure(page, fixture.PHASE3_FIXTURE_DISABLED_USER_EMAIL);

    await login(page, fixture.PHASE3_FIXTURE_LECTURER_B_EMAIL);
    const userIdProbe = await page.request.get(
      `/api/admin/users?user_id=${encodeURIComponent(lecturerA.lecturer_uid)}`,
    );
    expect(userIdProbe.status()).toBe(404);
    const formProbe = await page.request.post("/admin/users", {
      form: { targetUserId: lecturerA.lecturer_uid, role: "ADMIN" },
      maxRedirects: 0,
    });
    expect([403, 404]).toContain(formProbe.status());
  });
});

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in?reauth=1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(fixture.PHASE3_FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

async function loginExpectFailure(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in?reauth=1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(fixture.PHASE3_FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Email hoặc mật khẩu không chính xác.",
  );
  await expect(page).toHaveURL(/\/sign-in\?reauth=1$/u);
}

function managedUserCard(page: Page) {
  return page
    .locator("article")
    .filter({ hasText: fixture.PHASE3_FIXTURE_NEW_USER_EMAIL });
}

async function assertAdminPresentationReflow(
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
      'input:visible:not([type="hidden"]):not([type="checkbox"]), select:visible, button:visible:not([data-next-mark])',
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

  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () =>
        document.activeElement instanceof HTMLElement &&
        document.activeElement.matches(":focus-visible"),
    ),
  ).toBe(true);
}

async function assertStableCount(
  locator: ReturnType<Page["locator"]>,
  counts: Map<string, number>,
  route: string,
): Promise<void> {
  const current = await locator.count();
  const expected = counts.get(route);
  if (expected === undefined) {
    counts.set(route, current);
  } else {
    expect(current).toBe(expected);
  }
}
