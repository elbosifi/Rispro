import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "../helpers/auth";

test("Teaching login, workspace entry, responsive shell, and shared logout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));
  await page.goto("/teaching/login");

  await expect(page.getByRole("heading", { name: "RISpro Teaching" })).toBeVisible();
  await expect(page.getByText("Question Bank and Residency Education")).toBeVisible();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1440);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "RISpro Teaching" })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);

  await page.getByLabel("Username").fill("e2e_doctor");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/teaching\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Question Bank" })).toBeVisible();
  await expect(page.getByText(/Current cycle: \d+ \/ \d+ questions/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Teaching navigation" }).first()).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/doctor/dashboard");
  await expect(page.getByRole("banner")).toContainText("Doctor Workspace");
  await page.getByRole("button", { name: "Switch workspace: Doctor Workspace" }).click();
  await page.getByRole("menuitem", { name: "Teaching" }).click();
  await expect(page).toHaveURL(/\/teaching\/dashboard$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Question Bank" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out of Teaching" }).click();
  await expect(page).toHaveURL(/\/teaching\/login$/);
  await expect(page.getByRole("heading", { name: "RISpro Teaching" })).toBeVisible();

  await page.goto("/teaching/dashboard");
  await expect(page).toHaveURL(/\/teaching\/login$/);
});
