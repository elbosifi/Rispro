import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import test from "node:test";
import jwt from "jsonwebtoken";
import AdmZip from "adm-zip";
import sharp from "sharp";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "teaching-import-test-secret";

interface JsonResponse {
  status: number;
  data: Record<string, unknown>;
  headers: Headers;
}

function question(externalId: string, overrides: Record<string, unknown> = {}) {
  return {
    externalId,
    classification: {
      specialty: "radiology",
      domain: "neuroradiology",
      topic: "brain-tumors",
      subtopics: ["glioma"],
      modalities: ["MRI"],
      competencies: ["diagnosis", "imaging_findings"],
      trainingLevel: "junior_resident",
      difficulty: 3,
      tags: ["oncology"],
    },
    type: "single_best_answer",
    stem: "Synthetic teaching question stem for import integration coverage.",
    options: [{ id: "A", text: "Synthetic distractor" }, { id: "B", text: "Synthetic correct option" }],
    answerKey: ["B"],
    explanation: {
      summary: "Synthetic explanation for the disposable integration test.",
      teachingPoint: "Synthetic teaching point for the disposable integration test.",
      furtherDiscussion: null,
      optionExplanations: { A: "Synthetic distractor explanation.", B: "Synthetic correct explanation." },
    },
    source: { type: "unknown" },
    provenance: { relationshipToSource: null },
    references: [],
    generation: { method: "ai_assisted", model: "synthetic-test-model" },
    ...overrides,
  };
}

function signedCookie(subject: string, role: string, env: { jwtSecret: string; cookieName: string }): string {
  return `${env.cookieName}=${jwt.sign({ sub: subject, role, fullName: "Teaching Import Test" }, env.jwtSecret)}`;
}

