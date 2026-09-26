import { expect, test, type Page } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

async function createPublishedQuestion(page: Page): Promise<{ externalId: string; stem: string }> {
  const templateResponse = await page.request.get("http://127.0.0.1:3100/api/teaching/qbank/import/template.json");
  expect(templateResponse.ok()).toBeTruthy();
  const template = await templateResponse.json() as { _schemaExamples: { single_best_answer: Record<string, unknown> } };
  const question = structuredClone(template._schemaExamples.single_best_answer);
  const externalId = `E2E-LEARNER-${Date.now()}`;
  const stem = "Synthetic learner question for Study, Exam, and Review.";
  const classification = question.classification as Record<string, unknown>;
  classification.tags = ["oncology"];
  question.externalId = externalId;
  question.stem = stem;

  await page.goto("/teaching/admin/import");
  await page.locator("#teaching-import-file").setInputFiles({
    name: "teaching-learner-question.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: "1.0", questions: [question] })),
  });
  await page.getByRole("button", { name: "Inspect upload" }).click();
  await expect(page.getByText("Structure valid")).toBeVisible();
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByText(externalId)).toBeVisible();
  await page.getByRole("button", { name: "Import 1 Draft Questions" }).first().click();
  await expect(page.getByText("1 questions imported as Draft.")).toBeVisible();

  await page.getByRole("link", { name: "Question Bank", exact: true }).click();
  await page.getByLabel(/Search external ID/).fill(externalId);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: externalId }).click();
  await page.getByRole("button", { name: "Submit for Review" }).click();
  await expect(page.getByText("in review")).toBeVisible();
  await page.getByRole("button", { name: "Approve Review" }).click();
  await page.getByRole("button", { name: "Publish revision" }).click();
  await expect(page.getByRole("button", { name: "Create New Revision" })).toBeVisible();
  return { externalId, stem };
}

async function createSession(page: Page, mode: "study" | "exam" | "review", timed = false) {
  await page.goto("/teaching/qbank");
  await page.getByText("More filters").click();
  await page.getByLabel("Tags").selectOption("oncology");
  await page.getByLabel("Mode").selectOption(mode);
  await page.getByLabel("Number of questions").fill("1");
  if (timed) {
    await page.getByRole("checkbox", { name: "Timed exam" }).check();
    await page.getByLabel("Time limit (minutes)").fill("5");
  }
  await expect(page.getByRole("status")).toHaveText("Available questions: 1");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/teaching\/qbank\/session\/\d+$/);
}

