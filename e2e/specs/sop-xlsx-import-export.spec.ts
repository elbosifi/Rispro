import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import * as XLSX from "xlsx";
import { signInWithSession } from "../helpers/auth.js";

async function writeWorkbook(sourcePath: string, destinationPath: string, changes: { sopCode?: string; changeSummary?: string; purpose?: string; procedure?: string }) {
  const workbook = XLSX.read(await fs.readFile(sourcePath), { type: "buffer" });
  const worksheet = workbook.Sheets.SOP;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: false });
  const updated = rows.map((row) => {
    const next = { ...row };
    if (row.section_key === "purpose" && changes.purpose !== undefined) next.content = changes.purpose;
    if (row.section_key === "procedure" && changes.procedure !== undefined) next.content = changes.procedure;
    if (row.section_key === "purpose" && changes.sopCode !== undefined) next.sop_code = changes.sopCode;
    if (row.section_key === "purpose" && changes.changeSummary !== undefined) next.change_summary = changes.changeSummary;
    return next;
  });
  const headers = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", raw: false })[0] as string[];
  const nextSheet = XLSX.utils.json_to_sheet(updated, { header: headers });
  const nextWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(nextWorkbook, nextSheet, "SOP");
  XLSX.writeFile(nextWorkbook, destinationPath);
}

