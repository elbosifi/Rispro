import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const filePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/pages/settings/settings-page.tsx";

test("exam type settings page exposes activate and deactivate actions", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes("Deactivate"), "Settings page should include a deactivate action for exam types");
  assert.ok(content.includes("Activate"), "Settings page should include an activate action for inactive exam types");
  assert.ok(content.includes("Hard Delete"), "Settings page should include a hard delete action for inactive exam types");
  assert.ok(
    content.includes("تحضير الفحص (عربي)") && content.includes("Exam preparation (English)"),
    "Settings page should include exam preparation fields in the form"
  );
  assert.ok(
    content.includes('mutationFn: (id: number) => deleteExamType(id)'),
    "Settings page should call the exam-type deactivate API"
  );
  assert.ok(
    content.includes('mutationFn: (id: number) => hardDeleteExamType(id)'),
    "Settings page should call the exam-type hard delete API"
  );
  assert.ok(
    content.includes('updateMutation.mutate({ id: et.id, data: { modalityId: et.modality_id, name_ar: et.name_ar, name_en: et.name_en, specific_instruction_ar: et.specific_instruction_ar, specific_instruction_en: et.specific_instruction_en, is_active: true } })'),
    "Settings page should reactivate inactive exam types through the update mutation"
  );
  assert.ok(
    content.includes("specificInstructionAr: data.specific_instruction_ar") &&
      content.includes("specificInstructionEn: data.specific_instruction_en"),
    "Settings page should forward exam preparation text through create/update payloads"
  );
});
