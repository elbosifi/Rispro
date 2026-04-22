import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeIncomingMppsEvent } from "./mpps-service.js";

describe("mpps-service normalization", () => {
  it("normalizes MPPS payload fields and status", () => {
    const normalized = normalizeIncomingMppsEvent({
      eventType: "n-create",
      sourceAeTitle: "ct_room_1",
      patientId: "MRN-123",
      accessionNumber: "V2-42",
      studyInstanceUid: "1.2.3.4",
      mppsInstanceUid: "2.16.840.1",
      performedStepStatus: "in_progress",
      requestedProcedureId: "V2-42",
      scheduledProcedureStepId: "V2-42",
      modality: "ct",
      scheduledStartDate: "2026-04-22",
      scheduledStartTime: "09:15",
      rawDatasetJson: { PatientID: "MRN-123" },
    });

    assert.equal(normalized.eventType, "n-create");
    assert.equal(normalized.sourceAeTitle, "CT_ROOM_1");
    assert.equal(normalized.performedStepStatus, "IN PROGRESS");
    assert.equal(normalized.modality, "CT");
    assert.equal(normalized.scheduledStartDate, "20260422");
    assert.equal(normalized.scheduledStartTime, "091500");
    assert.ok(normalized.dedupeKey.length > 10);
  });

  it("rejects payloads without identifiers", () => {
    assert.throws(
      () => normalizeIncomingMppsEvent({
        eventType: "n-set",
        sourceAeTitle: "CT_AE",
        performedStepStatus: "COMPLETED",
        rawDatasetJson: {},
      }),
      /At least one identifier is required/
    );
  });
});
