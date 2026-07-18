import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

async function reauthenticate(page: Page) {
  const response = await page.request.post("http://127.0.0.1:3100/api/auth/re-auth", { data: { password: E2E_PASSWORD } });
  expect(response.ok()).toBeTruthy();
}

test("super admin can open the guarded Backup V3 control center and save an approved local destination", async ({ page }) => {
  await signInWithSession(page, "e2e_super_admin");
  await reauthenticate(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Backup & Restore" }).click();
  await expect(page.getByRole("heading", { name: /automated backup v3 control center/i })).toBeVisible();
  await expect(page.getByText(/does not include the Orthanc PACS image-storage tank/i)).toBeVisible();

  await page.getByText("Protected destination and encryption settings").click();
  await page.getByLabel("Automated destination name").fill(`E2E local ${Date.now()}`);
  await page.getByLabel("Automated local root").fill("storage/backups");
  await page.getByRole("button", { name: "Save destination" }).click();
  await expect(page.getByText(/Destination saved. Test it before relying on a schedule/i)).toBeVisible();
});

test("supervisor can view the Backup V3 control center but cannot open protected destination controls", async ({ page }) => {
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Backup & Restore" }).click();
  await expect(page.getByRole("heading", { name: /automated backup v3 control center/i })).toBeVisible();
  await expect(page.getByText("Protected destination and encryption settings")).toHaveCount(0);
});
