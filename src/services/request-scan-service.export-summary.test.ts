import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Request Scan list projects the stable clinical-document export summary without an additional per-row query", async () => {
  const source = await readFile("src/services/request-scan-service.ts", "utf8");
  for (const field of [
    "clinical_document_export_representation_type",
    "clinical_document_export_expected_page_count",
    "clinical_document_export_exported_page_count",
    "clinical_document_export_verified_page_count",
    "clinical_document_export_failed_page_number",
    "clinical_document_export_last_attempt_at",
    "clinical_document_export_next_retry_at",
    "clinical_document_export_last_error",
    "clinical_document_export_exported_at",
  ]) assert.match(source, new RegExp(`export\\.[a-z_]+ as ${field}`));
  assert.match(source, /left join lateral \(select e\.id, e\.status,/);
  assert.match(source, /select i\.page_number from clinical_document_export_instances/);
  assert.doesNotMatch(source, /for \(const .* of rows.*clinical_document_exports/s);
});
