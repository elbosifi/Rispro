import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

async function openPacsWithExpiredReauth(page: Page, source = "i18n-reauth") {
  await signInWithSession(page, "e2e_super_admin");
  await page.goto(`/settings?section=pacs_connection&source=${source}`);
  await expect(page.getByRole("heading", { name: "PACS Connection", exact: true })).toBeVisible();
  await expect(page.getByText("Re-authentication required", { exact: true })).toBeVisible();
}

async function completePasswordReauth(page: Page) {
  await page.getByRole("button", { name: "Re-authenticate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Supervisor Re-Authentication", exact: true })).toBeVisible();
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
}

test("PACS re-authentication preserves the URL section and refetches protected content", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openPacsWithExpiredReauth(page);
  await page.screenshot({ path: testInfo.outputPath("pacs-reauth-required.png"), fullPage: true });

  await page.getByRole("button", { name: "Re-authenticate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Supervisor Re-Authentication", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("reauth-modal-en.png"), fullPage: true });
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Verify", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Supervisor Re-Authentication", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/settings\?section=pacs_connection&source=i18n-reauth/);
  await expect(page.getByText("Orthanc remote modalities", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("pacs-after-reauth.png"), fullPage: true });
  expect(pageErrors, `Unexpected page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});

test("PACS re-authentication cancellation and invalid password keep access protected", async ({ page }) => {
  await openPacsWithExpiredReauth(page, "secure-cancel");
  await page.getByRole("button", { name: "Re-authenticate", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Supervisor Re-Authentication", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/section=pacs_connection&source=secure-cancel/);
  await expect(page.getByText("Re-authentication required", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Re-authenticate", exact: true }).click();
  await page.locator('input[type="password"]').fill("wrong-password");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Supervisor Re-Authentication", exact: true })).toBeVisible();
  await expect(page.getByText("The supervisor password is incorrect.", { exact: true })).toBeVisible();
  await expect(page.getByText("Re-authentication required", { exact: true })).toBeVisible();
});

test("the shared continuation also refetches the Users Settings section", async ({ page }) => {
  await signInWithSession(page, "e2e_super_admin");
  await page.goto("/settings?section=users&source=shared-reauth");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-authenticate", exact: true })).toBeVisible();
  await completePasswordReauth(page);
  await expect(page.getByRole("heading", { name: "Supervisor Re-Authentication", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/section=users&source=shared-reauth/);
  await expect(page.getByRole("button", { name: "Add User", exact: true })).toBeVisible();
});

test("Settings and PACS surfaces switch to Arabic RTL without raw section labels", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_super_admin");
  await page.goto("/settings?source=language-audit");
  await expect(page.getByRole("heading", { name: "Options", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-menu-en.png"), fullPage: true });
  await page.getByRole("button", { name: "Switch language to Arabic", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar-LY");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("استيراد المرضى", { exact: true })).toBeVisible();
  await expect(page.getByText("Patient Import", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("settings-menu-ar.png"), fullPage: true });

  await page.getByRole("button", { name: /اتصال PACS/ }).click();
  await expect(page.getByRole("heading", { name: "اتصال PACS", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "إعادة التحقق", exact: true }).click();
  await expect(page.getByRole("heading", { name: "إعادة تحقق المشرف", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("reauth-modal-ar.png"), fullPage: true });
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "تحقق", exact: true }).click();
  await expect(page.getByText("أجهزة Orthanc البعيدة", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("pacs-settings-ar.png"), fullPage: true });
});
