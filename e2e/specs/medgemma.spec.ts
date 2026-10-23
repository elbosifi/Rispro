import { expect, test } from "@playwright/test";
import http from "node:http";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

test.describe.configure({ mode: "serial" });
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }, permissions: ["microphone", "clipboard-read", "clipboard-write"] });
let mock: http.Server;
let baseUrl: string;
let receivedText = "";
let lastRequest: Record<string, unknown>;
const taskResults: Record<string, string> = {
  cleanup_dictation: "No left frontal lesion.",
  correct_terminology: "Corrected medical terminology.\n\nUncertain corrections for review:\n- Confirm the sequence name.",
  format_radiology_report: "Findings:\nNo left frontal lesion.",
  review_radiology_report: "- Possible laterality inconsistency: compare findings with impression.",
};
test.beforeAll(async () => {
  mock = http.createServer((req, res) => {
    if (req.headers["x-api-key"] !== "synthetic-medgemma-key") { res.writeHead(401); res.end(); return; }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/health") { res.end(JSON.stringify({ status: "ready", model: "google/medgemma-1.5-4b-it" })); return; }
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      const input = JSON.parse(body);
      expect(Object.keys(taskResults)).toContain(input.task);
      expect(input.temperature).toBe(0.2);
      expect(input.max_new_tokens).toBe(1024);
      lastRequest = input;
      expect(input.instructions).toContain("Preserve negation, laterality, measurements");
      receivedText = input.text;
      res.end(JSON.stringify({ text: taskResults[input.task], processing_seconds: 2.5 }));
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
});
test.afterAll(async () => {
  if (mock) { mock.closeAllConnections(); await new Promise<void>((resolve) => mock.close(() => resolve())); }
});

test("administrator configures a mock service; English/Arabic settings fit desktop and mobile", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_super_admin");
  expect((await page.request.post("http://127.0.0.1:3100/api/auth/re-auth", { data: { password: E2E_PASSWORD } })).ok()).toBeTruthy();
  await page.goto("/settings");
  await page.getByRole("button", { name: /^MedGemma / }).click();
  await expect(page).toHaveURL(/section=medgemma/);
  await expect(page.getByLabel("Enable MedGemma")).not.toBeChecked();
  await expect(page.getByLabel("Request Timeout (seconds)")).toHaveValue("180");
  await page.getByLabel("MedGemma Server URL").fill(baseUrl);
  await page.getByLabel("API Key", { exact: true }).fill("synthetic-medgemma-key");
  await page.locator('label[for="medgemma-enabled"]').click();
  await page.getByRole("checkbox", { name: /Allow unencrypted HTTP/ }).check();
  for (const task of Object.keys(taskResults)) {
    await page.getByLabel("Instruction Preset").selectOption(task);
    const instructions = page.getByLabel("System Instructions");
    await instructions.fill(`${await instructions.inputValue()}\nKeep test output concise.`);
  }
  await page.getByLabel("Temperature (0–1)").fill("0.2");
  await page.getByLabel("Maximum Generated Tokens (128–8192)").fill("1024");
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Settings saved. Changes are active immediately.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("MedGemma Server URL")).toHaveValue(baseUrl);
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(page.getByText("API key: Configured")).toBeVisible();
  await expect(page.getByLabel("Temperature (0–1)")).toHaveValue("0.2");
  await expect(page.getByLabel("Maximum Generated Tokens (128–8192)")).toHaveValue("1024");
  await expect(page.getByLabel("System Instructions")).toHaveValue(/Keep test output concise\./);
  await page.getByRole("button", { name: "Restore Default" }).click();
  await expect(page.getByLabel("System Instructions")).not.toHaveValue(/Keep test output concise\./);
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Settings saved. Changes are active immediately.")).toBeVisible();
  const settings = await page.request.get("http://127.0.0.1:3100/api/medgemma/settings");
  expect(await settings.text()).not.toContain("synthetic-medgemma-key");
  await page.getByRole("button", { name: "Test Connection" }).click();
  await expect(page.getByText("Connection Status: Connected")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("settings-en-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("settings-en-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Switch language to Arabic", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByLabel("عنوان خادم MedGemma")).toBeVisible();
  expect(await page.locator("#medgemma-enabled").evaluate((input) => {
    const rail = input.parentElement!.getBoundingClientRect();
    const thumb = input.parentElement!.lastElementChild!.getBoundingClientRect();
    return thumb.left >= rail.left && thumb.right <= rail.right;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("settings-ar-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("settings-ar-desktop.png"), fullPage: true });
});

test("doctor sends text through RISpro to mock service and reviews, edits, copies and clears output", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_doctor");
  await page.goto("/doctor/my-work");
  await page.locator("aside").getByRole("button", { name: "MedGemma", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/medgemma-test/);
  await expect(page.getByText("Connection Status: Connected")).toBeVisible();
  const original = "No uh left frontal lesion period";
  await page.getByLabel("Original Text Input", { exact: true }).fill(original);
  const request = page.waitForRequest("**/api/medgemma/generate");
  await page.getByRole("button", { name: "Process Text", exact: true }).click();
  const sent = await request;
  expect(sent.headers()["x-api-key"]).toBeUndefined();
  expect(sent.postDataJSON()).toEqual({ task: "cleanup_dictation", text: original });
  await expect(page.getByLabel("MedGemma Result", { exact: true })).toHaveValue("No left frontal lesion.");
  expect(receivedText).toBe(original);
  await expect(page.getByLabel("Original Text Input", { exact: true })).toHaveValue(original);
  await expect(page.getByLabel("Original Text", { exact: true })).toHaveValue(original);
  await expect(page.getByText("Processing time: 2.5 seconds")).toBeVisible();
  await page.getByRole("button", { name: "Edit Result", exact: true }).click();
  await page.getByLabel("MedGemma Result", { exact: true }).fill("Reviewed text.");
  await page.getByRole("button", { name: "Copy Result", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("console-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("console-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByLabel("Original Text Input", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("MedGemma Result", { exact: true })).toHaveValue("");
  await page.getByLabel("Original Text Input", { exact: true }).fill(original);
  await expect(page.getByLabel(/Per-test Instructions/)).toHaveCount(0);
  for (const task of Object.keys(taskResults)) {
    await page.getByLabel("Processing Task").selectOption(task);
    await page.getByRole("button", { name: "Process Text", exact: true }).click();
    await expect(page.getByLabel(task === "review_radiology_report" ? "Potential Issues" : "MedGemma Result", { exact: true })).toHaveValue(taskResults[task]);
    expect(lastRequest.task).toBe(task);
    await expect(page.getByLabel("Original Text", { exact: true })).toHaveValue(original);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("qa-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("qa-desktop.png"), fullPage: true });
  await page.route("**/api/medgemma/generate", (route) => route.fulfill({ status: 502, json: { error: { message: "MedGemma returned an invalid generation response." } } }));
  await page.getByRole("button", { name: "Process Text", exact: true }).click();
  await expect(page.getByText("MedGemma returned an invalid generation response.")).toBeVisible();
  await expect(page.getByLabel("Original Text", { exact: true })).toHaveValue(original);
  await page.route("**/api/medgemma/health", (route) => route.fulfill({ json: { status: "unavailable" } }));
  await page.getByRole("button", { name: "Refresh Status", exact: true }).click();
  await expect(page.getByText("Connection Status: Unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Process Text", exact: true })).toBeDisabled();
});

test("MedASR transfers text only and does not invoke a disabled MedGemma service", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_doctor");
  await page.route("**/api/medical-dictation/health", (route) => route.fulfill({ json: { status: "connected", model: "google/medasr", credentialsValidated: false } }));
  const transcription = "There is uh a small enhancing lesion new paragraph No other finding period";
  await page.route("**/api/medical-dictation/transcribe", (route) => route.fulfill({ json: { text: transcription, processing_seconds: 1 } }));
  await page.route("**/api/medgemma/health", (route) => route.fulfill({ json: { status: "disabled" } }));
  let generationCalls = 0;
  await page.route("**/api/medgemma/generate", (route) => { generationCalls++; return route.fulfill({ json: { text: "Unexpected request", processing_seconds: 1 } }); });
  await page.goto("/doctor/dictation-test");
  await expect(page.getByRole("button", { name: "Send to MedGemma" })).toBeDisabled();
  await page.getByRole("button", { name: "Start Recording" }).click();
  await expect(page.getByRole("timer")).toContainText("1 / 60", { timeout: 10_000 });
  await page.getByRole("button", { name: "Stop Recording" }).click();
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(page.getByLabel("Transcription")).toHaveValue(transcription);
  await page.getByRole("button", { name: "Send to MedGemma" }).click();
  await expect(page).toHaveURL(/\/doctor\/medgemma-test$/);
  await expect(page.getByLabel("Original Text Input")).toHaveValue(transcription);
  await expect(page.getByLabel("Processing Task")).toHaveValue("cleanup_dictation");
  await expect(page.getByText("Connection Status: Disabled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Process Text" })).toBeDisabled();
  expect(generationCalls).toBe(0);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, history: history.state }))).not.toContain(transcription);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("transferred-text.png"), fullPage: true });
  await page.reload();
  await expect(page.getByLabel("Original Text Input")).toHaveValue("");
});
