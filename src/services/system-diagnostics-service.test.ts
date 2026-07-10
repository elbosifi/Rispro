import test from "node:test";
import assert from "node:assert/strict";

test("diagnostic redaction removes credentials, URLs, headers, and tokens", async () => {
  process.env.DATABASE_URL ||= "postgresql://example/example";
  process.env.JWT_SECRET ||= "test-secret";
  const { redactDiagnosticMetadata, redactDiagnosticText } = await import("./system-diagnostics-service.js");
  const value = redactDiagnosticText("password=hunter2 token=abc Authorization: Bearer jwt Cookie: session=abc postgresql://user:pass@host/db DATABASE_URL=postgresql://x:y@z/db");
  assert.doesNotMatch(value, /hunter2|abc|jwt|:pass@|x:y@/i);
  assert.match(value, /REDACTED/);
  assert.deepEqual(redactDiagnosticMetadata({ requestBody: { patient: "x" }, cookies: "a=b", safe: "ok" }), { requestBody: "[REDACTED]", cookies: "[REDACTED]", safe: "ok" });
});
