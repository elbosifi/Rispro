import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { uploadDocument } from "./document-service.js";
import { HttpError } from "../utils/http-error.js";

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 1,
    appointmentId: 1,
    appointmentRefType: "legacy_appointment",
    documentType: "appointment_request",
    originalFilename: "request.pdf",
    mimeType: "application/pdf",
    fileContentBase64: Buffer.from("ok").toString("base64"),
    ...overrides,
  };
}

describe("document upload validation", () => {
  it("rejects invalid MIME types before storage", async () => {
    await assert.rejects(
      () => uploadDocument(basePayload({ mimeType: "text/plain", originalFilename: "request.txt" }), 1),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 400);
        assert.equal(error.message, "Document type must be PDF, JPEG, or PNG.");
        return true;
      }
    );
  });

  it("rejects documents over 50 MB before storage", async () => {
    const tooLarge = Buffer.alloc(50 * 1024 * 1024 + 1).toString("base64");
    await assert.rejects(
      () => uploadDocument(basePayload({ fileContentBase64: tooLarge }), 1),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, 413);
        assert.equal(error.message, "Uploaded document exceeds the 50 MB limit.");
        return true;
      }
    );
  });
});
