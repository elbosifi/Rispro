import { expect, test, type Page } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }, permissions: ["microphone"] });

async function recording(page: Page) {
  const microphone = page.getByRole("button", { name: "Stop dictation", exact: true });
  await expect(microphone).toHaveAttribute("aria-pressed", "true");
  await expect(microphone).toHaveCSS("color", "rgb(185, 28, 28)");
  // Let the real MediaRecorder receive fake-device audio before stopping it.
  await page.waitForTimeout(600);
}

async function shortcut(page: Page, code: string, repeat = false) {
  await page.evaluate(({ code, repeat }) => window.dispatchEvent(new KeyboardEvent("keydown", { code, key: code, repeat, bubbles: true, cancelable: true })), { code, repeat });
  if (!repeat) await page.evaluate((code) => window.dispatchEvent(new KeyboardEvent("keyup", { code, key: code, bubbles: true, cancelable: true })), code);
}

test("global microphone preserves Protocoling, cursor/undo, keyboard and SpeechMike modes at desktop/mobile widths", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await signInWithSession(page, "e2e_doctor");
  await page.goto("/doctor/my-work");
  await page.getByRole("button", { name: "Open account menu" }).click();
  // The adjacent top-bar settings arrow is the only entry for these controls.
  await expect(page.getByRole("button", { name: "Dictation Controls", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Open account menu" }).click();
  const settingsArrow = page.getByRole("button", { name: "Dictation Controls", exact: true });
  await settingsArrow.click();
  const settings = page.locator("[data-dictation-controls]");
  await settings.getByRole("button", { name: "Capture Shortcut", exact: true }).click();
  await page.keyboard.press("Control+Shift+F9");
  await expect(settings.getByText("Ctrl + Shift + F9", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Reset keyboard to default" }).click();
  await settings.getByLabel("Enable SpeechMike shortcuts").check();
  for (const [button, code] of [["Capture Start Shortcut", "F15"], ["Capture Stop Shortcut", "F16"]]) {
    await settings.getByRole("button", { name: button }).click();
    await shortcut(page, code);
    await expect(settings.getByText(code, { exact: true })).toBeVisible();
  }
  await page.reload();
  await settingsArrow.click();
  await expect(settings.getByLabel("Enable SpeechMike shortcuts")).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("dictation-controls-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(async () => {
    const bounds = await page.getByRole("menu").boundingBox();
    return bounds ? bounds.x + bounds.width : Infinity;
  }).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("dictation-controls-mobile.png"), fullPage: true });
  await settingsArrow.click();
  await page.setViewportSize({ width: 1440, height: 960 });

  let transcriptions = 0;
  let assignments = 0;
  let delayNext = false;
  let release: (() => void) | undefined;
  page.on("request", (request) => { if (request.method() === "POST" && /\/assignment$/.test(new URL(request.url()).pathname)) assignments++; });
  await page.route("**/api/medical-dictation/transcribe", async (route) => {
    transcriptions++;
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    if (delayNext) { delayNext = false; await new Promise<void>((done) => { release = done; }); }
    // Cancellation aborts the fetch; late text must never overwrite a manual edit.
    await route.fulfill({ json: { text: "Um axial T1 period new paragraph no contrast period</s>", processing_seconds: 1 } }).catch(() => {});
  });
  await page.goto("/doctor/protocols");
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await page.getByLabel("Protocol status").selectOption("ALL");
  await page.getByLabel("Search protocoling appointments").fill("E2E Protocoling Exam Patient");
  await page.getByRole("row", { name: /E2E Protocoling Exam Patient/ }).getByRole("button", { name: "Assign" }).click();
  const workspace = page.getByRole("dialog", { name: "Assign protocol", exact: true });
  await workspace.getByRole("radio", { name: "Free-text protocol" }).click();
  const field = workspace.getByLabel("Free-text protocol", { exact: true });
  await field.fill("Before old after");
  await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 10));
  await page.keyboard.down("ShiftRight");
  await recording(page);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(workspace.getByRole("button", { name: /Dictate|Stop dictation/ })).toHaveCount(0);
  await page.keyboard.up("ShiftRight");
  await expect(field).toHaveValue("Before Axial T1.\n\nNo contrast. after");
  await page.keyboard.press("Control+z");
  await expect(field).toHaveValue("Before old after");
  await field.fill("Reviewed directly in the existing protocol editor.");
  await page.screenshot({ path: testInfo.outputPath("protocol-dictation-desktop.png"), fullPage: true });

  await workspace.getByRole("button", { name: "Additional instructions", exact: true }).click();
  const notes = workspace.getByLabel("Protocol instructions", { exact: true });
  await notes.focus();
  await shortcut(page, "F15");
  await shortcut(page, "F15", true);
  await recording(page);
  await shortcut(page, "F16");
  await expect(notes).toHaveValue("Axial T1.\n\nNo contrast.");

  // Configure Toggle through the same dropdown while the clinical window stays open.
  await settingsArrow.click();
  await settings.getByRole("button", { name: "Capture Shortcut", exact: true }).click();
  await page.keyboard.press("F9");
  await settings.getByLabel(/^Recording mode/).selectOption("toggle");
  await settingsArrow.click();
  await notes.focus();
  await page.keyboard.down("F9");
  await page.keyboard.down("F9"); // A duplicate keydown must not start another recorder.
  await recording(page);
  await page.keyboard.up("F9");
  await page.keyboard.press("F9");
  await expect(notes).toHaveValue("Axial T1.\n\nNo contrast. Axial T1.\n\nNo contrast.");

  await page.setViewportSize({ width: 390, height: 844 });
  const contrast = workspace.getByLabel("Contrast/preparation instructions", { exact: true });
  await contrast.focus();
  await page.getByRole("button", { name: "Start dictation", exact: true }).click();
  await recording(page);
  await page.screenshot({ path: testInfo.outputPath("protocol-recording-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Stop dictation", exact: true }).click();
  await expect(contrast).toHaveValue("Axial T1.\n\nNo contrast.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await workspace.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(56);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath("protocol-dictation-mobile.png"), fullPage: true });

  await contrast.focus();
  await page.getByRole("button", { name: "Start dictation", exact: true }).click();
  await recording(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Start dictation", exact: true })).toBeVisible();
  await expect(workspace).toBeVisible();
  expect(transcriptions).toBe(4);

  delayNext = true;
  await contrast.focus();
  await page.keyboard.press("F9"); await recording(page); await page.keyboard.press("F9");
  await expect(page.getByRole("button", { name: "Transcribing dictation", exact: true })).toBeVisible();
  await expect.poll(() => Boolean(release)).toBe(true);
  await contrast.fill("Manual correction while processing.");
  release!();
  await expect(page.getByRole("button", { name: "Start dictation", exact: true })).toBeVisible();
  await expect(contrast).toHaveValue("Manual correction while processing.");
  expect(transcriptions).toBe(5);
  expect(assignments).toBe(0);
  // Saving remains manual; dictation leaves the existing action available.
  await expect(workspace.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});
