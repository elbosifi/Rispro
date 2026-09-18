import { expect, test, type Page } from "@playwright/test";
import { signInWithSession } from "../helpers/auth.js";

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

async function e2eModalityId(page: Page): Promise<string> {
  const response = await page.request.get("http://127.0.0.1:3100/api/v2/lookups/modalities");
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { items: Array<{ id: number; code?: string }> };
  const modality = body.items.find((item) => item.code === "E2E_CT") ?? body.items[0];
  expect(modality).toBeTruthy();
  return String(modality!.id);
}

function modalityUrl(date: string, modalityId: string): string {
  return `/modality?source=e2e-navigation&modalityId=${modalityId}&date=${date}&view=completed`;
}

async function expectRestoredState(page: Page, date: string, modalityId: string) {
  await expect(page.locator("select").first()).toHaveValue(modalityId);
  await expect(page.getByRole("textbox", { name: "Date" })).toHaveValue(`${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`);
  await expect(page.getByRole("button", { name: "Completed", exact: true })).toHaveAttribute("aria-pressed", "true");
}

test("Modality deep links restore operational state and appointment history", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_supervisor");
  const date = tripoliDate();
  const modalityId = await e2eModalityId(page);

  await page.goto("/modality");
  await page.locator("select").first().selectOption(modalityId);
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/modality\\?modalityId=${modalityId}.*view=completed`));
  const operationalUrl = page.url();

  await page.goto("/queue");
  await page.goBack();
  await expect(page).toHaveURL(operationalUrl);
  await expectRestoredState(page, date, modalityId);
  await page.screenshot({ path: testInfo.outputPath("modality-restored-after-back.png"), fullPage: true });

  const directUrl = modalityUrl(date, modalityId);
  await page.goto(directUrl);
  await expectRestoredState(page, date, modalityId);
  await expect(page.getByTestId(/modality-board-row-/).filter({ hasText: "E2E Acquisition Patient" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(directUrl);
  await expectRestoredState(page, date, modalityId);
  await page.screenshot({ path: testInfo.outputPath("modality-deep-link-restored.png"), fullPage: true });

  await page.getByTestId(/modality-board-row-/).filter({ hasText: "E2E Acquisition Patient" }).click();
  await expect(page).toHaveURL(/appointmentId=\d+/);
  const appointmentUrl = page.url();
  await expect(page.getByTestId("selected-appointment-drawer")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("modality-appointment-deep-link.png"), fullPage: true });

  await page.reload();
  await expect(page).toHaveURL(appointmentUrl);
  await expect(page.getByTestId("selected-appointment-drawer")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(directUrl);
  await expect(page.getByTestId("selected-appointment-drawer")).toHaveCount(0);
  await expectRestoredState(page, date, modalityId);
  await page.screenshot({ path: testInfo.outputPath("modality-restored-after-appointment-back.png"), fullPage: true });

  await page.goForward();
  await expect(page).toHaveURL(appointmentUrl);
  await expect(page.getByTestId("selected-appointment-drawer")).toBeVisible();
});

test("Modality appointment deep links remain usable on mobile", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  await page.setViewportSize({ width: 390, height: 844 });
  const date = tripoliDate();
  const modalityId = await e2eModalityId(page);

  await page.goto(modalityUrl(date, modalityId));
  await expectRestoredState(page, date, modalityId);
  await page.getByTestId(/modality-board-row-/).filter({ hasText: "E2E Acquisition Patient" }).click();
  await expect(page).toHaveURL(/appointmentId=\d+/);
  await expect(page.getByTestId("selected-appointment-drawer")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("selected-appointment-drawer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeVisible();
});
