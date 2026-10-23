import { expect, test } from "@playwright/test";
import http from "node:http";
import { E2E_PASSWORD, signInWithSession } from "../helpers/auth";

test.describe.configure({ mode: "serial" });
test.use({ permissions: ["clipboard-read", "clipboard-write"] });
let mock: http.Server;
let baseUrl: string;
let receivedText = "";
test.beforeAll(async () => {
  mock = http.createServer((req, res) => {
    if (req.headers["x-api-key"] !== "synthetic-medgemma-key") { res.writeHead(401); res.end(); return; }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/health") { res.end(JSON.stringify({ status: "ready", model: "google/medgemma-1.5-4b-it" })); return; }
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      const input = JSON.parse(body);
      expect(input.task).toBe("cleanup_dictation");
      expect(input.instructions).toContain("Preserve negation, laterality, measurements");
      receivedText = input.text;
      res.end(JSON.stringify({ text: "No left frontal lesion.", processing_seconds: 2.5 }));
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
  await page.getByRole("button", { name: "Save Settings" }).click();
  await expect(page.getByText("Settings saved. Changes are active immediately.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("MedGemma Server URL")).toHaveValue(baseUrl);
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(page.getByText("API key: Configured")).toBeVisible();
  const settings = await page.request.get("http://127.0.0.1:3100/api/medgemma/settings");
  expect(await settings.text()).not.toContain("synthetic-medgemma-key");
  await page.getByRole("button", { name: "Test Connection" }).click();
  await expect(page.getByText("Connection Status: Connected")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-en-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
  await page.screenshot({ path: testInfo.outputPath("settings-ar-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: testInfo.outputPath("settings-ar-desktop.png"), fullPage: true });
});

test("doctor sends text through RISpro to mock service and reviews, edits, copies and clears output", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_doctor");
  await page.goto("/doctor/my-work");
  await page.locator("aside").getByRole("button", { name: "MedGemma", exact: true }).click();
  await expect(page).toHaveURL(/\/doctor\/medgemma-test/);
  await expect(page.getByText("Connection Status: Connected")).toBeVisible();
  const original = "No uh left frontal lesion period";
  await page.getByLabel("Original Dictation", { exact: true }).fill(original);
  const request = page.waitForRequest("**/api/medgemma/generate");
  await page.getByRole("button", { name: "Clean Dictation with MedGemma", exact: true }).click();
  const sent = await request;
  expect(sent.headers()["x-api-key"]).toBeUndefined();
  expect(sent.postDataJSON()).toEqual({ task: "cleanup_dictation", text: original });
  await expect(page.getByLabel("MedGemma Cleaned Text", { exact: true })).toHaveValue("No left frontal lesion.");
  expect(receivedText).toBe(original);
  await expect(page.getByLabel("Original Dictation", { exact: true })).toHaveValue(original);
  await expect(page.getByLabel("Original Text", { exact: true })).toHaveValue(original);
  await expect(page.getByText("Processing time: 2.5 seconds")).toBeVisible();
  await page.getByRole("button", { name: "Edit Cleaned Text", exact: true }).click();
  await page.getByLabel("MedGemma Cleaned Text", { exact: true }).fill("Reviewed text.");
  await page.getByRole("button", { name: "Copy Cleaned Text", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("console-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("console-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByLabel("Original Dictation", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("MedGemma Cleaned Text", { exact: true })).toHaveValue("");
  await page.route("**/api/medgemma/health", (route) => route.fulfill({ json: { status: "unavailable" } }));
  await page.getByRole("button", { name: "Refresh Status", exact: true }).click();
  await expect(page.getByText("Connection Status: Unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clean Dictation with MedGemma", exact: true })).toBeDisabled();
});
