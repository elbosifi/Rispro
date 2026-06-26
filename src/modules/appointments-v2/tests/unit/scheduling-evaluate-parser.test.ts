import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseEvaluateBookingDecisionRequestBody } from "../../api/routes/scheduling-evaluate-parser.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";

const validBody = {
  patientId: 10,
  modalityId: 20,
  examTypeId: 30,
  scheduledDate: "2026-05-05",
  caseCategory: "non_oncology",
};

function assertSchedulingError(fn: () => unknown, messagePart: string) {
  assert.throws(
    fn,
    (error) =>
      error instanceof SchedulingError &&
      error.statusCode === 400 &&
      error.message.includes(messagePart)
  );
}

describe("parseEvaluateBookingDecisionRequestBody", () => {
  it("parses valid evaluate request values and preserves defaults", () => {
    const parsed = parseEvaluateBookingDecisionRequestBody({
      ...validBody,
      specialReasonCode: "special-case",
      includeOverrideEvaluation: true,
    });

    assert.deepEqual(parsed, {
      patientId: 10,
      modalityId: 20,
      examTypeId: 30,
      scheduledDate: "2026-05-05",
      caseCategory: "non_oncology",
      capacityResolutionMode: "standard",
      useSpecialQuota: false,
      specialReasonCode: "special-case",
      includeOverrideEvaluation: true,
      policySetKey: undefined,
    });
  });

  it("defaults capacityResolutionMode from useSpecialQuota", () => {
    const parsed = parseEvaluateBookingDecisionRequestBody({
      ...validBody,
      useSpecialQuota: true,
    });

    assert.equal(parsed.capacityResolutionMode, "special_quota_extra");
    assert.equal(parsed.useSpecialQuota, true);
  });

  it("rejects invalid evaluate request body values", () => {
    const cases: Array<{ name: string; body: Record<string, unknown>; message: string }> = [
      { name: "missing patientId", body: { ...validBody, patientId: undefined }, message: "patientId" },
      { name: "invalid patientId", body: { ...validBody, patientId: 0 }, message: "patientId" },
      { name: "invalid modalityId", body: { ...validBody, modalityId: "abc" }, message: "modalityId" },
      { name: "invalid examTypeId", body: { ...validBody, examTypeId: 0 }, message: "examTypeId" },
      { name: "invalid scheduledDate", body: { ...validBody, scheduledDate: "2026-02-30" }, message: "scheduledDate" },
      { name: "invalid caseCategory", body: { ...validBody, caseCategory: "urgent" }, message: "caseCategory" },
      { name: "invalid capacityResolutionMode", body: { ...validBody, capacityResolutionMode: "bad_mode" }, message: "capacityResolutionMode" },
      { name: "non-boolean useSpecialQuota", body: { ...validBody, useSpecialQuota: "true" }, message: "useSpecialQuota" },
      { name: "non-boolean includeOverrideEvaluation", body: { ...validBody, includeOverrideEvaluation: "false" }, message: "includeOverrideEvaluation" },
    ];

    for (const testCase of cases) {
      assertSchedulingError(
        () => parseEvaluateBookingDecisionRequestBody(testCase.body),
        testCase.message
      );
    }
  });
});
