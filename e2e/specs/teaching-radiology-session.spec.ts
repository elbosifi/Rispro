import AdmZip from "adm-zip";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { signInWithSession } from "../helpers/auth";

type TemplateQuestion = Record<string, any>;

async function importRadiologyQuestionSet(page: Page): Promise<{ stems: Record<string, string> }> {
  const templateResponse = await page.request.get("http://127.0.0.1:3100/api/teaching/qbank/import/template.json");
  expect(templateResponse.ok()).toBeTruthy();
  const template = await templateResponse.json() as {
    _catalog: { domains: Array<{ code: string }>; topics: Array<{ code: string; parentCode: string | null }> };
    _schemaExamples: Record<string, TemplateQuestion>;
  };
  const chest = template._catalog.domains.find((item) => item.code === "chest");
  expect(chest).toBeTruthy();
  const chestTopic = template._catalog.topics.find((item) => item.parentCode === "chest");
  const batchMarker = `E2E-RADIOLOGY-${Date.now()}`;
  const stems = {
    plain: `${batchMarker} plain single-best-answer question`,
    single: `${batchMarker} single-image question`,
    multiple: `${batchMarker} multiple-image question`,
    case: `${batchMarker} case-based image question`,
  };
  const questions: TemplateQuestion[] = [
    structuredClone(template._schemaExamples.single_best_answer),
    structuredClone(template._schemaExamples.image_based_sba),
    structuredClone(template._schemaExamples.image_based_sba),
    structuredClone(template._schemaExamples.case_based_sba),
  ];
  const assets: Array<{ filename: string; assetKey: string; altText: string }> = [];
  const filenames = ["single.png", "multiple-1.png", "multiple-2.png", "multiple-3.png", "case.png"];
  const alts = [
    "Synthetic single axial image",
    "Synthetic multiple axial image one",
    "Synthetic multiple axial image two",
    "Synthetic multiple axial image three",
    "Synthetic case image",
  ];
  let assetOffset = 0;
  const externalIds = ["PLAIN", "IMAGE-SINGLE", "IMAGE-MULTI", "CASE-IMAGE"];
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index]!;
    const externalId = `${batchMarker}-${externalIds[index]}`;
    question.externalId = externalId;
    question.stem = stems[(["plain", "single", "multiple", "case"] as const)[index]!];
    const classification = question.classification as Record<string, unknown>;
    classification.specialty = "radiology";
    classification.domain = chest!.code;
    classification.topic = chestTopic?.code ?? null;
    classification.subtopics = [];
    classification.tags = [];

    let imageCount = 0;
    if (index === 1 || index === 3) imageCount = 1;
    if (index === 2) imageCount = 3;
    question.media = Array.from({ length: imageCount }, () => {
      const filename = filenames[assetOffset]!;
      const altText = alts[assetOffset]!;
      const assetKey = `${externalId}-ASSET-${assetOffset + 1}`;
      assetOffset += 1;
      assets.push({ filename, assetKey, altText });
      return { assetKey, filename, type: "image", altText };
    });
    if (index === 3) {
      question.caseId = `${batchMarker}-CASE`;
      question.case = {
        title: "Synthetic chest radiology case",
        clinicalHistory: `Synthetic de-identified educational history. ${"The learner reviews a stable, fictional imaging vignette with no patient details. ".repeat(18)}`,
      };
      const options = question.options as Array<{ id: string; text: string }>;
      options[0]!.text = `Long synthetic option A: ${"This illustrative answer wraps across the available mobile width without changing the meaning of this fictional teaching question. ".repeat(8)}`;
    }
  }

  const archive = new AdmZip();
  archive.addFile("questions.json", Buffer.from(JSON.stringify({ schemaVersion: "1.0", questions })));
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index]!;
    const color = ["#6f93b5", "#789dbe", "#8ba9c3", "#688ba7", "#839fb3"][index]!;
    const image = await sharp({ create: { width: 480, height: 360, channels: 3, background: color } }).png().toBuffer();
    archive.addFile(`assets/${asset.filename}`, image);
  }

  await page.goto("/teaching/admin/import");
  await page.locator("#teaching-import-file").setInputFiles({ name: "synthetic-radiology-session.zip", mimeType: "application/zip", buffer: archive.toBuffer() });
  await page.getByRole("button", { name: "Inspect upload" }).click();
  await expect(page.getByText("Structure valid")).toBeVisible();
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByText(stems.plain)).toBeVisible();
  await page.getByRole("button", { name: "Import 4 Draft Questions" }).first().click();
  await expect(page).toHaveURL(/\/teaching\/admin\/import\/batches\/[0-9a-f-]+$/i);
  await expect(page.getByRole("heading", { name: "Import batch" })).toBeVisible();
  await page.getByRole("button", { name: /Validate & publish/ }).click();
  const validationDialog = page.getByRole("dialog", { name: "Review validation before publishing" });
  await expect(validationDialog.getByText("4 questions are eligible for publication.")).toBeVisible();
  await validationDialog.getByRole("button", { name: "Publish 4 questions" }).click();
  await expect(page.getByRole("heading", { name: "Publication complete" })).toBeVisible();
  await expect(page.getByText(/4 published · 0 published with warnings · 0 require attention/)).toBeVisible();
  return { stems };
}

