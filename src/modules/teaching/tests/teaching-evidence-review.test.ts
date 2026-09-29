import assert from "node:assert/strict";
import test from "node:test";
import { parseTeachingQuestionInput } from "../domain/teaching-content-validation.js";

function question(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "EVIDENCE-TEST-001",
    questionBankCode: "radiology-main",
    type: "single_best_answer",
    stem: "Which answer is correct?",
    specialtyCode: "radiology",
    domainCode: "neuroradiology",
    topicCode: "brain-tumors",
    subtopicCode: "glioma",
    difficulty: 3,
    trainingLevelCode: "junior_resident",
    caseId: null,
    explanation: { summary: "Summary", teachingPoint: "Teaching point", furtherDiscussion: null },
    options: [{ key: "A", text: "Answer", isCorrect: true }, { key: "B", text: "Distractor", isCorrect: false }],
    modalityCodes: ["MRI"], competencyCodes: ["diagnosis"], tagCodes: ["oncology"],
    sources: [], references: [{ referenceId: 1, notes: null }], assetIds: [], assetAltTexts: [],
    authorship: { kind: "human_authored", modelName: null },
    ...overrides,
  };
}

test("Teaching evidence review requires support only for reviewed statuses", () => {
  assert.deepEqual(parseTeachingQuestionInput(question()).evidenceReview, { status: "not_verified", checkedAt: null, summary: "", update: null });
  assert.deepEqual(parseTeachingQuestionInput(question({ evidenceReview: { status: "confirmed", checkedAt: "2026-09-01", summary: "Reviewed against current guidance.", update: null } })).evidenceReview, { status: "confirmed", checkedAt: "2026-09-01", summary: "Reviewed against current guidance.", update: null });
  assert.deepEqual(parseTeachingQuestionInput(question({ evidenceReview: { status: "uncertain", checkedAt: "2026-09-01", summary: "Evidence is mixed.", update: null } })).evidenceReview, { status: "uncertain", checkedAt: "2026-09-01", summary: "Evidence is mixed.", update: null });
  assert.deepEqual(parseTeachingQuestionInput(question({ evidenceReview: { status: "updated", checkedAt: "2026-09-01", summary: "Current evidence changes the answer.", update: "Correct answer revised." } })).evidenceReview, { status: "updated", checkedAt: "2026-09-01", summary: "Current evidence changes the answer.", update: "Correct answer revised." });
  assert.throws(() => parseTeachingQuestionInput(question({ evidenceReview: { status: "confirmed", summary: "Missing date.", update: null } })), /checkedAt is required/);
  assert.throws(() => parseTeachingQuestionInput(question({ references: [], evidenceReview: { status: "confirmed", checkedAt: "2026-09-01", summary: "Missing reference.", update: null } })), /supporting reference/);
  assert.throws(() => parseTeachingQuestionInput(question({ evidenceReview: { status: "updated", checkedAt: "2026-09-01", summary: "Missing update.", update: null } })), /update is required/);
});
