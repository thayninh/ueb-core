import { expect, test } from "@playwright/test";

test("home page loads and shows the UEB Core heading", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "UEB Core" }),
  ).toBeVisible();
});

test("health endpoint returns HTTP 200", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    status: "ok",
    service: "ueb-core",
  });
});
