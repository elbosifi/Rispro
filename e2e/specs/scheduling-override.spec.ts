import { expect, type Page, test } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";
import { e2eTomorrowInTripoli } from "../helpers/fixtures";

async function createDirectedCapacityRequest(page: Page, patientName: string, nationalId: string, screenshot: (name: string) => Promise<unknown>) {
  const fullFixtureDate = e2eTomorrowInTripoli();
  await page.goto("/appointments");
  await page.getByPlaceholder(/Search patient by name, national ID, or MRN/).fill(patientName);
  await page.getByRole("button", { name: new RegExp(patientName, "i") }).click();
  await page.getByRole("textbox", { name: /enter complete national id/i }).fill(nationalId);
  await page.getByRole("button", { name: "Verify and select" }).click();
  const modalitySelect = page.getByTestId("appointment-form-region").getByLabel("Modality", { exact: true });
  const modalityValue = await modalitySelect.locator("option").filter({ hasText: "E2E CT" }).getAttribute("value");
  await modalitySelect.selectOption(modalityValue ?? "");
  await page.getByRole("button", { name: "Acknowledge and continue" }).click();
  const examTypeSelect = page.getByTestId("appointment-form-region").getByLabel("Exam Type", { exact: true });
  const examTypeValue = await examTypeSelect.locator("option").filter({ hasText: "E2E CT Head" }).getAttribute("value");
  await examTypeSelect.selectOption(examTypeValue ?? "");
  await page.getByLabel(/start date/i).fill(fullFixtureDate);
  await page.getByRole("button", { name: "Show full days" }).click();
  await page.getByRole("button", { name: new RegExp(`${fullFixtureDate} full`, "i") }).click();
  await page.getByRole("button", { name: "Request override approval" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Request override approval" })).toBeVisible();
  const selector = dialog.getByLabel(/Request approval from/);
  await expect(selector).toBeVisible();
  await expect(dialog.getByRole("button", { name: /submit request/i })).toBeDisabled();
  await screenshot("directed-overbooking-before-select.png");
  await expect(selector.locator("option")).toContainText(["Select supervising doctor", "Dr E2E", "Dr E2E Other", "Dr E2E Supervisor"]);
  await expect(selector).not.toContainText(/any doctor/i);
  await screenshot("directed-overbooking-selector.png");
  await dialog.getByLabel("Requester reason").fill("Synthetic E2E directed capacity exception requiring clinical review.");
  await selector.selectOption({ label: "Dr E2E" });
  const selectedUserId = await selector.inputValue();
  const createRequest = page.waitForRequest((request) => request.method() === "POST" && /\/v2\/scheduling-override-requests$/.test(new URL(request.url()).pathname));
  await dialog.getByRole("button", { name: /submit request/i }).click();
  const request = await createRequest;
  expect(request.postDataJSON()).toMatchObject({ requestedApproverUserId: Number(selectedUserId) });
  await expect(page.getByText(/submitted|pending/i).first()).toBeVisible();
  await screenshot("directed-overbooking-submitted.png");
}

test("reception directs a capacity override to one doctor, and only that doctor can approve it", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const receptionContext = await browser.newContext();
  const reception = await receptionContext.newPage();
  const screenshot = (name: string) => reception.screenshot({ path: testInfo.outputPath(name), fullPage: true });

  await signInWithSession(reception, "e2e_reception");
  await createDirectedCapacityRequest(reception, "E2E Similar Patient Two", "100000000002", screenshot);

  const otherContext = await browser.newContext();
  const otherDoctor = await otherContext.newPage();
  await signInWithSession(otherDoctor, "e2e_doctor_other");
  await otherDoctor.goto("/doctor");
  await otherDoctor.getByRole("button", { name: /override/i }).click();
  await expect(otherDoctor.getByText("E2E Similar Patient Two")).not.toBeVisible();
  await expect(otherDoctor.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(otherDoctor.getByRole("button", { name: "Reject" })).toHaveCount(0);

  const selectedContext = await browser.newContext();
  const selectedDoctor = await selectedContext.newPage();
  const selectedScreenshot = (name: string) => selectedDoctor.screenshot({ path: testInfo.outputPath(name), fullPage: true });
  await signInWithSession(selectedDoctor, "e2e_doctor");
  await selectedDoctor.goto("/doctor");
  await selectedDoctor.getByRole("button", { name: /override/i }).click();
  await expect(selectedDoctor.getByText("E2E Similar Patient Two")).toBeVisible();
  await expect(selectedDoctor.getByText("E2E CT", { exact: true })).toBeVisible();
  await expect(selectedDoctor.getByText("E2E CT Head", { exact: true })).toBeVisible();
  await expect(selectedDoctor.getByText(/Current capacity:/)).toBeVisible();
  await expect(selectedDoctor.getByText(/After approval:/)).toBeVisible();
  await expect(selectedDoctor.getByText(/Overbook:/)).toBeVisible();
  await expect(selectedDoctor.getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(selectedDoctor.getByRole("button", { name: "Reject" })).toBeVisible();
  await selectedScreenshot("directed-overbooking-selected-doctor-before-approval.png");
  await selectedDoctor.getByPlaceholder("Approval note required").fill("Clinically appropriate E2E capacity exception.");
  await selectedDoctor.getByRole("button", { name: "Approve" }).click();
  await expect(selectedDoctor.getByText("No override requests found.")).toBeVisible();
  await expect(selectedDoctor.locator('input[autocomplete="current-password"]')).toHaveCount(0);
  await selectedScreenshot("directed-overbooking-selected-doctor-after-approval.png");

  await selectedContext.close();
  await otherContext.close();
  await receptionContext.close();
});

test("supervisor must direct a capacity override request to one doctor", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await signInWithSession(page, "e2e_supervisor");
  await createDirectedCapacityRequest(
    page,
    "E2E Similar Patient One",
    "100000000001",
    (name) => page.screenshot({ path: testInfo.outputPath(name), fullPage: true })
  );
});

test("Super Admin retains direct override while also being able to request named-doctor approval", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await signInWithSession(page, "e2e_super_admin");
  await page.goto("/appointments");
  await page.getByPlaceholder(/Search patient by name, national ID, or MRN/).fill("E2E Similar Patient Two");
  await page.getByRole("button", { name: /E2E Similar Patient Two/i }).click();
  await page.getByRole("textbox", { name: /enter complete national id/i }).fill("100000000002");
  await page.getByRole("button", { name: "Verify and select" }).click();
  const modalitySelect = page.getByTestId("appointment-form-region").getByLabel("Modality", { exact: true });
  await modalitySelect.selectOption(await modalitySelect.locator("option").filter({ hasText: "E2E CT" }).getAttribute("value") ?? "");
  await page.getByRole("button", { name: "Acknowledge and continue" }).click();
  const examTypeSelect = page.getByTestId("appointment-form-region").getByLabel("Exam Type", { exact: true });
  await examTypeSelect.selectOption(await examTypeSelect.locator("option").filter({ hasText: "E2E CT Head" }).getAttribute("value") ?? "");
  const fullFixtureDate = e2eTomorrowInTripoli();
  await page.getByLabel(/start date/i).fill(fullFixtureDate);
  await page.getByRole("button", { name: "Show full days" }).click();
  await page.getByRole("button", { name: new RegExp(`${fullFixtureDate} full`, "i") }).click();

  await page.getByLabel("Capacity Resolution Action").selectOption("total_capacity_override");
  await expect(page.getByRole("button", { name: "Create Appointment" })).toBeEnabled();
  await page.getByRole("button", { name: "Create Appointment" }).click();
  await expect(page.getByText("Supervisor Override Required")).toBeVisible();
  await page.getByPlaceholder("Override Reason").fill("Synthetic Super Admin direct capacity override.");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('input[autocomplete="current-password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/appointment created|appointment successful/i)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("super-admin-direct-overbooking.png"), fullPage: true });

  await page.goto("/appointments");
  await page.getByPlaceholder(/Search patient by name, national ID, or MRN/).fill("E2E Similar Patient One");
  await page.getByRole("button", { name: /E2E Similar Patient One/i }).click();
  await page.getByRole("textbox", { name: /enter complete national id/i }).fill("100000000001");
  await page.getByRole("button", { name: "Verify and select" }).click();
  const deferredModality = page.getByTestId("appointment-form-region").getByLabel("Modality", { exact: true });
  await deferredModality.selectOption(await deferredModality.locator("option").filter({ hasText: "E2E CT" }).getAttribute("value") ?? "");
  await page.getByRole("button", { name: "Acknowledge and continue" }).click();
  const deferredExam = page.getByTestId("appointment-form-region").getByLabel("Exam Type", { exact: true });
  await deferredExam.selectOption(await deferredExam.locator("option").filter({ hasText: "E2E CT Head" }).getAttribute("value") ?? "");
  await page.getByLabel(/start date/i).fill(fullFixtureDate);
  await page.getByRole("button", { name: "Show full days" }).click();
  await page.getByRole("button", { name: new RegExp(`${fullFixtureDate} full`, "i") }).click();
  await page.getByRole("button", { name: "Request override approval" }).click();
  const dialog = page.getByRole("dialog");
  const selector = dialog.getByLabel(/Request approval from/);
  await expect(selector).toBeVisible();
  await expect(dialog.getByRole("button", { name: /submit request/i })).toBeDisabled();
  await selector.selectOption({ label: "Dr E2E" });
  await expect(dialog.getByText("Approval will be requested from Dr E2E.")).toBeVisible();
  await dialog.getByLabel("Requester reason").fill("Synthetic Super Admin directed capacity exception.");
  const createRequest = page.waitForRequest((request) => request.method() === "POST" && /\/v2\/scheduling-override-requests$/.test(new URL(request.url()).pathname));
  await dialog.getByRole("button", { name: /submit request/i }).click();
  const request = await createRequest;
  expect(request.postDataJSON()).toMatchObject({ requestedApproverUserId: Number(await selector.inputValue()) });
  await expect(page.getByText(/submitted|pending/i).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("super-admin-directed-overbooking.png"), fullPage: true });
});

test("Super Admin sees and decides a request that remains directed to its original doctor", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const receptionContext = await browser.newContext();
  const reception = await receptionContext.newPage();
  const screenshot = (name: string) => reception.screenshot({ path: testInfo.outputPath(name), fullPage: true });
  await signInWithSession(reception, "e2e_reception");
  await createDirectedCapacityRequest(reception, "E2E Similar Patient One", "100000000001", screenshot);

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signInWithSession(admin, "e2e_super_admin");
  await admin.goto("/dashboard");
  await admin.getByRole("button", { name: /override/i }).click();
  await expect(admin.getByText("E2E Similar Patient One")).toBeVisible();
  await expect(admin.getByText("Requested doctor").first()).toBeVisible();
  await expect(admin.getByText("E2E Doctor", { exact: true }).first()).toBeVisible();
  await admin.getByRole("button", { name: "Reject" }).click();
  await admin.getByPlaceholder(/rejection reason/i).fill("E2E Super Admin rejection of directed exception.");
  await admin.getByRole("button", { name: "Confirm rejection" }).click();
  await admin.locator('input[autocomplete="current-password"]').fill(E2E_PASSWORD);
  await admin.getByRole("button", { name: "Verify" }).click();
  await expect(admin.getByText("No override requests found.")).toBeVisible();
  await admin.getByLabel("Override request status filter").selectOption("");
  await expect(admin.getByText("E2E Similar Patient One")).toBeVisible();
  await expect(admin.getByText("Requested doctor").first()).toBeVisible();
  await expect(admin.getByText("E2E Doctor", { exact: true }).first()).toBeVisible();

  await adminContext.close();
  await receptionContext.close();
});
