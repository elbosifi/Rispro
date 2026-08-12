import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorklistMonitorQuery } from "./worklist-monitor-service.js";
import { computeWorklistMonitorBackendStatus } from "./worklist-monitor-service.js";

test("normalizeWorklistMonitorQuery applies safe defaults and caps limit", () => {
  const result = normalizeWorklistMonitorQuery({ limit: "9999" }, "2026-05-26");

  assert.equal(result.dateFrom, "2026-05-26");
  assert.equal(result.dateTo, "2026-05-26");
  assert.equal(result.limit, 500);
  assert.equal(result.status, "all");
});

test("normalizeWorklistMonitorQuery preserves supported filters", () => {
  const result = normalizeWorklistMonitorQuery({
    dateFrom: "2026-05-20",
    dateTo: "2026-05-26",
    modalityId: "7",
    status: "failed",
    q: "V2-000123",
    limit: "50",
  }, "2026-05-26");

  assert.equal(result.dateFrom, "2026-05-20");
  assert.equal(result.dateTo, "2026-05-26");
  assert.equal(result.modalityId, 7);
  assert.equal(result.status, "failed");
  assert.equal(result.q, "V2-000123");
  assert.equal(result.limit, 50);
});

test("monitor gives protocol hold precedence over queue hold", () => {
  assert.equal(computeWorklistMonitorBackendStatus({
    bookingStatus: "scheduled",
    protocolingModalityCode: "CT",
    activeProtocolAssignmentExists: false,
    protocolRequirementEnabled: true,
    queueOnly: true,
    syncStatus: null,
  }), "waiting_for_protocol");
});

test("monitor reports queue hold after the protocol gate passes", () => {
  assert.equal(computeWorklistMonitorBackendStatus({
    bookingStatus: "scheduled",
    protocolingModalityCode: "MRI",
    activeProtocolAssignmentExists: true,
    protocolRequirementEnabled: true,
    queueOnly: true,
    syncStatus: null,
  }), "waiting_for_queue");
});

test("monitor never applies protocol holds to Mammo or Ultrasound", () => {
  for (const modality of ["MG", "US"]) {
    assert.equal(computeWorklistMonitorBackendStatus({
      bookingStatus: "scheduled",
      protocolingModalityCode: modality,
      activeProtocolAssignmentExists: false,
      protocolRequirementEnabled: true,
      queueOnly: false,
      syncStatus: null,
    }), "not_enqueued");
  }
});

test("terminal cleanup status is not masked by a missing protocol", () => {
  assert.equal(computeWorklistMonitorBackendStatus({
    bookingStatus: "cancelled",
    protocolingModalityCode: "CT",
    activeProtocolAssignmentExists: false,
    protocolRequirementEnabled: true,
    queueOnly: true,
    syncStatus: "pending",
  }), "pending");
});