test("Teaching import template, authorization, inspect-preview-confirm, conflict handling, ZIP assets, and draft lineage", async (t) => {
  const [{ createApp }, { pool }, { env }] = await Promise.all([
    import("../../../app.js"),
    import("../../../db/pool.js"),
    import("../../../config/env.js"),
  ]);
  try {
    await pool.query("select 1 from teaching.import_batches limit 1");
  } catch {
    t.skip("PostgreSQL is not reachable at the configured disposable DATABASE_URL.");
    return;
  }

  const subject = BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 12)}`).toString();
  const learnerSubject = (BigInt(subject) + 1n).toString();
  const externalIds = [
    `TST-JSON-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    `TST-ZIP-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    `TST-CASE-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    `TST-YEAR-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    `TST-ROLLBACK-A-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
    `TST-ROLLBACK-B-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
    `TST-SOURCE-A-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
    `TST-SOURCE-B-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
    `TST-IMAGE-JPEG-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
    `TST-IMAGE-WEBP-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
    `TST-LIVE-VALIDATION-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
    `TST-MISSING-ASSET-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
    `TST-RACE-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
    `TST-CASE-CONFLICT-A-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
    `TST-CASE-CONFLICT-B-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
  ];
  const caseExternalId = `CASE-IMPORT-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const tempUploadsDirectory = await mkdtemp(path.join(os.tmpdir(), "teaching-import-integration-"));
  const previousUploadsDirectory = env.uploadsDir;
  env.uploadsDir = tempUploadsDirectory;
  const batchIds: string[] = [];
  let rollbackTrigger: string | null = null;
  let rollbackFunction: string | null = null;
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const request = async (pathname: string, options: { method?: string; role?: string; subject?: string; body?: unknown } = {}): Promise<JsonResponse> => {
    const headers: Record<string, string> = {};
    if (options.role) headers.Cookie = signedCookie(options.subject ?? subject, options.role, env);
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) body = options.body;
    else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const response = await fetch(`${baseUrl}${pathname}`, { method: options.method ?? "GET", headers, body });
    const raw = await response.json() as Record<string, unknown>;
    return { status: response.status, data: raw, headers: response.headers };
  };
  const upload = async (filename: string, bytes: Buffer, role: string, identitySubject = subject): Promise<JsonResponse> => {
    const form = new FormData();
    const type = filename.endsWith(".zip") ? "application/zip" : "application/json";
    form.append("file", new Blob([new Uint8Array(bytes)], { type }), filename);
    return request("/api/teaching/qbank/import/inspect", { method: "POST", role, subject: identitySubject, body: form });
  };

  try {
    const health = await request("/api/teaching/health");
    assert.deepEqual(health.data, { ok: true, module: "teaching" });

    const anonymousTemplate = await request("/api/teaching/qbank/import/template.json");
    assert.equal(anonymousTemplate.status, 401);
    const learnerTemplate = await request("/api/teaching/qbank/import/template.json", { role: "doctor", subject: learnerSubject });
    assert.equal(learnerTemplate.status, 403);

    const templateResponse = await request("/api/teaching/qbank/import/template.json", { role: "supervisor" });
    assert.equal(templateResponse.status, 200);
    assert.match(templateResponse.headers.get("content-disposition") ?? "", /rispro-teaching-qbank-template-v1\.json/);
    const template = templateResponse.data;
    assert.equal(template.schemaVersion, "1.0");
    const catalog = template._catalog as Record<string, unknown>;
    const currentCatalogResponse = await request("/api/teaching/catalog", { role: "supervisor" });
    assert.equal(currentCatalogResponse.status, 200);
    const currentCatalog = currentCatalogResponse.data;
    assert.deepEqual(catalog.specialties, currentCatalog.specialties);
    assert.deepEqual(catalog.domains, currentCatalog.domains);
    assert.deepEqual(catalog.topics, currentCatalog.topics);
    assert.deepEqual(catalog.subtopics, currentCatalog.subtopics);
    assert.deepEqual(catalog.modalities, currentCatalog.modalities);
    assert.deepEqual(catalog.competencies, currentCatalog.competencies);
    assert.deepEqual(catalog.trainingLevels, currentCatalog.trainingLevels);
    assert.deepEqual(catalog.difficulties, currentCatalog.difficulties);
    assert.deepEqual(catalog.tags, currentCatalog.tags);
    assert.deepEqual(catalog.questionTypes, currentCatalog.supportedQuestionTypes);
    assert.deepEqual(catalog.sourceTypes, currentCatalog.supportedSourceTypes);
    assert.deepEqual(catalog.provenanceRelationships, currentCatalog.supportedProvenanceRelationships);
    assert.ok(Array.isArray(catalog.specialties) && catalog.specialties.some((item: { code: string }) => item.code === "radiology"));
    assert.ok(Array.isArray(catalog.domains) && catalog.domains.length > 0 && catalog.domains.every((item: { code: string; label: string; description: string; parentCode?: string }) => item.code && item.label && item.description && item.parentCode));
    assert.ok((catalog.topics as Array<{ parentCode?: string }>).every((item) => item.parentCode));
    assert.ok((catalog.subtopics as Array<{ parentCode?: string }>).every((item) => item.parentCode));
    assert.ok((catalog.competencies as Array<{ description: string }>).every((item) => item.description));
    assert.ok((catalog.difficulties as Array<{ value: number; description: string }>).some((item) => Number.isInteger(item.value) && item.description));
    assert.deepEqual(catalog.questionTypes, ["single_best_answer", "image_based_sba", "case_based_sba"]);
    assert.deepEqual(Object.keys(template._schemaExamples as Record<string, unknown>).sort(), ["case_based_sba", "image_based_sba", "single_best_answer"]);
    const examples = template._schemaExamples as Record<string, Record<string, unknown>>;
    for (const example of Object.values(examples)) {
      for (const field of ["externalId", "classification", "type", "stem", "options", "answerKey", "explanation", "source", "provenance", "references", "generation"]) {
        assert.ok(Object.hasOwn(example, field), `template examples must include ${field}`);
      }
      assert.equal(example.status, "draft");
    }
    assert.ok(Array.isArray(examples.image_based_sba?.media));
    assert.ok(examples.case_based_sba?.caseId && examples.case_based_sba?.case);
    assert.deepEqual(template.questions, []);
    const humanInstructions = JSON.stringify(template._instructions);
    for (const instruction of ["current RISpro Teaching Q-bank import format", "questions array is the only import payload", "exact active codes", "created as Draft", "Do not fabricate", "separately in a ZIP", "server-owned metadata"]) {
      assert.ok(humanInstructions.includes(instruction), `human instructions must include ${instruction}`);
    }
    const aiInstructions = JSON.stringify(template._aiInstructions);
    for (const instruction of ["Return valid JSON only", "schemaVersion and questions", "Do not invent specialties", "domains", "topics", "subtopics", "modalities", "competencies", "tags", "source details", "references", "textbook page numbers", "DOI values", "examination years", "sittings", "papers", "question numbers", "null rather than guessing", "unique externalId", "exactly one correct answer", "meaningful explanation", "draft", "reviewedBy", "publishedBy"]) {
      assert.ok(aiInstructions.includes(instruction), `AI instructions must include ${instruction}`);
    }
    assert.doesNotMatch(JSON.stringify(template._catalog), /patients|appointments|PACS/i);

    const jsonPayload = { schemaVersion: "1.0", questions: [question(externalIds[0]!, {
      source: { type: "unknown" },
      provenance: { relationshipToSource: null },
      references: [{ type: "guideline", title: "Synthetic guideline reference", organization: "Synthetic Society", year: 2025, url: null, doi: null }],
    })] };
    const inspected = await upload("synthetic-qbank.json", Buffer.from(JSON.stringify(jsonPayload)), "supervisor");
    assert.equal(inspected.status, 201, JSON.stringify(inspected.data));
    assert.equal(inspected.data.structurallyValid, true);
    const batchId = String(inspected.data.batchId);
    batchIds.push(batchId);
    assert.equal(inspected.data.questions, 1);
    const before = await pool.query("select count(*)::int as count from teaching.questions where external_id = $1", [externalIds[0]]);
    assert.equal(before.rows[0]?.count, 0, "inspect must not create Q-bank questions");

    const previewed = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId } });
    assert.equal(previewed.status, 200);
    const preview = previewed.data as unknown as { errors: unknown[]; warnings: unknown[]; questions: Array<Record<string, unknown>> };
    assert.deepEqual(preview.errors, []);
    assert.ok(preview.warnings.length > 0);
    assert.equal(preview.questions[0]?.disposition, "new");
    assert.equal((await pool.query("select count(*)::int as count from teaching.questions where external_id = $1", [externalIds[0]])).rows[0]?.count, 0, "preview must not create Q-bank questions");

    const concurrentConfirms = await Promise.all([
      request("/api/teaching/qbank/import/confirm", { method: "POST", role: "supervisor", body: { batchId } }),
      request("/api/teaching/qbank/import/confirm", { method: "POST", role: "supervisor", body: { batchId } }),
    ]);
    assert.deepEqual(concurrentConfirms.map((result) => result.status).sort(), [200, 409]);
    const confirmed = concurrentConfirms.find((result) => result.status === 200)!;
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.status, "confirmed");
    assert.equal(confirmed.data.questionCount, 1);
    const persisted = await pool.query<{ question_id: string; revision_id: string; revision_number: number; status: string; import_batch_id: string; source_type: string; source_title: string | null; provenance: string; reference_count: number }>(
      `select question.id::text as question_id, revision.id::text as revision_id, revision.revision_number, revision.status, revision.import_batch_id::text,
       source.source_type, source.title as source_title, question_source.relationship_to_source as provenance,
       (select count(*)::int from teaching.question_references where question_revision_id = revision.id) as reference_count
       from teaching.questions question join teaching.question_revisions revision on revision.question_id = question.id
       join teaching.question_sources question_source on question_source.question_revision_id = revision.id
       join teaching.sources source on source.id = question_source.source_id where question.external_id = $1`,
      [externalIds[0]],
    );
    assert.equal(persisted.rowCount, 1);
    assert.equal(persisted.rows[0]?.revision_number, 1);
    assert.equal(persisted.rows[0]?.status, "draft");
    assert.equal(persisted.rows[0]?.import_batch_id, batchId);
    assert.equal(persisted.rows[0]?.source_type, "unknown");
    assert.equal(persisted.rows[0]?.source_title, null);
    assert.equal(persisted.rows[0]?.provenance, "unknown");
    assert.equal(persisted.rows[0]?.reference_count, 1);
    const mappedContent = await pool.query<{
      question_type: string; specialty_code: string; domain_code: string; topic_code: string; difficulty: number; training_level_code: string;
      modality_count: number; competency_count: number; tag_count: number; option_key: string; is_correct: boolean; option_explanation: string;
      explanation_summary: string; teaching_point: string; authorship_kind: string; model_name: string | null;
    }>(
      `select revision.question_type, specialty.code as specialty_code, domain.code as domain_code, topic.code as topic_code,
       difficulty.value as difficulty, training_level.code as training_level_code,
       (select count(*)::int from teaching.question_revision_modalities where question_revision_id = revision.id) as modality_count,
       (select count(*)::int from teaching.question_revision_competencies where question_revision_id = revision.id) as competency_count,
       (select count(*)::int from teaching.question_revision_tags where question_revision_id = revision.id) as tag_count,
       option.option_key, option.is_correct, option.explanation as option_explanation,
       revision.explanation_summary, revision.teaching_point, revision.authorship_kind, revision.model_name
       from teaching.questions question join teaching.question_revisions revision on revision.question_id = question.id
       join teaching.specialties specialty on specialty.id = revision.specialty_id
       join teaching.domains domain on domain.id = revision.domain_id
       left join teaching.topics topic on topic.id = revision.topic_id
       join teaching.difficulties difficulty on difficulty.id = revision.difficulty_id
       left join teaching.training_levels training_level on training_level.id = revision.training_level_id
       join teaching.question_options option on option.question_revision_id = revision.id
       where question.external_id = $1 order by option.sort_order`,
      [externalIds[0]],
    );
    assert.equal(mappedContent.rowCount, 2);
    assert.equal(mappedContent.rows[0]?.question_type, "single_best_answer");
    assert.equal(mappedContent.rows[0]?.specialty_code, "radiology");
    assert.equal(mappedContent.rows[0]?.domain_code, "neuroradiology");
    assert.equal(mappedContent.rows[0]?.topic_code, "brain-tumors");
    assert.equal(mappedContent.rows[0]?.difficulty, 3);
    assert.equal(mappedContent.rows[0]?.training_level_code, "junior_resident");
    assert.ok((mappedContent.rows[0]?.modality_count ?? 0) > 0);
    assert.equal(mappedContent.rows[0]?.competency_count, 2);
    assert.equal(mappedContent.rows[0]?.tag_count, 1);
    assert.deepEqual(mappedContent.rows.map((row) => [row.option_key, row.is_correct]), [["A", false], ["B", true]]);
    assert.ok(mappedContent.rows.every((row) => row.explanation_summary.includes("Synthetic explanation")), JSON.stringify(mappedContent.rows));
    assert.ok(mappedContent.rows.every((row) => row.teaching_point.includes("Synthetic teaching point")));
    assert.equal(mappedContent.rows.find((row) => row.option_key === "B")?.option_explanation, "Synthetic correct explanation.");
    assert.equal(mappedContent.rows[0]?.authorship_kind, "ai_assisted");
    assert.equal(mappedContent.rows[0]?.model_name, "synthetic-test-model");
    const mappedReference = await pool.query<{ reference_type: string; title: string; organization: string | null; year: number | null }>(
      `select reference.reference_type, reference.title, reference.organization, reference.year
       from teaching.questions question join teaching.question_revisions revision on revision.question_id = question.id
       join teaching.question_references relation on relation.question_revision_id = revision.id
       join teaching."references" reference on reference.id = relation.reference_id where question.external_id = $1`,
      [externalIds[0]],
    );
    assert.deepEqual(mappedReference.rows, [{ reference_type: "guideline", title: "Synthetic guideline reference", organization: "Synthetic Society", year: 2025 }]);

    const repeatedConfirm = await request("/api/teaching/qbank/import/confirm", { method: "POST", role: "supervisor", body: { batchId } });
    assert.equal(repeatedConfirm.status, 409);

    const duplicateBatch = await upload("duplicate-external-id.json", Buffer.from(JSON.stringify(jsonPayload)), "supervisor");
    assert.equal(duplicateBatch.status, 201);
    const duplicateBatchId = String(duplicateBatch.data.batchId);
    batchIds.push(duplicateBatchId);
    const duplicatePreview = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: duplicateBatchId } });
    const duplicateValidation = duplicatePreview.data as unknown as { errors: Array<{ code: string }>; questions: Array<{ disposition: string }> };
    assert.ok(duplicateValidation.errors.some((item) => item.code === "external_id_conflict"));
    assert.equal(duplicateValidation.questions[0]?.disposition, "existing_draft");
    const questionId = persisted.rows[0]!.question_id;
    assert.equal((await request(`/api/teaching/admin/questions/${questionId}/submit-review`, { method: "POST", role: "supervisor" })).status, 200);
    assert.equal((await request(`/api/teaching/admin/questions/${questionId}/revisions/${persisted.rows[0]!.revision_id}/review`, { method: "POST", role: "supervisor" })).status, 200);
    assert.equal((await request(`/api/teaching/admin/questions/${questionId}/publish`, { method: "POST", role: "supervisor" })).status, 200);
    const publishedDuplicateUpload = await upload("published-external-id.json", Buffer.from(JSON.stringify(jsonPayload)), "supervisor");
    const publishedDuplicateBatchId = String(publishedDuplicateUpload.data.batchId);
    batchIds.push(publishedDuplicateBatchId);
    const publishedDuplicatePreview = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: publishedDuplicateBatchId } });
    const publishedDuplicateValidation = publishedDuplicatePreview.data as unknown as { errors: Array<{ code: string }>; questions: Array<{ disposition: string }> };
    assert.ok(publishedDuplicateValidation.errors.some((item) => item.code === "external_id_conflict"));
    assert.equal(publishedDuplicateValidation.questions[0]?.disposition, "existing_published");

    const nextRevision = await request(`/api/teaching/admin/questions/${persisted.rows[0]!.question_id}/new-revision`, { method: "POST", role: "supervisor" });
    assert.equal(nextRevision.status, 201);
    const revisedQuestion = nextRevision.data as { revisions: Array<{ revisionNumber: number; status: string; audit: { importBatchId: string | null } }> };
    assert.equal(revisedQuestion.revisions[0]?.revisionNumber, 2);
    assert.equal(revisedQuestion.revisions[0]?.status, "draft");
    assert.equal(revisedQuestion.revisions[0]?.audit.importBatchId, batchId);

    const sharedSource = { type: "textbook", title: "Synthetic shared source", year: 2024 };
    const sharedSourcePayload = {
      schemaVersion: "1.0",
      questions: [
        question(externalIds[6]!, { source: sharedSource, provenance: { relationshipToSource: "adapted" } }),
        question(externalIds[7]!, {
          source: sharedSource,
          provenance: { relationshipToSource: "paraphrased" },
          explanation: {
            summary: "Synthetic shared-source explanation.",
            teachingPoint: "Synthetic shared-source teaching point.",
            furtherDiscussion: null,
            optionExplanations: { A: "Synthetic distractor explanation only." },
          },
        }),
      ],
    };
    const sharedSourceUpload = await upload("shared-source.json", Buffer.from(JSON.stringify(sharedSourcePayload)), "supervisor");
    const sharedSourceBatchId = String(sharedSourceUpload.data.batchId);
    batchIds.push(sharedSourceBatchId);
    const sharedSourcePreview = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: sharedSourceBatchId } });
    assert.deepEqual((sharedSourcePreview.data as { errors: unknown[] }).errors, []);
    assert.ok((sharedSourcePreview.data as { warnings: Array<{ code: string }> }).warnings.some((item) => item.code === "option_explanation_missing"), "missing optional option explanations are warnings");
    const sharedSourceConfirm = await request("/api/teaching/qbank/import/confirm", { method: "POST", role: "supervisor", body: { batchId: sharedSourceBatchId } });
    assert.equal(sharedSourceConfirm.status, 200, JSON.stringify(sharedSourceConfirm.data));
    const sharedSourceMappings = await pool.query<{ external_id: string; source_id: string; relationship_to_source: string; source_title: string; source_year: number }>(
      `select question.external_id, question_source.source_id::text, question_source.relationship_to_source,
       source.title as source_title, source.year as source_year
       from teaching.questions question join teaching.question_revisions revision on revision.question_id = question.id
       join teaching.question_sources question_source on question_source.question_revision_id = revision.id
       join teaching.sources source on source.id = question_source.source_id
       where question.external_id = any($1::text[]) order by question.external_id`,
      [[externalIds[6], externalIds[7]]],
    );
    assert.equal(sharedSourceMappings.rowCount, 2);
    assert.equal(sharedSourceMappings.rows[0]?.source_id, sharedSourceMappings.rows[1]?.source_id);
    assert.deepEqual(sharedSourceMappings.rows.map((item) => item.relationship_to_source).sort(), ["adapted", "paraphrased"]);
    assert.ok(sharedSourceMappings.rows.every((item) => item.source_title === "Synthetic shared source" && item.source_year === 2024));

    const invalidYearPayload = {
      schemaVersion: "1.0",
      questions: [question(externalIds[3]!, {
        source: { type: "textbook", title: "Synthetic reference", year: 999 },
        provenance: { relationshipToSource: "adapted" },
        references: [{ type: "guideline", title: "Synthetic reference", year: 10000 }],
      })],
    };
    const invalidYearUpload = await upload("invalid-years.json", Buffer.from(JSON.stringify(invalidYearPayload)), "supervisor");
    assert.equal(invalidYearUpload.data.structurallyValid, true);
    const invalidYearBatchId = String(invalidYearUpload.data.batchId);
    batchIds.push(invalidYearBatchId);
    const invalidYearPreview = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: invalidYearBatchId } });
    const yearIssues = (invalidYearPreview.data as { errors: Array<{ code: string }> }).errors;
    assert.ok(yearIssues.some((item) => item.code === "invalid_source_year"));
    assert.ok(yearIssues.some((item) => item.code === "invalid_reference_year"));

    const invalidCatalogQuestion = question(externalIds[10]!, {
      classification: {
        specialty: "fabricated_specialty", domain: "fabricated_domain", topic: "fabricated_topic", subtopics: ["fabricated_subtopic"],
        modalities: ["fabricated_modality"], competencies: ["fabricated_competency"], trainingLevel: "fabricated_level", difficulty: 99, tags: ["fabricated_tag"],
      },
      type: "unsupported_question_type",
      source: { type: "fabricated_source", title: "Synthetic source", doi: "not-a-doi" },
      provenance: { relationshipToSource: "fabricated_relationship" },
      references: [{ type: "fabricated_reference", title: "Synthetic reference", doi: "not-a-doi" }],
    });
    const invalidCatalogUpload = await upload("invalid-catalog.json", Buffer.from(JSON.stringify({
      schemaVersion: "1.0",
      _catalog: { specialties: [{ code: "fabricated_specialty", label: "Fake embedded item" }] },
      questions: [invalidCatalogQuestion],
    })), "supervisor");
    assert.equal(invalidCatalogUpload.data.structurallyValid, true);
    const invalidCatalogBatchId = String(invalidCatalogUpload.data.batchId);
    batchIds.push(invalidCatalogBatchId);
    const invalidCatalogPreview = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: invalidCatalogBatchId } });
    const liveValidationCodes = (invalidCatalogPreview.data as { errors: Array<{ code: string }> }).errors.map((item) => item.code);
    for (const code of ["unknown_specialty", "invalid_domain_hierarchy", "invalid_topic_hierarchy", "invalid_subtopic_hierarchy", "unknown_modality", "unknown_competency", "unknown_training_level", "invalid_difficulty", "unknown_tag", "unsupported_question_type", "unknown_source_type", "invalid_provenance", "invalid_doi"]) {
      assert.ok(liveValidationCodes.includes(code), `live server validation must report ${code}`);
    }
    const invalidBatchDetail = await request(`/api/teaching/qbank/import/batches/${invalidCatalogBatchId}`, { role: "supervisor" });
    assert.equal(JSON.stringify(invalidBatchDetail.data).includes("Synthetic teaching question stem"), false, "batch audit must not retain or return normalized question previews");
    assert.equal(Object.hasOwn(invalidBatchDetail.data.validation as object, "questions"), false);

    const invalidUpload = await upload("unsupported-version.json", Buffer.from(JSON.stringify({ schemaVersion: "9.0", questions: [] })), "supervisor");
    assert.equal(invalidUpload.status, 201);
    assert.equal(invalidUpload.data.structurallyValid, false);
    assert.ok(Array.isArray(invalidUpload.data.errors));
    batchIds.push(String(invalidUpload.data.batchId));

    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#366e91" } }).png().toBuffer();
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#366e91" } }).jpeg().toBuffer();
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#366e91" } }).webp().toBuffer();
    const zip = new AdmZip();
    zip.addFile("questions.json", Buffer.from(JSON.stringify({
      schemaVersion: "1.0",
      questions: [
        question(externalIds[1]!, {
          type: "image_based_sba",
          media: [{ assetKey: `${externalIds[1]}-01`, filename: "synthetic.png", type: "image", altText: "Synthetic educational image" }],
          source: { type: "original" },
          provenance: { relationshipToSource: "original" },
          caseId: caseExternalId,
          case: { title: "Synthetic case metadata", clinicalHistory: "Synthetic educational history only." },
        }),
        question(externalIds[2]!, {
          type: "case_based_sba",
          caseId: caseExternalId,
          case: { title: "Synthetic case metadata", clinicalHistory: "Synthetic educational history only." },
          source: { type: "original" },
          provenance: { relationshipToSource: "original" },
        }),
        question(externalIds[8]!, {
          type: "image_based_sba",
          media: [{ assetKey: `${externalIds[8]}-01`, filename: "synthetic.jpeg", type: "image", altText: "Synthetic JPEG educational image" }],
        }),
        question(externalIds[9]!, {
          type: "image_based_sba",
          media: [{ assetKey: `${externalIds[9]}-01`, filename: "synthetic.webp", type: "image", altText: "Synthetic WebP educational image" }],
        }),
      ],
    })));
    zip.addFile("assets/synthetic.png", png);
    zip.addFile("assets/synthetic.jpeg", jpeg);
    zip.addFile("assets/synthetic.webp", webp);
    const zipInspection = await upload("synthetic-images.zip", zip.toBuffer(), "supervisor");
    assert.equal(zipInspection.status, 201);
    assert.equal(zipInspection.data.structurallyValid, true);
    const zipBatchId = String(zipInspection.data.batchId);
    batchIds.push(zipBatchId);
    const { loadStagedTeachingAssets } = await import("../import/staging-service.js");
    assert.equal((await loadStagedTeachingAssets(zipBatchId)).length, 3, "inspection stages supported image formats temporarily");
    assert.equal((await pool.query("select count(*)::int as count from teaching.assets where asset_key = any($1::text[])", [[`${externalIds[1]}-01`, `${externalIds[8]}-01`, `${externalIds[9]}-01`]])).rows[0]?.count, 0, "inspection must not create permanent Teaching assets");
    const zipPreview = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: zipBatchId } });
    assert.deepEqual((zipPreview.data as { errors: unknown[] }).errors, []);
    assert.equal((await pool.query("select count(*)::int as count from teaching.assets where asset_key = any($1::text[])", [[`${externalIds[1]}-01`, `${externalIds[8]}-01`, `${externalIds[9]}-01`]])).rows[0]?.count, 0, "preview must not create permanent Teaching assets");
    const zipConfirm = await request("/api/teaching/qbank/import/confirm", { method: "POST", role: "supervisor", body: { batchId: zipBatchId } });
    assert.equal(zipConfirm.status, 200, JSON.stringify(zipConfirm.data));
    assert.equal(zipConfirm.data.questionCount, 4);
    assert.equal((await loadStagedTeachingAssets(zipBatchId)).length, 0, "successful confirmation removes staged assets");
    const linkedCase = await pool.query<{ count: number; unique_cases: number }>(
      `select count(*)::int as count, count(distinct revision.case_id)::int as unique_cases
       from teaching.questions question join teaching.question_revisions revision on revision.question_id = question.id
       where question.external_id = any($1::text[]) and revision.case_id is not null`,
      [[externalIds[1], externalIds[2]]],
    );
    assert.deepEqual(linkedCase.rows[0], { count: 2, unique_cases: 1 });
    assert.equal((await pool.query("select count(*)::int as count from teaching.cases where external_id = $1", [caseExternalId])).rows[0]?.count, 1);
    const storedAssets = await pool.query<{ storage_key: string; size_bytes: string; mime_type: string }>(
      `select asset.storage_key, asset.size_bytes::text, asset.mime_type from teaching.assets asset
       join teaching.question_revision_assets relation on relation.asset_id = asset.id
       join teaching.questions question on question.id = (select question_id from teaching.question_revisions where id = relation.question_revision_id)
       where question.external_id = any($1::text[]) order by asset.mime_type`,
      [[externalIds[1], externalIds[8], externalIds[9]]],
    );
    assert.equal(storedAssets.rowCount, 3);
    assert.deepEqual(storedAssets.rows.map((asset) => asset.mime_type).sort(), ["image/jpeg", "image/png", "image/webp"]);
    for (const storedAsset of storedAssets.rows) {
      assert.match(storedAsset.storage_key, /^teaching\/assets\//);
      assert.ok(Number(storedAsset.size_bytes) > 0);
      await stat(path.join(tempUploadsDirectory, storedAsset.storage_key));
    }

    const missingAssetZip = new AdmZip();
    missingAssetZip.addFile("questions.json", Buffer.from(JSON.stringify({
      schemaVersion: "1.0",
      questions: [question(externalIds[11]!, {
        type: "image_based_sba",
        media: [{ assetKey: `${externalIds[11]}-01`, filename: "missing.png", type: "image", altText: "Synthetic missing asset" }],
      })],
    })));
    missingAssetZip.addFile("assets/unused.png", png);
    const missingAssetUpload = await upload("missing-asset.zip", missingAssetZip.toBuffer(), "supervisor");
    const missingAssetBatchId = String(missingAssetUpload.data.batchId);
    batchIds.push(missingAssetBatchId);
    assert.equal((await loadStagedTeachingAssets(missingAssetBatchId)).length, 1);
    const missingAssetPreview = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: missingAssetBatchId } });
    assert.ok((missingAssetPreview.data as { errors: Array<{ code: string }> }).errors.some((item) => item.code === "asset_missing"));
    assert.equal((await loadStagedTeachingAssets(missingAssetBatchId)).length, 0, "validation failure removes staged assets");

    const conflictingCaseId = `CASE-CONFLICT-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const conflictingCaseUpload = await upload("conflicting-case.json", Buffer.from(JSON.stringify({
      schemaVersion: "1.0",
      questions: [
        question(externalIds[13]!, { type: "case_based_sba", caseId: conflictingCaseId, case: { title: "Synthetic case A", clinicalHistory: "Synthetic history." } }),
        question(externalIds[14]!, { type: "case_based_sba", caseId: conflictingCaseId, case: { title: "Synthetic case B", clinicalHistory: "Synthetic history." } }),
      ],
    })), "supervisor");
    const conflictingCaseBatchId = String(conflictingCaseUpload.data.batchId);
    batchIds.push(conflictingCaseBatchId);
    const conflictingCasePreview = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: conflictingCaseBatchId } });
    assert.ok((conflictingCasePreview.data as { errors: Array<{ code: string }> }).errors.some((item) => item.code === "case_metadata_conflict"));
    assert.equal((await pool.query("select count(*)::int as count from teaching.cases where external_id = $1", [conflictingCaseId])).rows[0]?.count, 0);

    const racePayload = Buffer.from(JSON.stringify({ schemaVersion: "1.0", questions: [question(externalIds[12]!)] }));
    const raceUploadA = await upload("race-a.json", racePayload, "supervisor");
    const raceUploadB = await upload("race-b.json", racePayload, "supervisor");
    const raceBatchA = String(raceUploadA.data.batchId);
    const raceBatchB = String(raceUploadB.data.batchId);
    batchIds.push(raceBatchA, raceBatchB);
    const racePreviewA = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: raceBatchA } });
    const racePreviewB = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: raceBatchB } });
    assert.deepEqual((racePreviewA.data as { errors: unknown[] }).errors, []);
    assert.deepEqual((racePreviewB.data as { errors: unknown[] }).errors, []);
    const raceConfirms = await Promise.all([
      request("/api/teaching/qbank/import/confirm", { method: "POST", role: "supervisor", body: { batchId: raceBatchA } }),
      request("/api/teaching/qbank/import/confirm", { method: "POST", role: "supervisor", body: { batchId: raceBatchB } }),
    ]);
    const confirmedRaceBatches = raceConfirms.filter((result) => result.status === 200 && result.data.status === "confirmed");
    assert.equal(confirmedRaceBatches.length, 1, "only one batch can claim the same externalId");
    assert.ok(raceConfirms.every((result) => result.status === 200 || result.status === 409));
    assert.equal((await pool.query("select count(*)::int as count from teaching.questions where external_id = $1", [externalIds[12]])).rows[0]?.count, 1);
    const raceAudit = await pool.query<{ status: string; failure_message: string | null }>("select status, failure_message from teaching.import_batches where id = any($1::uuid[]) order by status", [[raceBatchA, raceBatchB]]);
    assert.deepEqual(raceAudit.rows.map((item) => item.status).sort(), ["confirmed", "invalid"]);
    assert.ok(raceAudit.rows.find((item) => item.status === "invalid")?.failure_message);

    const rollbackSuffix = randomUUID().replaceAll("-", "").slice(0, 12).toLowerCase();
    rollbackTrigger = `teaching_import_rollback_${rollbackSuffix}`;
    rollbackFunction = `teaching_import_rollback_fn_${rollbackSuffix}`;
    await pool.query(
      `create function teaching.${rollbackFunction}() returns trigger language plpgsql as $$
       begin
         if exists (select 1 from teaching.questions where id = new.question_id and external_id = '${externalIds[5]}') then
           raise exception 'synthetic Teaching import rollback assertion';
         end if;
         return new;
       end $$`,
    );
    await pool.query(`create trigger ${rollbackTrigger} before insert on teaching.question_revisions for each row execute function teaching.${rollbackFunction}()`);
    const rollbackAssetKey = `${externalIds[4]}-01`;
    const rollbackZip = new AdmZip();
    rollbackZip.addFile("questions.json", Buffer.from(JSON.stringify({
      schemaVersion: "1.0",
      questions: [
        question(externalIds[4]!, {
          type: "image_based_sba",
          media: [{ assetKey: rollbackAssetKey, filename: "rollback.png", type: "image", altText: "Synthetic rollback image" }],
        }),
        question(externalIds[5]!),
      ],
    })));
    rollbackZip.addFile("assets/rollback.png", png);
    const rollbackZipBytes = rollbackZip.toBuffer();
    const filesBeforeRollback = await readdir(path.join(tempUploadsDirectory, "teaching", "assets"));
    const rollbackInspection = await upload("rollback-batch.zip", rollbackZipBytes, "supervisor");
    assert.equal(rollbackInspection.status, 201);
    const rollbackBatchId = String(rollbackInspection.data.batchId);
    batchIds.push(rollbackBatchId);
    const rollbackPreview = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: rollbackBatchId } });
    assert.deepEqual((rollbackPreview.data as { errors: unknown[] }).errors, []);
    const failedConfirm = await request("/api/teaching/qbank/import/confirm", { method: "POST", role: "supervisor", body: { batchId: rollbackBatchId } });
    assert.equal(failedConfirm.status, 500);
    assert.doesNotMatch(JSON.stringify(failedConfirm.data), /P0001|PLpgSQL|synthetic Teaching import rollback assertion/i);
    assert.equal((await pool.query("select count(*)::int as count from teaching.questions where external_id = any($1::text[])", [[externalIds[4], externalIds[5]]])).rows[0]?.count, 0, "a failure on the second question must roll back the first question too");
    assert.equal((await pool.query("select count(*)::int as count from teaching.assets where asset_key = $1", [rollbackAssetKey])).rows[0]?.count, 0, "asset metadata must roll back with question content");
    assert.equal((await readdir(path.join(tempUploadsDirectory, "teaching", "assets"))).length, filesBeforeRollback.length, "promoted files must be removed after transaction rollback");
    const failedBatchAudit = await pool.query<{ status: string; failure_message: string | null }>("select status, failure_message from teaching.import_batches where id = $1", [rollbackBatchId]);
    assert.equal(failedBatchAudit.rows[0]?.status, "failed", "a server error marks the batch failed after rollback");
    assert.equal(failedBatchAudit.rows[0]?.failure_message, "Import confirmation failed and all database changes were rolled back.");
    assert.equal((await loadStagedTeachingAssets(rollbackBatchId)).length, 0, "server failure removes staged assets");
    assert.equal((await pool.query("select payload_json from teaching.import_batches where id = $1", [rollbackBatchId])).rows[0]?.payload_json, null);
    await pool.query(`drop trigger ${rollbackTrigger} on teaching.question_revisions`);
    await pool.query(`drop function teaching.${rollbackFunction}()`);
    rollbackTrigger = null;
    rollbackFunction = null;
    const retryInspection = await upload("rollback-retry.zip", rollbackZipBytes, "supervisor");
    const retryBatchId = String(retryInspection.data.batchId);
    batchIds.push(retryBatchId);
    const retryPreview = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: retryBatchId } });
    assert.deepEqual((retryPreview.data as { errors: unknown[] }).errors, []);
    const successfulRetry = await request("/api/teaching/qbank/import/confirm", { method: "POST", role: "supervisor", body: { batchId: retryBatchId } });
    assert.equal(successfulRetry.status, 200);
    assert.equal(successfulRetry.data.questionCount, 2);
    assert.equal((await pool.query<{ failure_message: string | null }>("select failure_message from teaching.import_batches where id = $1", [retryBatchId])).rows[0]?.failure_message, null);

    const expiringUpload = await upload("expires.json", Buffer.from(JSON.stringify(jsonPayload)), "supervisor");
    const expiringBatchId = String(expiringUpload.data.batchId);
    batchIds.push(expiringBatchId);
    await pool.query("update teaching.import_batches set expires_at = now() - interval '1 second' where id = $1", [expiringBatchId]);
    const expiredDetail = await request(`/api/teaching/qbank/import/batches/${expiringBatchId}`, { role: "supervisor" });
    assert.equal(expiredDetail.data.status, "expired");
    const expiredPreview = await request("/api/teaching/qbank/import/preview", { method: "POST", role: "supervisor", body: { batchId: expiringBatchId } });
    assert.equal(expiredPreview.status, 410);

    const learnerInspect = await upload("learner.json", Buffer.from(JSON.stringify(jsonPayload)), "doctor", learnerSubject);
    assert.equal(learnerInspect.status, 403);
    const anonymousInspect = await request("/api/teaching/qbank/import/inspect", { method: "POST" });
    assert.equal(anonymousInspect.status, 401);

    const batchDtos = await request("/api/teaching/qbank/import/batches", { role: "supervisor" });
    assert.equal(batchDtos.status, 200);
    assert.ok(Array.isArray(batchDtos.data.items));
    assert.equal(JSON.stringify(batchDtos.data.items).includes("Synthetic teaching question stem"), false, "batch list must omit imported question content");
    const detail = await request(`/api/teaching/qbank/import/batches/${batchId}`, { role: "supervisor" });
    assert.equal(detail.status, 200);
    assert.equal(Object.hasOwn(detail.data, "payload_json"), false);
    assert.equal(JSON.stringify(detail.data).toLowerCase().includes("patient"), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const client = await pool.connect();
    try {
      if (rollbackTrigger) await client.query(`drop trigger if exists ${rollbackTrigger} on teaching.question_revisions`);
      if (rollbackFunction) await client.query(`drop function if exists teaching.${rollbackFunction}()`);
      await client.query("begin");
      const questions = await client.query<{ id: string }>("select id::text from teaching.questions where external_id = any($1::text[])", [externalIds]);
      const questionIds = questions.rows.map((row) => row.id);
      if (questionIds.length) await client.query("delete from teaching.question_revisions where question_id = any($1::bigint[])", [questionIds]);
      await client.query("delete from teaching.questions where id = any($1::bigint[])", [questionIds]);
      await client.query("delete from teaching.case_assets where case_id in (select id from teaching.cases where created_by_identity_subject = $1)", [subject]);
      await client.query("delete from teaching.cases where created_by_identity_subject = $1", [subject]);
      await client.query("delete from teaching.sources where created_by_identity_subject = $1", [subject]);
      await client.query('delete from teaching."references" where created_by_identity_subject = $1', [subject]);
      await client.query("delete from teaching.assets where created_by_identity_subject = $1", [subject]);
      await client.query("delete from teaching.import_batches where id = any($1::uuid[])", [batchIds]);
      await client.query("delete from teaching.user_profiles where identity_issuer = 'rispro' and identity_subject = any($1::text[])", [[subject, learnerSubject]]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
      env.uploadsDir = previousUploadsDirectory;
      await rm(tempUploadsDirectory, { recursive: true, force: true });
    }
  }
});
