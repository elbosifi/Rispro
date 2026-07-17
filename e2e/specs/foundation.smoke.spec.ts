import { expect, test } from "@playwright/test";

test("real frontend, backend readiness, and seeded login are available", async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));

  const ready = await request.get("http://127.0.0.1:3100/api/ready");
  expect(ready.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByRole("heading")).toBeVisible();
  await page.locator('input[autocomplete="username"]').fill("e2e_reception");
  await page.locator('input[autocomplete="current-password"]').fill("E2ePassword!2026");
  await page.getByRole("button", { name: /sign in|login/i }).click();
  await expect(page).not.toHaveURL(/login/);
  await page.reload();
  await expect(page).not.toHaveURL(/login/);
});
