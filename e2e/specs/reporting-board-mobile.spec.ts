import { expect, test } from "@playwright/test";

test("public mobile reporting board renders a real saved view case", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reporting/worklist/e2e-mobile-reporting-token");
  await expect(page.getByText("E2E Reporting Patient")).toBeVisible();
  await expect(page.getByText("E2E CT")).toBeVisible();
  await expect(page.getByText("Report", { exact: true })).toBeVisible();
});
