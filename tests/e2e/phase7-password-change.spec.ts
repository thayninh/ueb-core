import { expect, test } from "@playwright/test";

const lecturerEmail = process.env.PHASE7_E2E_LECTURER_EMAIL!;
const leaderEmail = process.env.PHASE7_E2E_LEADER_EMAIL!;
const initialPassword = process.env.PHASE7_E2E_INITIAL_PASSWORD!;
const newPassword = process.env.PHASE7_E2E_NEW_PASSWORD!;

test("first login is forced through password change and every old session is revoked", async ({
  browser,
  page,
}) => {
  await signIn(page, lecturerEmail, initialPassword);
  await expect(page).toHaveURL(/\/change-password$/u);
  await expect(
    page.getByRole("heading", { name: "Đổi mật khẩu lần đầu" }),
  ).toBeVisible();

  for (const path of [
    "/lecturer/profile",
    "/leader/data",
    "/admin/users",
    "/dashboard",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/change-password$/u);
  }

  const blockedApi = await page.request.get("/api/auth/list-sessions");
  expect(blockedApi.status()).toBe(403);
  await expect(blockedApi.json()).resolves.toMatchObject({
    code: "PASSWORD_CHANGE_REQUIRED",
  });

  await page.getByLabel("Mật khẩu hiện tại").fill("incorrect-current-value");
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(newPassword);
  await page.getByLabel("Xác nhận mật khẩu mới").fill(newPassword);
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/change-password$/u);

  await page.getByLabel("Mật khẩu hiện tại").fill(initialPassword);
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(initialPassword);
  await page.getByLabel("Xác nhận mật khẩu mới").fill(initialPassword);
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await signIn(secondPage, lecturerEmail, initialPassword);
  await expect(secondPage).toHaveURL(/\/change-password$/u);

  await page.getByLabel("Mật khẩu hiện tại").fill(initialPassword);
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(newPassword);
  await page.getByLabel("Xác nhận mật khẩu mới").fill(newPassword);
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
  await expect(page).toHaveURL(/\/sign-in\?passwordChanged=1&reauth=1$/u);

  await secondPage.goto("/lecturer/profile");
  await expect(secondPage).toHaveURL(/\/sign-in\?reauth=1$/u);
  await secondContext.close();

  await signIn(page, lecturerEmail, initialPassword);
  await expect(page.getByRole("alert")).toHaveText(
    "Email hoặc mật khẩu không chính xác.",
  );
  await signIn(page, lecturerEmail, newPassword);
  await expect(page).toHaveURL(/\/dashboard$/u);
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);
});

test("the shared-password test leader is also forced before leader routes", async ({
  page,
}) => {
  await signIn(page, leaderEmail, initialPassword);
  await expect(page).toHaveURL(/\/change-password$/u);
  await page.goto("/leader/data");
  await expect(page).toHaveURL(/\/change-password$/u);
});

async function signIn(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/sign-in?reauth=1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}
