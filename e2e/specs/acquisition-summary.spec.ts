import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth.js";

test("shows the authoritative MPPS device and acquisition duration across modality, protocoling, and reporting", async ({ page }, testInfo) => {
  const screenshot = (name: string) => page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/modality");
  await expect(page).not.toHaveURL(/login/);
  await page.locator("select").first().selectOption({ label: "E2E CT" });
  await page.getByRole("button", { name: "All Dates", exact: true }).click();
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  const modalityRow = page.getByTestId(/modality-board-row-/).filter({ hasText: "E2E Acquisition Patient" });
  await expect(modalityRow).toBeVisible();
  await expect(modalityRow.getByTestId("modality-board-acquisition")).toContainText("E2E Performed CT");
  await expect(modalityRow.getByTestId("modality-board-acquisition")).toContainText("27m");
  await modalityRow.click();
  await expect(page.getByText("Performed on", { exact: true })).toBeVisible();
  await expect(page.getByText("E2E Performed CT", { exact: true })).toBeVisible();
  await expect(page.getByText("Duration", { exact: true })).toBeVisible();
  await expect(page.getByText("27m", { exact: true })).toBeVisible();
  await screenshot("acquisition-modality-desktop.png");

  await page.context().clearCookies();
  await signInWithSession(page, "e2e_doctor");
  await page.goto("/doctor/protocols");
  await expect(page.getByRole("heading", { name: "Protocoling Worklist" })).toBeVisible();
  await page.getByLabel("Protocol status").selectOption("ALL");
  await page.getByLabel("Search protocoling appointments").fill("E2E Acquisition Patient");
  const protocolingRow = page.getByRole("row", { name: /E2E Acquisition Patient/ });
  await expect(protocolingRow).toContainText("Protocol scanner: E2E Planned CT");
  await expect(protocolingRow.getByTestId("protocoling-performed-acquisition")).toContainText("Performed on: E2E Performed CT");
  await expect(protocolingRow.getByTestId("protocoling-performed-acquisition")).toContainText("27 min");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await screenshot("acquisition-protocoling-mobile.png");

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.context().clearCookies();
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/doctor/reporting-board");
  await expect(page.getByRole("heading", { name: "Reporting Assignment Board" })).toBeVisible();
  const reportingRow = page.getByRole("row", { name: /E2E Acquisition Patient/ });
  await expect(reportingRow.getByTestId("reporting-study-acquisition")).toContainText("E2E Performed CT");
  await expect(reportingRow.getByTestId("reporting-study-acquisition")).toContainText("27 min");
  await screenshot("acquisition-reporting-desktop.png");

  expect(pageErrors, `Unexpected page errors: ${pageErrors.join(" | ")}`).toEqual([]);
});
