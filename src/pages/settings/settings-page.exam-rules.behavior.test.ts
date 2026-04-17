import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const filePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/pages/settings/settings-page.tsx";

test("exam-rule modality change clears stale examTypeIds", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(
    content.includes("{ ...r, modalityId: v, examTypeIds: [] }"),
    "Exam rule modality change should clear examTypeIds"
  );
});

test("exam-rule selector shows helper when modality is missing", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(
    content.includes("Select a modality first"),
    'Should show "Select a modality first" helper text'
  );
});

test("exam-rule selector shows helper when selected modality has no exam types", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(
    content.includes("No exam types configured for selected modality"),
    'Should show "No exam types configured for selected modality" helper text'
  );
});
