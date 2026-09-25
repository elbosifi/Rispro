import assert from "node:assert/strict";
import test from "node:test";
import { parseTeachingImportJson } from "../import/import-schema.js";

function question(externalId = "TEST-SBA-0001", overrides: Record<string, unknown> = {}) {
  return {
    externalId,
    classification: {
      specialty: "radiology",
      domain: "neuroradiology",
      topic: "brain-tumors",
      subtopics: ["glioma"],
      modalities: ["MRI"],
      competencies: ["diagnosis"],
      trainingLevel: "junior_resident",
      difficulty: 3,
      tags: ["oncology"],
    },
    type: "single_best_answer",
    stem: "Synthetic question stem.",
    options: [{ id: "A", text: "Option A" }, { id: "B", text: "Option B" }],
    answerKey: ["B"],
    explanation: {
      summary: "Synthetic explanation.",
      teachingPoint: "Synthetic teaching point.",
      furtherDiscussion: null,
      optionExplanations: { A: "Incorrect because of a synthetic reason.", B: "Correct for a synthetic reason." },
    },
    source: { type: "unknown" },
    provenance: { relationshipToSource: null },
    references: [],
    generation: { method: "ai_assisted", model: "synthetic-test-model" },
    ...overrides,
  };
}

function parse(document: Record<string, unknown>) {
  return parseTeachingImportJson(Buffer.from(JSON.stringify(document), "utf8"));
}

test("Teaching import schema parses a valid V1 question without treating template examples as import data", () => {
  const parsed = parse({
    schemaVersion: "1.0",
    _instructions: { purpose: "ignored" },
    _aiInstructions: ["ignored"],
    _catalog: { specialties: [{ code: "not-trusted" }] },
    _schemaExamples: { single_best_answer: { externalId: "EXAMPLE-NOT-IMPORTED" } },
    questions: [question()],
  });

  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.questions.length, 1);
  assert.equal(parsed.questions[0]?.externalId, "TEST-SBA-0001");
  assert.equal(parsed.questions[0]?.source?.type, "unknown");
  assert.equal(parsed.questions[0]?.relationshipToSource, null);
  assert.deepEqual(parsed.questions[0]?.references, []);
  assert.deepEqual(parsed.questions[0]?.answerKey, ["B"]);
});

test("Teaching import parser returns actionable invalid JSON and schema version errors", () => {
  assert.equal(parseTeachingImportJson(Buffer.from("{", "utf8")).errors[0]?.code, "invalid_json");
  const parsed = parse({ schemaVersion: "9.0", questions: [] });
  assert.ok(parsed.errors.some((item) => item.code === "unsupported_schema_version"));
  assert.match(parsed.errors.find((item) => item.code === "unsupported_schema_version")?.message ?? "", /Supported versions: "1\.0"/);
  const invalidUtf8 = parseTeachingImportJson(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
  assert.equal(invalidUtf8.errors[0]?.code, "invalid_encoding");
});

test("Teaching import parser rejects duplicate external IDs, answer errors, duplicate options and server-owned fields", () => {
  const invalid = question("TEST-SBA-0002", {
    id: 123,
    options: [{ id: "A", text: "A" }, { id: "A", text: "Duplicate" }],
    answerKey: ["B", "A"],
  });
  const parsed = parse({ schemaVersion: "1.0", questions: [invalid, question("TEST-SBA-0002")] });
  const codes = parsed.errors.map((item) => item.code);
  assert.ok(codes.includes("server_owned_field"));
  assert.ok(codes.includes("duplicate_option_id"));
  assert.ok(codes.includes("invalid_answer_count"));
  assert.ok(codes.includes("answer_option_missing"));
  assert.ok(codes.includes("duplicate_external_id"));
});

test("Teaching import parser rejects option identifiers outside the Teaching option-key contract", () => {
  const parsed = parse({
    schemaVersion: "1.0",
    questions: [question("TEST-SBA-0010", {
      options: [{ id: "OPTION-A", text: "A" }, { id: "B", text: "B" }],
      answerKey: ["B"],
    })],
  });
  assert.ok(parsed.errors.some((item) => item.code === "invalid_option_id"));
});

test("Teaching import parser rejects unknown fields and non-draft status", () => {
  const parsed = parse({
    schemaVersion: "1.0",
    questions: [question("TEST-SBA-0003", { status: "published", patientId: 99 })],
  });
  assert.ok(parsed.errors.some((item) => item.code === "import_status_must_be_draft"));
  assert.ok(parsed.errors.some((item) => item.code === "unknown_field" && item.path?.endsWith("patientId")));
});

test("Teaching import parser validates safe image references, case identifiers, and nested exam data", () => {
  const parsed = parse({
    schemaVersion: "1.0",
    questions: [question("TEST-IMAGE-0001", {
      type: "image_based_sba",
      media: [{ assetKey: "TEST-IMAGE-0001-01", filename: "../image.png", type: "image", altText: "Synthetic image" }],
      source: { type: "exam", exam: { name: "Synthetic Exam", year: 2024, sitting: "Spring", paper: null, questionNumber: 8 } },
      caseId: "case-invalid-lowercase",
      case: { title: "Synthetic case", clinicalHistory: null },
    })],
  });
  assert.ok(parsed.errors.some((item) => item.code === "unsafe_asset_filename"));
  assert.ok(parsed.errors.some((item) => item.code === "invalid_case_id"));
  assert.deepEqual(parsed.errors.filter((item) => item.code === "invalid_type"), []);
  assert.equal(parsed.questions[0]?.source?.examName, "Synthetic Exam");
  assert.equal(parsed.questions[0]?.source?.year, 2024);
  assert.equal(parsed.questions[0]?.source?.questionNumber, "8");
});

test("Teaching import parser rejects duplicate asset keys, unsafe URLs, and nested server-owned fields", () => {
  const first = question("TEST-IMAGE-1001", {
    type: "image_based_sba",
    media: [{ assetKey: "DUPLICATE-ASSET-KEY", filename: "first.png", type: "image", altText: "Synthetic image" }],
    source: { type: "textbook", title: "Synthetic", url: "javascript:alert(1)" },
    reviewedBy: 42,
  });
  const second = question("TEST-IMAGE-1002", {
    type: "image_based_sba",
    media: [{ assetKey: "DUPLICATE-ASSET-KEY", filename: "second.webp", type: "image", altText: "Synthetic image" }],
  });
  const parsed = parse({ schemaVersion: "1.0", questions: [first, second] });
  const codes = parsed.errors.map((item) => item.code);
  assert.ok(codes.includes("duplicate_asset_key"));
  assert.ok(codes.includes("server_owned_field"));
  assert.ok(codes.includes("invalid_url"));
});

test("Teaching import parser leaves live catalog and referenced media availability to validation", () => {
  const parsed = parse({
    schemaVersion: "1.0",
    questions: [
      question("TEST-IMAGE-0002", { type: "image_based_sba" }),
      question("TEST-CASE-0002", { type: "case_based_sba" }),
    ],
  });
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.questions.length, 2);
});
