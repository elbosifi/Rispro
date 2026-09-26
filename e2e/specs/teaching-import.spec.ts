import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test("Teaching author imports a reviewed JSON batch from the isolated application shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/teaching/login");
  await expect(page).toHaveURL(/\/teaching\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Question Bank" })).toBeVisible();
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
  const exceptionQuestion = structuredClone(question);
  exceptionQuestion.externalId = `${externalId}-EXCEPTION`;
  exceptionQuestion.stem = "Synthetic E2E import exception question. No patient information.";
  const payload = { schemaVersion: "1.0", questions: [question, exceptionQuestion] };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Import", exact: true }).click();
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
  await expect(page.getByText(externalId, { exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);

  const confirmedBatch = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/teaching/qbank/import/confirm" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Import 2 Draft Questions" }).first().click();
  const confirmResponse = await confirmedBatch;
  expect(confirmResponse.ok()).toBeTruthy();
  const batch = await confirmResponse.json() as { batchId: string };
  await expect(page).toHaveURL(`/teaching/admin/import/batches/${batch.batchId}`);
  await expect(page.getByRole("heading", { name: "Import batch" })).toBeVisible();

  const administrationResponse = await page.request.get(`http://127.0.0.1:3100/api/teaching/admin/questions?search=${encodeURIComponent(externalId)}&status=draft`);
  expect(administrationResponse.ok()).toBeTruthy();
  const administration = await administrationResponse.json() as {
    items: Array<{ id: number; externalId: string; revision: { id: number; version: number; revisionNumber: number; status: string } }>;
  };
  const importedQuestion = administration.items.find((item) => item.externalId === `${externalId}-EXCEPTION`);
  expect(importedQuestion).toMatchObject({ revision: { revisionNumber: 1, status: "draft" } });
  const invalidatedQuestion = await page.request.patch(`http://127.0.0.1:3100/api/teaching/admin/questions/${importedQuestion!.id}/revisions/${importedQuestion!.revision.id}`, {
    data: { type: "image_based_sba", expectedVersion: importedQuestion!.revision.version },
  });
  expect(invalidatedQuestion.ok()).toBeTruthy();

  const validationResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/teaching/qbank/import/batches/${batch.batchId}/validate` && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Validate & publish…" }).click();
  expect((await validationResponsePromise).ok()).toBeTruthy();
  const confirmation = page.getByRole("dialog", { name: "Review validation before publishing" });
  await expect(confirmation).toContainText("2 matched.");
  await expect(confirmation).toContainText("1 question is eligible for publication.");
  await expect(confirmation).toContainText("1 invalid and will remain Draft.");
  const publicationResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/teaching/qbank/import/batches/${batch.batchId}/publish` && response.request().method() === "POST",
  );
  await confirmation.getByRole("button", { name: "Publish 1 question" }).click();
  const publicationResponse = await publicationResponsePromise;
  expect(publicationResponse.ok()).toBeTruthy();
  expect(await publicationResponse.json()).toMatchObject({ requested: 2, published: 1, invalid: 1 });
  await expect(page.getByRole("heading", { name: "Questions requiring attention" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveAttribute("href", `/teaching/admin/questions/${importedQuestion!.id}`);
  await expect(page.getByText(/image-based question requires at least one image asset/i)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Import batch" })).toBeVisible();
  await expect(page.getByText("Last validation result")).toBeVisible();
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Import batch").getByRole("link", { name: "Import history" }).click();
  await expect(page).toHaveURL("/teaching/admin/import/history");
  const historyRow = page.getByRole("row", { name: /teaching-import\.json/ });
  await expect(historyRow).toContainText("1 Draft");
  await expect(historyRow).toContainText("1 Published");
  await historyRow.getByRole("link", { name: "Open batch" }).click();
  await expect(page).toHaveURL(`/teaching/admin/import/batches/${batch.batchId}`);
  await expect(page.getByRole("heading", { name: "Import batch" })).toBeVisible();
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
