import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("incident routes keep attachments isolated and generic documents cannot expose incident linkage", () => {
  const incidents = fs.readFileSync(new URL("./incidents.ts", import.meta.url), "utf8");
  const documents = fs.readFileSync(new URL("./documents.ts", import.meta.url), "utf8");
  assert.match(incidents, /listDocuments\(\{ incidentId: id \}\)\)\.map\(\s*toPublicDocumentResponse/);
  assert.match(incidents, /incidentId: id,[\s\S]*documentType: "incident_attachment",[\s\S]*source: "manual_upload"/);
  assert.doesNotMatch(documents, /incidentId: asOptionalUserId/);
  assert.match(documents, /documents\.map\(toPublicDocumentResponse\)/);
});
