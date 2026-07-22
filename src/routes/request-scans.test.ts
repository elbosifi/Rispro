import assert from "node:assert/strict";
import test from "node:test";
import { setRequestScanFileHeaders } from "./request-scans.js";

test("Request Scan file response is private and inline for PDF and JPEG previews", () => {
  const headers = new Map<string, string>();
  const response = { setHeader(name: string, value: string) { headers.set(name, value); } };
  setRequestScanFileHeaders(response as never, { filename: 'request".pdf', mime_type: "application/pdf" });
  assert.equal(headers.get("Content-Type"), "application/pdf");
  assert.equal(headers.get("Content-Disposition"), 'inline; filename="request.pdf"');
  assert.equal(headers.get("Cache-Control"), "private, no-store");
  setRequestScanFileHeaders(response as never, { filename: "request.jpg", mime_type: "image/jpeg" });
  assert.equal(headers.get("Content-Type"), "image/jpeg");
});
