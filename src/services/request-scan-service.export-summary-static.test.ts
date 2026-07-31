import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Request Scan list static query-shape guard projects the expected export summary", async () => {
  const source = await readFile("src/services/request-scan-service.ts", "utf8");
  for (const mapping of ["export.representation_type as clinical_document_export_representation_type", "export.expected_page_count as clinical_document_export_expected_page_count", "export.exported_page_count as clinical_document_export_exported_page_count", "export.verified_page_count as clinical_document_export_verified_page_count", "export.failed_page_number as clinical_document_export_failed_page_number", "export.last_attempt_at as clinical_document_export_last_attempt_at", "export.next_retry_at as clinical_document_export_next_retry_at", "export.last_error as clinical_document_export_last_error", "export.exported_at as clinical_document_export_exported_at"]) assert.ok(source.includes(mapping));
  assert.match(source, /left join lateral \(select e\.id, e\.status,/);
  assert.match(source, /select i\.page_number from clinical_document_export_instances/);
  assert.doesNotMatch(source, /for \(const .* of rows.*clinical_document_exports/s);
});
