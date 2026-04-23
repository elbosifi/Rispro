import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const filePath = "/Users/serajalsaifi/Nextcloud/RISpro/src/services/appointment-service.ts";

test("appointment service exposes both deactivate and hard delete modality actions", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes("export async function deactivateModality"), "Should export deactivateModality");
  assert.ok(content.includes("export async function hardDeleteModality"), "Should export hardDeleteModality");
  assert.ok(content.includes('actionType: "deactivate"'), "Deactivation should be audited as deactivate");
  assert.ok(content.includes('actionType: "hard_delete"'), "Hard delete should be audited distinctly");
});
