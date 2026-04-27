import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const filePath = new URL("../../../frontend/src/pages/settings/settings-page.tsx", import.meta.url);

test("exam type settings derive modality labels from the exam-types payload and mark inactive parents", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(
    content.includes('type ExamTypeModalityRow = {') &&
      content.includes('const modalityRows = (((data as { modalities?: ExamTypeModalityRow[] } | undefined)?.modalities) ?? []) as ExamTypeModalityRow[];'),
    "Exam types section should read modalities from the exam-types settings payload"
  );
  assert.ok(
    content.includes('label: m.is_active === false ? `${baseLabel} (Inactive)` : baseLabel'),
    "Inactive parent modalities should be labeled clearly instead of rendering blank"
  );
  assert.ok(
    content.includes('const modality = modalityById.get(String(et.modality_id));') &&
      content.includes('if (!modality) return "Not assigned";'),
    "Exam type rows should resolve modality names from the returned modality map"
  );
});
