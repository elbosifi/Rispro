import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("authoritative Orthanc routes keep settings restricted and modality status read-only", async () => {
  const source = await readFile(new URL("./authoritative-orthanc.ts", import.meta.url), "utf8");
  assert.match(source, /get\("\/settings", requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  assert.match(source, /put\("\/settings", requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  assert.match(source, /post\("\/test", requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  assert.match(source, /get\("\/status", requireAnyRole\(\["modality_staff", "supervisor", "super_admin"\]\)/);
  assert.match(source, /get\("\/appointments\/:appointmentId\/study", requireAnyRole\(\["modality_staff", "supervisor", "super_admin"\]\)/);
  assert.match(source, /get\("\/appointments\/:appointmentId\/document-exports", requireAnyRole\(\["modality_staff", "supervisor", "super_admin"\]\)/);
  assert.match(source, /post\("\/document-exports\/reconcile", requireAnyRole\(\["super_admin"\]\)/);
  assert.match(source, /post\("\/document-exports\/:exportId\/retry", requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  assert.doesNotMatch(source, /delete\(|\/instances["'`]|\/series["'`]|\/studies["'`]/i);
});
