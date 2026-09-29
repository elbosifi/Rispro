import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { Request } from "express";
import test from "node:test";
import {
  createTeachingQuestion,
  createTeachingReference,
  createTeachingSource,
  getTeachingQuestion,
  lockCurrentTeachingQuestionRevisionInTransaction,
  publishTeachingQuestion,
  reviewTeachingQuestion,
  submitTeachingQuestionForReview,
} from "../services/teaching-content-service.js";
import { withTeachingTransaction } from "../services/teaching-transaction.js";
import { confirmTeachingMaintenanceWorkbook, exportTeachingMaintenanceWorkbook, previewTeachingMaintenanceWorkbook } from "../import/maintenance-workbook-service.js";
import { readWorkbookFromBase64 } from "../../../services/workbook-service.js";
import { HttpError } from "../../../utils/http-error.js";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";

function multipartRequest(bytes: Buffer, previewHash?: string): Request {
  const boundary = "----teaching-maintenance-atomic-" + randomUUID();
  const body = Buffer.concat([
    Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"atomic.xlsx\"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n"),
    bytes,
    Buffer.from("\r\n--" + boundary + "--\r\n"),
  ]);
  const request = Readable.from([body]) as unknown as Request;
  (request as unknown as { headers: Record<string, string> }).headers = {
    "content-type": "multipart/form-data; boundary=" + boundary,
    "content-length": String(body.length),
    ...(previewHash ? { "x-teaching-maintenance-preview-hash": previewHash } : {}),
  };
  return request;
}

