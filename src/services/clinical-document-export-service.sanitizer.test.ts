import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeClinicalDocumentExportError } from "./clinical-document-export-service.js";

function assertRedacted(input: string, forbidden: readonly string[]): string {
  const result = sanitizeClinicalDocumentExportError(input);
  for (const value of forbidden) assert.ok(!result.toLowerCase().includes(value.toLowerCase()), `${JSON.stringify(value)} remained in ${JSON.stringify(result)}`);
  return result;
}

test("clinical-document export sanitizer removes credentials and unsafe formatting", () => {
  const cases = [
    ["Authorization: Basic abc123", ["abc123"]], ["Authorization: Bearer secret", ["secret"]], ["Authorization: Token secret", ["secret"]],
    ["X-API-Key: secret", ["secret"]], ["Cookie: session=secret", ["secret"]], ["Set-Cookie: sid=secret", ["secret"]],
    ["Proxy-Authorization: ApiKey abc123", ["abc123"]], ["http://user:password@host:8042/path", ["user:password"]],
    ["https://host/path?token=secret", ["token=secret"]], ["line one\n\tline two", ["\n", "\t"]],
  ] as const;
  for (const [input, forbidden] of cases) assertRedacted(input, forbidden);
  assert.equal(sanitizeClinicalDocumentExportError("Orthanc request timed out."), "Orthanc request timed out.");
  assert.equal(sanitizeClinicalDocumentExportError(""), "Clinical document export failed.");
  assert.equal(sanitizeClinicalDocumentExportError("x".repeat(500)).length, 300);
});

test("clinical-document export sanitizer removes complete Windows, UNC, and POSIX paths", () => {
  const cases = [
    [String.raw`C:\scans\John Doe.pdf`, ["John Doe", "Doe.pdf", String.raw`C:\scans`]],
    [String.raw`"C:\Patient Documents\John Doe.pdf"`, ["John Doe", "Doe.pdf", "Patient Documents", String.raw`C:\Patient`]],
    [String.raw`'C:\Patient Documents\John Doe.pdf'`, ["John Doe", "Doe.pdf", "Patient Documents", String.raw`C:\Patient`]],
    [String.raw`\\server\Clinical Documents\John Doe.pdf`, ["John Doe", "Doe.pdf", "Clinical Documents", String.raw`\\server`]],
    [String.raw`"\\server\Clinical Documents\John Doe.pdf"`, ["John Doe", "Doe.pdf", "Clinical Documents", String.raw`\\server`]],
    ["/usr/local/rispro/John Doe.pdf", ["John Doe", "Doe.pdf", "/usr/local"]],
    ["/etc/rispro/config.json", ["config.json", "/etc/rispro"]],
    ["/root/scans/patient.pdf", ["patient.pdf", "/root/scans"]],
    ["/workspace/documents/patient.pdf", ["patient.pdf", "/workspace/documents"]],
    ['"/srv/rispro/Patient Documents/John Doe.pdf"', ["John Doe", "Doe.pdf", "Patient Documents", "/srv/rispro"]],
  ] as const;
  for (const [input, forbidden] of cases) assertRedacted(input, forbidden);
});

test("clinical-document export sanitizer preserves useful context around complete paths", () => {
  const windows = assertRedacted(
    String.raw`Failed to read C:\Patient Documents\John Doe.pdf because access was denied.`,
    ["John Doe", "Doe.pdf", "Patient Documents", String.raw`C:\Patient`],
  );
  assert.match(windows, /Failed to read/);
  assert.match(windows, /because access was denied/);

  const posix = assertRedacted(
    "Renderer failed for /usr/local/rispro/John Doe.pdf after timeout.",
    ["John Doe", "Doe.pdf", "/usr/local"],
  );
  assert.match(posix, /Renderer failed/);
  assert.match(posix, /after timeout/);
});
