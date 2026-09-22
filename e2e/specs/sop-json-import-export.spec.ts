import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { signInWithSession } from "../helpers/auth.js";

function sopJson(code: string, purpose = "يجب التأكد من هوية المريض قبل بدء فحص MRI.") {
  const required = new Set(["purpose", "scope", "responsibilities", "procedure"]);
  const definitions = [["purpose", "Purpose"], ["scope", "Scope"], ["responsibilities", "Responsibilities"], ["definitions", "Definitions / Abbreviations"], ["safety", "Safety / Precautions"], ["procedure", "Procedure"], ["documentation", "Documentation / Records"], ["references", "References"]] as const;
  const sections = definitions.map(([key, title]) => ({
    key, title, required: required.has(key),
    content: key === "purpose" ? { type: "doc", content: [{ type: "heading", attrs: { level: 2, dir: "rtl" }, content: [{ type: "text", text: "سلامة MRI", marks: [{ type: "bold" }] }] }, { type: "paragraph", attrs: { dir: "rtl" }, content: [{ type: "text", text: purpose }] }] }
      : key === "procedure" ? { type: "doc", content: [{ type: "bulletList", attrs: { dir: "ltr" }, content: [{ type: "listItem", attrs: { dir: "auto" }, content: [{ type: "paragraph", attrs: { dir: "auto" }, content: [{ type: "text", text: "Verify identity" }] }] }] }, { type: "table", attrs: { dir: "auto" }, content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null, dir: "auto" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Step" }] }] }] }] }] }
        : { type: "doc", content: [{ type: "paragraph", attrs: { dir: "auto" }, content: required.has(key) ? [{ type: "text", text: `${title} content` }] : [] }] },
  }));
  return { format: "rispro-sop", formatVersion: 1, sop: { code, title: "MRI JSON Safety Workflow", category: "MRI", version: "1.0", effectiveDate: "2026-10-20", changeSummary: "Initial JSON issue", document: { type: "sop", version: 1, sections } } };
}

test("SOP JSON import/export creates and updates a rich draft without publishing", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const code = `RAD-JSON-E2E-${Date.now().toString().slice(-6)}`;
  const initial = Buffer.from(JSON.stringify(sopJson(code), null, 2));
  const pageErrors: string[] = []; page.on("pageerror", (error) => pageErrors.push(error.message));
  await signInWithSession(page, "e2e_supervisor"); await page.goto("/sops");
  const exampleResponse = page.waitForResponse((response) => response.url().endsWith("/api/sops/import/json/example"));
  const exampleDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Download JSON Example", exact: true }).click();
  const [example, exampleResponseValue] = await Promise.all([exampleDownload, exampleResponse]);
  expect(example.suggestedFilename()).toBe("RISpro-SOP-JSON-V1-Example.json"); expect(exampleResponseValue.status()).toBe(200); expect(exampleResponseValue.headers()["content-type"]).toContain("application/json"); expect(exampleResponseValue.headers()["content-disposition"]).toBe('attachment; filename="RISpro-SOP-JSON-V1-Example.json"'); expect(exampleResponseValue.headers()["cache-control"]).toBe("no-store, private");
  const examplePath = testInfo.outputPath("sop-json-example.json"); await example.saveAs(examplePath); const exampleBody = JSON.parse(await fs.readFile(examplePath, "utf8")); expect(exampleBody).toMatchObject({ format: "rispro-sop", formatVersion: 1, sop: { code: "RAD-MRI-001", version: "1.0" } }); expect(exampleBody.sop.document.sections).toHaveLength(8);
  await page.getByRole("button", { name: "Import SOP", exact: true }).click();
  await page.getByLabel("SOP JSON file").setInputFiles({ name: `${code}.json`, mimeType: "application/json", buffer: initial });
  await expect(page.getByText("JSON structure is valid")).toBeVisible(); await page.getByRole("button", { name: "Preview import", exact: true }).click();
  await expect(page.getByText("Import summary")).toBeVisible(); await expect(page.getByText("Purpose", { exact: true })).toBeVisible(); await expect(page.getByText("Procedure", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm import", exact: true }).click(); await expect(page).toHaveURL(/\/sops\/\d+\?version=1\.0/); await expect(page.locator(".ProseMirror").first()).toContainText("يجب التأكد"); await expect(page.getByRole("button", { name: "Publish SOP", exact: true })).toBeVisible();
  await page.reload(); await expect(page.locator(".ProseMirror").first()).toContainText("سلامة MRI");
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export JSON", exact: true }).click(); const exported = await download; const exportedPath = testInfo.outputPath("sop-export.json"); await exported.saveAs(exportedPath); const body = JSON.parse(await fs.readFile(exportedPath, "utf8")); expect(body).toMatchObject({ format: "rispro-sop", formatVersion: 1, sop: { code, version: "1.0" } }); expect(JSON.stringify(body.sop.document)).toContain("tableHeader");
  body.sop.document.sections[0].content.content[1].content[0].text = "تحديث JSON بعد التصدير"; const revised = Buffer.from(JSON.stringify(body, null, 2));
  await page.getByRole("button", { name: "Import JSON", exact: true }).click(); await page.getByLabel("SOP JSON file").setInputFiles({ name: `${code}-edited.json`, mimeType: "application/json", buffer: revised }); await page.getByRole("button", { name: "Preview import", exact: true }).click(); await expect(page.getByText("Current", { exact: true })).toBeVisible(); await expect(page.getByText("Imported", { exact: true })).toBeVisible(); await page.getByRole("button", { name: "Confirm import", exact: true }).click(); await expect(page.locator(".ProseMirror").first()).toContainText("تحديث JSON بعد التصدير");
  await page.getByRole("button", { name: "Import JSON", exact: true }).click(); await page.getByLabel("SOP JSON file").setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{") }); await expect(page.getByRole("alert")).toContainText("SOP JSON file is not valid JSON.");
  await signInWithSession(page, "e2e_reception"); await page.goto("/sops"); await expect(page.getByRole("button", { name: "Import SOP", exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Download JSON Example", exact: true })).toHaveCount(0); expect(pageErrors).toEqual([]);
});
