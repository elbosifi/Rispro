import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

const searchPlaceholder = "Search patients by name, national ID, MRN, or phone...";
const patientSearchStorageKey = "rispro:patients:search";
const privateSearchValue = "E2E Similar";

test("Patients deep links retain filters, drawer state, edit return, and global search navigation", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_reception");

  await test.step("filter state is retained through navigation and refresh", async () => {
    await page.goto("/patients");
    await page.getByPlaceholder(searchPlaceholder).fill(privateSearchValue);
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), patientSearchStorageKey)).toBe(privateSearchValue);
    expect(page.url()).not.toContain("q=");
    expect(page.url()).not.toContain(privateSearchValue);
    await page.getByLabel("Category:").selectOption("oncology");
    await expect(page).toHaveURL(/category=oncology/);
    await page.getByLabel("Sex:").selectOption("male");
    await expect(page).toHaveURL(/sex=male/);
    expect(page.url()).not.toContain("q=");
    expect(page.url()).not.toContain(privateSearchValue);
    await expect(page.getByText("No patients found")).toBeVisible();
    const categoryFilteredUrl = page.url();

    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(page).toHaveURL(/\/queue$/);
    await page.goBack();
    await expect(page).toHaveURL(categoryFilteredUrl);
    await expect(page.getByPlaceholder(searchPlaceholder)).toHaveValue(privateSearchValue);
    await expect(page.getByLabel("Category:")).toHaveValue("oncology");
    await expect(page.getByLabel("Sex:")).toHaveValue("male");
    await expect(page.getByText("No patients found")).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(categoryFilteredUrl);
    await expect(page.getByPlaceholder(searchPlaceholder)).toHaveValue(privateSearchValue);
    await expect(page.getByLabel("Category:")).toHaveValue("oncology");

    await page.getByLabel("Category:").selectOption("");
    await expect(page.getByText("E2E Similar Patient One")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("patients-filtered.png"), fullPage: true });
  });

  await test.step("drawer state is URL-backed and browser history is natural", async () => {
    const filteredUrl = page.url();
    await page.getByText("E2E Similar Patient One").first().click();
    await expect(page).toHaveURL(/patientId=\d+/);
    expect(page.url()).not.toContain("q=");
    expect(page.url()).not.toContain(privateSearchValue);
    await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("patient-drawer-deep-link.png"), fullPage: true });
    const drawerUrl = page.url();

    await page.reload();
    await expect(page).toHaveURL(drawerUrl);
    await expect(page.getByPlaceholder(searchPlaceholder)).toHaveValue(privateSearchValue);
    await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(filteredUrl);
    await expect(page.getByTestId("patient-drawer-backdrop")).toHaveCount(0);
    await expect(page.getByPlaceholder(searchPlaceholder)).toHaveValue("E2E Similar");
    await page.screenshot({ path: testInfo.outputPath("patients-restored-after-back.png"), fullPage: true });
    await page.goForward();
    await expect(page).toHaveURL(drawerUrl);
    await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  });

  await test.step("edit Cancel returns to the exact patient-directory context", async () => {
    const expectedReturn = new URL(page.url()).pathname + new URL(page.url()).search;
    await page.getByRole("button", { name: /^edit patient$/i }).click();
    const editUrl = new URL(page.url());
    expect(editUrl.pathname).toMatch(/^\/patients\/\d+\/edit$/);
    expect(editUrl.searchParams.get("returnTo")).toBe(expectedReturn);
    expect(editUrl.searchParams.get("returnTo")).not.toContain("q=");
    expect(editUrl.toString()).not.toContain(privateSearchValue);
    await page.getByRole("button", { name: /cancel/i }).first().click();
    await expect(page).toHaveURL(expectedReturn);
    await expect(page.getByPlaceholder(searchPlaceholder)).toHaveValue(privateSearchValue);
    await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  });

  await test.step("global patient search produces the canonical Patients deep link", async () => {
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByTestId("patient-drawer-backdrop")).toHaveCount(0);
    const filteredUrl = page.url();
    const globalSearch = page.getByRole("combobox", { name: "Search patients or registrations" });
    await globalSearch.fill("E2E Similar Patient One");
    await expect(page.getByRole("option", { name: /E2E Similar Patient One/ })).toBeVisible();
    await page.getByRole("option", { name: /E2E Similar Patient One/ }).click();
    await expect(page).toHaveURL(/\/patients\?.*patientId=\d+/);
    expect(page.url()).not.toContain("q=");
    expect(page.url()).not.toContain("E2E Similar Patient One");
    await expect(page.getByPlaceholder(searchPlaceholder)).toHaveValue(privateSearchValue);
    await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(filteredUrl);
  });
});

test("Patients drawer deep link remains usable on mobile", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/patients?sex=male");
  await page.getByPlaceholder(searchPlaceholder).fill(privateSearchValue);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), patientSearchStorageKey)).toBe(privateSearchValue);
  expect(page.url()).not.toContain("q=");
  expect(page.url()).not.toContain(privateSearchValue);
  await page.locator('[data-patient-id]').last().click();
  await expect(page).toHaveURL(/patientId=\d+/);
  expect(page.url()).not.toContain("q=");
  await page.reload();
  await expect(page.getByPlaceholder(searchPlaceholder)).toHaveValue(privateSearchValue);
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
});
