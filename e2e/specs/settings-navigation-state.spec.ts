import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

async function reauthenticate(page: import("@playwright/test").Page) {
  const response = await page.request.post("http://127.0.0.1:3100/api/auth/re-auth", { data: { password: E2E_PASSWORD } });
  expect(response.ok()).toBeTruthy();
}

test("Settings section navigation is URL-backed across reload and browser history", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_super_admin");
  await reauthenticate(page);
  await page.goto("/settings?source=e2e-navigation");
  await expect(page.getByRole("heading", { name: "Options", exact: true })).toBeVisible();

  await page.getByRole("button", { name: /SonicDICOM Reports/ }).click();
  await expect(page).toHaveURL(/section=sonicdicom_reports/);
  await expect(page.getByRole("heading", { name: "SonicDICOM Reports", exact: true })).toBeVisible();
  const sonicUrl = page.url();

  await page.reload();
  await expect(page).toHaveURL(sonicUrl);
  await expect(page.getByRole("heading", { name: "SonicDICOM Reports", exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/settings\?source=e2e-navigation$/);
  await expect(page.getByRole("heading", { name: "Options", exact: true })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(sonicUrl);
  await expect(page.getByRole("heading", { name: "SonicDICOM Reports", exact: true })).toBeVisible();

  await page.goto("/settings?section=equipment&source=e2e-navigation");
  await expect(page).toHaveURL(/section=equipment/);
  await expect(page.getByRole("heading", { name: "Equipment Registry", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E Performed CT/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row", { name: /E2E Performed CT/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-equipment-deep-link.png"), fullPage: true });
});

test("Settings direct links cannot bypass section authorization", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/settings?section=system_diagnostics&source=e2e-navigation");

  await expect(page).toHaveURL(/\/settings\?source=e2e-navigation$/);
  await expect(page.getByRole("heading", { name: "Options", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "System Diagnostics", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /System Diagnostics/ })).toHaveCount(0);
});
