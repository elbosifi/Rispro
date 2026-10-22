import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

async function openUserManagement(page: Page) {
  await signInWithSession(page, "e2e_super_admin");
  await page.goto("/settings?section=users");
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Re-authenticate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Supervisor Re-Authentication", exact: true })).toBeVisible();
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add User", exact: true })).toBeVisible();
}

test("user security details and actions work on desktop, mobile, and Arabic RTL", async ({ page }, testInfo) => {
  await openUserManagement(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("row").filter({ hasText: "@e2e_reception" }).getByRole("button", { name: "Manage", exact: true }).click();

  let dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Never recorded", { exact: true })).toBeVisible();
  const navigation = dialog.locator("details");
  await expect(navigation.getByText("Navigation visibility", { exact: true })).toBeVisible();
  await navigation.locator("summary").click();
  await expect(navigation.getByText("Visible pages", { exact: true })).toBeVisible();
  let history = dialog.getByRole("heading", { name: "Account security history", exact: true }).locator("xpath=..");
  await expect(history.getByText("No account security activity has been recorded.", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("user-management-security-desktop.png"), fullPage: true });

  await dialog.getByRole("combobox", { name: "Edit role" }).selectOption("administrative");
  await dialog.getByRole("button", { name: "Save role", exact: true }).click();
  await expect(history.getByText("From: Receptionist · To: Administrative", { exact: true })).toBeVisible();

  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Require password change", exact: true }).click();
  await expect(history.getByText("Password change required", { exact: true })).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Revoke all sessions", exact: true }).click();
  await expect(history.getByText("Sessions revoked", { exact: true })).toBeVisible();
  await expect(history.getByText("Actor: E2E Super Admin (@e2e_super_admin)", { exact: true }).first()).toBeVisible();

  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Switch language to Arabic", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar-LY");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("article").filter({ hasText: "@e2e_reception" }).getByRole("button", { name: "إدارة", exact: true }).click();

  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "سجل أمان الحساب", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "إبطال جميع الجلسات", exact: true })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("user-management-security-ar-mobile.png"), fullPage: true });
});
