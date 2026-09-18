import { expect, test, type Page } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";
import { e2eTodayInTripoli } from "../helpers/fixtures";

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function clickDoctorNav(page: Page, name: RegExp | string): Promise<void> {
  await page.locator("aside").getByRole("button", { name }).click();
}

test("Doctor Portal restores Today Cases through internal navigation", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  const dateFrom = addDays(e2eTodayInTripoli(), 1);
  const dateTo = addDays(dateFrom, 8);
  const savedUrl = `/doctor/today-cases?dateFrom=${dateFrom}&dateTo=${dateTo}&view=team`;

  await page.goto(savedUrl);
  await expect(page.getByRole("heading", { name: /Today/ })).toBeVisible();
  await clickDoctorNav(page, "Protocols");
  await expect(page).toHaveURL(/\/doctor\/protocols/);
  await clickDoctorNav(page, /Today.*Cases/);

  await expect(page).toHaveURL(new RegExp(`/doctor/today-cases\\?dateFrom=${dateFrom}&dateTo=${dateTo}.*view=team`));
  await expect(page.getByRole("button", { name: "Team cases" })).toHaveAttribute("aria-pressed", "true");
});

test("Doctor Portal restores Reporting Board through internal navigation", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  const savedUrl = "/doctor/reporting-board?assignmentStatus=unassigned&category=oncology";

  await page.goto(savedUrl);
  await expect(page.getByRole("heading", { name: /Reporting Assignment Board/ })).toBeVisible();
  await clickDoctorNav(page, "Protocols");
  await expect(page).toHaveURL(/\/doctor\/protocols/);
  await clickDoctorNav(page, "Reporting Board");

  await expect(page).toHaveURL(/\/doctor\/reporting-board\?.*assignmentStatus=unassigned.*category=oncology/);
  await expect(page.getByRole("combobox", { name: "Assigned doctor" })).toHaveValue("unassigned");
});

test("Team Workload direct URL survives reload and Advanced Setup restores a section", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  const startDate = addDays(e2eTodayInTripoli(), 1);
  const endDate = addDays(startDate, 8);
  const modalityResponse = await page.request.get("http://127.0.0.1:3100/api/v2/lookups/modalities");
  expect(modalityResponse.ok()).toBeTruthy();
  const modalityBody = await modalityResponse.json() as { items: Array<{ id: number; code?: string }> };
  const modalityId = String(modalityBody.items.find((item) => item.code === "E2E_CT")?.id ?? modalityBody.items[0]?.id);
  expect(modalityId).not.toBe("undefined");

  const workloadUrl = `/doctor/team-workload?startDate=${startDate}&endDate=${endDate}&modalityId=${modalityId}&requiresReport=true&category=oncology`;
  await page.goto(workloadUrl);
  await expect(page.getByRole("heading", { name: /team workload/i })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(workloadUrl);
  await expect(page.getByRole("textbox", { name: "From" })).toHaveValue(startDate);
  await expect(page.getByRole("textbox", { name: "To" })).toHaveValue(endDate);
  await expect(page.getByRole("combobox", { name: "Modality" })).toHaveValue(modalityId);
  await expect(page.getByRole("combobox", { name: "Report" })).toHaveValue("true");
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("oncology");

  await page.goto("/doctor/advanced-setup?section=roster");
  await expect(page.getByRole("heading", { name: "Advanced Setup" })).toBeVisible();
  await expect(page).toHaveURL(/\/doctor\/advanced-setup\?section=roster/);
  await expect(page.getByRole("button", { name: /Roster setup/ })).toHaveAttribute("style", /accent/);
  await expect(page.getByText("Roster Management")).toBeVisible();
});
