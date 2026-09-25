import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../../utils/http-error.js";
import {
  parseTeachingQuestionInput,
  parseTeachingReferenceInput,
  parseTeachingSourceInput,
} from "../domain/teaching-content-validation.js";

const question = {
  externalId: "RAD-NEURO-000001",
  questionBankCode: "radiology-main",
  type: "single_best_answer",
  stem: "Which finding is most likely?",
  specialtyCode: "radiology",
  domainCode: "neuroradiology",
  topicCode: "brain-tumors",
  subtopicCode: "glioma",
  difficulty: 3,
  trainingLevelCode: "junior_resident",
  explanation: { summary: "Summary", teachingPoint: "Teaching point" },
  options: [
    { key: "A", text: "Choice A", isCorrect: true },
    { key: "B", text: "Choice B", isCorrect: false },
  ],
  modalityCodes: ["CT", "MRI"],
  competencyCodes: ["diagnosis", "imaging_findings"],
  tagCodes: ["oncology", "emergency"],
  sources: [{ sourceId: 1, relationship: "adapted" }],
  references: [{ referenceId: 1 }],
  assetIds: [],
  authorship: { kind: "human_authored" },
};

test("Teaching question validation accepts complete SBA content and rejects invalid answer sets", () => {
  const parsed = parseTeachingQuestionInput(question);
  assert.equal(parsed.externalId, "RAD-NEURO-000001");
  assert.deepEqual(parsed.modalityCodes, ["CT", "MRI"]);
  assert.equal(parsed.options.filter((option) => option.isCorrect).length, 1);

  for (const options of [
    [{ key: "A", text: "A", isCorrect: false }, { key: "B", text: "B", isCorrect: false }],
    [{ key: "A", text: "A", isCorrect: true }, { key: "B", text: "B", isCorrect: true }],
    [{ key: "A", text: "A", isCorrect: true }, { key: "A", text: "Duplicate", isCorrect: false }],
  ]) {
    assert.throws(() => parseTeachingQuestionInput({ ...question, options }), HttpError);
  }
});

test("Teaching validation rejects unknown question, provenance, source, URL and ID formats", () => {
  assert.throws(() => parseTeachingQuestionInput({ ...question, type: "essay" }), HttpError);
  assert.throws(() => parseTeachingQuestionInput({ ...question, externalId: "rad-1" }), HttpError);
  assert.throws(() => parseTeachingQuestionInput({ ...question, type: "case_based_sba", caseId: null }), HttpError);
  assert.throws(() => parseTeachingQuestionInput({ ...question, sources: [{ sourceId: 1, relationship: "copied" }] }), HttpError);
  assert.throws(() => parseTeachingQuestionInput({ ...question, assetIds: ["not-an-id"] }), HttpError);
  assert.throws(() => parseTeachingSourceInput({ sourceType: "book", title: "Book" }), HttpError);
  assert.throws(() => parseTeachingSourceInput({ sourceType: "textbook", title: "Book", url: "javascript:alert(1)" }), HttpError);
});

test("Teaching reference and exam source metadata remain distinct validated records", () => {
  const source = parseTeachingSourceInput({
    sourceType: "exam", title: "Board review", examName: "Radiology Board", examSitting: "2024",
    examPaper: "Paper 1", questionNumber: "5", authors: ["Faculty"], metadata: { region: "north" },
  });
  const reference = parseTeachingReferenceInput({
    referenceType: "journal_article", title: "Imaging review", authors: ["Author"], year: 2024,
    doi: "10.1000/example", citationText: "Author. Imaging review.",
  });
  assert.equal(source.sourceType, "exam");
  assert.equal(source.examName, "Radiology Board");
  assert.equal(reference.referenceType, "journal_article");
  assert.equal(reference.citationText, "Author. Imaging review.");
});
