import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test("Teaching faculty validates and publishes all eligible matching Draft questions", async ({ page }, testInfo) => {
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
  const learnerTag = "oncology";
  const questions = externalIds.map((externalId, index) => {
    const question = structuredClone(example);
    question.externalId = externalId;
    question.stem = `Synthetic bulk publication question ${externalId}.`;
    (question.classification as Record<string, unknown>).tags = [learnerTag];
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
  await inspectResponse.json();
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
  await page.goto(`/teaching/admin/questions?search=${encodeURIComponent(marker)}&status=draft`);
  await expect(page.getByRole("heading", { name: "Question Bank" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("teaching-bulk-matching-desktop.png"), fullPage: true });
  const validatePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/teaching/admin/questions/bulk/validate-matching" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Validate all matching" }).click();
  expect((await validatePromise).ok()).toBeTruthy();
  await expect(page.getByText("Matched 10: 8 valid, 1 with warnings, 1 invalid.")).toBeVisible();

  await page.getByLabel("Status").selectOption("in_review");
  await expect(page.getByRole("button", { name: "Validate & publish all eligible" })).toBeDisabled();
  await page.getByLabel("Status").selectOption("draft");
  const revalidatePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/teaching/admin/questions/bulk/validate-matching" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Validate all matching" }).click();
  expect((await revalidatePromise).ok()).toBeTruthy();
  await expect(page.getByText("Matched 10: 8 valid, 1 with warnings, 1 invalid.")).toBeVisible();

  await page.setViewportSize({ width: mobileWidth, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", mobileWidth);
  await page.screenshot({ path: testInfo.outputPath("teaching-bulk-matching-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Validate & publish all eligible (9)" }).click();
  const confirmation = page.getByRole("dialog", { name: "Publish all eligible matching questions?" });
  await expect(confirmation).toContainText("10 questions match the current filters.");
  await expect(confirmation).toContainText("9 eligible questions will be published.");
  await expect(confirmation).toContainText("1 questions have warnings.");
  await expect(confirmation).toContainText("1 questions contain errors and will remain Draft.");
  const publishPromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/teaching/admin/questions/bulk/validate-publish-matching" && response.request().method() === "POST",
  );
  await confirmation.getByRole("button", { name: "Publish 9 eligible questions" }).click();
  const publishResult = await publishPromise;
  expect(publishResult.ok()).toBeTruthy();
  expect(await publishResult.json()).toMatchObject({ requested: 10, published: 9, invalid: 1, warnings: 1 });
  await expect(page.getByText("10 matched: 9 published, 1 published with warnings, 1 invalid / remain Draft, 0 conflicts, 0 already published.")).toBeVisible();
  await page.getByRole("button", { name: "View questions requiring attention" }).click();
  await expect(page.getByLabel("Questions requiring attention").getByRole("link", { name: externalIds[9]!, exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign out of Teaching" }).click();
  await signInWithSession(page, "e2e_doctor");
  await page.goto("/teaching/qbank");
  await page.getByText("More filters").click();
  await page.getByLabel("Tags").selectOption(learnerTag);
  await expect(page.getByRole("status")).toHaveText("Available questions: 9");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", mobileWidth);
});
