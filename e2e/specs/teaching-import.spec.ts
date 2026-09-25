import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test("Teaching author imports a reviewed JSON batch from the isolated application shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/teaching/login");
  await expect(page).toHaveURL(/\/teaching\/dashboard$/);
  await expect(page.getByText("Teaching workspace initialized.")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1440);

  await page.getByRole("link", { name: "Question Bank Import" }).click();
  await expect(page).toHaveURL(/\/teaching\/admin\/import$/);
  await expect(page.getByRole("heading", { name: "Question Bank Import" })).toBeVisible();
  const templateDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download AI Template" }).click();
  const templateDownload = await templateDownloadPromise;
  expect(templateDownload.suggestedFilename()).toBe("rispro-teaching-qbank-template-v1.json");

  const templateResponse = await page.request.get("http://127.0.0.1:3100/api/teaching/qbank/import/template.json");
  expect(templateResponse.ok()).toBeTruthy();
  const template = await templateResponse.json() as { _schemaExamples: { single_best_answer: Record<string, unknown> } };
  const question = structuredClone(template._schemaExamples.single_best_answer);
  const externalId = `E2E-IMPORT-${Date.now()}`;
  question.externalId = externalId;
  question.stem = "Synthetic E2E import question. No patient information.";
  const payload = { schemaVersion: "1.0", questions: [question] };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Import" }).click();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.locator("#teaching-import-file").setInputFiles({
    name: "teaching-import.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await page.getByRole("button", { name: "Inspect upload" }).click();
  await expect(page.getByText("Structure valid")).toBeVisible();
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByRole("heading", { name: "3. Preview import" })).toBeVisible();
  await expect(page.getByText(externalId)).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);

  await page.getByRole("button", { name: "Import 1 Draft Questions" }).first().click();
  await expect(page.getByText("1 questions imported as Draft.")).toBeVisible();
  const administrationResponse = await page.request.get(`http://127.0.0.1:3100/api/teaching/admin/questions?search=${encodeURIComponent(externalId)}&status=draft`);
  expect(administrationResponse.ok()).toBeTruthy();
  const administration = await administrationResponse.json() as {
    items: Array<{ externalId: string; revision: { revisionNumber: number; status: string } }>;
  };
  const importedQuestion = administration.items.find((item) => item.externalId === externalId);
  expect(importedQuestion).toMatchObject({ revision: { revisionNumber: 1, status: "draft" } });
  await page.getByRole("button", { name: "Sign out of Teaching" }).click();
  await expect(page).toHaveURL(/\/teaching\/login$/);
  await expect(page.getByRole("heading", { name: "RISpro Teaching" })).toBeVisible();
});

test("Teaching import shows actionable errors and blocks confirmation for invalid catalog values", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/teaching/admin/import");

  const templateResponse = await page.request.get("http://127.0.0.1:3100/api/teaching/qbank/import/template.json");
  expect(templateResponse.ok()).toBeTruthy();
  const template = await templateResponse.json() as { _schemaExamples: { single_best_answer: Record<string, unknown> } };
  const question = structuredClone(template._schemaExamples.single_best_answer);
  const classification = question.classification as Record<string, unknown>;
  classification.specialty = "invented_specialty";
  const payload = { schemaVersion: "1.0", questions: [question] };

  await page.locator("#teaching-import-file").setInputFiles({
    name: "invalid-teaching-import.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await page.getByRole("button", { name: "Inspect upload" }).click();
  await expect(page.getByText("Structure valid")).toBeVisible();
  await page.getByRole("button", { name: "Validate and preview" }).click();
  const validationErrors = page.getByRole("alert").filter({ hasText: "Errors · import blocked" });
  await expect(validationErrors.getByText(/Unknown or inactive specialty/)).toBeVisible();
  const confirmButtons = page.getByRole("button", { name: /Import .* Draft Questions/ });
  await expect(confirmButtons).toHaveCount(2);
  await expect(confirmButtons.first()).toBeDisabled();
  await expect(confirmButtons.nth(1)).toBeDisabled();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
