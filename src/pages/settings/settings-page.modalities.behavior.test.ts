import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const filePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/pages/settings/settings-page.tsx";

test("modality settings list loads active modalities only", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(
    content.includes('queryFn: () => fetchModalitiesSettings(showInactive)'),
    "Modalities section should load modalities based on the showInactive toggle"
  );
  assert.ok(
    content.includes("Showing all modalities, including inactive ones.") &&
      content.includes("Showing active modalities only. Deactivated modalities stay hidden from this list."),
    "Modalities section should explain the current visibility mode"
  );
  assert.ok(
    content.includes('showInactive ? "Hide inactive" : "Show inactive"'),
    "Modalities section should expose a toggle for inactive rows"
  );
});