test("Teaching learner completes, resumes, resets a study cycle, and reviews private sessions", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/teaching/login");
  await expect(page).toHaveURL(/\/teaching\/dashboard$/);
  const fixture = await createPublishedQuestion(page);

  await page.getByRole("button", { name: "Sign out of Teaching" }).click();
  await signInWithSession(page, "e2e_doctor");
  await page.goto("/teaching/dashboard");
  await expect(page.getByRole("heading", { name: "Question Bank" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Learn Q-Bank" })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1440);

  await createSession(page, "study");
  await expect(page.getByText(fixture.stem)).toBeVisible();
  const studySessionId = Number(page.url().match(/session\/(\d+)$/)?.[1]);
  const unanswered = await page.request.get(`http://127.0.0.1:3100/api/teaching/sessions/${studySessionId}/questions/1`);
  expect(unanswered.ok()).toBeTruthy();
  const safeQuestion = await unanswered.json() as Record<string, unknown>;
  for (const secret of ["correctOption", "answerKey", "isCorrect", "explanation", "provenance", "importBatchId"]) {
    expect(JSON.stringify(safeQuestion)).not.toContain(secret);
  }

  await page.getByRole("radio").nth(0).check();
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByRole("heading", { name: "Incorrect" })).toBeVisible();
  await expect(page.getByText("Correct answer:")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Incorrect" })).toBeVisible();
  await page.getByRole("button", { name: "End study session" }).click();
  await expect(page.getByText("Score", { exact: true })).toBeVisible();

  await createSession(page, "exam", true);
  await expect(page.getByText(fixture.stem)).toBeVisible();
  const examSessionId = Number(page.url().match(/session\/(\d+)$/)?.[1]);
  const responsePath = `/api/teaching/sessions/${examSessionId}/questions/1/response`;
  const saveChoice = async (position: number) => {
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === responsePath && response.request().method() === "PUT",
    );
    await page.getByRole("radio").nth(position).check();
    expect((await responsePromise).ok()).toBeTruthy();
  };
  await saveChoice(1);
  await saveChoice(0);
  await expect(page.getByRole("radio").nth(0)).toBeChecked();
  await expect(page.getByText("Correct answer:")).toHaveCount(0);

  await page.getByRole("button", { name: "Mark question" }).click();
  await expect(page.getByRole("button", { name: "Marked" })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Personal note", { exact: true }).click();
  await page.getByRole("textbox", { name: "Personal note" }).fill("Synthetic private learner note.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Note saved")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.reload();
  await expect(page.getByRole("radio").nth(0)).toBeChecked();
  await expect(page.getByRole("button", { name: "Marked" })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Personal note", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Personal note" })).toHaveValue("Synthetic private learner note.");
  await expect(page.getByText("Correct answer:")).toHaveCount(0);

  await page.getByRole("button", { name: "Submit exam" }).click();
  const confirmation = page.getByRole("dialog");
  await expect(confirmation.getByRole("heading", { name: "Submit Exam?" })).toBeVisible();
  await confirmation.getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByRole("heading", { name: "Incorrect" })).toBeVisible();
  await expect(page.getByText("Correct answer:")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);

  await page.goto("/teaching/history");
  await expect(page.getByRole("heading", { name: "Session history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Exam.*1 questions/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Review", exact: true }).first()).toBeVisible();

  await createSession(page, "review");
  await expect(page.getByText(fixture.stem)).toBeVisible();
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByRole("heading", { name: "Correct" })).toBeVisible();
  await page.getByRole("button", { name: "End review session" }).click();
  await expect(page.getByText("Score", { exact: true })).toBeVisible();

  await createSession(page, "study");
  const preResetSessionId = Number(page.url().match(/session\/(\d+)$/)?.[1]);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/teaching/progress");
  await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
  await expect(page.getByText("Current cycle").locator("xpath=..")).toContainText(/1 \/ \d+/);
  await expect(page.getByText("First-pass accuracy").locator("xpath=..")).toContainText("0%");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 1440);
  await page.screenshot({ path: testInfo.outputPath("teaching-progress-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Reset progress" }).click();
  const resetDialog = page.getByRole("dialog");
  await resetDialog.getByLabel("Scope").selectOption("domain");
  await resetDialog.getByRole("combobox").nth(1).selectOption("neuroradiology");
  await expect(resetDialog.getByText(/active session containing 1 question\(s\)/i)).toBeVisible();
  await expect(resetDialog.getByText(/Previous attempts, session history, bookmarks, and personal notes will not be deleted/i)).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("teaching-progress-mobile-reset.png"), fullPage: true });
  await resetDialog.getByRole("button", { name: "Start new cycle" }).click();
  await expect(resetDialog).toBeHidden();
  await expect(page.getByText("Current cycle").locator("xpath=..")).toContainText(/0 \/ \d+/);
  const stillActive = await page.request.get(`http://127.0.0.1:3100/api/teaching/sessions/${preResetSessionId}`);
  expect(stillActive.ok()).toBeTruthy();
  expect((await stillActive.json() as { status: string }).status).toBe("active");

  await page.goto(`/teaching/qbank/session/${examSessionId}`);
  await expect(page.getByRole("button", { name: "Marked" })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Personal note", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Personal note" })).toHaveValue("Synthetic private learner note.");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);

  await page.goto("/teaching/qbank");
  await page.getByText("More filters").click();
  await page.getByLabel("Tags").selectOption("oncology");
  await page.getByLabel("Question state").selectOption("unseen");
  await expect(page.getByRole("status")).toHaveText("Available questions: 1");
  await page.getByRole("spinbutton", { name: "Number of questions" }).fill("1");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/teaching\/qbank\/session\/\d+$/);
  await page.getByRole("radio").nth(1).check();
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByRole("heading", { name: "Correct" })).toBeVisible();
  await page.getByRole("button", { name: "End study session" }).click();

  await page.goto("/teaching/progress");
  await expect(page.getByText("Current-cycle accuracy").locator("xpath=..")).toContainText("100%");
  await expect(page.getByText("First-pass accuracy").locator("xpath=..")).toContainText("0%");
  const neuroradiologyRow = page.getByRole("row").filter({ hasText: /neuroradiology/i });
  await expect(neuroradiologyRow).toBeVisible();
  await neuroradiologyRow.getByRole("button", { name: "View cycles" }).click();
  await expect(page.getByText("Cycle 1", { exact: true })).toBeVisible();
  expect(preResetSessionId).toBeGreaterThan(0);
});
