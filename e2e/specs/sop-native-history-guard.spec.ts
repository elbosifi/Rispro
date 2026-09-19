import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth.js";

test("SOP dirty drafts protect native Back and clear protection after Save Draft", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const editors = () => page.locator(".ProseMirror");
  const code = `RAD-NATIVE-HISTORY-${Date.now().toString().slice(-6)}`;

  await signInWithSession(page, "e2e_supervisor");
  await page.goto("/sops/new");
  await expect(page.getByRole("heading", { name: "Create new SOP", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Title" }).fill("Native History Guard SOP");
  await page.getByRole("textbox", { name: "SOP Code" }).fill(code);
  await page.getByRole("combobox", { name: "Category" }).selectOption("Patient Safety");
  await page.locator("input[type='date']").fill("2026-12-01");
  await page.getByRole("textbox", { name: "Change summary" }).fill("Native history guard baseline");
  for (const [index, text] of [[0, "Purpose baseline."], [1, "Scope baseline."], [2, "Responsibilities baseline."], [5, "Procedure baseline."]] as const) {
    await editors().nth(index).click();
    await page.keyboard.insertText(text);
  }
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(page).toHaveURL(/\/sops\/\d+\?version=1\.0/);
  const sopPath = new URL(page.url()).pathname;

  const draftUrl = `${sopPath}?version=1.0`;
  // Put the library immediately behind the existing draft through SPA routes.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/\/sops$/);
  await page.getByRole("combobox", { name: "Status" }).selectOption("draft");
  const draftRow = page.locator("tr").filter({ hasText: code });
  await expect(draftRow).toContainText("1.0");
  await draftRow.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(draftUrl);
  await expect(page.getByRole("heading", { name: /Edit draft/ })).toBeVisible();
  const nativeEditor = editors().nth(5);
  await nativeEditor.click();
  await nativeEditor.press("Control+A");
  await page.keyboard.insertText("Native Back unsaved edit preserved.");

  await page.goBack();
  const guardDialog = page.getByRole("dialog");
  await expect(guardDialog).toContainText("Discard unsaved changes?");
  await expect(guardDialog).toContainText("SOP edits have not been saved.");
  await expect(page).toHaveURL(draftUrl);
  await page.screenshot({ path: testInfo.outputPath("sop-native-back-unsaved-guard.png"), fullPage: false });
  await guardDialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(draftUrl);
  await expect(nativeEditor).toContainText("Native Back unsaved edit preserved.");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goBack();
  await page.getByRole("dialog").getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/sops$/);
  await expect(page.getByRole("heading", { name: "SOP Library", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Status" }).selectOption("draft");

  await draftRow.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(draftUrl);
  await expect(page.getByRole("heading", { name: /Edit draft/ })).toBeVisible();
  const savedEditor = editors().nth(5);
  await savedEditor.click();
  await savedEditor.press("Control+A");
  await page.keyboard.insertText("Saved before native Back.");
  const saveResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/sops/"));
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Save Draft", exact: true })).toBeVisible();
  const savedHistoryIndex = await page.evaluate(() => window.history.state?.idx);
  await page.goBack();
  await expect.poll(() => page.evaluate(() => window.history.state?.idx)).toBeLessThan(savedHistoryIndex ?? 0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  expect(pageErrors, `Unexpected page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
