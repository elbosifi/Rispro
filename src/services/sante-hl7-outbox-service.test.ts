import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";

const source = await fs.readFile(new URL("./sante-hl7-outbox-service.ts", import.meta.url), "utf8");

test("Sante outbox does not persist full HL7 payload text", () => {
  assert.doesNotMatch(source, /hl7_payload|message_payload|payload_text|full_payload/i);
  assert.match(source, /payload_hash/);
});

test("manual retry clears paths so retry creates a new unique file", () => {
  assert.match(source, /target_path = null/);
  assert.match(source, /tmp_path = null/);
  assert.match(source, /manual_retry_new_file/);
});

