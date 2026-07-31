import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeClinicalDocumentExportError } from "./clinical-document-export-service.js";

test("clinical-document export sanitizer removes credentials, paths, and unsafe formatting", () => {
  const cases = [
    ["Authorization: Basic abc123", ["abc123"]], ["Authorization: Bearer secret", ["secret"]], ["Authorization: Token secret", ["secret"]],
    ["X-API-Key: secret", ["secret"]], ["Cookie: session=secret", ["secret"]], ["Set-Cookie: sid=secret", ["secret"]],
    ["Proxy-Authorization: ApiKey abc123", ["abc123"]], ["C:\\scans\\patient.pdf", ["C:\\scans"]], ["\\\\server\\share\\patient.pdf", ["\\\\server\\share"]],
    ["/srv/rispro/documents/patient.pdf", ["/srv/rispro"]], ["http://user:password@host:8042/path", ["user:password"]],
    ["https://host/path?token=secret", ["token=secret"]], ["line one\n\tline two", ["\n", "\t"]],
  ] as const;
  for (const [input, forbidden] of cases) { const result = sanitizeClinicalDocumentExportError(input); for (const value of forbidden) assert.doesNotMatch(result, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")); }
  assert.equal(sanitizeClinicalDocumentExportError("Orthanc request timed out."), "Orthanc request timed out.");
  assert.equal(sanitizeClinicalDocumentExportError(""), "Clinical document export failed.");
  assert.equal(sanitizeClinicalDocumentExportError("x".repeat(500)).length, 300);
});
