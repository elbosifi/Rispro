import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://example@example/mwl_eligibility_test";
process.env.JWT_SECRET ??= "mwl-eligibility-test-secret";

const { resolveMwlProtocolGate } = await import("./mwl-eligibility-service.js");

function gate(overrides: Partial<Parameters<typeof resolveMwlProtocolGate>[0]> = {}) {
  return resolveMwlProtocolGate({
    bookingId: 1,
    bookingStatus: "scheduled",
    protocolingModalityApplies: true,
    protocolRequirementEnabled: true,
    activeProtocolAssignmentExists: false,
    ...overrides,
  });
}

test("disabled protocol policy preserves CT and MRI MWL eligibility", () => {
  assert.equal(gate({ protocolRequirementEnabled: false }).protocolGateSatisfied, true);
});

test("enabled protocol policy holds CT or MRI without an active assignment", () => {
  const result = gate();
  assert.equal(result.protocolGateSatisfied, false);
  assert.equal(result.holdReason, "waiting_for_protocol");
});

test("saved and free-text active assignments satisfy the same status-based gate", () => {
  const result = gate({ activeProtocolAssignmentExists: true });
  assert.equal(result.protocolGateSatisfied, true);
  assert.equal(result.holdReason, null);
});

test("non-protocoling modalities bypass the enabled policy", () => {
  assert.equal(gate({ protocolingModalityApplies: false }).protocolGateSatisfied, true);
});
