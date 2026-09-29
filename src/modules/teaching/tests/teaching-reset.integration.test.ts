import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createTeachingCase,
  createTeachingQuestion,
  createTeachingReference,
  createTeachingSource,
} from "../services/teaching-content-service.js";
import { resetTeachingContent, teachingResetContentCounts, TEACHING_RESET_CONFIRMATION } from "../services/teaching-reset-service.js";
import { HttpError } from "../../../utils/http-error.js";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";

test("Teaching reset dry-run, refusal, database cleanup, preservation, and asset namespace safety", async (t) => {
  const { pool } = await import("../../../db/pool.js");
  try {
    const database = await pool.query<{ current_database: string }>("select current_database()");
    if (database.rows[0]?.current_database !== "rispro_test") throw new Error("Teaching reset proof requires the disposable rispro_test database.");
    await pool.query("select 1 from teaching.question_banks limit 1");
  } catch (error) {
    if (error instanceof Error && error.message.includes("requires the disposable")) throw error;
    t.skip("PostgreSQL is not reachable at the configured disposable DATABASE_URL.");
    return;
  }

  const marker = "RST-" + randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const subject = String(BigInt("0x" + randomUUID().replaceAll("-", "").slice(0, 12)));
  const identity = { identityIssuer: "rispro", identitySubject: subject, displayName: "Teaching reset integration fixture" };
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "teaching-reset-test-"));
  const goodAssetFilename = randomUUID() + ".png";
  const goodAssetPath = path.join(storageRoot, "teaching", "assets", goodAssetFilename);
  const outsideAssetPath = path.join(storageRoot, "clinical", "keep.png");
  const goodStorageKey = "teaching/assets/" + goodAssetFilename;
  const malformedStorageKey = "../clinical/keep.png";
  const unrelatedBefore = await pool.query<{ count: string }>("select count(*)::text as count from schema_migrations");
  const difficultyCountBefore = Number((await pool.query<{ count: string }>("select count(*)::text as count from teaching.difficulties")).rows[0]!.count);
  try {
    await mkdir(path.dirname(goodAssetPath), { recursive: true });
    await mkdir(path.dirname(outsideAssetPath), { recursive: true });
    await writeFile(goodAssetPath, Buffer.from("synthetic Teaching-owned test asset"));
    await writeFile(outsideAssetPath, Buffer.from("must remain outside Teaching assets"));

    await pool.query("insert into teaching.user_profiles (identity_issuer, identity_subject, display_name) values ('rispro', $1, $2)", [subject, identity.displayName]);
    const taxonomyClient = await pool.connect();
    let specialtyId = 0;
    let bankId = 0;
    let referenceId = 0;
    let sourceId = 0;
    let assetId = 0;
    let questionId = 0;
    let revisionId = 0;
    try {
      await taxonomyClient.query("begin");
      specialtyId = Number((await taxonomyClient.query<{ id: string }>(
        "insert into teaching.specialties (code, label) values ($1, 'Reset fixture specialty') returning id", [marker + "-SPEC"],
      )).rows[0]!.id);
      const domainId = Number((await taxonomyClient.query<{ id: string }>(
        "insert into teaching.domains (specialty_id, code, label) values ($1, $2, 'Reset fixture domain') returning id", [specialtyId, marker + "-DOMAIN"],
      )).rows[0]!.id);
      const topicId = Number((await taxonomyClient.query<{ id: string }>(
        "insert into teaching.topics (domain_id, code, label) values ($1, $2, 'Reset fixture topic') returning id", [domainId, marker + "-TOPIC"],
      )).rows[0]!.id);
      const subtopicId = Number((await taxonomyClient.query<{ id: string }>(
        "insert into teaching.subtopics (topic_id, code, label) values ($1, $2, 'Reset fixture subtopic') returning id", [topicId, marker + "-SUB"],
      )).rows[0]!.id);
      await taxonomyClient.query("insert into teaching.modalities (code, label) values ($1, 'Reset fixture modality')", [marker + "-MOD"]);
      await taxonomyClient.query("insert into teaching.competencies (code, label) values ($1, 'Reset fixture competency')", [marker + "-COMP"]);
      await taxonomyClient.query("insert into teaching.training_levels (code, label) values ($1, 'Reset fixture level')", [marker + "-LEVEL"]);
      await taxonomyClient.query("insert into teaching.tags (code, label) values ($1, 'Reset fixture tag')", [marker + "-TAG"]);
      bankId = Number((await taxonomyClient.query<{ id: string }>(
        "insert into teaching.question_banks (code, name, specialty_id) values ($1, 'Reset fixture bank', $2) returning id", [marker + "-BANK", specialtyId],
      )).rows[0]!.id);
      await taxonomyClient.query("commit");
      const difficulty = await taxonomyClient.query("select id from teaching.difficulties where value = 3");
      assert.equal(difficulty.rowCount, 1);
      const source = await createTeachingSource({
        sourceType: "textbook", title: marker + " source", organization: null, authors: ["Synthetic Author"], edition: null,
        year: 2025, chapter: null, page: null, examName: null, examSitting: null, examPaper: null, questionNumber: null,
        url: null, doi: null, notes: null, metadata: {},
      }, identity);
      sourceId = source.id;
      const reference = await createTeachingReference({
        referenceType: "journal_article", title: marker + " reference", organization: null, authors: ["Synthetic Author"],
        year: 2025, edition: null, url: null, doi: null, citationText: null, notes: null,
      }, identity);
      referenceId = reference.id;
      const validAsset = await pool.query<{ id: string }>(
        "insert into teaching.assets (asset_key, storage_key, mime_type, original_filename, size_bytes, created_by_identity_issuer, created_by_identity_subject) values ($1,$2,'image/png',$3,35,'rispro',$4) returning id",
        [marker + "-ASSET", goodStorageKey, goodAssetFilename, subject],
      );
      assetId = Number(validAsset.rows[0]!.id);
      await pool.query(
        "insert into teaching.assets (asset_key, storage_key, mime_type, original_filename, size_bytes, created_by_identity_issuer, created_by_identity_subject) values ($1,$2,'image/png','outside.png',35,'rispro',$3)",
        [marker + "-MALFORMED-ASSET", malformedStorageKey, subject],
      );
      const teachingCase = await createTeachingCase({
        externalId: marker + "-CASE", specialtyCode: marker + "-SPEC", title: "Synthetic reset case",
        clinicalHistory: "Synthetic education-only history.", assetIds: [],
      }, identity);
      const question = await createTeachingQuestion({
        externalId: marker + "-QUESTION", questionBankCode: marker + "-BANK", type: "single_best_answer",
        stem: "Synthetic reset question", specialtyCode: marker + "-SPEC", domainCode: marker + "-DOMAIN",
        topicCode: marker + "-TOPIC", subtopicCode: marker + "-SUB", difficulty: 3, trainingLevelCode: marker + "-LEVEL",
        caseId: teachingCase.id,
        explanation: { summary: "Synthetic summary", teachingPoint: "Synthetic point" },
        options: [
          { key: "A", text: "Synthetic correct answer", isCorrect: true, explanation: "Reason" },
          { key: "B", text: "Synthetic incorrect answer", isCorrect: false, explanation: "Reason" },
        ],
        modalityCodes: [marker + "-MOD"], competencyCodes: [marker + "-COMP"], tagCodes: [marker + "-TAG"],
        sources: [{ sourceId, relationship: "original" }], references: [{ referenceId }],
        assetIds: [assetId], assetAltTexts: [{ assetId, altText: "Synthetic teaching image" }],
        authorship: { kind: "human_authored" },
      }, identity);
      questionId = question.id;
      revisionId = question.revisions[0]!.id;

      const session = await pool.query<{ id: string }>(
        "insert into teaching.sessions (identity_issuer, identity_subject, mode, question_count) values ('rispro',$1,'study',1) returning id", [subject],
      );
      const sessionQuestion = await pool.query<{ id: string }>(
        "insert into teaching.session_questions (session_id, question_id, question_revision_id, position) values ($1,$2,$3,1) returning id",
        [session.rows[0]!.id, questionId, revisionId],
      );
      const attempt = await pool.query<{ id: string }>(
        "insert into teaching.attempts (identity_issuer, identity_subject, session_id, session_question_id, question_id, question_revision_id, selected_option_key, is_correct, mode) values ('rispro',$1,$2,$3,$4,$5,'A',true,'study') returning id",
        [subject, session.rows[0]!.id, sessionQuestion.rows[0]!.id, questionId, revisionId],
      );
      await pool.query(
        "insert into teaching.user_question_state (identity_issuer, identity_subject, question_id, state, last_attempt_id, last_answered_at) values ('rispro',$1,$2,'correct',$3,now())",
        [subject, questionId, attempt.rows[0]!.id],
      );
      await pool.query("insert into teaching.bookmarks (identity_issuer, identity_subject, question_id) values ('rispro',$1,$2)", [subject, questionId]);
      await pool.query("insert into teaching.notes (identity_issuer, identity_subject, question_id, note_text) values ('rispro',$1,$2,'Synthetic reset note')", [subject, questionId]);
      await pool.query(
        "insert into teaching.study_cycles (identity_issuer, identity_subject, question_bank_id, scope_type, scope_id, cycle_number, reset_event_id, started_at) values ('rispro',$1,$2,'bank',$2,1,$3,now())",
        [subject, bankId, randomUUID()],
      );
      await pool.query(
        "insert into teaching.question_validation_summaries (question_revision_id, revision_version, classification, validated_by_identity_issuer, validated_by_identity_subject) values ($1,1,'valid','rispro',$2)",
        [revisionId, subject],
      );
      await pool.query(
        "insert into teaching.import_batches (id, uploaded_by_identity_issuer, uploaded_by_identity_subject, original_filename, input_type, schema_version, status, question_count) values ($1,'rispro',$2,$3,'json','1.1','uploaded',1)",
        [randomUUID(), subject, marker + ".json"],
      );

      const preflightCounts = await teachingResetContentCounts(pool);
      assert.ok(preflightCounts.questions >= 1);
      assert.ok(preflightCounts.question_revisions >= 1);
      assert.ok(preflightCounts.sessions >= 1);
      assert.ok(preflightCounts.attempts >= 1);
      assert.ok(preflightCounts.import_batches >= 1);
      const dryRun = await resetTeachingContent({ nodeEnv: "test", uploadsDir: storageRoot });
      assert.equal(dryRun.deleted, false);
      assert.ok(dryRun.counts.questions >= 1);
      assert.equal(await stat(goodAssetPath).then(() => true), true);
      const wrongConfirmation = await resetTeachingContent({ confirmation: "RESET-TEACHING-WRONG", nodeEnv: "test", uploadsDir: storageRoot });
      assert.equal(wrongConfirmation.deleted, false);
      await assert.rejects(
        resetTeachingContent({ confirmation: TEACHING_RESET_CONFIRMATION, nodeEnv: "production", uploadsDir: storageRoot }),
        (error: unknown) => error instanceof HttpError && error.statusCode === 403 && error.message.includes("disabled in production"),
      );
      assert.equal((await pool.query("select 1 from teaching.questions where id = $1", [questionId])).rowCount, 1);

      const reset = await resetTeachingContent({ confirmation: TEACHING_RESET_CONFIRMATION, nodeEnv: "test", uploadsDir: storageRoot });
      assert.equal(reset.deleted, true);
      assert.ok(reset.assetFilesDeleted >= 1);
      assert.ok(reset.assetFileDeletionFailures.some((failure) => failure.storageKey === malformedStorageKey));
      for (const [table, count] of Object.entries(await teachingResetContentCounts(pool))) assert.equal(count, 0, table + " was not emptied");
      assert.equal(await stat(goodAssetPath).then(() => true, () => false), false);
      assert.equal(await stat(outsideAssetPath).then(() => true), true);
      assert.equal((await pool.query("select 1 from teaching.user_profiles where identity_issuer='rispro' and identity_subject=$1", [subject])).rowCount, 1);
      assert.equal((await pool.query("select 1 from teaching.specialties where code=$1", [marker + "-SPEC"])).rowCount, 1);
      assert.equal((await pool.query("select 1 from teaching.domains where code=$1", [marker + "-DOMAIN"])).rowCount, 1);
      assert.equal((await pool.query("select 1 from teaching.topics where code=$1", [marker + "-TOPIC"])).rowCount, 1);
      assert.equal((await pool.query("select 1 from teaching.subtopics where code=$1", [marker + "-SUB"])).rowCount, 1);
      assert.equal((await pool.query("select 1 from teaching.modalities where code=$1", [marker + "-MOD"])).rowCount, 1);
      assert.equal((await pool.query("select 1 from teaching.competencies where code=$1", [marker + "-COMP"])).rowCount, 1);
      assert.equal((await pool.query("select 1 from teaching.training_levels where code=$1", [marker + "-LEVEL"])).rowCount, 1);
      assert.equal((await pool.query("select 1 from teaching.tags where code=$1", [marker + "-TAG"])).rowCount, 1);
      assert.equal((await pool.query("select 1 from teaching.difficulties where value=3")).rowCount, 1);
      assert.equal(Number((await pool.query<{ count: string }>("select count(*)::text as count from teaching.difficulties")).rows[0]!.count), difficultyCountBefore);
      assert.equal((await pool.query("select 1 from teaching.question_banks where code=$1", [marker + "-BANK"])).rowCount, 1);
      assert.equal((await pool.query<{ count: string }>("select count(*)::text as count from schema_migrations")).rows[0]!.count, unrelatedBefore.rows[0]!.count);
      console.log("[Teaching reset proof] " + JSON.stringify({
        deletedContentTables: Object.keys(reset.counts).length,
        deletedAssetFiles: reset.assetFilesDeleted,
        reportedAssetFileFailures: reset.assetFileDeletionFailures.length,
        preservedUserProfile: true,
        preservedTaxonomyAndQuestionBank: true,
        unrelatedTableUnchanged: true,
      }));
    } finally {
      taxonomyClient.release();
    }
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
    await resetTeachingContent({ confirmation: TEACHING_RESET_CONFIRMATION, nodeEnv: "test", uploadsDir: storageRoot }).catch(() => undefined);
    await pool.query("delete from teaching.question_banks where name = 'Reset fixture bank'");
    await pool.query("delete from teaching.subtopics where label = 'Reset fixture subtopic'");
    await pool.query("delete from teaching.topics where label = 'Reset fixture topic'");
    await pool.query("delete from teaching.domains where label = 'Reset fixture domain'");
    await pool.query("delete from teaching.specialties where label = 'Reset fixture specialty'");
    await pool.query("delete from teaching.modalities where label = 'Reset fixture modality'");
    await pool.query("delete from teaching.competencies where label = 'Reset fixture competency'");
    await pool.query("delete from teaching.training_levels where label = 'Reset fixture level'");
    await pool.query("delete from teaching.tags where label = 'Reset fixture tag'");
    await pool.query("delete from teaching.user_profiles where identity_issuer = 'rispro' and display_name = 'Teaching reset integration fixture'");
    await pool.end();
  }
});
