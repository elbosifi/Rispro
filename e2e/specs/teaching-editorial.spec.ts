import AdmZip from "adm-zip";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { signInWithSession } from "../helpers/auth";

test("Teaching faculty imports, reviews, publishes, and revises an image question", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/teaching/login");
  await expect(page).toHaveURL(/\/teaching\/dashboard$/);
  await page.getByRole("link", { name: "Question Bank Import" }).click();

  const templateResponse = await page.request.get("http://127.0.0.1:3100/api/teaching/qbank/import/template.json");
  expect(templateResponse.ok()).toBeTruthy();
  const template = await templateResponse.json() as { _schemaExamples: { image_based_sba: Record<string, unknown> } };
  const question = structuredClone(template._schemaExamples.image_based_sba);
  const externalId = `E2E-EDITOR-${Date.now()}`;
  const filename = "synthetic-editorial-image.png";
  const media = question.media as Array<Record<string, unknown>>;
  question.externalId = externalId;
  question.stem = "Synthetic editorial question before review.";
  media[0] = { assetKey: `${externalId}-IMAGE-1`, filename, type: "image", altText: "Synthetic image for editorial E2E" };
  const archive = new AdmZip();
  archive.addFile("questions.json", Buffer.from(JSON.stringify({ schemaVersion: "1.0", questions: [question] })));
  archive.addFile(`assets/${filename}`, await sharp({ create: { width: 32, height: 24, channels: 3, background: "#6f93b5" } }).png().toBuffer());

  await page.locator("#teaching-import-file").setInputFiles({ name: "editorial-image.zip", mimeType: "application/zip", buffer: archive.toBuffer() });
  await page.getByRole("button", { name: "Inspect upload" }).click();
  await expect(page.getByText("Structure valid")).toBeVisible();
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByText(externalId)).toBeVisible();
  await page.getByRole("button", { name: "Import 1 Draft Questions" }).first().click();
  await expect(page.getByText("1 questions imported as Draft.")).toBeVisible();

  await page.getByRole("link", { name: "Import" }).click();
  await page.getByRole("link", { name: "Question Bank", exact: true }).click();
  await page.getByLabel(/Search external ID/).fill(externalId);
  await page.getByRole("button", { name: "Search" }).click();
  const protectedImageRequest = page.waitForResponse((response) =>
    new URL(response.url()).pathname.startsWith("/api/teaching/assets/") && response.request().method() === "GET",
  );
  await page.getByRole("link", { name: externalId }).click();
  await expect(page.getByRole("heading", { name: externalId })).toBeVisible();
  await expect(page.getByText("Imported lineage")).toBeVisible();
  await expect(page.getByText("editorial-image.zip")).toBeVisible();
  const image = page.getByRole("img", { name: "Synthetic image for editorial E2E" });
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  expect((await protectedImageRequest).ok()).toBeTruthy();
  expect(await image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1440);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);

  const revisionOneStem = "Synthetic editorial question revised before review.";
  await page.getByLabel("Question stem").fill(revisionOneStem);
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Teaching question updated.")).toBeVisible();
  await page.getByRole("button", { name: "Submit for Review" }).click();
  await expect(page.getByText("in review")).toBeVisible();
  await page.getByRole("button", { name: "Approve Review" }).click();
  await expect(page.getByRole("button", { name: "Publish revision" })).toBeVisible();
  await page.getByRole("button", { name: "Publish revision" }).click();
  await expect(page.getByRole("button", { name: "Create New Revision" })).toBeVisible();
  await expect(page.getByLabel("Question stem")).toBeDisabled();

  await page.getByRole("button", { name: "Create New Revision" }).click();
  await expect(page.getByRole("button", { name: "Save Draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "v2 · draft" })).toBeVisible();
  const revisionTwoStem = "Synthetic editorial question in the next Draft revision.";
  await page.getByLabel("Question stem").fill(revisionTwoStem);
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Teaching question updated.")).toBeVisible();

  await page.getByRole("button", { name: "v1 · published" }).click();
  await expect(page.getByLabel("Question stem")).toHaveValue(revisionOneStem);
  await expect(page.getByLabel("Question stem")).toBeDisabled();
  await page.getByRole("button", { name: "v2 · draft" }).click();
  await expect(page.getByLabel("Question stem")).toHaveValue(revisionTwoStem);
  await expect(page.getByText("Imported lineage")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", { name: "Sign out of Teaching" }).click();
  await expect(page).toHaveURL(/\/teaching\/login$/);
});

test("Teaching learner cannot open editorial routes or create questions", async ({ page }) => {
  await signInWithSession(page, "e2e_doctor");
  const createResponse = await page.request.post("http://127.0.0.1:3100/api/teaching/admin/questions", { data: {} });
  expect(createResponse.status()).toBe(403);

  await page.goto("/teaching/admin/questions");
  await expect(page.getByRole("heading", { name: "Teaching editorial access is required" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New question" })).toHaveCount(0);
});
