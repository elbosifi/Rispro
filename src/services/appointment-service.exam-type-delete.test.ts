import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const filePath = "/Users/serajalsaifi/Nextcloud/RISpro/src/services/appointment-service.ts";

test("appointment service exposes both deactivate and hard delete exam type actions", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes("export async function deleteExamType"), "Should export deleteExamType");
  assert.ok(content.includes("export async function hardDeleteExamType"), "Should export hardDeleteExamType");
  assert.ok(content.includes('actionType: "delete"'), "Soft delete should be audited as delete");
  assert.ok(content.includes('actionType: "hard_delete"'), "Hard delete should be audited distinctly");
  assert.ok(
    content.includes("Deactivate this exam type first before permanently deleting it."),
    "Hard delete should require the exam type to be inactive first"
  );
});
