import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }, permissions: ["microphone"] });

test("clinical doctor configures shortcuts and dictates directly into Protocoling fields at desktop/mobile widths", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await signInWithSession(page, "e2e_doctor");
  await page.goto("/doctor/my-work");
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Dictation Controls", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/dictation-controls/);
  await page.getByRole("button", { name: "Capture Shortcut", exact: true }).click();
  await page.keyboard.press("Control+Shift+F9");
  await expect(page.getByText("Ctrl + Shift + F9", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset keyboard to default" }).click();
  await page.getByLabel("Enable SpeechMike shortcuts").check();
  // SpeechControl delivers these as ordinary browser keyboard events.
  for (const [button, code] of [["Capture Start Shortcut", "F15"], ["Capture Stop Shortcut", "F16"]]) {
    await page.getByRole("button", { name: button }).click();
    await page.evaluate((key) => document.dispatchEvent(new KeyboardEvent("keydown", { code: key, key, bubbles: true, cancelable: true })), code);
    await expect(page.getByText(code, { exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByLabel("Enable SpeechMike shortcuts")).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("dictation-controls-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dictation-controls-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });

  let transcriptions = 0;
  let assignments = 0;
  page.on("request", (request) => { if (request.method() === "POST" && /\/assignment$/.test(new URL(request.url()).pathname)) assignments++; });
  await page.route("**/api/medical-dictation/transcribe", async (route) => {
    transcriptions++;
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    await route.fulfill({ json: { text: "Um axial T1 period new paragraph no contrast period</s>", processing_seconds: 1 } });
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
  await expect(workspace.getByText(/Recording.* 1 \/ 60 seconds/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Insert Text" })).toHaveCount(0);
  await expect(page.getByLabel("Basic Cleaned Text")).toHaveCount(0);
  await page.keyboard.up("ShiftRight");
  await expect(field).toHaveValue("Before Axial T1.\n\nNo contrast. after");
  await field.fill("Reviewed directly in the existing protocol editor.");
  await page.screenshot({ path: testInfo.outputPath("protocol-dictation-desktop.png"), fullPage: true });

  await workspace.getByRole("button", { name: "Additional instructions", exact: true }).click();
  const notes = workspace.getByLabel("Protocol instructions", { exact: true });
  await notes.focus();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "F15", key: "F15" })));
  await expect(workspace.getByText(/Recording.* 1 \/ 60 seconds/)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "F16", key: "F16" })));
  await expect(notes).toHaveValue("Axial T1.\n\nNo contrast.");

  await page.setViewportSize({ width: 390, height: 844 });
  const contrast = workspace.getByLabel("Contrast/preparation instructions", { exact: true });
  await workspace.getByRole("button", { name: "Dictate contrast/preparation instructions", exact: true }).click();
  await expect(workspace.getByText(/Recording.* 1 \/ 60 seconds/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("protocol-recording-mobile.png"), fullPage: true });
  await workspace.getByRole("button", { name: "Stop dictation", exact: true }).click();
  await expect(contrast).toHaveValue("Axial T1.\n\nNo contrast.");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await contrast.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("protocol-dictation-mobile.png"), fullPage: true });
  await workspace.getByRole("button", { name: "Dictate contrast/preparation instructions", exact: true }).click();
  await expect(workspace.getByText(/Recording.* 1 \/ 60 seconds/)).toBeVisible();
  await workspace.getByRole("button", { name: "Cancel dictation", exact: true }).click();
  await expect(contrast).toHaveValue("Axial T1.\n\nNo contrast.");
  expect(transcriptions).toBe(3);
  expect(assignments).toBe(0);
});
