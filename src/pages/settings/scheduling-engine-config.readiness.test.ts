import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const filePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/pages/settings/settings-page.tsx";

test("scheduling config uses lookup object arrays for modalities and exam types", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes("modalityLookup?.modalities"));
  assert.ok(content.includes("examTypeLookup?.examTypes"));
});

test("scheduling config renders accordion sections", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes("<details className=\"rounded-lg border"));
  assert.ok(content.includes("<summary className=\"cursor-pointer list-none\""));
});

test("scheduling config has rule-type-aware field visibility", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes('row.ruleType === "specific_date"'));
  assert.ok(content.includes('row.ruleType === "date_range"'));
  assert.ok(content.includes('row.ruleType === "yearly_recurrence"'));
  assert.ok(content.includes('row.ruleType === "weekly_recurrence"'));
});

test("scheduling config validates draft before save and still serializes all sections", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes("const validateDraft = (value: SchedulingDraft): string[]"));
  assert.ok(content.includes("saveMutation.mutate(serializeDraft(draft))"));
  assert.ok(content.includes("categoryLimits:"));
  assert.ok(content.includes("blockedRules:"));
  assert.ok(content.includes("examRules:"));
  assert.ok(content.includes("specialQuotas:"));
  assert.ok(content.includes("specialReasons:"));
  assert.ok(content.includes("identifierTypes:"));
});
