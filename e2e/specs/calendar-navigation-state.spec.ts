import { expect, test, type Page } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

const privateSearchValue = "E2E Queue";
const calendarSearchStorageKey = "rispro:calendar:search";

function tripoliDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(year, monthNumber, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
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
  return `/calendar?source=e2e-navigation&month=${date.slice(0, 7)}&date=${date}&modalityId=${modalityId}&category=non_oncology&status=scheduled`;
}

test("Calendar deep links restore context, preserve privacy, and retain patient drawer history", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_reception");
  const date = tripoliDate();
  const modalityId = await e2eModalityId(page);
  const directUrl = calendarUrl(date, modalityId);

  await page.goto(directUrl);
  await expect(page.getByTestId(`modality-summary-modality:${modalityId}`)).toBeVisible();
  await expect(page.getByLabel("Modality")).toHaveValue(modalityId);
  await expect(page.getByLabel("Category")).toHaveValue("non_oncology");
  await expect(page.getByLabel("Status")).toHaveValue("scheduled");
  await page.screenshot({ path: testInfo.outputPath("calendar-deep-link.png"), fullPage: true });

  await page.getByPlaceholder("Patient, MRN, accession, exam").fill(privateSearchValue);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), calendarSearchStorageKey)).toBe(privateSearchValue);
  expect(page.url()).not.toContain("q=");
  expect(page.url()).not.toContain(privateSearchValue);

  await page.reload();
  await expect(page).toHaveURL(directUrl);
  await expect(page.getByPlaceholder("Patient, MRN, accession, exam")).toHaveValue(privateSearchValue);
  await expect(page.getByTestId(`modality-summary-modality:${modalityId}`)).toBeVisible();

  await page.getByLabel("Next month").click();
  const restoredMonth = nextMonth(date.slice(0, 7));
  await expect(page).toHaveURL(new RegExp(`month=${restoredMonth}.*modalityId=${modalityId}.*category=non_oncology.*status=scheduled`));
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/queue$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`month=${restoredMonth}.*modalityId=${modalityId}.*category=non_oncology.*status=scheduled`));
  await expect(page.getByLabel("Modality")).toHaveValue(modalityId);
  await expect(page.getByLabel("Category")).toHaveValue("non_oncology");
  await expect(page.getByLabel("Status")).toHaveValue("scheduled");

  await page.goto(directUrl);
  await page.getByTestId(`modality-summary-modality:${modalityId}`).click();
  await page.getByRole("button", { name: "E2E Queue Patient", exact: true }).click();
  await expect(page).toHaveURL(/patientId=\d+/);
  const drawerUrl = page.url();
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("calendar-patient-drawer-deep-link.png"), fullPage: true });

  await page.reload();
  await expect(page).toHaveURL(drawerUrl);
  await expect(page.getByPlaceholder("Patient, MRN, accession, exam")).toHaveValue(privateSearchValue);
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(directUrl);
  await expect(page.getByTestId("patient-drawer-backdrop")).toHaveCount(0);
  await expect(page.getByLabel("Modality")).toHaveValue(modalityId);
  await page.screenshot({ path: testInfo.outputPath("calendar-restored-after-back.png"), fullPage: true });
  await page.goForward();
  await expect(page).toHaveURL(drawerUrl);
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
});

test("Calendar patient drawer direct links remain usable on mobile", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  await page.setViewportSize({ width: 390, height: 844 });
  const date = tripoliDate();
  const modalityId = await e2eModalityId(page);
  const directUrl = calendarUrl(date, modalityId);

  await page.goto(directUrl);
  await page.getByTestId(`modality-summary-modality:${modalityId}`).click();
  await page.getByRole("button", { name: "E2E Queue Patient", exact: true }).click();
  await expect(page).toHaveURL(/patientId=\d+/);
  const drawerUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(drawerUrl);
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
});
