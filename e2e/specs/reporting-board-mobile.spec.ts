import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

const personalDeskPath = "/reporting/worklist/e2e-mobile-reporting-token";
const personalWorkflowTabs = (page: Parameters<typeof signInWithSession>[0]) => page.getByRole("region", { name: "Personal workflow tabs" });
const personalWorkflowTab = (page: Parameters<typeof signInWithSession>[0], name: string) => personalWorkflowTabs(page).getByRole("button", { name: new RegExp(`^${name} `) });

async function openAuthenticatedPersonalDesk(page: Parameters<typeof signInWithSession>[0]) {
  await signInWithSession(page, "e2e_doctor");
  await page.goto(personalDeskPath);
  await expect(page.getByText("Personal Reporting Desk")).toBeVisible();
}

test("public personal reporting desk renders the responsive personal workflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reporting/worklist/e2e-mobile-reporting-token");
  await expect(page.getByText("Personal Reporting Desk")).toBeVisible();
  await expect(personalWorkflowTab(page, "My Cases")).toBeVisible();
  await expect(personalWorkflowTab(page, "Available")).toBeVisible();
  await expect(personalWorkflowTab(page, "Urgent")).toBeVisible();
  await expect(personalWorkflowTab(page, "Overdue")).toBeVisible();
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByLabel("Modality").locator("option")).toHaveText(["All modalities", "E2E_CT"]);
  await expect(page.getByLabel("Category").locator("option")).toHaveText(["All categories", "Oncology", "Non-oncology"]);
  await expect(page.getByRole("option", { name: "All priorities", exact: true })).toHaveText("All priorities");
  const sort = page.getByLabel("Sort");
  await sort.selectOption("newest_study");
  await expect(sort).toHaveValue("newest_study");
  await page.getByRole("button", { name: "Done" }).click();
  await personalWorkflowTab(page, "Available").click();
  await expect(page.getByText("E2E Reporting Patient")).toBeVisible();
  await expect(page.getByText("E2E CT")).toBeVisible();
  await expect(page.getByText("Sign in to enable notifications")).toBeVisible();
  await expect(page.getByText("Reassign case", { exact: true })).not.toBeVisible();
});

test("public personal reporting desk keeps the same workflow on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reporting/worklist/e2e-mobile-reporting-token");
  await personalWorkflowTab(page, "Available").click();
  await expect(page.getByText("Personal Reporting Desk")).toBeVisible();
  await expect(page.getByText("E2E Reporting Patient")).toBeVisible();
});

test("authenticated personal reporting desk shows the doctor identity and personal tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAuthenticatedPersonalDesk(page);

  await expect(page.getByRole("button", { name: "e2e_doctor" })).toBeVisible();
  await expect(page.getByText("Sign in to enable notifications")).not.toBeVisible();
  for (const tab of ["My Cases", "Available", "Urgent", "Overdue"]) {
    await expect(personalWorkflowTab(page, tab)).toBeVisible();
  }
});

test("authenticated personal reporting desk keeps personal tab semantics on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAuthenticatedPersonalDesk(page);

  await expect(page.getByText("E2E Reporting Assigned")).toBeVisible();
  await expect(page.getByText("E2E Reporting Overdue")).toBeVisible();
  await expect(page.getByText("E2E Reporting Available")).not.toBeVisible();

  await personalWorkflowTab(page, "Available").click();
  await expect(page.getByText("E2E Reporting Available")).toBeVisible();
  await expect(page.getByText("E2E Reporting Urgent")).toBeVisible();
  await expect(page.getByText("E2E Reporting Assigned")).not.toBeVisible();

  await personalWorkflowTab(page, "Urgent").click();
  await expect(page.getByText("E2E Reporting Urgent")).toBeVisible();
  await expect(page.getByText("E2E Reporting Available")).not.toBeVisible();

  await personalWorkflowTab(page, "Overdue").click();
  await expect(page.getByText("E2E Reporting Overdue")).toBeVisible();
  await expect(page.getByText("E2E Reporting Assigned")).not.toBeVisible();
});

test("authenticated doctor claims an available Personal Desk case through the UI", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAuthenticatedPersonalDesk(page);
  await personalWorkflowTab(page, "Available").click();
  await page.getByRole("button", { name: "Open case details for E2E Reporting Claim" }).click();
  await expect(page.getByRole("button", { name: "Claim case" })).toBeVisible();
  await page.getByRole("button", { name: "Claim case" }).click();
  await expect(page.getByRole("status")).toHaveText("Case claimed. It is now in My Cases.");
  await expect(page.getByText("E2E Reporting Claim")).not.toBeVisible();

  await personalWorkflowTab(page, "My Cases").click();
  await expect(page.getByText("E2E Reporting Claim")).toBeVisible();
});

test("authenticated owner sees personal case details and owner-only additional imaging action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAuthenticatedPersonalDesk(page);
  await page.getByRole("button", { name: "Open case details for E2E Reporting Assigned" }).click();

  const details = page.getByRole("dialog");
  await expect(details.getByText("MRN:")).toBeVisible();
  await expect(details.getByText("Accession:")).toBeVisible();
  await expect(details.getByRole("region", { name: "Additional imaging" })).toBeVisible();
  await expect(details.getByRole("button", { name: "Request additional imaging" })).toBeVisible();
  await expect(details.getByText("Reassign case", { exact: true })).not.toBeVisible();
  await expect(details.getByRole("button", { name: /Return to pool|Unassign|Reconcile/ })).not.toBeVisible();
});

test("authenticated doctor finalizes an own case and finds it in finalized history", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAuthenticatedPersonalDesk(page);
  await page.getByRole("button", { name: "Open case details for E2E Reporting Finalize" }).click();
  await expect(page.getByRole("button", { name: "Finalize report" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Finalize report" }).click();
  await expect(page.getByRole("status")).toHaveText("Report finalized under your account.");
  await expect(page.getByText("E2E Reporting Finalize")).not.toBeVisible();

  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Report state").selectOption("final");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("E2E Reporting Finalize")).toBeVisible();
});

test("authenticated mobile Patient History returns to the same case details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAuthenticatedPersonalDesk(page);
  await page.getByRole("button", { name: "Open case details for E2E Reporting Assigned" }).click();
  const details = page.getByRole("dialog");
  await expect(details.getByText("E2E Reporting Assigned")).toBeVisible();
  await details.getByRole("button", { name: "Patient History" }).click();

  const history = page.getByRole("dialog");
  await expect(history.getByRole("heading", { name: "Patient History" })).toBeVisible();
  const historyBounds = await history.boundingBox();
  expect(historyBounds?.y).toBe(0);
  expect(historyBounds?.height).toBeGreaterThanOrEqual(800);
  await history.getByRole("button", { name: "Back to case" }).click();
  await expect(page.getByRole("dialog").getByText("E2E Reporting Assigned")).toBeVisible();
});

test("authenticated Personal Desk remains personal on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAuthenticatedPersonalDesk(page);
  await expect(page.getByText("E2E Reporting Assigned")).toBeVisible();
  await page.getByRole("button", { name: "Open case details for E2E Reporting Assigned" }).click();
  const details = page.getByRole("dialog");
  await expect(details.getByText("Assigned doctor:")).toBeVisible();
  await expect(details.getByText("Reassign case", { exact: true })).not.toBeVisible();
});
