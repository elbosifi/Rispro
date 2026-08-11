import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

test("reception login, direct-route protection, and logout use the real session contract", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));
  await page.goto("/login");
  await page.locator('input[autocomplete="username"]').fill("e2e_reception");
  await page.locator('input[autocomplete="current-password"]').fill("wrong password");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByText(/invalid|failed/i)).toBeVisible();

  await page.locator('input[autocomplete="current-password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/(dashboard|patients|appointments|registrations|queue)/);
  await page.goto("/patients");
  await expect(page.getByRole("button", { name: /register patient/i })).toBeVisible();

  await page.goto("/doctor/dashboard");
  await expect(page).not.toHaveURL(/\/doctor\//);
  await page.goto("/settings");
  await expect(page).not.toHaveURL(/\/settings/);

  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/patients");
  await expect(page).toHaveURL(/\/login/);
});

test("similar synthetic patients remain distinguishable and duplicate entry warns before selection", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  await page.goto("/patients");
  await page.getByPlaceholder("Search patients by name, national ID, MRN, or phone...").fill("E2E Similar");
  await expect(page.getByText("E2E Similar Patient One")).toBeVisible();
  await expect(page.getByText("E2E Similar Patient Two")).toBeVisible();
  await expect(page.getByText("0910000001").first()).toBeVisible();
  await expect(page.getByText("0910000002").first()).toBeVisible();

  await page.getByText("E2E Similar Patient Two").first().click();
  await expect(page.getByText("100000000002")).toBeVisible();

  await page.goto("/patients/new");
  await page.getByLabel(/arabic full name/i).fill("اختبار تشابه مريض واحد");
  await page.getByLabel(/national id/i).fill("100000000001");
  await expect(page.getByRole("heading", { name: /possible duplicates/i })).toBeVisible();
  await expect(page.getByText("E2E Similar Patient One")).toBeVisible();
  await expect(page.getByText("100000000001")).toBeVisible();
});
