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
  assert.match(source, /manual_retry_new_file|createsNewDeliveryAttempt/);
});

test("file-drop writer still uses tmp write, rename, and pending import", () => {
  assert.match(source, /writeSanteOutboxJobToFileDrop/);
  assert.match(source, /fs\.writeFile\(tmpPath, built\.message, "utf8"\)/);
  assert.match(source, /fs\.rename\(tmpPath, targetPath\)/);
  assert.match(source, /status = 'pending_import'/);
});

test("MLLP delivery records acknowledged, nack, and retryable send failure paths", () => {
  assert.match(source, /sendSanteOutboxJobViaMllp/);
  assert.match(source, /status = 'acknowledged'/);
  assert.match(source, /status = 'nack_received'/);
  assert.match(source, /status = 'send_failed'/);
  assert.match(source, /markSanteOutboxFailure\(job, message, job\.attemptCount < job\.maxAttempts\)/);
});

test("queue-only setting skips first Sante send until booking enters queue", () => {
  assert.match(source, /sendOnlyWhenPatientEntersQueue/);
  assert.match(source, /QUEUE_STATUSES = new Set\(\["arrived", "waiting"\]\)/);
  assert.match(source, /waiting_for_patient_queue/);
});

test("detail replacement queues cancel before fresh create for queued synced bookings", () => {
  assert.match(source, /enqueueSanteHl7ReplacementForBooking/);
  assert.match(source, /booking_not_in_queue/);
  const cancelIndex = source.indexOf(`eventType: "cancel"`);
  const createIndex = source.indexOf(`eventType: "create"`, cancelIndex);
  assert.ok(cancelIndex > 0, "replacement path enqueues cancel");
  assert.ok(createIndex > cancelIndex, "replacement path enqueues create after cancel");
  assert.match(source, /orderControl: "CA"/);
  assert.match(source, /orderControl: "NW"/);
});
