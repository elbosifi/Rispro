import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test("reception creates a capacity-compliant appointment through the real scheduling UI", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  await page.goto("/appointments");

  await page.getByPlaceholder(/search.*patient/i).fill("E2E Similar One");
  await page.getByRole("button", { name: /e2e similar one/i }).click();
  await page.getByLabel(/modality/i).selectOption({ label: /e2e ct/i });
  await page.getByLabel(/exam type/i).selectOption({ label: /e2e ct head/i });

  const availableSlot = page.getByRole("button", { name: /\d{4}-\d{2}-\d{2} available/i }).first();
  await expect(availableSlot).toBeVisible();
  await availableSlot.click();
  await page.getByRole("button", { name: /^create appointment$/i }).click();

  await expect(page.getByText(/appointment created|appointment successful/i)).toBeVisible();
  await expect(page.getByText("E2E Similar One")).toBeVisible();
  await page.getByRole("button", { name: /print view|view details/i }).click();
  await expect(page).toHaveURL(/\/print\//);
});
