import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth.js";

async function reauthenticate(page: Page) {
  const response = await page.request.post("http://127.0.0.1:3100/api/auth/re-auth", { data: { password: E2E_PASSWORD } });
  expect(response.ok()).toBeTruthy();
}

test("Equipment Registry manages its optional DICOM identity without a standalone DICOM Devices page", async ({ page }, testInfo) => {
  const screenshot = (name: string) => page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
  const pageErrors: string[] = []; page.on("pageerror", (error) => pageErrors.push(error.message));
  await signInWithSession(page, "e2e_super_admin"); await reauthenticate(page);
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Equipment Registry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "DICOM Devices" })).toHaveCount(0);
  await expect(page.getByText("settings.section.equipment", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Equipment Registry" }).click();
  await expect(page.getByRole("heading", { name: "Equipment Registry" })).toBeVisible();
  await expect(page.getByRole("row", { name: /E2E Performed CT/ })).toContainText("DICOM configured");
  await expect(page.getByRole("row", { name: /E2E Performed CT/ })).toContainText("AE: E2E_MPPS_CT");
  await expect(page.getByRole("row", { name: /E2E Planned CT/ })).toContainText("DICOM not configured");
  await screenshot("equipment-settings-desktop.png");

  const planned = page.getByRole("row", { name: /E2E Planned CT/ }); await planned.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Configure DICOM" }).click();
  await expect(page.getByLabel("Device name")).toHaveValue("E2E Planned CT");
  await page.getByLabel("Modality AE Title").fill("E2E_SETTINGS_CT");
  await page.getByLabel("Scheduled Station AE Title").fill("E2E_SETTINGS_STATION");
  await page.getByLabel("Station name").fill("E2E Settings station");
  await page.getByLabel("Source IP").fill("10.20.30.40");
  await page.getByRole("checkbox", { name: "MWL enabled" }).check();
  await page.getByRole("button", { name: "Save DICOM identity" }).click();
  await expect(page.getByText("DICOM configured")).toBeVisible();
  await screenshot("equipment-settings-edit-desktop.png");
  await page.goto("/settings?section=equipment"); await expect(page.getByRole("row", { name: /E2E Planned CT/ })).toContainText("AE: E2E_SETTINGS_CT");
  await page.goto("/settings?section=dicom_gateway_devices"); await expect(page.getByRole("heading", { name: "Equipment Registry" })).toBeVisible();
  await page.getByRole("button", { name: /Back.*Settings/ }).click(); await expect(page.getByRole("button", { name: "Advanced / Legacy DICOM Gateway" })).toBeVisible();
  await page.goto("/settings?section=equipment"); await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy(); await screenshot("equipment-settings-mobile.png");
  await page.getByRole("button", { name: "Switch language to Arabic" }).click(); await expect(page.locator("html")).toHaveAttribute("dir", "rtl"); await screenshot("equipment-settings-rtl.png");
  expect(pageErrors, `Unexpected page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});