test("Teaching maintenance commits per question and rolls back failed Published and Draft updates", async (t) => {
  const { pool } = await import("../../../db/pool.js");
  try {
    const database = await pool.query<{ current_database: string }>("select current_database()");
    if (database.rows[0]?.current_database !== "rispro_test") throw new Error("Teaching maintenance atomicity proof requires the disposable rispro_test database.");
    await pool.query("select 1 from teaching.question_banks limit 1");
  } catch (error) {
    if (error instanceof Error && error.message.includes("requires the disposable")) throw error;
    t.skip("PostgreSQL is not reachable at the configured disposable DATABASE_URL.");
    return;
  }
  const marker = "TAT-" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const subject = String(BigInt("0x" + randomUUID().replaceAll("-", "").slice(0, 12)));
  const actor = { identityIssuer: "rispro", identitySubject: subject, displayName: "Teaching maintenance atomic fixture" };
  const questionIds: number[] = [];
  try {
    await pool.query("insert into teaching.user_profiles (identity_issuer, identity_subject, display_name) values ('rispro',$1,$2)", [subject, actor.displayName]);
    const source = await createTeachingSource({
      sourceType: "textbook", title: marker + " original source", organization: null, authors: ["Synthetic Author"],
      edition: null, year: 2025, chapter: null, page: null, examName: null, examSitting: null, examPaper: null,
      questionNumber: null, url: null, doi: null, notes: null, metadata: {},
    }, actor);
    const reference = await createTeachingReference({
      referenceType: "journal_article", title: marker + " original reference", organization: null, authors: ["Synthetic Author"],
      year: 2025, edition: null, url: null, doi: null, citationText: null, notes: null,
    }, actor);
    const makeQuestion = async (suffix: string) => {
      const question = await createTeachingQuestion({
        externalId: marker + "-" + suffix, questionBankCode: "radiology-main", type: "single_best_answer",
        stem: "Original stem for " + suffix, specialtyCode: "radiology", domainCode: "neuroradiology",
        topicCode: "brain-tumors", subtopicCode: "glioma", difficulty: 3, trainingLevelCode: "junior_resident",
        explanation: { summary: "Original summary", teachingPoint: "Original teaching point" },
        options: [
          { key: "A", text: "Correct answer", isCorrect: true, explanation: "Correct explanation" },
          { key: "B", text: "Incorrect answer", isCorrect: false, explanation: "Incorrect explanation" },
        ],
        modalityCodes: ["CT"], competencyCodes: ["diagnosis"], tagCodes: ["oncology"],
        sources: [{ sourceId: source.id, relationship: "original", notes: "Original provenance" }],
        references: [{ referenceId: reference.id, notes: "Original support" }],
        assetIds: [], assetAltTexts: [], authorship: { kind: "human_authored" },
      }, actor);
      questionIds.push(question.id);
      return question;
    };
    const validDraft = await makeQuestion("A-VALID");
    const failingDraft = await makeQuestion("B-DRAFT-FAIL");
    const published = await makeQuestion("C-PUBLISHED-FAIL");
    await submitTeachingQuestionForReview(published.id, actor);
    const inReview = await pool.query<{ id: string | number }>(
      "select id from teaching.question_revisions where question_id=$1 and status='in_review'", [published.id],
    );
    assert.equal(inReview.rowCount, 1);
    await reviewTeachingQuestion(published.id, Number(inReview.rows[0]!.id), actor);
    await publishTeachingQuestion(published.id, actor);

    const rowsBefore = await pool.query<{ id: string | number; question_id: string | number; status: string; stem: string; version: number }>(
      "select id, question_id, status, stem, version from teaching.question_revisions where question_id = any($1::bigint[]) order by question_id, revision_number desc",
      [questionIds],
    );
    const revisionByQuestion = new Map<number, typeof rowsBefore.rows>();
    for (const row of rowsBefore.rows) {
      const key = Number(row.question_id);
      revisionByQuestion.set(key, [...(revisionByQuestion.get(key) ?? []), row]);
    }
    const originalRevisionCounts = new Map([...revisionByQuestion].map(([questionId, revisions]) => [questionId, revisions.length]));
    const originalDraftContent = await getTeachingQuestion(failingDraft.id);
    const originalPublishedContent = await getTeachingQuestion(published.id);
    const sourceCountBefore = Number((await pool.query<{ count: string }>("select count(*)::text as count from teaching.sources where title like $1", [marker + "%"])).rows[0]!.count);
    const referenceCountBefore = Number((await pool.query<{ count: string }>("select count(*)::text as count from teaching.\"references\" where title like $1", [marker + "%"])).rows[0]!.count);

    const workbook = await exportTeachingMaintenanceWorkbook({ search: marker });
    const parsed = await readWorkbookFromBase64(workbook.toString("base64"));
    const { XLSX } = parsed;
    const questions = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.workbook.Sheets.Questions!);
    const questionSheet = parsed.workbook.Sheets.Questions!;
    const edited = questions.map((row) => {
      if (row.external_id === marker + "-A-VALID") row.stem = "Question A committed independently.";
      if (row.external_id === marker + "-B-DRAFT-FAIL") row.stem = "Question B must roll back.";
      if (row.external_id === marker + "-C-PUBLISHED-FAIL") row.stem = "Published question must remain unchanged.";
      return row;
    });
    XLSX.utils.sheet_add_json(questionSheet, edited, { skipHeader: true, origin: "A2" });
    const sourceSheet = parsed.workbook.Sheets.Sources!;
    const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sourceSheet);
    const modifiedSources = sourceRows.map((row) => {
      if (row.external_id === marker + "-B-DRAFT-FAIL") {
        row.title = marker + " orphan candidate source for Draft failure";
        row.relationship_to_source = "invalid_relationship";
      }
      if (row.external_id === marker + "-C-PUBLISHED-FAIL") {
        row.title = marker + " orphan candidate source for Published failure";
        row.relationship_to_source = "invalid_relationship";
      }
      return row;
    });
    XLSX.utils.sheet_add_json(sourceSheet, modifiedSources, { skipHeader: true, origin: "A2" });
    const referenceSheet = parsed.workbook.Sheets.References!;
    const referenceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(referenceSheet);
    const modifiedReferences = referenceRows.map((row) => {
      if (row.external_id === marker + "-C-PUBLISHED-FAIL") row.title = marker + " orphan candidate reference for Published failure";
      return row;
    });
    XLSX.utils.sheet_add_json(referenceSheet, modifiedReferences, { skipHeader: true, origin: "A2" });
    const changedWorkbook = XLSX.write(parsed.workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const preview = await previewTeachingMaintenanceWorkbook(multipartRequest(changedWorkbook));
    assert.equal(preview.summary.updateDraft, 2);
    assert.equal(preview.summary.createDraftRevision, 1);
    const confirmation = await confirmTeachingMaintenanceWorkbook(
      multipartRequest(changedWorkbook, preview.workbookHash),
      actor,
    );
    assert.equal(confirmation.updatedDraft, 1);
    assert.equal(confirmation.newDraftRevision, 0);
    assert.equal(confirmation.invalid, 2);
    assert.equal(confirmation.conflicts, 0);
    assert.equal(confirmation.exceptions.length, 2);

    const finalRevisions = await pool.query<{ id: string | number; question_id: string | number; status: string; stem: string; version: number }>(
      "select id, question_id, status, stem, version from teaching.question_revisions where question_id = any($1::bigint[]) order by question_id, revision_number desc",
      [questionIds],
    );
    const finalByQuestion = new Map<number, typeof finalRevisions.rows>();
    for (const row of finalRevisions.rows) {
      const key = Number(row.question_id);
      finalByQuestion.set(key, [...(finalByQuestion.get(key) ?? []), row]);
    }
    assert.equal(finalByQuestion.get(validDraft.id)?.[0]?.stem, "Question A committed independently.");
    assert.equal(Number(finalByQuestion.get(validDraft.id)?.[0]?.version), Number(revisionByQuestion.get(validDraft.id)?.[0]?.version) + 1);
    assert.equal(finalByQuestion.get(failingDraft.id)?.length, originalRevisionCounts.get(failingDraft.id));
    assert.equal(finalByQuestion.get(failingDraft.id)?.[0]?.stem, "Original stem for B-DRAFT-FAIL");
    assert.equal(finalByQuestion.get(failingDraft.id)?.[0]?.status, "draft");
    assert.equal(finalByQuestion.get(published.id)?.length, originalRevisionCounts.get(published.id));
    assert.equal(finalByQuestion.get(published.id)?.[0]?.stem, "Original stem for C-PUBLISHED-FAIL");
    assert.equal(finalByQuestion.get(published.id)?.[0]?.status, "published");
    const finalDraftContent = await getTeachingQuestion(failingDraft.id);
    const finalPublishedContent = await getTeachingQuestion(published.id);
    assert.deepEqual(finalDraftContent.revisions[0]?.options, originalDraftContent.revisions[0]?.options);
    assert.deepEqual(finalDraftContent.revisions[0]?.classification, originalDraftContent.revisions[0]?.classification);
    assert.deepEqual(finalPublishedContent.revisions[0]?.options, originalPublishedContent.revisions[0]?.options);
    assert.deepEqual(finalPublishedContent.revisions[0]?.classification, originalPublishedContent.revisions[0]?.classification);
    assert.equal(Number((await pool.query<{ count: string }>("select count(*)::text as count from teaching.sources where title like $1", [marker + "%"])).rows[0]!.count), sourceCountBefore);
    assert.equal(Number((await pool.query<{ count: string }>("select count(*)::text as count from teaching.\"references\" where title like $1", [marker + "%"])).rows[0]!.count), referenceCountBefore);
    assert.equal((await pool.query("select 1 from teaching.question_sources link join teaching.question_revisions revision on revision.id=link.question_revision_id where revision.question_id=any($1::bigint[]) and link.question_revision_id=revision.id", [questionIds])).rowCount, 3);

    await assert.rejects(
      withTeachingTransaction((client) => lockCurrentTeachingQuestionRevisionInTransaction(client, {
        questionId: published.id,
        questionBankCode: "radiology-main",
        externalId: marker + "-C-PUBLISHED-FAIL",
        revisionId: Number(finalByQuestion.get(published.id)?.[0]?.id),
        revisionVersion: 9999,
        status: "published",
      })),
      (error: unknown) => error instanceof HttpError && error.statusCode === 409,
    );
  } finally {
    const revisionIds = await pool.query<{ id: string | number }>("select id from teaching.question_revisions where question_id=any($1::bigint[])", [questionIds]);
    if (revisionIds.rowCount) await pool.query("delete from teaching.question_revisions where question_id=any($1::bigint[])", [questionIds]);
    if (questionIds.length) await pool.query("delete from teaching.questions where id=any($1::bigint[])", [questionIds]);
    await pool.query("delete from teaching.sources where title like $1", [marker + "%"]);
    await pool.query("delete from teaching.\"references\" where title like $1", [marker + "%"]);
    await pool.query("delete from teaching.user_profiles where identity_issuer='rispro' and identity_subject=$1", [subject]);
    await pool.end();
  }
});
