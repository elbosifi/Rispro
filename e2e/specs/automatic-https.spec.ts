import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

test("super administrator sees HTTPS configuration and protected-bootstrap guidance at desktop and mobile widths", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_super_admin");
  expect((await page.request.post("http://127.0.0.1:3100/api/auth/re-auth", { data: { password: E2E_PASSWORD } })).ok()).toBeTruthy();
  await page.goto("/settings?section=deployment_identity");
  await expect(page.getByRole("heading", { name: "Automatic HTTPS", exact: true })).toBeVisible();
  await expect(page.getByLabel("Hostname", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Certificate Provider")).toHaveValue("acmedns");
  await expect(page.getByLabel("ACME-DNS password")).toHaveValue("");
  await expect(page.getByLabel("Redirect HTTP to HTTPS")).not.toBeChecked();
  await expect(page.getByLabel("ACME-DNS password")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save Configuration" })).toBeDisabled();
  await expect(page.getByText(/Enter credentials using trusted HTTPS/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("automatic-https-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("ACME-DNS full domain")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("automatic-https-mobile.png"), fullPage: true });
});
