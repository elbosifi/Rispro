import { expect, test } from "@playwright/test";

test("public personal reporting desk renders the responsive personal workflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reporting/worklist/e2e-mobile-reporting-token");
  await expect(page.getByText("Personal Reporting Desk")).toBeVisible();
  await expect(page.getByRole("button", { name: /My Cases/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Available/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Urgent/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Overdue/ })).toBeVisible();
  await page.getByRole("button", { name: /Available/ }).click();
  await expect(page.getByText("E2E Reporting Patient")).toBeVisible();
  await expect(page.getByText("E2E CT")).toBeVisible();
  await expect(page.getByText("Sign in to enable notifications")).toBeVisible();
  await expect(page.getByText("Reassign case", { exact: true })).not.toBeVisible();
});

test("public personal reporting desk keeps the same workflow on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reporting/worklist/e2e-mobile-reporting-token");
  await page.getByRole("button", { name: /Available/ }).click();
  await expect(page.getByText("Personal Reporting Desk")).toBeVisible();
  await expect(page.getByText("E2E Reporting Patient")).toBeVisible();
});
