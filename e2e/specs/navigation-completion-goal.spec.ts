import { expect, test, type Page } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";
import { e2eTodayInTripoli } from "../helpers/fixtures";

const queueSearchStorageKey = "rispro:queue:search";
const worklistSearchStorageKey = "rispro:worklist-monitor:search";
const comparisonsSearchStorageKey = "rispro:comparisons:search";
const protocolingSearchStorageKey = "rispro:doctor:protocoling:search";

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function e2eModalityId(page: Page): Promise<string> {
  const response = await page.request.get("http://127.0.0.1:3100/api/v2/lookups/modalities");
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { items: Array<{ id: number; code?: string }> };
  const modality = body.items.find((item) => item.code === "E2E_CT") ?? body.items[0];
  expect(modality).toBeTruthy();
  return String(modality!.id);
}

async function clickSidebarGroup(page: Page, name: string): Promise<void> {
  const menu = page.locator("nav[aria-label='Menu']");
  const group = menu.getByRole("button", { name, exact: true }).first();
  if (await group.getAttribute("aria-expanded") === "false") await group.click();
}

test("Queue preserves safe filters, private search, patient drawer reload, and history", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  const modalityId = await e2eModalityId(page);
  const filteredUrl = `/queue?view=entered&modalityId=${modalityId}`;

  await page.goto(filteredUrl);
  await expect(page.getByRole("heading", { name: /Today's Queue/ })).toBeVisible();
  await expect.poll(() => page.locator("select").evaluateAll((selects) => selects.map((select) => (select as HTMLSelectElement).value))).toContain("entered");
  await expect.poll(() => page.locator("select").evaluateAll((selects) => selects.map((select) => (select as HTMLSelectElement).value))).toContain(modalityId);
  await page.getByPlaceholder("Name, accession, phone, ID...").fill("Queue private E2E");
  expect(page.url()).not.toContain("Queue%20private");
  expect(page.url()).not.toContain("q=");
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), queueSearchStorageKey)).toBe("Queue private E2E");

  await page.goto(`/queue?modalityId=${modalityId}`);
  await page.getByPlaceholder("Name, accession, phone, ID...").fill("");
  const patient = page.getByRole("button", { name: "E2E Queue Patient", exact: true }).first();
  await expect(patient).toBeVisible();
  await patient.click();
  await expect(page).toHaveURL(/\/queue\?modalityId=\d+&patientId=\d+/);
  const drawerUrl = page.url();
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(drawerUrl);
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/queue\\?modalityId=${modalityId}$`));
  await expect(page.getByTestId("patient-drawer-backdrop")).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(drawerUrl);
  await expect(page.getByTestId("patient-drawer-backdrop")).toBeVisible();
});

test("Worklist Monitor preserves tab, filters, reload, and private search", async ({ page }) => {
  await signInWithSession(page, "e2e_super_admin");
  const today = e2eTodayInTripoli();
  const modalityId = await e2eModalityId(page);
  const dateFrom = addDays(today, 1);
  const dateTo = addDays(today, 2);
  const url = `/worklist-monitor?tab=sante&dateFrom=${dateFrom}&dateTo=${dateTo}&modalityId=${modalityId}&status=waiting_for_queue`;

  await page.goto(url);
  await expect(page.getByRole("heading", { name: "MWL Monitor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sante HL7 Worklist" })).toHaveClass(/border-blue-600/);
  await expect(page.locator("input[type='date']").nth(0)).toHaveValue(dateFrom);
  await expect(page.locator("input[type='date']").nth(1)).toHaveValue(dateTo);
  await expect(page.locator("select").nth(0)).toHaveValue(modalityId);
  await expect(page.locator("select").nth(1)).toHaveValue("waiting_for_queue");
  await page.locator("input[placeholder='Accession, ID, name']").fill("Monitor private E2E");
  expect(page.url()).not.toContain("q=");
  expect(page.url()).not.toContain("Monitor%20private");
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), worklistSearchStorageKey)).toBe("Monitor private E2E");
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.locator("input[placeholder='Accession, ID, name']")).toHaveValue("Monitor private E2E");
});

test("Statistics preserves date/modality state and quick-range URL navigation", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  const today = e2eTodayInTripoli();
  const modalityId = await e2eModalityId(page);
  const url = `/statistics?dateFrom=${addDays(today, -2)}&dateTo=${today}&modalityId=${modalityId}`;

  await page.goto(url);
  await expect(page.getByRole("heading", { name: /Statistics/ })).toBeVisible();
  await expect(page).toHaveURL(url);
  await page.reload();
  await expect(page).toHaveURL(url);
  const last7 = page.getByRole("button", { name: /Last 7/i });
  await expect(last7).toBeVisible();
  await last7.click();
  await expect(page).toHaveURL(/\/statistics\?dateFrom=\d{4}-\d{2}-\d{2}&dateTo=\d{4}-\d{2}-\d{2}&modalityId=\d+/);
  expect(page.url()).not.toContain("quickRange");
});

test("Comparisons keeps kind/status URL state and applied search private", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  const url = "/comparisons?kind=ir&irStatus=ready_for_review";

  await page.goto(url);
  await expect(page.getByRole("main").nth(1)).toContainText(/Review Requests|Comparisons|IR consultations/i);
  await expect(page).toHaveURL(url);
  const search = page.locator("input[placeholder='Patient, MRN, accession, exam, or procedure']");
  await search.fill("Comparisons private E2E");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  expect(page.url()).not.toContain("Comparisons%20private");
  expect(page.url()).not.toContain("q=");
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), comparisonsSearchStorageKey)).toBe("Comparisons private E2E");
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.locator("input[placeholder='Patient, MRN, accession, exam, or procedure']")).toHaveValue("Comparisons private E2E");
});

test("Doctor Protocoling and Library preserve configured navigation and appointment history", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/doctor/protocols?modality=CT&protocolStatus=ALL&waitingFirst=true");
  await expect(page.getByRole("heading", { name: "Protocoling Worklist" })).toBeVisible();
  await page.getByLabel("Search protocoling appointments").fill("E2E Acquisition Patient");
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), protocolingSearchStorageKey)).toBe("E2E Acquisition Patient");
  expect(page.url()).not.toContain("E2E%20Acquisition");
  const row = page.getByRole("row", { name: /E2E Acquisition Patient/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Assign|Change/ }).click();
  await expect(page).toHaveURL(/\/doctor\/protocols\?modality=CT&protocolStatus=ALL&waitingFirst=true&appointmentId=\d+/);
  const appointmentUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(appointmentUrl);
  await expect(page.getByRole("dialog", { name: /Assign protocol|Change assigned protocol/i })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("http://127.0.0.1:5173/doctor/protocols?modality=CT&protocolStatus=ALL&waitingFirst=true");
  await page.goForward();
  await expect(page).toHaveURL(appointmentUrl);
  await page.getByRole("button", { name: "Close" }).last().click();
  await page.getByRole("button", { name: "Protocol Library" }).click();
  await expect(page).toHaveURL(/\/doctor\/protocols\?area=library/);
  await page.getByRole("button", { name: "Library setup" }).click();
  await page.getByRole("button", { name: "MRI sequence presets" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/doctor/protocols?area=library&section=mriSequences");
  await page.reload();
  await expect(page.getByRole("button", { name: "MRI sequence presets" })).toHaveAttribute("style", /accent/);
});

test("Cross-module sidebar re-entry restores Queue and Statistics without exposing private search", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  const modalityId = await e2eModalityId(page);
  const queueUrl = `/queue?view=entered&modalityId=${modalityId}`;
  await page.goto(queueUrl);
  await page.getByPlaceholder("Name, accession, phone, ID...").fill("Cross-module private E2E");
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await expect(page).toHaveURL(/\/patients$/);
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await expect(page).toHaveURL(queueUrl);
  expect(page.url()).not.toContain("Cross-module%20private");
  await page.goto(`/statistics?dateFrom=${addDays(e2eTodayInTripoli(), -1)}&dateTo=${e2eTodayInTripoli()}&modalityId=${modalityId}`);
  await clickSidebarGroup(page, "Reporting");
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await expect(page).toHaveURL(/\/patients$/);
  const menu = page.locator("nav[aria-label='Menu']");
  const statistics = menu.getByRole("button", { name: "Statistics", exact: true });
  if (!(await statistics.isVisible())) await menu.getByRole("button", { name: "Reporting", exact: true }).click();
  await expect(statistics).toBeVisible();
  await statistics.dispatchEvent("click");
  await expect(page).toHaveURL(/\/statistics\?dateFrom=.*&dateTo=.*&modalityId=/);
});
