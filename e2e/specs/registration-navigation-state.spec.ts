import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

const searchPlaceholder = "Name, MRN, Accession...";
const registrationSearchStorageKey = "rispro:registrations:search";
const privateSearchValue = "E2E Queue";

function assertNoPrivateSearchInUrl(pageUrl: string) {
  expect(pageUrl).not.toContain("q=");
  expect(pageUrl).not.toContain(encodeURIComponent(privateSearchValue));
  expect(pageUrl).not.toContain(privateSearchValue);
}

test("Registrations deep links retain public filters and panel state without exposing search text", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_reception");
  await page.goto("/registrations");

  await expect(page.getByText("E2E Queue Patient").last()).toBeVisible();
  await page.getByPlaceholder(searchPlaceholder).fill(privateSearchValue);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), registrationSearchStorageKey)).toBe(privateSearchValue);
  assertNoPrivateSearchInUrl(page.url());

  await page.getByRole("button", { name: "All dates", exact: true }).click();
  await expect(page).toHaveURL(/dateMode=all/);
  await page.getByLabel("Sort:").selectOption("booking-asc");
  await expect(page).toHaveURL(/sort=booking-asc/);
  assertNoPrivateSearchInUrl(page.url());
  const filteredUrl = page.url();

  const managementRow = page.locator('[role="button"][aria-label*="E2E Queue Patient"]').last();
  await managementRow.click();
  await expect(page).toHaveURL(/appointmentId=\d+/);
  await expect(page.getByRole("dialog", { name: "Manage" })).toBeVisible();
  const managementUrl = page.url();
  assertNoPrivateSearchInUrl(managementUrl);
  await page.screenshot({ path: testInfo.outputPath("registrations-manage-deep-link.png"), fullPage: true });

  await page.reload();
  await expect(page).toHaveURL(managementUrl);
  await expect(page.getByPlaceholder(searchPlaceholder)).toHaveValue(privateSearchValue);
  await expect(page.getByRole("dialog", { name: "Manage" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
  await expect(page.getByRole("dialog", { name: "Manage" })).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(managementUrl);
  await expect(page.getByRole("dialog", { name: "Manage" })).toBeVisible();

  await page.goto(filteredUrl);
  await page.getByRole("button", { name: "E2E Queue Patient", exact: true }).last().click();
  await expect(page).toHaveURL(/patientDrawerId=\d+/);
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  const drawerUrl = page.url();
  assertNoPrivateSearchInUrl(drawerUrl);
  await page.reload();
  await expect(page).toHaveURL(drawerUrl);
  await expect(page.getByPlaceholder(searchPlaceholder)).toHaveValue(privateSearchValue);
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
  await expect(page.getByTestId("patient-drawer-backdrop")).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(drawerUrl);
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("registrations-patient-drawer-deep-link.png"), fullPage: true });
});

test("Registrations patient drawer deep link remains usable on mobile", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/registrations?dateMode=all");
  await page.getByPlaceholder(searchPlaceholder).fill(privateSearchValue);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), registrationSearchStorageKey)).toBe(privateSearchValue);
  await page.getByRole("button", { name: "E2E Queue Patient", exact: true }).first().click();
  await expect(page).toHaveURL(/patientDrawerId=\d+/);
  assertNoPrivateSearchInUrl(page.url());
  await page.reload();
  await expect(page.getByPlaceholder(searchPlaceholder)).toHaveValue(privateSearchValue);
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
});
