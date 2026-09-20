import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth.js";

test("SOP print and PDF actions save drafts and render the authoritative bilingual document", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const code = `RAD-PRINT-E2E-${Date.now().toString().slice(-6)}`;
  const editors = () => page.locator(".ProseMirror");
  const printDocument = async (screenshotName: string) => {
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Print", exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup.locator("body")).toContainText(code);
    await popup.screenshot({ path: testInfo.outputPath(screenshotName), fullPage: true });
    return popup;
  };
  const downloadPdf = async () => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${code}-v1.0.pdf`);
    await download.saveAs(testInfo.outputPath("sop-v1.0-draft.pdf"));
    const path = await download.path();
    expect(path).toBeTruthy();
    const bytes = await readFile(path!);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(10_000);
  };

  await signInWithSession(page, "e2e_supervisor");
  await expect.poll(async () => (await page.request.get("http://127.0.0.1:3100/api/auth/me")).status(), { timeout: 15_000 }).toBe(200);
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await page.goto("/sops/new");
  await expect(page.getByRole("heading", { name: "Create new SOP", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Title" }).fill("Bilingual MRI Safety Print SOP");
  await page.getByRole("textbox", { name: "SOP Code" }).fill(code);
  await page.getByRole("combobox", { name: "Category" }).selectOption("Patient Safety");
  await page.locator("input[type='date']").fill("2026-10-15");
  await page.getByRole("textbox", { name: "Change summary" }).fill("Initial print and PDF validation");

  await editors().nth(0).click();
  await page.getByRole("button", { name: "RTL" }).nth(0).click();
  await page.keyboard.insertText("إجراءات سلامة MRI قبل الفحص؛ verify identity and screening.");
  await editors().nth(1).click();
  await page.keyboard.insertText("Scope: all MRI examinations and contrast workflows.");
  await editors().nth(2).click();
  await page.keyboard.insertText("Responsibilities: radiologists, technologists, and nursing staff.");
  await editors().nth(4).click();
  await page.getByRole("button", { name: "Bullet list" }).nth(4).click();
  await page.keyboard.insertText("Confirm implants and pregnancy status");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("Document the completed safety check");
  await editors().nth(5).click();
  await page.keyboard.insertText(Array.from({ length: 70 }, (_, index) => `Step ${index + 1}: verify the patient, confirm the protocol, document the decision, and communicate any exception to the supervising radiologist.`).join(" "));
  await page.getByRole("button", { name: "Insert table" }).nth(5).click();
  const procedureEditor = editors().nth(5);
  const tableCells = procedureEditor.locator("table th, table td");
  await tableCells.nth(0).click();
  await page.keyboard.insertText("Checkpoint");
  await tableCells.nth(1).click();
  await page.keyboard.insertText("Owner");
  await tableCells.nth(2).click();
  await page.keyboard.insertText("Evidence");
  await tableCells.nth(3).click();
  await page.keyboard.insertText("Identity");
  await tableCells.nth(4).click();
  await page.keyboard.insertText("Technologist");
  await tableCells.nth(5).click();
  await page.keyboard.insertText("Checklist");
  await editors().nth(6).click();
  await page.keyboard.insertText("Record the examination, protocol, and any variance in RISpro.");
  await editors().nth(7).click();
  await page.keyboard.insertText("MRI safety policy and contrast guidance.");

  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(page).toHaveURL(/\/sops\/\d+\?version=1\.0/);
  const sopPath = new URL(page.url()).pathname;
  const sopId = Number(sopPath.split("/").at(-1));
  expect(Number.isInteger(sopId)).toBeTruthy();

  await editors().nth(0).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("إجراءات سلامة MRI المحدثة؛ dirty draft must be saved before PDF.");
  await downloadPdf();

  await editors().nth(1).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("Scope updated immediately before browser print.");
  const draftPrint = await printDocument("04-sop-print-draft-watermark.png");
  await expect(draftPrint.locator(".status-watermark")).toHaveText("DRAFT");
  await expect(draftPrint.locator(".content-table")).toBeVisible();
  await expect(draftPrint.locator("body")).toContainText("dirty draft must be saved before PDF");
  await draftPrint.close();

  await page.getByRole("button", { name: "Publish SOP", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish SOP", exact: true }).click();
  await expect(page.getByText("Published SOP", { exact: true })).toBeVisible();

  const currentPrint = await printDocument("01-sop-print-current-first-page.png");
  await expect(currentPrint.locator(".status-pill.current")).toHaveText("CURRENT");
  await expect(currentPrint.locator("body")).toContainText("إجراءات سلامة MRI المحدثة");
  await currentPrint.screenshot({ path: testInfo.outputPath("02-sop-print-arabic-mixed.png"), fullPage: true });
  await currentPrint.locator(".content-table").screenshot({ path: testInfo.outputPath("03-sop-print-table.png") });
  await currentPrint.close();

  await page.getByRole("button", { name: "Create New Revision", exact: true }).click();
  const revisionDialog = page.getByRole("dialog");
  await revisionDialog.getByRole("textbox", { name: "Change summary" }).fill("Superseded print validation");
  await revisionDialog.getByRole("textbox", { name: "Effective date" }).fill("2026-11-01");
  await revisionDialog.getByRole("button", { name: "Create draft revision", exact: true }).click();
  await expect(page).toHaveURL(/version=1\.1/);
  await editors().nth(5).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("Updated revision procedure; this content supersedes version 1.0.");
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await page.getByRole("button", { name: "Publish SOP", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish SOP", exact: true }).click();
  await expect(page.getByText("Version 1.1", { exact: true })).toBeVisible();

  await page.goto(`${sopPath}?version=1.0`);
  await expect(page.getByText("Read-only historical version", { exact: true })).toBeVisible();
  const supersededPrint = await printDocument("05-sop-print-superseded-watermark.png");
  await expect(supersededPrint.locator(".status-watermark")).toHaveText("SUPERSEDED");
  await expect(supersededPrint.locator("body")).toContainText("إجراءات سلامة MRI المحدثة");
  await supersededPrint.close();

  const directPdf = await page.request.get(`http://127.0.0.1:3100/api/sops/${sopId}/versions/1.0/pdf`);
  expect(directPdf.ok()).toBeTruthy();
  expect(directPdf.headers()["content-type"]).toContain("application/pdf");
  expect((await directPdf.body()).subarray(0, 5).toString("ascii")).toBe("%PDF-");
});
