import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test("Teaching faculty validates and publishes eligible questions from an import batch", async ({ page }, testInfo) => {
  const desktopWidth = 1440;
  const mobileWidth = 390;
  const marker = `E2E-BULK-${Date.now()}`;
  const externalIds = Array.from({ length: 10 }, (_, index) => `${marker}-${String(index + 1).padStart(2, "0")}`);

  await page.setViewportSize({ width: desktopWidth, height: 960 });
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/teaching/admin/import");

  const templateResponse = await page.request.get("http://127.0.0.1:3100/api/teaching/qbank/import/template.json");
  expect(templateResponse.ok()).toBeTruthy();
  const template = await templateResponse.json() as { _schemaExamples: { single_best_answer: Record<string, unknown> } };
  const example = template._schemaExamples.single_best_answer;
  const questions = externalIds.map((externalId, index) => {
    const question = structuredClone(example);
    question.externalId = externalId;
    question.stem = `Synthetic bulk publication question ${externalId}.`;
    if (index === 8) {
      question.source = null;
      question.provenance = null;
      question.references = [];
    }
    return question;
  });

  await page.locator("#teaching-import-file").setInputFiles({
    name: "teaching-bulk-publication.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: "1.0", questions })),
  });
  const inspectResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/teaching/qbank/import/inspect" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Inspect upload" }).click();
  const inspectResponse = await inspectResponsePromise;
  expect(inspectResponse.ok()).toBeTruthy();
  const inspection = await inspectResponse.json() as { batchId: string };
  await expect(page.getByText("Structure valid")).toBeVisible();
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByRole("heading", { name: "3. Preview import" })).toBeVisible();
  await expect(page.getByText(externalIds[0]!, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import 10 Draft Questions" }).first().click();
  await expect(page.getByText("10 questions imported as Draft.")).toBeVisible();

  const listResponse = await page.request.get(
    `http://127.0.0.1:3100/api/teaching/admin/questions?search=${encodeURIComponent(externalIds[9]!)}&status=draft`,
  );
  expect(listResponse.ok()).toBeTruthy();
  const questionList = await listResponse.json() as { items: Array<{ id: number; externalId: string }> };
  const invalidCandidate = questionList.items.find((item) => item.externalId === externalIds[9]);
  expect(invalidCandidate).toBeDefined();

  await page.goto(`/teaching/admin/questions/${invalidCandidate!.id}`);
  await expect(page.getByLabel("Question type")).toHaveValue("single_best_answer");
  await page.getByLabel("Question type").selectOption("image_based_sba");
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Teaching question updated.")).toBeVisible();
  await page.getByRole("link", { name: "Open import batch" }).click();
  await expect(page).toHaveURL(new RegExp(`/teaching/admin/import/batches/${inspection.batchId}$`));
  await expect(page.getByRole("heading", { name: "Import batch" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("teaching-bulk-batch-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: mobileWidth, height: 844 });
  await page.getByRole("button", { name: "Validate All" }).click();
  await expect(page.getByRole("button", { name: "Valid (8)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Warnings (1)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invalid (1)" })).toBeVisible();
  const invalidRow = page.getByRole("row").filter({ hasText: externalIds[9]! });
  await expect(invalidRow).toContainText(/image-based question requires at least one image asset/i);
  await expect(invalidRow.getByRole("link", { name: "Edit" })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", mobileWidth);
  await page.screenshot({ path: testInfo.outputPath("teaching-bulk-batch-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: "Publish All Eligible (9)" }).click();
  const confirmation = page.getByRole("dialog", { name: "Publish imported questions?" });
  await expect(confirmation).toContainText("9 questions are eligible for publication.");
  await expect(confirmation).toContainText("1 question contains validation errors and will remain Draft.");
  await expect(confirmation.getByText("View warnings")).toBeVisible();
  const firstPublishPromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(`/qbank/import/batches/${inspection.batchId}/publish`) && response.request().method() === "POST",
  );
  await confirmation.getByRole("button", { name: "Publish 9 questions" }).click();
  const firstPublish = await firstPublishPromise;
  expect(firstPublish.ok()).toBeTruthy();
  const firstPublishResult = await firstPublish.json() as { published: number; invalid: number; warnings: number };
  expect(firstPublishResult).toMatchObject({ published: 9, invalid: 1, warnings: 1 });
  await expect(page.getByRole("button", { name: "Published (9)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Draft (1)" })).toBeVisible();

  await page.getByRole("button", { name: "Invalid (1)" }).click();
  await invalidRow.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByLabel("Question type")).toHaveValue("image_based_sba");
  await page.getByLabel("Question type").selectOption("single_best_answer");
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Teaching question updated.")).toBeVisible();
  await page.getByRole("link", { name: "Open import batch" }).click();

  await page.getByRole("button", { name: "Validate All" }).click();
  await expect(page.getByRole("button", { name: "Invalid (0)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish All Eligible (1)" })).toBeVisible();
  await page.getByRole("button", { name: "Publish All Eligible (1)" }).click();
  const finalConfirmation = page.getByRole("dialog", { name: "Publish imported questions?" });
  await finalConfirmation.getByRole("button", { name: "Publish 1 question" }).click();
  await expect(page.getByRole("button", { name: "Published (10)" })).toBeVisible();

  const batchResponse = await page.request.get(`http://127.0.0.1:3100/api/teaching/qbank/import/batches/${inspection.batchId}`);
  expect(batchResponse.ok()).toBeTruthy();
  const batch = await batchResponse.json() as { publication: { total: number; draft: number; published: number } };
  expect(batch.publication).toMatchObject({ total: 10, draft: 0, published: 10 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", mobileWidth);
});
