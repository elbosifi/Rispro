import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }, permissions: ["microphone", "clipboard-read", "clipboard-write"] });

test("administrator configures MedASR through Settings with desktop/mobile and Arabic layouts", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_super_admin");
  expect((await page.request.post("http://127.0.0.1:3100/api/auth/re-auth", { data: { password: E2E_PASSWORD } })).ok()).toBeTruthy();
  await page.goto("/settings");
  await page.getByRole("button", { name: /Medical Dictation \(MedASR\)/ }).click();
  await expect(page).toHaveURL(/section=medical_dictation/);
  await expect(page.getByRole("heading", { name: "Medical Dictation (MedASR)", exact: true })).toBeVisible();
  await page.getByLabel("MedASR Server Address").fill("https://medasr.example.test:8443");
  // The standard platform encryption prerequisite is supplied by the E2E runner.
  await page.getByLabel("API Key", { exact: true }).fill("synthetic-e2e-key");
  await page.locator('label[for="dictation-enabled"]').click();
  await expect(page.getByLabel("Enable Medical Dictation")).toBeChecked();
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Settings saved. Changes are active immediately.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("MedASR Server Address")).toHaveValue("https://medasr.example.test:8443");
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(page.getByText("API key: Configured")).toBeVisible();
  const saved = await page.request.get("http://127.0.0.1:3100/api/medical-dictation/settings");
  expect(await saved.text()).not.toContain("synthetic-e2e-key");
  // Browser tests mock readiness; backend mock-server tests verify the HTTP hop.
  await page.route("**/api/medical-dictation/test-connection", (route) => route.fulfill({ json: { status: "connected", model: "google/medasr", credentialsValidated: false } }));
  await page.getByRole("button", { name: "Test Connection" }).click();
  await expect(page.getByText("Model: google/medasr")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("MedASR Server Address")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("settings-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Switch language to Arabic", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "الإملاء الطبي (MedASR)", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await page.locator("#dictation-enabled").evaluate((input) => {
    const rail = input.parentElement!.getBoundingClientRect();
    const thumb = input.parentElement!.lastElementChild!.getBoundingClientRect();
    return thumb.left >= rail.left && thumb.right <= rail.right;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("settings-mobile-ar.png"), fullPage: true });
});

test("doctor records native audio, sends it to RISpro, edits/copies/clears text and sees unavailable state", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_doctor");
  await page.route("**/api/medical-dictation/health", (route) => route.fulfill({ json: { status: "connected", model: "google/medasr", credentialsValidated: false } }));
  let uploaded = false;
  await page.route("**/api/medical-dictation/transcribe", async (route) => {
    const request = route.request();
    expect(new URL(request.url()).origin).toBe("http://127.0.0.1:5173");
    expect(request.headers()["content-type"]).toContain("multipart/form-data");
    expect(request.headers()["x-api-key"]).toBeUndefined();
    const body = request.postDataBuffer()!;
    expect(body.includes(Buffer.from('name="file"'))).toBe(true);
    expect(body.length).toBeGreaterThan(500);
    uploaded = true;
    await route.fulfill({ json: { text: "MRI brain demonstrates multiple enhancing lesions.", processing_seconds: 2.8 } });
  });
  await page.goto("/doctor/my-work");
  await page.locator("aside").getByRole("button", { name: "Medical Dictation", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/dictation-test/);
  await expect(page.getByRole("heading", { name: "Medical Dictation — Test Console" })).toBeVisible();
  await page.getByRole("button", { name: "Start Recording" }).click();
  await expect(page.getByText("Recording…", { exact: true })).toBeVisible();
  await expect(page.getByRole("timer")).toContainText("1 / 60", { timeout: 10_000 });
  await page.getByRole("button", { name: "Stop Recording" }).click();
  await expect(page.getByText("Recording ready to transcribe.")).toBeVisible();
  await page.getByRole("button", { name: "Transcribe", exact: true }).click();
  await expect(page.getByLabel("Transcription")).toHaveValue("MRI brain demonstrates multiple enhancing lesions.");
  expect(uploaded).toBe(true);
  await expect(page.getByText("Processing time: 2.8 seconds")).toBeVisible();
  await page.getByLabel("Transcription").fill("Edited medical text.");
  await page.getByRole("button", { name: "Copy Text" }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("console-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("console-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear Recording" }).click();
  await expect(page.getByRole("button", { name: "Transcribe", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Clear Text" }).click();
  await expect(page.getByLabel("Transcription")).toHaveValue("");
  await page.route("**/api/medical-dictation/health", (route) => route.fulfill({ json: { status: "disabled", credentialsValidated: false } }));
  await page.getByRole("button", { name: "Refresh Status" }).click();
  await expect(page.getByText("Connection Status: Disabled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Recording" })).toBeDisabled();
});
