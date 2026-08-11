import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test("reception creates a capacity-compliant appointment through the real scheduling UI", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  await page.goto("/appointments");

  await page.getByPlaceholder(/Search patient by name, national ID, or MRN/).fill("E2E Similar Patient One");
  await page.getByRole("button", { name: /e2e similar patient one/i }).click();
  await expect(page.getByRole("heading", { name: "Verify patient identity" })).toBeVisible();
  await page.getByPlaceholder("Enter identifier").fill("100000000001");
  await page.getByRole("button", { name: "Verify and select" }).click();
  const modalitySelect = page.getByLabel(/modality/i);
  const modalityValue = await modalitySelect.locator("option").filter({ hasText: "E2E CT" }).getAttribute("value");
  await modalitySelect.selectOption(modalityValue ?? "");
  await page.getByRole("button", { name: "Acknowledge and continue" }).click();
  const examTypeSelect = page.getByLabel(/exam type/i);
  const examTypeValue = await examTypeSelect.locator("option").filter({ hasText: "E2E CT Head" }).getAttribute("value");
  await examTypeSelect.selectOption(examTypeValue ?? "");

  const availableSlot = page.getByRole("button", { name: /\d{4}-\d{2}-\d{2} available/i }).first();
  await expect(availableSlot).toBeVisible();
  await availableSlot.click();
  await page.getByRole("button", { name: /^create appointment$/i }).click();

  await expect(page.getByText(/appointment created|appointment successful/i)).toBeVisible();
  await expect(page.getByText("E2E Similar Patient One")).toBeVisible();
  await page.getByRole("button", { name: "Print View" }).click();
  await expect(page).toHaveURL(/\/print\?appointmentId=\d+/);
});
