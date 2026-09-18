import { expect, test, type Page } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

const moduleLastLocationsStorageKey = "rispro:navigation:last-locations:v1";

function tripoliDate(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function e2eModalityId(page: Page): Promise<string> {
  const response = await page.request.get("http://127.0.0.1:3100/api/v2/lookups/modalities");
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { items: Array<{ id: number; code?: string }> };
  const modality = body.items.find((item) => item.code === "E2E_CT") ?? body.items[0];
  expect(modality).toBeTruthy();
  return String(modality!.id);
}

function calendarUrl(date: string, modalityId: string): string {
  return `/calendar?month=${date.slice(0, 7)}&date=${date}&modalityId=${modalityId}&status=scheduled`;
}

function modalityUrl(date: string, modalityId: string): string {
  return `/modality?modalityId=${modalityId}&date=${date}&view=completed`;
}

async function clickSidebar(page: Page, label: string): Promise<void> {
  await page.locator("nav[aria-label='Menu']").getByRole("button", { name: label, exact: true }).dispatchEvent("click");
}

async function expectCalendarState(page: Page, modalityId: string): Promise<void> {
  await expect(page.locator("select").nth(0)).toHaveValue(modalityId);
  await expect(page.locator("select").nth(2)).toHaveValue("scheduled");
}

async function expectModalityState(page: Page, date: string, modalityId: string): Promise<void> {
  await expect(page.locator("select").first()).toHaveValue(modalityId);
  await expect(page.getByRole("textbox", { name: "Date" })).toHaveValue(`${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`);
  await expect(page.getByRole("button", { name: "Completed", exact: true })).toHaveAttribute("aria-pressed", "true");
}

test("sidebar switching restores the previous Calendar location", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  const date = tripoliDate(1);
  const modalityId = await e2eModalityId(page);
  const savedCalendarUrl = calendarUrl(date, modalityId);

  await page.goto(savedCalendarUrl);
  await expect(page).toHaveURL(savedCalendarUrl);
  await expectCalendarState(page, modalityId);

  await clickSidebar(page, "Patients");
  await expect(page).toHaveURL(/\/patients$/);

  await clickSidebar(page, "Calendar");
  await expect(page).toHaveURL(savedCalendarUrl);
  await expectCalendarState(page, modalityId);
});

test("Patients, Calendar, and Modality retain independent sidebar locations", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  const date = tripoliDate();
  const modalityId = await e2eModalityId(page);
  const patientsUrl = "/patients?category=oncology&page=2";
  const savedCalendarUrl = `/calendar?month=${date.slice(0, 7)}&date=${date}&modalityId=${modalityId}&category=non_oncology&status=scheduled`;
  const savedModalityUrl = modalityUrl(date, modalityId);

  await page.goto(patientsUrl);
  await clickSidebar(page, "Calendar");
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto(savedCalendarUrl);

  await clickSidebar(page, "Modality board");
  await expect(page).toHaveURL(/\/modality$/);
  await page.goto(savedModalityUrl);
  await expectModalityState(page, date, modalityId);

  await clickSidebar(page, "Patients");
  await expect(page).toHaveURL(patientsUrl);
  await clickSidebar(page, "Calendar");
  await expect(page).toHaveURL(savedCalendarUrl);
  await expectCalendarState(page, modalityId);
  await clickSidebar(page, "Modality board");
  await expect(page).toHaveURL(savedModalityUrl);
  await expectModalityState(page, date, modalityId);
});

test("sidebar re-entry restores an open Calendar patient drawer and its filters", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  const date = tripoliDate();
  const modalityId = await e2eModalityId(page);
  await page.goto(calendarUrl(date, modalityId));

  await page.getByTestId(`modality-summary-modality:${modalityId}`).click();
  await page.getByRole("button", { name: "E2E Queue Patient", exact: true }).click();
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  const drawerUrl = page.url();

  await clickSidebar(page, "Patients");
  await expect(page).toHaveURL(/\/patients$/);
  await clickSidebar(page, "Calendar");
  await expect(page).toHaveURL(drawerUrl);
  await expectCalendarState(page, modalityId);
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
});

test("closing an overlay updates the saved Calendar location", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  const date = tripoliDate();
  const modalityId = await e2eModalityId(page);
  const savedCalendarUrl = calendarUrl(date, modalityId);
  await page.goto(savedCalendarUrl);

  await page.getByTestId(`modality-summary-modality:${modalityId}`).click();
  await page.getByRole("button", { name: "E2E Queue Patient", exact: true }).click();
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("patient-drawer-backdrop")).toHaveCount(0);

  await clickSidebar(page, "Patients");
  await expect(page).toHaveURL(/\/patients$/);
  await clickSidebar(page, "Calendar");
  await expect(page).toHaveURL(savedCalendarUrl);
  await expect(page.getByTestId("patient-drawer-backdrop")).toHaveCount(0);
});

test("an explicit registration workflow overrides a stored registration location", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/registrations?dateMode=all");
  await page.locator('[role="button"][aria-label*="E2E Queue Patient"]').last().click();
  const storedAppointmentId = new URL(page.url()).searchParams.get("appointmentId");
  expect(storedAppointmentId).toBeTruthy();

  await clickSidebar(page, "Patients");
  await expect(page).toHaveURL(/\/patients$/);

  const globalSearch = page.getByRole("combobox", { name: "Search patients or registrations" });
  await globalSearch.fill("E2E Acquisition Patient");
  const registrationResult = page.getByRole("option").filter({ hasText: "V2-" }).filter({ hasText: "E2E Acquisition Patient" });
  await expect(registrationResult).toBeVisible();
  await registrationResult.click();

  const destination = new URL(page.url());
  expect(destination.pathname).toBe("/registrations");
  expect(destination.searchParams.get("appointmentId")).toBeTruthy();
  expect(destination.searchParams.get("appointmentId")).not.toBe(storedAppointmentId);
  expect(destination.searchParams.get("tab")).toBe("details");
});

test("logout clears module last-location state before the next authenticated session", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  const date = tripoliDate(1);
  const modalityId = await e2eModalityId(page);
  const savedCalendarUrl = calendarUrl(date, modalityId);
  await page.goto(savedCalendarUrl);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), moduleLastLocationsStorageKey)).not.toBeNull();

  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), moduleLastLocationsStorageKey)).toBeNull();

  await signInWithSession(page, "e2e_reception");
  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/calendar$/);
  expect(page.url()).not.toBe(savedCalendarUrl);
});
