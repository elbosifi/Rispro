import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test("reception enters a scheduled patient into today's queue", async ({ page }) => {
  await signInWithSession(page, "e2e_reception");
  await page.goto("/queue");
  await expect(page.getByText("E2E Queue Patient")).toBeVisible();
  await page.getByRole("button", { name: "E2E Queue Patient" }).locator("xpath=ancestor::li").getByRole("button", { name: "Enter to Queue" }).click();
  await expect(page.getByText("Called", { exact: true })).toBeVisible();
  await expect(page.getByText("E2E Queue Patient")).toBeVisible();
});
