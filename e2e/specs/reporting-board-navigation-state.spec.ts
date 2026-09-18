import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

async function openSupervisorReportingBoard(page: Parameters<typeof signInWithSession>[0]) {
  await signInWithSession(page, "e2e_supervisor");
  const settingsResponse = page.waitForResponse((response) => response.url().includes("/api/doctor/reporting-board/settings") && response.ok());
  await page.goto("/doctor/reporting-board");
  await settingsResponse;
  await expect(page.getByRole("heading", { name: /Reporting Assignment Board/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Report status" })).toHaveValue("required_not_final");
}

async function configureStableFilters(page: Parameters<typeof signInWithSession>[0]) {
  await expect(page.getByLabel("Date from")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByRole("combobox", { name: "Assigned doctor" }).selectOption("unassigned");
  await page.getByRole("combobox", { name: "Sort by" }).selectOption("study_date");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByLabel("Category").selectOption("non_oncology");
}

test("Reporting Board normal filter deep link survives reload", async ({ page }) => {
  await openSupervisorReportingBoard(page);
  await configureStableFilters(page);

  const savedUrl = page.url();
  expect(savedUrl).toContain("assignmentStatus=unassigned");
  expect(savedUrl).toContain("category=non_oncology");
  expect(savedUrl).toContain("sortBy=study_date");

  await page.reload();
  await expect(page).toHaveURL(savedUrl);
  await expect(page.getByRole("combobox", { name: "Assigned doctor" })).toHaveValue("unassigned");
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("study_date");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("non_oncology");
});

test("Reporting Board search remains private to the browser URL", async ({ page }) => {
  await openSupervisorReportingBoard(page);
  const search = page.getByPlaceholder("Search MRN / accession / patient / exam");
  await search.fill("PRIVATE-PATIENT-SEARCH");
  await search.press("Enter");

  await expect(search).toHaveValue("PRIVATE-PATIENT-SEARCH");
  expect(page.url()).not.toMatch(/[?&](q|query|search)=/);
  expect(page.url()).not.toContain("PRIVATE-PATIENT-SEARCH");
});

test("Reporting Board state restores through browser Back", async ({ page }) => {
  await openSupervisorReportingBoard(page);
  await configureStableFilters(page);
  const savedUrl = page.url();

  await page.goto("/doctor/today-cases");
  await expect(page.getByRole("heading", { name: /Today/ })).toBeVisible();
  await page.goBack();

  await expect(page).toHaveURL(savedUrl);
  await expect(page.getByRole("combobox", { name: "Assigned doctor" })).toHaveValue("unassigned");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("non_oncology");
});

test("Reporting Board reset leaves the saved-view-free default route", async ({ page }) => {
  await openSupervisorReportingBoard(page);
  await configureStableFilters(page);
  await page.getByRole("button", { name: "Reset to default board" }).click();

  await expect(page).toHaveURL(/\/doctor\/reporting-board$/);
  await expect(page.getByRole("combobox", { name: "Assigned doctor" })).toHaveValue("all");
  await expect(page.getByRole("combobox", { name: "Report status" })).toHaveValue("required_not_final");
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("priority_study_date");
});
