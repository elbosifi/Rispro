import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const filePath = `${process.cwd()}/frontend/src/pages/settings/settings-page.tsx`;

test("modality settings page exposes deactivate and hard delete actions", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes("Deactivate"), "Settings page should include a deactivate action");
  assert.ok(content.includes("Activate"), "Settings page should include an activate action for inactive rows");
  assert.ok(content.includes("Hard Delete"), "Settings page should include a hard delete action");
  assert.ok(
    content.includes('mutationFn: (id: number) => deactivateModality(id)'),
    "Settings page should call the deactivate API"
  );
  assert.ok(
    content.includes('updateMutation.mutate({ id: m.id, data: { ...m, is_active: true } })'),
    "Settings page should reactivate inactive modalities through the edit mutation"
  );
  assert.ok(
    content.includes('mutationFn: (id: number) => deleteModality(id)'),
    "Settings page should call the hard delete API"
  );
});
