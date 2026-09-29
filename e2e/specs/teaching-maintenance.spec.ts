import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";
import { signInWithSession } from "../helpers/auth";

test("Teaching maintenance XLSX creates a Draft without mutating a Published revision", async ({ page }, testInfo) => {
  await signInWithSession(page, "e2e_supervisor");
  const templateResponse = await page.request.get("http://127.0.0.1:3100/api/teaching/qbank/import/template.json");
  expect(templateResponse.ok()).toBeTruthy();
  const template = await templateResponse.json() as { _schemaExamples: { single_best_answer: Record<string, unknown> } };
  const externalId = `E2E-MAINTENANCE-${Date.now()}`;
  const question = structuredClone(template._schemaExamples.single_best_answer);
  question.externalId = externalId;
  question.stem = "Published stem before XLSX maintenance. No patient information.";
  const payload = { schemaVersion: "1.1", taxonomyProposals: { topics: [] }, questions: [question] };

  await page.goto("/teaching/admin/import");
  await page.locator("#teaching-import-file").setInputFiles({ name: "teaching-maintenance-seed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) });
  const inspected = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/teaching/qbank/import/inspect" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Inspect upload" }).click();
  expect((await inspected).ok()).toBeTruthy();
  await page.getByRole("button", { name: "Validate and preview" }).click();
  await expect(page.getByRole("heading", { name: "3. Preview import" })).toBeVisible();
  const imported = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/teaching/qbank/import/confirm" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Import 1 Draft Questions" }).first().click();
  expect((await imported).ok()).toBeTruthy();

  const listed = await page.request.get(`http://127.0.0.1:3100/api/teaching/admin/questions?search=${encodeURIComponent(externalId)}&status=draft`);
  const list = await listed.json() as { items: Array<{ id: number; revision: { id: number } }> };
  const item = list.items.find((entry) => entry.id > 0);
  expect(item).toBeTruthy();
  expect((await page.request.post(`http://127.0.0.1:3100/api/teaching/admin/questions/${item!.id}/submit-review`)).ok()).toBeTruthy();
  expect((await page.request.post(`http://127.0.0.1:3100/api/teaching/admin/questions/${item!.id}/revisions/${item!.revision.id}/review`)).ok()).toBeTruthy();
  expect((await page.request.post(`http://127.0.0.1:3100/api/teaching/admin/questions/${item!.id}/publish`)).ok()).toBeTruthy();

  const exported = await page.request.get("http://127.0.0.1:3100/api/teaching/admin/questions/export.xlsx");
  expect(exported.ok()).toBeTruthy();
  const workbook = XLSX.read(Buffer.from(await exported.body()), { type: "buffer" });
  const questionSheet = workbook.Sheets.Questions!;
  const headers = XLSX.utils.sheet_to_json<string[]>(questionSheet, { header: 1, blankrows: false })[0]!;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(questionSheet, { defval: "" });
  const row = rows.find((entry) => entry.external_id === externalId)!;
  row.stem = "Updated stem from the safe XLSX maintenance workflow.";
  workbook.Sheets.Questions = XLSX.utils.json_to_sheet(rows, { header: headers });
  const editedWorkbook = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

  await page.goto("/teaching/admin/questions/maintenance");
  await page.locator('input[aria-label="Updated XLSX workbook"]').setInputFiles({ name: "teaching-maintenance.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: editedWorkbook });
  const previewed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/teaching/admin/questions/maintenance/preview" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Preview changes" }).click();
  expect((await previewed).ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "3. Review changes" })).toBeVisible();
  await expect(page.getByText(/createDraftRevision: 1/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("teaching-maintenance-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("teaching-maintenance-mobile.png"), fullPage: true });
  const confirmed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/teaching/admin/questions/maintenance/confirm" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Confirm Updates" }).click();
  const confirmationResponse = await confirmed;
  expect(confirmationResponse.ok()).toBeTruthy();
  const confirmation = await confirmationResponse.json() as { newDraftRevision: number; conflicts: number; exceptions: unknown[] };
  expect(confirmation.exceptions).toEqual([]);
  expect(confirmation).toMatchObject({ newDraftRevision: 1, conflicts: 0 });
  await expect(page.getByText(/1 new Draft revisions created/)).toBeVisible();

  const detail = await page.request.get(`http://127.0.0.1:3100/api/teaching/admin/questions/${item!.id}`);
  const persisted = await detail.json() as { revisions: Array<{ revisionNumber: number; status: string; stem: string }> };
  expect(persisted.revisions[0]).toMatchObject({ revisionNumber: 2, status: "draft", stem: "Updated stem from the safe XLSX maintenance workflow." });
  expect(persisted.revisions[1]).toMatchObject({ revisionNumber: 1, status: "published", stem: "Published stem before XLSX maintenance. No patient information." });
});