test("SOP XLSX export, external edit, preview, confirm, invalid validation, Arabic, and draft isolation", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const screenshot = (name: string) => page.screenshot({ path: testInfo.outputPath(name), fullPage: false });
  const code = `RAD-XLSX-E2E-${Date.now().toString().slice(-6)}`;
  const editors = () => page.locator(".ProseMirror");

  await signInWithSession(page, "e2e_supervisor");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/sops");
  await expect(page.getByRole("heading", { name: "SOP Library", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.goto("/sops/new");
  await expect(page.getByRole("heading", { name: "Create new SOP", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Title" }).fill("MRI XLSX Safety Workflow");
  await page.getByRole("textbox", { name: "SOP Code" }).fill(code);
  await page.getByRole("combobox", { name: "Category" }).selectOption("MRI");
  await page.locator("input[type='date']").fill("2026-10-20");
  await page.getByRole("textbox", { name: "Change summary" }).fill("Initial Excel round trip");
  await editors().nth(0).click();
  await page.keyboard.insertText("يجب التأكد من هوية المريض قبل بدء الفحص.");
  await editors().nth(1).click();
  await page.keyboard.insertText("MRI safety screening applies to all MRI examinations.");
  await editors().nth(2).click();
  await page.keyboard.insertText("The MRI technologist completes the screening.");
  await editors().nth(5).click();
  await page.keyboard.type("1. ");
  await page.keyboard.type("Verify identity");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Complete MRI safety screening");
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(page).toHaveURL(/\/sops\/\d+\?version=1\.0/);
  const sopPath = new URL(page.url()).pathname;
  await page.reload({ waitUntil: "domcontentloaded" });

  const persistedSummary = page.getByRole("textbox", { name: "Change summary" });
  await persistedSummary.fill("Persisted before Excel export");
  const dirtyPatch = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/sops/"));
  const dirtyDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  expect((await dirtyPatch).status()).toBe(200);
  const initialDownload = await dirtyDownload;
  const initialPath = testInfo.outputPath("sop-v1.0-export.xlsx");
  await initialDownload.saveAs(initialPath);
  expect(initialDownload.suggestedFilename()).toBe(`${code}-v1.0.xlsx`);
  await screenshot("01-sop-xlsx-export-action.png");
  const exported = XLSX.read(await fs.readFile(initialPath), { type: "buffer" });
  expect(exported.SheetNames).toEqual(["SOP"]);
  const exportedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(exported.Sheets.SOP, { defval: "", raw: false });
  expect(exportedRows).toHaveLength(8);
  expect(exportedRows[0]).toMatchObject({ format_version: "1", sop_code: code, source_version: "1.0" });
  expect(String(exportedRows.find((row) => row.section_key === "purpose")?.content)).toContain("يجب التأكد");
  expect(String(exportedRows.find((row) => row.section_key === "procedure")?.content)).toContain("1. Verify identity");

  const modifiedPath = testInfo.outputPath("sop-v1.0-edited.xlsx");
  await writeWorkbook(initialPath, modifiedPath, {
    changeSummary: "Imported Arabic and procedure edits",
    purpose: "Purpose updated: يجب التأكد من هوية المريض قبل بدء الفحص.\nMRI safety screening يجب إكماله قبل دخول المريض.",
    procedure: "1. Verify identity\n2. Complete updated MRI safety screening",
  });
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import Excel changes" })).toBeVisible();
  await screenshot("02-sop-xlsx-import-upload.png");
  await page.getByLabel("Excel workbook").setInputFiles(modifiedPath);
  await expect(page.getByText("Workbook structure is valid")).toBeVisible();
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  await expect(page.getByText("Workbook summary")).toBeVisible();
  await expect(page.locator(".hidden.md\\:block").getByText("Purpose", { exact: true })).toBeVisible();
  await expect(page.locator(".hidden.md\\:block").getByText("Procedure", { exact: true })).toBeVisible();
  await expect(page.getByText("Changed").first()).toBeVisible();
  await expect(page.getByText("Unchanged").first()).toBeVisible();
  await expect(page.getByText("Workbook source: v1.0")).toBeVisible();
  await expect(page.getByText("Target draft: v1.0")).toBeVisible();
  await page.getByText("Compare current and imported text").first().click();
  await expect(page.getByText("Current RISpro text").first()).toBeVisible();
  await expect(page.getByText("Imported Excel text").first()).toBeVisible();
  await screenshot("03-sop-xlsx-preview-changed.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("06-sop-xlsx-preview-mobile.png");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Confirm import", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Excel changes imported into draft v1.0.");
  await expect(editors().nth(0)).toContainText("Purpose updated");
  await expect(editors().nth(0)).toContainText("يجب التأكد");
  await expect(editors().nth(5)).toContainText("updated MRI safety screening");
  await expect(page.getByRole("button", { name: "Publish SOP", exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(editors().nth(0)).toContainText("MRI safety screening");
  await screenshot("05-sop-xlsx-imported-draft.png");

  await page.getByRole("button", { name: "Publish SOP", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish SOP", exact: true }).click();
  await expect(page.getByText("Published SOP", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create New Revision", exact: true }).click();
  const revisionDialog = page.getByRole("dialog");
  await revisionDialog.getByRole("textbox", { name: "Effective date" }).fill("2026-11-20");
  await revisionDialog.getByRole("textbox", { name: "Change summary" }).fill("Excel draft revision");
  await revisionDialog.getByRole("button", { name: "Create draft revision", exact: true }).click();
  await expect(page).toHaveURL(/version=1\.1/);
  await expect(page.getByRole("heading", { name: /Edit draft/ })).toBeVisible();
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  await page.getByLabel("Excel workbook").setInputFiles(modifiedPath);
  await expect(page.getByText("Workbook structure is valid")).toBeVisible();
  await page.getByRole("button", { name: "Preview changes", exact: true }).click();
  await expect(page.getByText("Workbook source: v1.0")).toBeVisible();
  await expect(page.getByText("Target draft: v1.1")).toBeVisible();
  await page.getByRole("button", { name: "Confirm import", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Excel changes imported into draft v1.1.");

  await signInWithSession(page, "e2e_reception");
  await page.goto(`${sopPath}?version=1.1`);
  await expect(page.getByText("Version 1.0", { exact: true })).toBeVisible();
  await expect(page.getByText("Purpose updated", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import Excel", exact: true })).toHaveCount(0);

  await signInWithSession(page, "e2e_supervisor");
  await page.goto(`${sopPath}?version=1.1`);
  await expect(page.getByRole("heading", { name: /Edit draft/ })).toBeVisible();
  const invalidPath = testInfo.outputPath("sop-invalid-code.xlsx");
  await writeWorkbook(initialPath, invalidPath, { sopCode: "RAD-WRONG-E2E-001" });
  await page.getByRole("button", { name: "Import Excel", exact: true }).click();
  await page.getByLabel("Excel workbook").setInputFiles(invalidPath);
  await expect(page.getByText("SOP code does not match this SOP.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview changes", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Confirm import", exact: true })).toHaveCount(0);
  await screenshot("04-sop-xlsx-import-validation-error.png");

  const blankProcedurePath = testInfo.outputPath("sop-invalid-blank-procedure.xlsx");
  await writeWorkbook(initialPath, blankProcedurePath, { procedure: "" });
  await page.getByRole("button", { name: "Choose another workbook", exact: true }).click();
  await page.getByLabel("Excel workbook").setInputFiles(blankProcedurePath);
  await expect(page.getByText("Workbook needs attention")).toBeVisible();
  await expect(page.getByText("Row 7: Required section 'procedure' cannot be blank.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview changes", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Confirm import", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish SOP", exact: true })).toBeVisible();

  expect(pageErrors, `Unexpected page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
});
