import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const filePath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/pages/appointments/appointments-page.tsx";

test("appointments page removes TEST wording and shows availability legend", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(!content.includes("Create Appointment TEST"));
  assert.ok(content.includes("Legend"));
  assert.ok(content.includes("Needs supervisor approval"));
  assert.ok(content.includes("Blocked"));
});

test("appointments page uses dropdown-based special reason lookup", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes("const specialReasons = lookups?.specialReasons ?? []"));
  assert.ok(content.includes("Select special reason…"));
  assert.ok(content.includes("specialReasons.filter"));
  assert.ok(!content.includes('placeholder="Reason code"'));
});

test("appointments page has explicit typed-date rejection for dates outside loaded set", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes("outside the currently loaded availability window"));
  assert.ok(content.includes("setTypedDateError"));
});

test("appointments page keeps blocked dates visible and non-clickable", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes("const isBlocked = displayStatus === \"blocked\""));
  assert.ok(content.includes("cursor-not-allowed"));
  assert.ok(content.includes("opacity-50"));
});

test("appointments page separates override reason from notes", async () => {
  const content = await readFile(filePath, "utf-8");
  assert.ok(content.includes("overrideReason"));
  assert.ok(content.includes('placeholder="Supervisor override reason"'));
  assert.ok(content.includes("reason: form.overrideReason || undefined"));
  assert.ok(!content.includes("reason: form.specialReasonNote || form.notes"));
});
