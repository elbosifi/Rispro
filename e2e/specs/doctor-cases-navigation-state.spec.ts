import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";
import { e2eTodayInTripoli } from "../helpers/fixtures";

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function openSupervisorCases(page: Parameters<typeof signInWithSession>[0]) {
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/doctor/today-cases");
  await expect(page.getByRole("heading", { name: "Today’s Cases" })).toBeVisible();
}

async function configureCases(page: Parameters<typeof signInWithSession>[0]) {
  const dateFrom = addDays(e2eTodayInTripoli(), 1);
  const dateTo = addDays(dateFrom, 8);
  await page.getByRole("textbox", { name: "From" }).fill(dateFrom);
  await page.getByRole("textbox", { name: "To" }).fill(dateTo);
  const modality = page.getByRole("combobox", { name: "Modality" });
  await modality.selectOption({ label: "E2E CT" });
  await expect(modality).toHaveValue(/^\d+$/);
  const modalityId = await modality.inputValue();
  await page.getByRole("combobox", { name: "Category" }).selectOption("non_oncology");
  return { dateFrom, dateTo, modalityId };
}

test("Doctor Cases direct deep link survives reload", async ({ page }) => {
  await openSupervisorCases(page);
  const { dateFrom, dateTo, modalityId } = await configureCases(page);
  await page.getByRole("button", { name: "Team cases" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("modalityId")).toBe(modalityId);

  const savedUrl = page.url();
  expect(savedUrl).toContain(`/doctor/today-cases?dateFrom=${dateFrom}`);
  expect(savedUrl).toContain(`dateTo=${dateTo}`);
  expect(savedUrl).toContain("modalityId=");
  expect(savedUrl).toContain("category=non_oncology");
  expect(savedUrl).toContain("view=team");

  await page.reload();
  await expect(page).toHaveURL(savedUrl);
  await expect(page.getByRole("textbox", { name: "From" })).toHaveValue(dateFrom);
  await expect(page.getByRole("textbox", { name: "To" })).toHaveValue(dateTo);
  await expect(page.getByRole("combobox", { name: "Modality" })).toHaveValue(/^\d+$/);
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("non_oncology");
  await expect(page.getByRole("button", { name: "Team cases" })).toHaveAttribute("aria-pressed", "true");
});

test("Doctor Cases worklist view uses browser history", async ({ page }) => {
  await openSupervisorCases(page);
  await expect(page.getByRole("button", { name: "Unassigned cases" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Team cases" }).click();
  await expect(page).toHaveURL(/\/doctor\/today-cases\?.*view=team/);
  await expect(page.getByRole("button", { name: "Team cases" })).toHaveAttribute("aria-pressed", "true");

  await page.goBack();
  await expect(page.getByRole("button", { name: "Unassigned cases" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).not.toHaveURL(/view=team/);

  await page.goForward();
  await expect(page.getByRole("button", { name: "Team cases" })).toHaveAttribute("aria-pressed", "true");
});

test("Doctor Cases state survives navigating away and browser Back", async ({ page }) => {
  await openSupervisorCases(page);
  const { dateFrom, dateTo } = await configureCases(page);
  await page.getByRole("button", { name: "My cases" }).click();
  const savedUrl = page.url();

  await page.goto("/doctor/my-work");
  await expect(page.getByText("Clinical coordination workspace", { exact: true })).toBeVisible();
  await page.goBack();

  await expect(page).toHaveURL(savedUrl);
  await expect(page.getByRole("textbox", { name: "From" })).toHaveValue(dateFrom);
  await expect(page.getByRole("textbox", { name: "To" })).toHaveValue(dateTo);
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("non_oncology");
  await expect(page.getByRole("button", { name: "My cases" })).toHaveAttribute("aria-pressed", "true");
});

test("Doctor Cases normalizes unauthorized worklist views", async ({ page }) => {
  const teamRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/doctor/cases/team")) teamRequests.push(request.url());
  });
  await signInWithSession(page, "e2e_doctor_non_supervisor");
  await page.goto("/doctor/today-cases?view=team");

  await expect(page.getByRole("heading", { name: "Report Worklist" })).toBeVisible();
  await expect(page).toHaveURL(/\/doctor\/today-cases(?:\?requiresReport=true)?$/);
  await expect(page.getByText("My Cases", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Team cases" })).toHaveCount(0);
  expect(teamRequests).toHaveLength(0);
});

test("Doctor Cases remains usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSupervisorCases(page);
  await expect(page.getByRole("textbox", { name: "From" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Category" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});
