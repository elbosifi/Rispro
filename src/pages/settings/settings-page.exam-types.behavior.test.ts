import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const filePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/pages/settings/settings-page.tsx";

test("exam type settings list supports hiding and showing inactive rows", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(
    content.includes('queryFn: () => fetchExamTypes(showInactive)'),
    "Exam types section should load data based on the showInactive toggle"
  );
  assert.ok(
    content.includes("Showing all exam types, including inactive ones.") &&
      content.includes("Showing active exam types only. Deactivated exam types stay hidden from this list."),
    "Exam types section should explain the current visibility mode"
  );
  assert.ok(
    content.includes('showInactive ? "Hide inactive" : "Show inactive"'),
    "Exam types section should expose a toggle for inactive rows"
  );
});
