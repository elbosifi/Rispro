import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("authoritative Orthanc routes keep settings restricted and modality status read-only", async () => {
  const source = await readFile(new URL("./authoritative-orthanc.ts", import.meta.url), "utf8");
  assert.match(source, /get\("\/settings", requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  assert.match(source, /put\("\/settings", requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  assert.match(source, /post\("\/test", requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  assert.match(source, /get\("\/status", requireAnyRole\(\["modality_staff", "supervisor", "super_admin"\]\)/);
  assert.match(source, /use\("\/operations", requireAnyRole\(\["modality_staff", "supervisor", "super_admin"\]\), requirePageAccess\("authoritative\.orthanc"\)\)/);
  assert.match(source, /get\("\/operations\/summary"/);
  assert.match(source, /get\("\/operations\/routes"/);
  assert.match(source, /get\("\/operations\/jobs"/);
  assert.match(source, /get\("\/operations\/studies\/search"/);
  assert.match(source, /post\("\/operations\/routes\/test-all", requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  assert.match(source, /post\("\/operations\/routes\/:alias\/test", requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  assert.match(source, /post\("\/operations\/jobs\/:jobId\/retry", requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  assert.match(source, /post\("\/operations\/routes\/synchronize", requireAnyRole\(\["super_admin"\]\)/);
  assert.match(source, /get\("\/appointments\/:appointmentId\/study", requireAnyRole\(\["modality_staff", "supervisor", "super_admin"\]\)/);
  assert.match(source, /get\("\/appointments\/:appointmentId\/document-exports", requireAnyRole\(\["modality_staff", "supervisor", "super_admin"\]\)/);
  assert.match(source, /post\("\/document-exports\/reconcile", requireAnyRole\(\["super_admin"\]\)/);
  const retryRoute = source.match(/post\("\/document-exports\/:exportId\/retry"[^\n]*/)?.[0] || "";
  assert.match(retryRoute, /requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  assert.doesNotMatch(retryRoute, /modality_staff/);
  assert.doesNotMatch(source, /delete\(|\/instances["'`]|\/series["'`]|\/studies["'`]/i);
});