async function openPosition(page: Page, position: number) {
  await page.getByRole("button", { name: "Questions" }).click();
  const navigator = page.getByRole("dialog", { name: "Question navigator" });
  await navigator.getByRole("button", { name: new RegExp(`^Question ${position},`) }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Question ${position} of 4`) })).toBeVisible();
}

function secondsFromTimer(label: string): number {
  const match = label.match(/(\d+):(\d{2})/);
  expect(match).toBeTruthy();
  return Number(match![1]) * 60 + Number(match![2]);
}

test("Teaching radiology sessions prioritize context, images, and scalable navigation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/teaching/login");
  const fixture = await importRadiologyQuestionSet(page);

  await page.getByRole("button", { name: "Sign out of Teaching" }).click();
  await signInWithSession(page, "e2e_doctor");
  await page.goto("/teaching/qbank");
  await page.getByLabel("Domain").selectOption("chest");
  await page.getByLabel("Question state").selectOption("unseen");
  await page.getByRole("spinbutton", { name: "Number of questions" }).fill("4");
  await expect(page.getByRole("status")).toHaveText("Available questions: 4");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/teaching\/qbank\/session\/\d+$/);
  await expect(page.getByRole("heading", { name: "Question 1 of 4" })).toBeVisible();

  const positionByStem = new Map<string, number>();
  for (let position = 1; position <= 4; position += 1) {
    if (position > 1) await openPosition(page, position);
    const stem = (await page.getByTestId("teaching-question-stem").innerText()).trim();
    positionByStem.set(stem, position);
    if (stem === fixture.stems.plain) {
      await expect(page.getByTestId("teaching-question-images")).toHaveCount(0);
      await expect(page.getByTestId("teaching-clinical-history")).toHaveCount(0);
    } else if (stem === fixture.stems.case) {
      const content = page.getByRole("article", { name: "Question content" });
      const order = await content.evaluate((article) => Array.from(article.children).map((child) => child.getAttribute("data-testid")));
      expect(order).toEqual(["teaching-clinical-history", "teaching-question-images", "teaching-question-stem"]);
      await expect(page.getByText(/Synthetic de-identified educational history/)).toBeVisible();
      await expect(page.getByRole("radio").first().locator("xpath=..")).toContainText("Long synthetic option A");
    } else {
      await expect(page.getByTestId("teaching-question-images")).toBeVisible();
      const content = page.getByRole("article", { name: "Question content" });
      const order = await content.evaluate((article) => Array.from(article.children).map((child) => child.getAttribute("data-testid")));
      expect(order).toEqual(["teaching-question-images", "teaching-question-stem"]);
    }
  }
  expect(positionByStem.size).toBe(4);
  const multiImagePosition = positionByStem.get(fixture.stems.multiple);
  const casePosition = positionByStem.get(fixture.stems.case);
  expect(multiImagePosition).toBeDefined();
  expect(casePosition).toBeDefined();
  await openPosition(page, multiImagePosition!);
  await expect(page.getByText("Image 1 of 3")).toBeVisible();
  const visibleImage = page.getByRole("img", { name: "Synthetic multiple axial image one" });
  await expect(visibleImage).toBeVisible();
  await expect(page.getByTestId("teaching-question-images").getByRole("status")).toHaveCount(0);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1440);
  await page.screenshot({ path: testInfo.outputPath("teaching-radiology-desktop-image.png"), fullPage: true });

  await page.getByRole("button", { name: "Enlarge Synthetic multiple axial image one" }).click();
  const viewer = page.getByRole("dialog", { name: "Teaching image viewer" });
  await expect(viewer.getByText("Image 1 / 3 · Synthetic multiple axial image one")).toBeVisible();
  const viewerImage = viewer.getByRole("img", { name: "Synthetic multiple axial image one" });
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(async () => viewerImage.evaluate((image) => (image as HTMLImageElement).style.transform)).toContain("scale(1.25)");
  const imageBounds = await viewerImage.boundingBox();
  expect(imageBounds).toBeTruthy();
  await page.mouse.move(imageBounds!.x + imageBounds!.width / 2, imageBounds!.y + imageBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(imageBounds!.x + imageBounds!.width / 2 + 32, imageBounds!.y + imageBounds!.height / 2 + 18, { steps: 2 });
  await page.mouse.up();
  await expect.poll(async () => viewerImage.evaluate((image) => (image as HTMLImageElement).style.transform)).toContain("translate(32px, 18px)");
  await viewer.getByRole("button", { name: "Fit image" }).click();
  await expect.poll(async () => viewerImage.evaluate((image) => (image as HTMLImageElement).style.transform)).toContain("translate(0px, 0px) scale(1)");
  await viewer.getByRole("button", { name: "Next", exact: true }).click();
  await expect(viewer.getByText("Image 2 / 3 · Synthetic multiple axial image two")).toBeVisible();
  await viewer.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(viewer.getByText("Image 1 / 3 · Synthetic multiple axial image one")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("teaching-radiology-desktop-viewer.png") });
  await viewer.getByRole("button", { name: "Close image viewer" }).click();
  await expect(page.getByRole("dialog", { name: "Teaching image viewer" })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("teaching-radiology-mobile-image.png"), fullPage: true });
  await openPosition(page, casePosition!);
  await expect(page.getByText(/Synthetic de-identified educational history/)).toBeVisible();
  await expect(page.getByRole("radio").first().locator("xpath=..")).toContainText("Long synthetic option A");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await openPosition(page, multiImagePosition!);
  await page.getByRole("button", { name: "Questions" }).click();
  const mobileNavigator = page.getByRole("dialog", { name: "Question navigator" });
  await expect(mobileNavigator.getByRole("button", { name: new RegExp(`^Question ${multiImagePosition},`) })).toHaveAttribute("aria-current", "step");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("teaching-radiology-mobile-navigator.png") });
  await mobileNavigator.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByRole("heading", { name: "Incorrect" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Teaching point" })).toBeVisible();
  const selectedIncorrectOption = page.getByRole("radio").first().locator("xpath=..");
  const answerStateColors = await selectedIncorrectOption.evaluate((element) => ({
    error: getComputedStyle(element).getPropertyValue("--state-error-bg").trim(),
    success: getComputedStyle(element).getPropertyValue("--state-success-bg").trim(),
  }));
  await expect(selectedIncorrectOption).toHaveCSS("background-color", answerStateColors.error);
  const correctAnswerText = (await page.getByText(/Correct answer:/).textContent())!.split(":").slice(1).join(":").trim();
  const correctOption = page.getByRole("group", { name: "Answer options" }).locator("label").filter({ hasText: correctAnswerText });
  await expect(correctOption).toHaveCSS("background-color", answerStateColors.success);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("heading", { name: "Incorrect" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("teaching-radiology-study-feedback.png") });
  await page.getByRole("button", { name: "Mark question" }).click();
  await expect(page.getByRole("button", { name: "Marked" })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Personal note", { exact: true }).click();
  await page.getByRole("textbox", { name: "Personal note" }).fill("Synthetic private radiology learner note.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Note saved")).toBeVisible();
  await openPosition(page, (multiImagePosition! % 4) + 1);

  await page.goto("/teaching/qbank");
  await page.getByLabel("Domain").selectOption("chest");
  await page.getByLabel("Mode").selectOption("exam");
  await page.getByLabel("Number of questions").fill("4");
  await page.getByRole("checkbox", { name: "Timed exam" }).check();
  await page.getByLabel("Time limit (minutes)").fill("5");
  await page.getByLabel("Question state").selectOption("all");
  await expect(page.getByRole("status")).toHaveText("Available questions: 4");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  const initialSeconds = secondsFromTimer(await page.getByRole("timer").getAttribute("aria-label") ?? "");
  const saveExamAnswer = async () => {
    const response = page.waitForResponse(
      (candidate) => new URL(candidate.url()).pathname.endsWith("/response") && candidate.request().method() === "PUT",
      { timeout: 5000 },
    );
    const answer = page.getByRole("radio").first();
    await answer.check();
    await expect(answer).toBeChecked({ timeout: 2000 });
    expect((await response).ok()).toBeTruthy();
  };
  await saveExamAnswer();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Question 2 of 4" })).toBeVisible();
  await saveExamAnswer();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Question 3 of 4" })).toBeVisible();
  await saveExamAnswer();
  const afterSavesSeconds = secondsFromTimer(await page.getByRole("timer").getAttribute("aria-label") ?? "");
  expect(afterSavesSeconds).toBeLessThanOrEqual(initialSeconds);
  expect(afterSavesSeconds).toBeGreaterThan(initialSeconds - 45);

  await page.getByRole("button", { name: "Questions" }).click();
  const examNavigator = page.getByRole("dialog", { name: "Question navigator" });
  await expect(examNavigator.getByRole("button", { name: "Question 1, answered" })).toBeVisible();
  await expect(examNavigator.getByRole("button", { name: "Question 4, unanswered" })).toBeVisible();
  await expect(examNavigator.getByText(/Correct|Incorrect/)).toHaveCount(0);
  await examNavigator.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByText("Correct answer:")).toHaveCount(0);
  await expect(page.getByText("Teaching point")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: testInfo.outputPath("teaching-radiology-active-exam.png"), fullPage: true });

  await page.reload();
  const resumedSeconds = secondsFromTimer(await page.getByRole("timer").getAttribute("aria-label") ?? "");
  expect(resumedSeconds).toBeLessThanOrEqual(afterSavesSeconds);
  expect(resumedSeconds).toBeGreaterThan(afterSavesSeconds - 10);
  expect(page.getByRole("radio").first()).toBeChecked();
  await page.getByRole("button", { name: "Submit exam" }).click();
  const submitDialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Submit Exam?" }) });
  await submitDialog.getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByRole("heading", { name: /Correct|Incorrect/ })).toBeVisible();
  await expect(page.getByText("Correct answer:")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1440);
});
