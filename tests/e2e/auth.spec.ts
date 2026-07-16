import { expect, test } from "@playwright/test";

test("protected dashboard redirects to the controlled sign-in page", async ({
  page,
}) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/sign-in$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Đăng nhập" }),
  ).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.getByText(/đăng ký|sign up/iu)).toHaveCount(0);
});

for (const protectedPath of [
  "/lecturer/profile",
  "/leader/data",
  "/admin/users",
  "/admin/audit",
]) {
  test(`${protectedPath} redirects unauthenticated users`, async ({ page }) => {
    await page.goto(protectedPath);

    await expect(page).toHaveURL(/\/sign-in$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "Đăng nhập" }),
    ).toBeVisible();
  });
}

test("unknown credentials return only the generic sign-in error", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("unknown@example.edu");
  await page.getByLabel("Mật khẩu").fill("incorrect-password");
  await page.getByRole("button", { name: "Đăng nhập" }).click();

  await expect(
    page.getByRole("alert").filter({
      hasText: "Email hoặc mật khẩu không chính xác.",
    }),
  ).toHaveText("Email hoặc mật khẩu không chính xác.");
  await expect(page.getByText(/không tồn tại|disabled|vô hiệu/iu)).toHaveCount(
    0,
  );
  await expect(page).toHaveURL(/\/sign-in$/u);
});
