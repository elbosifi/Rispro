import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "teaching-bulk-test-secret";

function object(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.ok(value !== null);
  return value as Record<string, unknown>;
}

test("Teaching import batches validate current drafts and publish eligible revisions independently", async (t) => {
  const [appModule, db, config, content, validation, transactions] = await Promise.all([
    import("../../../app.js"),
    import("../../../db/pool.js"),
    import("../../../config/env.js"),
    import("../services/teaching-content-service.js"),
    import("../domain/teaching-content-validation.js"),
    import("../services/teaching-transaction.js"),
  ]);
  const { createApp } = appModule;
  const { pool } = db;
  const { env } = config;
  try {
    await pool.query("select 1 from teaching.import_batches limit 1");
  } catch {
    t.skip("PostgreSQL is not reachable at the configured disposable DATABASE_URL.");
    return;
  }

  const hex = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const subjectNumber = BigInt(`0x${hex}`).toString();
  const authorSubject = `${subjectNumber}1`;
  const publisherSubject = `${subjectNumber}2`;
  const learnerSubject = `${subjectNumber}3`;
  const marker = `TST-BULK-${hex}`;
  const batchId = randomUUID();
  const syntheticBatchId = randomUUID();
  const batchExternalIds = Array.from({ length: 10 }, (_, index) => `${marker}-Q-${String(index + 1).padStart(3, "0")}`);
  const syntheticExternalIds = Array.from({ length: 500 }, (_, index) => `${marker}-PERF-${String(index + 1).padStart(3, "0")}`);
  const tagCode = `${marker}-LEARNER`;
  const subjectList = [authorSubject, publisherSubject, learnerSubject];
  let sourceId: number | null = null;
  let referenceId: number | null = null;
  let manualQuestionId: number | null = null;
  let performanceMs = { validation: 0, publication: 0 };

  const actor = { identityIssuer: "rispro", identitySubject: authorSubject, displayName: "Bulk Test Author" };
  const publisherActor = { identityIssuer: "rispro", identitySubject: publisherSubject, displayName: "Bulk Test Publisher" };
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const request = async (pathname: string, options: { method?: string; subject?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = {};
    if (options.subject) {
      headers.Cookie = `${env.cookieName}=${jwt.sign({ sub: options.subject, role: "receptionist", fullName: "Teaching Bulk Test" }, env.jwtSecret)}`;
    }
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return { status: response.status, data: await response.json() as Record<string, unknown> };
  };

  const questionCommand = (externalId: string, kind: "valid" | "warning" | "invalid", includeLineage: boolean) => ({
    externalId,
    questionBankCode: "radiology-main",
    type: kind === "invalid" ? "image_based_sba" : "single_best_answer",
    stem: `Synthetic bulk validation question ${externalId}.`,
    specialtyCode: "radiology",
    domainCode: "neuroradiology",
    topicCode: "brain-tumors",
    subtopicCode: "glioma",
    difficulty: 3,
    trainingLevelCode: "junior_resident",
    explanation: { summary: "A short, clear evidence summary.", teachingPoint: "A concise educational point." },
    options: [
      { key: "A", text: "A plausible distractor.", isCorrect: false, explanation: kind === "warning" ? null : "This distractor is less likely." },
      { key: "B", text: "The correct answer.", isCorrect: true, explanation: "This is supported by the finding." },
    ],
    modalityCodes: ["MRI"],
    competencyCodes: ["diagnosis"],
    tagCodes: includeLineage ? [tagCode] : [],
    sources: kind === "warning" ? [] : sourceId === null ? [] : [{ sourceId, relationship: "original" }],
    references: kind === "warning" || referenceId === null ? [] : [{ referenceId }],
    assetIds: [],
    authorship: { kind: "human_authored" },
  });

  try {
    for (const [subject, capabilities] of [
      [authorSubject, ["teaching.access", "teaching.author", "teaching.review", "teaching.publish"]],
      [publisherSubject, ["teaching.access", "teaching.publish"]],
      [learnerSubject, ["teaching.access", "teaching.learn"]],
    ] as const) {
      await pool.query(
        "insert into teaching.user_profiles (identity_issuer, identity_subject, display_name) values ('rispro', $1, $2)",
        [subject, `Bulk Test ${subject}`],
      );
      await pool.query(
        `insert into teaching.user_permissions (identity_issuer, identity_subject, permission)
         select 'rispro', $1, capability.permission from unnest($2::text[]) as capability(permission)`,
        [subject, capabilities],
      );
    }
    const source = validation.parseTeachingSourceInput({ sourceType: "original", authors: [], metadata: {} });
    sourceId = (await content.createTeachingSource(source, actor)).id;
    const reference = validation.parseTeachingReferenceInput({ referenceType: "other", title: "Synthetic bulk reference" });
    referenceId = (await content.createTeachingReference(reference, actor)).id;
    await pool.query("insert into teaching.tags (code, label, is_active) values ($1, 'Bulk learner visibility test', true)", [tagCode]);

    await pool.query(
      `insert into teaching.import_batches (
         id, uploaded_by_identity_issuer, uploaded_by_identity_subject, original_filename, input_type,
         schema_version, status, question_count, confirmed_at, confirmed_by_identity_issuer, confirmed_by_identity_subject
       ) values ($1, 'rispro', $2, 'bulk-validation-synthetic.json', 'json', '1.0', 'confirmed', 10, now(), 'rispro', $2)`,
      [batchId, authorSubject],
    );

    const questionIds = await transactions.withTeachingTransaction(async (client) => {
      const created: number[] = [];
      for (let index = 0; index < batchExternalIds.length; index += 1) {
        const kind = index === 8 ? "warning" : index === 9 ? "invalid" : "valid";
        created.push(await content.createTeachingQuestionInTransaction(
          client,
          questionCommand(batchExternalIds[index]!, kind, true),
          actor,
          batchId,
        ));
      }
      manualQuestionId = await content.createTeachingQuestionInTransaction(
        client,
        questionCommand(`${marker}-MANUAL-001`, "valid", false),
        actor,
      );
      return created;
    });

    const deniedLearner = await request(`/api/teaching/qbank/import/batches/${batchId}/validate`, { method: "POST", subject: learnerSubject, body: {} });
    assert.equal(deniedLearner.status, 403);
    const deniedPublisherValidation = await request(`/api/teaching/qbank/import/batches/${batchId}/validate`, { method: "POST", subject: publisherSubject, body: {} });
    assert.equal(deniedPublisherValidation.status, 403);

    const batchBefore = await request(`/api/teaching/qbank/import/batches/${batchId}`, { subject: authorSubject });
    assert.equal(batchBefore.status, 200);
    assert.deepEqual(object(object(batchBefore.data).publication), { total: 10, draft: 10, inReview: 0, published: 0, retired: 0 });

    const validationStarted = Date.now();
    const validationResponse = await request(`/api/teaching/qbank/import/batches/${batchId}/validate`, { method: "POST", subject: authorSubject, body: {} });
    assert.equal(validationResponse.status, 200, JSON.stringify(validationResponse.data));
    const validationSummary = object(validationResponse.data);
    assert.equal(validationSummary.total, 10);
    assert.equal(validationSummary.valid, 8);
    assert.equal(validationSummary.validWithWarnings, 1);
    assert.equal(validationSummary.invalid, 1);
    const resultItems = validationSummary.questions as Array<Record<string, unknown>>;
    const invalidItem = resultItems.find((item) => item.externalId === batchExternalIds[9]);
    const warningItem = resultItems.find((item) => item.externalId === batchExternalIds[8]);
    assert.equal(invalidItem?.revisionStatus, "draft");
    assert.equal(invalidItem?.eligibleForPublish, false);
    assert.match(JSON.stringify(invalidItem?.errors), /image-based question requires at least one image asset/i);
    assert.equal(warningItem?.validationStatus, "valid_with_warnings");
    assert.equal(warningItem?.eligibleForPublish, true);
    assert.equal(Object.hasOwn(resultItems[0]!, "options"), false);
    performanceMs.validation = Date.now() - validationStarted;

    const manualValidation = await request("/api/teaching/admin/questions/bulk/validate", {
      method: "POST", subject: authorSubject, body: { questionIds: [manualQuestionId] },
    });
    assert.equal(manualValidation.status, 200);
    assert.equal(object(manualValidation.data).valid, 1);

    const listAfterValidation = await request(`/api/teaching/admin/questions?importBatchId=${batchId}&pageSize=20`, { subject: authorSubject });
    assert.equal(listAfterValidation.status, 200);
    const listed = object(listAfterValidation.data).items as Array<Record<string, unknown>>;
    assert.equal(listed.length, 10);
    assert.equal(listed.filter((item) => item.validation !== null).length, 10);
    assert.equal(listed.find((item) => item.externalId === batchExternalIds[9])?.validation && object(listed.find((item) => item.externalId === batchExternalIds[9])!.validation).classification, "invalid");

    const afterValidation = await pool.query<{ status: string; version: number }>(
      "select status, version from teaching.question_revisions where question_id = any($1::bigint[]) order by question_id",
      [questionIds],
    );
    assert.equal(afterValidation.rows.length, 10);
    assert.ok(afterValidation.rows.every((row) => row.status === "draft" && row.version === 1), "validation does not advance draft lifecycle state");
    const conflictCandidate = resultItems.find((item) => item.questionId === questionIds[0])!;
    await assert.rejects(
      content.publishTeachingQuestionFromBulk(
        Number(conflictCandidate.questionId),
        Number(conflictCandidate.revisionId),
        Number(conflictCandidate.revisionVersion) + 1,
        actor,
        true,
      ),
      /changed while the batch was being published/,
    );
    const afterConflict = await pool.query<{ status: string; version: number }>(
      "select status, version from teaching.question_revisions where question_id = $1 order by revision_number desc limit 1",
      [questionIds[0]],
    );
    assert.deepEqual(afterConflict.rows[0], { status: "draft", version: 1 }, "stale publication cannot mutate the current revision");

    const publisherOnlyResult = await request(`/api/teaching/qbank/import/batches/${batchId}/publish`, { method: "POST", subject: publisherSubject, body: {} });
    assert.equal(publisherOnlyResult.status, 200);
    assert.equal(object(publisherOnlyResult.data).published, 0);
    assert.equal(object(publisherOnlyResult.data).requiresReview, 9);
    assert.equal(object(publisherOnlyResult.data).invalid, 1);

    const publishStarted = Date.now();
    const publishResponse = await request(`/api/teaching/qbank/import/batches/${batchId}/publish`, { method: "POST", subject: authorSubject, body: {} });
    assert.equal(publishResponse.status, 200, JSON.stringify(publishResponse.data));
    const publishSummary = object(publishResponse.data);
    assert.equal(publishSummary.published, 9);
    assert.equal(publishSummary.invalid, 1);
    assert.equal(publishSummary.warnings, 1);
    performanceMs.publication = Date.now() - publishStarted;

    const afterFirstPublish = await pool.query<{
      external_id: string; status: string; revision_number: number; version: number;
      published_by_identity_subject: string | null; published_at: Date | null; import_batch_id: string | null;
    }>(
      `select question.external_id, revision.status, revision.revision_number, revision.version,
         revision.published_by_identity_subject, revision.published_at, revision.import_batch_id
       from teaching.questions question join teaching.question_revisions revision on revision.question_id = question.id
       where question.id = any($1::bigint[]) order by question.external_id`,
      [questionIds],
    );
    assert.equal(afterFirstPublish.rows.filter((row) => row.status === "published").length, 9);
    assert.equal(afterFirstPublish.rows.find((row) => row.external_id === batchExternalIds[9])?.status, "draft");
    for (const row of afterFirstPublish.rows.filter((item) => item.status === "published")) {
      assert.equal(row.revision_number, 1);
      assert.equal(row.published_by_identity_subject, authorSubject);
      assert.ok(row.published_at instanceof Date);
      assert.equal(row.import_batch_id, batchId);
    }

    const learnerAvailability = await request("/api/teaching/qbank/availability", {
      method: "POST", subject: learnerSubject, body: { questionBank: "radiology-main", tags: [tagCode] },
    });
    assert.equal(learnerAvailability.status, 200);
    assert.equal(object(learnerAvailability.data).available, 9);

    const retryPublish = await request(`/api/teaching/qbank/import/batches/${batchId}/publish`, { method: "POST", subject: authorSubject, body: {} });
    assert.equal(retryPublish.status, 200);
    assert.equal(object(retryPublish.data).published, 0);
    assert.equal(object(retryPublish.data).alreadyPublished, 9);
    assert.equal(object(retryPublish.data).invalid, 1);
    const invalidQuestionDetail = await request(`/api/teaching/admin/questions/${questionIds[9]}`, { subject: authorSubject });
    const invalidRevision = (object(invalidQuestionDetail.data).revisions as Array<Record<string, unknown>>)[0]!;
    const corrected = await request(`/api/teaching/admin/questions/${questionIds[9]}/revisions/${invalidRevision.id}`, {
      method: "PATCH", subject: authorSubject, body: { type: "single_best_answer", expectedVersion: invalidRevision.version },
    });
    assert.equal(corrected.status, 200);

    const revalidation = await request(`/api/teaching/qbank/import/batches/${batchId}/validate`, { method: "POST", subject: authorSubject, body: {} });
    assert.equal(revalidation.status, 200);
    assert.equal(object(revalidation.data).invalid, 0);
    const finalPublish = await request(`/api/teaching/qbank/import/batches/${batchId}/publish`, { method: "POST", subject: authorSubject, body: {} });
    assert.equal(finalPublish.status, 200);
    assert.equal(object(finalPublish.data).published, 1);
    assert.equal(object(finalPublish.data).alreadyPublished, 9);
    const finalBatch = await request(`/api/teaching/qbank/import/batches/${batchId}`, { subject: authorSubject });
    assert.deepEqual(object(object(finalBatch.data).publication), { total: 10, draft: 0, inReview: 0, published: 10, retired: 0 });
    const finalLearnerAvailability = await request("/api/teaching/qbank/availability", {
      method: "POST", subject: learnerSubject, body: { questionBank: "radiology-main", tags: [tagCode] },
    });
    assert.equal(object(finalLearnerAvailability.data).available, 10);

    const performanceBatch = await pool.query(
      `insert into teaching.import_batches (
         id, uploaded_by_identity_issuer, uploaded_by_identity_subject, original_filename, input_type,
         schema_version, status, question_count, confirmed_at, confirmed_by_identity_issuer, confirmed_by_identity_subject
       ) values ($1, 'rispro', $2, 'synthetic-500-question-batch.json', 'json', '1.0', 'confirmed', 500, now(), 'rispro', $2)`,
      [syntheticBatchId, authorSubject],
    );
    assert.equal(performanceBatch.rowCount, 1);
    const seed = await pool.connect();
    try {
      await seed.query("begin");
      const lookups = await seed.query<{
        bank_id: number; specialty_id: number; domain_id: number; topic_id: number;
        subtopic_id: number; difficulty_id: number; training_level_id: number;
      }>(
        `select bank.id as bank_id, specialty.id as specialty_id, domain.id as domain_id, topic.id as topic_id,
           subtopic.id as subtopic_id, difficulty.id as difficulty_id, level.id as training_level_id
         from teaching.question_banks bank
         join teaching.specialties specialty on specialty.id = bank.specialty_id
         join teaching.domains domain on domain.specialty_id = specialty.id and domain.code = 'neuroradiology'
         join teaching.topics topic on topic.domain_id = domain.id and topic.code = 'brain-tumors'
         join teaching.subtopics subtopic on subtopic.topic_id = topic.id and subtopic.code = 'glioma'
         join teaching.difficulties difficulty on difficulty.value = 3
         join teaching.training_levels level on level.code = 'junior_resident'
         where bank.code = 'radiology-main' and specialty.code = 'radiology'`,
      );
      const ids = lookups.rows[0]!;
      const insertedQuestions = await seed.query<{ id: string }>(
        `insert into teaching.questions (question_bank_id, specialty_id, external_id, created_by_identity_issuer, created_by_identity_subject)
         select $1, $2, item.external_id, 'rispro', $3 from unnest($4::text[]) as item(external_id) returning id`,
        [ids.bank_id, ids.specialty_id, authorSubject, syntheticExternalIds],
      );
      const syntheticQuestionIds = insertedQuestions.rows.map((row) => row.id);
      const insertedRevisions = await seed.query(
        `insert into teaching.question_revisions (
           question_id, revision_number, status, question_type, stem, specialty_id, domain_id, topic_id, subtopic_id,
           difficulty_id, training_level_id, explanation_summary, teaching_point, authorship_kind,
           created_by_identity_issuer, created_by_identity_subject, updated_by_identity_issuer,
           updated_by_identity_subject, import_batch_id
         )
         select question.id, 1, 'draft', 'single_best_answer', 'Synthetic large batch validation question.',
           $2, $3, $4, $5, $6, $7, 'A concise synthetic explanation.', 'A clear learning point.', 'human_authored',
           'rispro', $8, 'rispro', $8, $9::uuid
         from teaching.questions question where question.id = any($1::bigint[]) returning id`,
        [syntheticQuestionIds, ids.specialty_id, ids.domain_id, ids.topic_id, ids.subtopic_id, ids.difficulty_id, ids.training_level_id, authorSubject, syntheticBatchId],
      );
      const revisionIds = insertedRevisions.rows.map((row) => String(object(row).id));
      await seed.query(
        `insert into teaching.question_options (question_revision_id, option_key, text, is_correct, explanation, sort_order)
         select revision.id, 'A', 'A synthetic distractor.', false, null, 1 from teaching.question_revisions revision where revision.id = any($1::bigint[])
         union all
         select revision.id, 'B', 'A synthetic correct answer.', true, null, 2 from teaching.question_revisions revision where revision.id = any($1::bigint[])`,
        [revisionIds],
      );
      await seed.query("commit");
    } catch (error) {
      await seed.query("rollback");
      throw error;
    } finally {
      seed.release();
    }

    const largeValidationStart = Date.now();
    const largeValidation = await request(`/api/teaching/qbank/import/batches/${syntheticBatchId}/validate`, { method: "POST", subject: authorSubject, body: {} });
    performanceMs.validation = Date.now() - largeValidationStart;
    assert.equal(largeValidation.status, 200, JSON.stringify(largeValidation.data));
    assert.equal(object(largeValidation.data).total, 500);
    assert.equal(object(largeValidation.data).validWithWarnings, 500);
    const largePublicationStart = Date.now();
    const largePublication = await request(`/api/teaching/qbank/import/batches/${syntheticBatchId}/publish`, { method: "POST", subject: authorSubject, body: {} });
    performanceMs.publication = Date.now() - largePublicationStart;
    assert.equal(largePublication.status, 200, JSON.stringify(largePublication.data));
    assert.equal(object(largePublication.data).requested, 500);
    assert.equal(object(largePublication.data).published, 500);
    t.diagnostic(`Synthetic 500-question batch: validation ${performanceMs.validation} ms; publication ${performanceMs.publication} ms.`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const cleanup = await pool.connect();
    try {
      await cleanup.query("begin");
      const questions = await cleanup.query<{ id: string }>("select id from teaching.questions where external_id like $1", [`${marker}-%`]);
      const ids = questions.rows.map((row) => row.id);
      if (ids.length) {
        await cleanup.query("delete from teaching.question_options where question_revision_id in (select id from teaching.question_revisions where question_id = any($1::bigint[]))", [ids]);
        for (const table of ["question_revision_modalities", "question_revision_competencies", "question_revision_tags", "question_sources", "question_references", "question_revision_assets"]) {
          await cleanup.query(`delete from teaching.${table} where question_revision_id in (select id from teaching.question_revisions where question_id = any($1::bigint[]))`, [ids]);
        }
        await cleanup.query("delete from teaching.question_revisions where question_id = any($1::bigint[])", [ids]);
        await cleanup.query("delete from teaching.questions where id = any($1::bigint[])", [ids]);
      }
      await cleanup.query("delete from teaching.import_batches where id = any($1::uuid[])", [[batchId, syntheticBatchId]]);
      if (sourceId !== null) await cleanup.query("delete from teaching.sources where id = $1", [sourceId]);
      if (referenceId !== null) await cleanup.query('delete from teaching."references" where id = $1', [referenceId]);
      await cleanup.query("delete from teaching.tags where code = $1", [tagCode]);
      await cleanup.query("delete from teaching.user_profiles where identity_issuer = 'rispro' and identity_subject = any($1::text[])", [subjectList]);
      await cleanup.query("commit");
    } catch (error) {
      await cleanup.query("rollback");
      throw error;
    } finally {
      cleanup.release();
    }
  }
});
