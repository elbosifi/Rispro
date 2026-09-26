import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "teaching-learner-test-secret";

type Json = Record<string, any>;

test("Teaching learner sessions keep published revisions, private state, attempts, and Exam feedback safe", async (t) => {
  const [{ createApp }, { pool }, { env }] = await Promise.all([
    import("../../../app.js"),
    import("../../../db/pool.js"),
    import("../../../config/env.js"),
  ]);
  try {
    await pool.query("select 1 from teaching.sessions limit 1");
  } catch {
    t.skip("PostgreSQL is not reachable at the configured disposable DATABASE_URL.");
    return;
  }

  const suffix = randomUUID();
  const identityBase = `${Date.now()}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
  const learner = `${identityBase}01`;
  const otherLearner = `${identityBase}02`;
  const accessOnly = `${identityBase}03`;
  const subjects = [learner, otherLearner, accessOnly];
  const createdQuestionIds: number[] = [];
  const createdRevisionIds: number[] = [];
  let fixtureCleanupNeeded = false;
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const request = async (path: string, subject = learner, method = "GET", body?: unknown) => {
    const cookie = `${env.cookieName}=${jwt.sign({ sub: subject, role: "doctor", fullName: "Synthetic Teaching Learner" }, env.jwtSecret)}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Cookie: cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({})) as Json;
    return { status: response.status, data };
  };
  const cleanupFixtures = async () => {
    if (!fixtureCleanupNeeded) return;
    let snapshotTriggerDisabled = false;
    let attemptTriggerDisabled = false;
    try {
      await pool.query("alter table teaching.session_questions disable trigger teaching_session_questions_snapshot_immutable");
      snapshotTriggerDisabled = true;
      await pool.query("alter table teaching.attempts disable trigger teaching_attempts_immutable");
      attemptTriggerDisabled = true;
      await pool.query("delete from teaching.user_question_state where identity_issuer = 'rispro' and identity_subject = any($1::text[])", [subjects]);
      await pool.query("delete from teaching.bookmarks where identity_issuer = 'rispro' and identity_subject = any($1::text[])", [subjects]);
      await pool.query("delete from teaching.notes where identity_issuer = 'rispro' and identity_subject = any($1::text[])", [subjects]);
      await pool.query("delete from teaching.study_cycles where identity_issuer = 'rispro' and identity_subject = any($1::text[])", [subjects]);
      await pool.query("delete from teaching.attempts where identity_issuer = 'rispro' and identity_subject = any($1::text[])", [subjects]);
      await pool.query("delete from teaching.session_questions where session_id in (select id from teaching.sessions where identity_issuer = 'rispro' and identity_subject = any($1::text[]))", [subjects]);
      await pool.query("delete from teaching.sessions where identity_issuer = 'rispro' and identity_subject = any($1::text[])", [subjects]);
      if (createdRevisionIds.length) await pool.query("delete from teaching.question_revisions where id = any($1::bigint[])", [createdRevisionIds]);
      if (createdQuestionIds.length) await pool.query("delete from teaching.questions where id = any($1::bigint[])", [createdQuestionIds]);
      await pool.query("delete from teaching.user_profiles where identity_issuer = 'rispro' and identity_subject = any($1::text[])", [subjects]);
    } finally {
      if (attemptTriggerDisabled) await pool.query("alter table teaching.attempts enable trigger teaching_attempts_immutable");
      if (snapshotTriggerDisabled) await pool.query("alter table teaching.session_questions enable trigger teaching_session_questions_snapshot_immutable");
    }
  };

  try {
    await pool.query(
      `insert into teaching.user_profiles (identity_issuer, identity_subject, display_name)
       select 'rispro', profile.identity_subject, 'Synthetic Teaching Learner'
       from unnest($1::text[]) as profile(identity_subject)`,
      [subjects],
    );
    fixtureCleanupNeeded = true;
    await pool.query(
      `insert into teaching.user_permissions (identity_issuer, identity_subject, permission)
       select 'rispro', profiles.identity_subject, grants.permission
       from unnest($1::text[]) as profiles(identity_subject)
       cross join unnest(array['teaching.access', 'teaching.learn']::text[]) as grants(permission)`,
      [[learner, otherLearner]],
    );
    await pool.query(
      `insert into teaching.user_permissions (identity_issuer, identity_subject, permission)
       values ('rispro', $1, 'teaching.access')`,
      [accessOnly],
    );

    const catalog = await pool.query<{
      specialty_id: string; bank_id: string; domain_id: string; topic_id: string; chest_domain_id: string; difficulty_id: string;
      training_level_id: string; modality_id: string; competency_id: string; oncology_tag_id: string; emergency_tag_id: string;
    }>(
      `select specialty.id as specialty_id, bank.id as bank_id, domain.id as domain_id, topic.id as topic_id,
         (select id from teaching.domains where specialty_id = specialty.id and code = 'chest') as chest_domain_id,
         difficulty.id as difficulty_id, level.id as training_level_id, modality.id as modality_id,
         competency.id as competency_id,
         (select id from teaching.tags where code = 'oncology') as oncology_tag_id,
         (select id from teaching.tags where code = 'emergency') as emergency_tag_id
       from teaching.specialties specialty
       join teaching.question_banks bank on bank.specialty_id = specialty.id
       join teaching.domains domain on domain.specialty_id = specialty.id and domain.code = 'neuroradiology'
       join teaching.topics topic on topic.domain_id = domain.id and topic.code = 'brain-tumors'
       join teaching.difficulties difficulty on difficulty.value = 3
       join teaching.training_levels level on level.code = 'junior_resident'
       join teaching.modalities modality on modality.code = 'MRI'
       join teaching.competencies competency on competency.code = 'diagnosis'
       where specialty.code = 'radiology' and bank.code = 'radiology-main'`,
    );
    assert.equal(catalog.rowCount, 1);
    const ids = catalog.rows[0]!;

    const insertQuestion = async (externalId: string, stem: string, tags: number[], addDraft = false,
      domainId = ids.domain_id, topicId: string | null = ids.topic_id) => {
      const questionResult = await pool.query<{ id: string }>(
        `insert into teaching.questions (question_bank_id, specialty_id, external_id, created_by_identity_issuer, created_by_identity_subject)
         values ($1, $2, $3, 'rispro', $4) returning id`,
        [ids.bank_id, ids.specialty_id, externalId, learner],
      );
      const questionId = Number(questionResult.rows[0]!.id);
      createdQuestionIds.push(questionId);
      const revisionResult = await pool.query<{ id: string }>(
        `insert into teaching.question_revisions (
           question_id, revision_number, status, question_type, stem, specialty_id, domain_id, topic_id,
           difficulty_id, training_level_id, explanation_summary, teaching_point,
           created_by_identity_issuer, created_by_identity_subject,
           reviewed_by_identity_issuer, reviewed_by_identity_subject, reviewed_at,
           published_by_identity_issuer, published_by_identity_subject, published_at
         ) values ($1, 1, 'published', 'single_best_answer', $2, $3, $4, $5, $6, $7,
           'Synthetic explanation for learner validation.', 'Synthetic teaching point.',
           'rispro', $8, 'rispro', $8, now(), 'rispro', $8, now()) returning id`,
        [questionId, stem, ids.specialty_id, domainId, topicId, ids.difficulty_id, ids.training_level_id, learner],
      );
      const revisionId = Number(revisionResult.rows[0]!.id);
      createdRevisionIds.push(revisionId);
      const addOptions = async (revision: number) => {
        await pool.query(
          `insert into teaching.question_options (question_revision_id, option_key, text, is_correct, explanation, sort_order)
           values ($1, 'A', 'Synthetic correct option', true, 'Correct option explanation.', 1),
                  ($1, 'B', 'Synthetic distractor', false, 'Distractor explanation.', 2)`,
          [revision],
        );
      };
      await addOptions(revisionId);
      await pool.query("insert into teaching.question_revision_modalities (question_revision_id, modality_id, sort_order) values ($1, $2, 1)", [revisionId, ids.modality_id]);
      await pool.query("insert into teaching.question_revision_competencies (question_revision_id, competency_id, sort_order) values ($1, $2, 1)", [revisionId, ids.competency_id]);
      for (let index = 0; index < tags.length; index += 1) {
        await pool.query(
          "insert into teaching.question_revision_tags (question_revision_id, tag_id, sort_order) values ($1, $2, $3)",
          [revisionId, tags[index], index + 1],
        );
      }
      let draftRevisionId: number | null = null;
      if (addDraft) {
        const draft = await pool.query<{ id: string }>(
          `insert into teaching.question_revisions (
             question_id, revision_number, status, question_type, stem, specialty_id, domain_id, topic_id,
             difficulty_id, training_level_id, explanation_summary, teaching_point,
             created_by_identity_issuer, created_by_identity_subject
           ) values ($1, 2, 'draft', 'single_best_answer', 'Synthetic question A revision 2.', $2, $3, $4, $5, $6,
             'Synthetic revision two explanation.', 'Synthetic revision two point.', 'rispro', $7) returning id`,
          [questionId, ids.specialty_id, ids.domain_id, ids.topic_id, ids.difficulty_id, ids.training_level_id, learner],
        );
        draftRevisionId = Number(draft.rows[0]!.id);
        createdRevisionIds.push(draftRevisionId);
        await addOptions(draftRevisionId);
        await pool.query("insert into teaching.question_revision_modalities (question_revision_id, modality_id, sort_order) values ($1, $2, 1)", [draftRevisionId, ids.modality_id]);
        await pool.query("insert into teaching.question_revision_competencies (question_revision_id, competency_id, sort_order) values ($1, $2, 1)", [draftRevisionId, ids.competency_id]);
        for (let index = 0; index < tags.length; index += 1) {
          await pool.query(
            "insert into teaching.question_revision_tags (question_revision_id, tag_id, sort_order) values ($1, $2, $3)",
            [draftRevisionId, tags[index], index + 1],
          );
        }
      }
      return { questionId, revisionId, draftRevisionId };
    };

    const questionA = await insertQuestion(`TEST-${suffix.slice(0, 8).toUpperCase()}-A`, "Synthetic question A revision 1.", [Number(ids.oncology_tag_id)], true);
    assert.ok(questionA.draftRevisionId);
    await insertQuestion(`TEST-${suffix.slice(0, 8).toUpperCase()}-B`, "Synthetic question B.", [Number(ids.emergency_tag_id)]);
    await insertQuestion(`TEST-${suffix.slice(0, 8).toUpperCase()}-C`, "Synthetic question C.", []);
    await insertQuestion(`TEST-${suffix.slice(0, 8).toUpperCase()}-D`, "Synthetic Chest question.", [Number(ids.emergency_tag_id)], false, ids.chest_domain_id, null);

    const chestSession = await request("/api/teaching/sessions", learner, "POST", {
      mode: "study", questionCount: 1, filters: { specialty: "radiology", domain: "chest", questionState: "unseen" },
    });
    assert.equal(chestSession.status, 201);
    const chestSessionId = chestSession.data.sessionId as number;
    const chestAnswer = await request(`/api/teaching/sessions/${chestSessionId}/questions/1/answer`, learner, "POST", { selectedOptionKey: "A" });
    assert.equal(chestAnswer.data.feedback.isCorrect, true);

    const denied = await request("/api/teaching/sessions", accessOnly, "POST", { mode: "study", questionCount: 1, filters: { questionState: "all" } });
    assert.equal(denied.status, 403);
    assert.equal((await request("/api/teaching/progress?questionBank=radiology-main", accessOnly)).status, 403);
    const deniedAsset = await request("/api/teaching/assets/1", accessOnly);
    assert.equal(deniedAsset.status, 403);

    const filters = {
      specialty: "radiology", domain: "neuroradiology", topics: ["brain-tumors"],
      modalities: ["MRI"], competencies: ["diagnosis"], trainingLevels: ["junior_resident"],
      difficulty: [3], tags: ["oncology"], questionState: "unseen",
    };
    const available = await request("/api/teaching/qbank/availability", learner, "POST", { filters });
    assert.equal(available.status, 200);
    assert.deepEqual(available.data, { available: 1, questionState: "unseen" });

    const insufficient = await request("/api/teaching/sessions", learner, "POST", {
      mode: "study", questionCount: 2, timed: false, filters,
    });
    assert.equal(insufficient.status, 422);
    assert.match(JSON.stringify(insufficient.data), /Only 1 questions match.*2 requested/);

    const studyCreated = await request("/api/teaching/sessions", learner, "POST", {
      mode: "study", questionCount: 1, timed: false, filters,
    });
    assert.equal(studyCreated.status, 201);
    const studyId = studyCreated.data.sessionId as number;
    assert.equal(studyCreated.data.questionCount, 1);
    assert.equal(Object.hasOwn(studyCreated.data, "correctOption"), false);
    const beforeAnswer = await request(`/api/teaching/sessions/${studyId}/questions/1`);
    assert.equal(beforeAnswer.status, 200);
    assert.equal(beforeAnswer.data.stem, "Synthetic question A revision 1.");
    assert.equal(beforeAnswer.data.options[0].key, "A");
    assert.equal(Object.hasOwn(beforeAnswer.data, "feedback"), false);
    const beforeJson = JSON.stringify(beforeAnswer.data);
    for (const forbidden of ["isCorrect", "is_correct", "answerKey", "correctOption", "explanation", "provenance", "importBatchId"]) {
      assert.equal(beforeJson.includes(forbidden), false, `unanswered Study DTO must not serialize ${forbidden}`);
    }

    const studyAnswer = await request(`/api/teaching/sessions/${studyId}/questions/1/answer`, learner, "POST", { selectedOptionKey: "B", isCorrect: true });
    assert.equal(studyAnswer.status, 200);
    assert.equal(studyAnswer.data.feedback.isCorrect, false);
    assert.equal(studyAnswer.data.feedback.correctOption.key, "A");
    assert.equal(studyAnswer.data.feedback.optionExplanations.length, 2);
    const repeatedAnswer = await request(`/api/teaching/sessions/${studyId}/questions/1/answer`, learner, "POST", { selectedOptionKey: "B" });
    assert.equal(repeatedAnswer.status, 200);
    const changedStudyAnswer = await request(`/api/teaching/sessions/${studyId}/questions/1/answer`, learner, "POST", { selectedOptionKey: "A" });
    assert.equal(changedStudyAnswer.status, 409);
    const firstAttempt = await pool.query<{ id: string; selected_option_key: string; is_correct: boolean }>(
      "select id, selected_option_key, is_correct from teaching.attempts where session_id = $1",
      [studyId],
    );
    assert.equal(firstAttempt.rowCount, 1);
    assert.deepEqual(firstAttempt.rows[0], { id: firstAttempt.rows[0]!.id, selected_option_key: "B", is_correct: false });
    await assert.rejects(
      pool.query("update teaching.attempts set is_correct = true where id = $1", [firstAttempt.rows[0]!.id]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "55000",
    );

    const marked = await request(`/api/teaching/bookmarks/${questionA.questionId}`, learner, "PUT", {});
    assert.equal(marked.status, 200);
    const note = await request(`/api/teaching/notes/${questionA.questionId}`, learner, "PUT", { note: "Review the synthetic vessel pattern." });
    assert.equal(note.status, 200);
    const learnerQuestion = await request(`/api/teaching/sessions/${studyId}/questions/1`);
    assert.equal(learnerQuestion.data.bookmarked, true);
    assert.equal(learnerQuestion.data.note, "Review the synthetic vessel pattern.");

    const otherSession = await request("/api/teaching/sessions", otherLearner, "POST", {
      mode: "study", questionCount: 1, filters: { ...filters, questionState: "unseen" },
    });
    assert.equal(otherSession.status, 201);
    const otherSessionId = otherSession.data.sessionId as number;
    const privateQuestion = await request(`/api/teaching/sessions/${otherSessionId}/questions/1`, otherLearner);
    assert.equal(privateQuestion.status, 200);
    assert.equal(privateQuestion.data.bookmarked, false);
    assert.equal(privateQuestion.data.note, "");
    assert.equal((await request(`/api/teaching/sessions/${studyId}`, otherLearner)).status, 404);

    const incorrectAvailability = await request("/api/teaching/qbank/availability", learner, "POST", {
      filters: { ...filters, questionState: "incorrect" },
    });
    const markedAvailability = await request("/api/teaching/qbank/availability", learner, "POST", {
      filters: { ...filters, questionState: "marked" },
    });
    assert.equal(incorrectAvailability.data.available, 1);
    assert.equal(markedAvailability.data.available, 1);
    const reviewCreated = await request("/api/teaching/sessions", learner, "POST", {
      mode: "review", questionCount: 1, filters: { ...filters, questionState: "incorrect" },
    });
    assert.equal(reviewCreated.status, 201);
    assert.equal(reviewCreated.data.mode, "review");
    const reviewId = reviewCreated.data.sessionId as number;
    const reviewAnswer = await request(`/api/teaching/sessions/${reviewId}/questions/1/answer`, learner, "POST", { selectedOptionKey: "A" });
    assert.equal(reviewAnswer.data.feedback.isCorrect, true);
    const endedStudy = await request(`/api/teaching/sessions/${studyId}/submit`, learner, "POST", {});
    assert.equal(endedStudy.data.status, "submitted");
    const state = await pool.query<{ state: string }>(
      "select state from teaching.user_question_state where identity_issuer = 'rispro' and identity_subject = $1 and question_id = $2",
      [learner, questionA.questionId],
    );
    assert.equal(state.rows[0]?.state, "correct");
    const preservedAttempts = await pool.query<{ count: number }>("select count(*)::int as count from teaching.attempts where question_id = $1 and identity_subject = $2", [questionA.questionId, learner]);
    assert.equal(preservedAttempts.rows[0]?.count, 2);

    const examCreated = await request("/api/teaching/sessions", learner, "POST", {
      mode: "exam", questionCount: 3, timed: false,
      filters: { specialty: "radiology", domain: "neuroradiology", difficulty: [3], modalities: ["MRI"], competencies: ["diagnosis"], questionState: "all" },
    });
    assert.equal(examCreated.status, 201);
    const examId = examCreated.data.sessionId as number;
    const examQuestion = await request(`/api/teaching/sessions/${examId}/questions/1`);
    assert.equal(examQuestion.status, 200);
    assert.equal(Object.hasOwn(examQuestion.data, "feedback"), false);
    for (const forbidden of ["isCorrect", "is_correct", "answerKey", "correctOption", "explanation", "provenance"]) {
      assert.equal(JSON.stringify(examQuestion.data).includes(forbidden), false, `active Exam DTO must not serialize ${forbidden}`);
    }
    const selectExamAnswer = await request(`/api/teaching/sessions/${examId}/questions/1/response`, learner, "PUT", { selectedOptionKey: "A" });
    const changeExamAnswer = await request(`/api/teaching/sessions/${examId}/questions/1/response`, learner, "PUT", { selectedOptionKey: "B" });
    assert.equal(selectExamAnswer.status, 200);
    assert.equal(changeExamAnswer.status, 200);
    const noDraftAttempts = await pool.query("select 1 from teaching.attempts where session_id = $1", [examId]);
    assert.equal(noDraftAttempts.rowCount, 0);
    const activeExam = await request(`/api/teaching/sessions/${examId}`);
    assert.equal(activeExam.data.progress.answered, 1);
    assert.equal(activeExam.data.progress.correct, null);
    const unchangedSafeExam = await request(`/api/teaching/sessions/${examId}/questions/1`);
    assert.equal(Object.hasOwn(unchangedSafeExam.data, "feedback"), false);
    const submittedExam = await request(`/api/teaching/sessions/${examId}/submit`, learner, "POST", {});
    assert.equal(submittedExam.data.status, "submitted");
    assert.equal(submittedExam.data.progress.answered, 1);
    assert.equal(submittedExam.data.progress.incorrect, 1);
    assert.equal(submittedExam.data.progress.unanswered, 2);
    assert.equal(submittedExam.data.progress.scorePercent, 0);
    await request(`/api/teaching/sessions/${examId}/submit`, learner, "POST", {});
    assert.equal((await pool.query("select 1 from teaching.attempts where session_id = $1", [examId])).rowCount, 1);
    const examReview = await request(`/api/teaching/sessions/${examId}/questions/1`);
    assert.equal(examReview.data.feedback.isCorrect, false);
    assert.equal(examReview.data.feedback.correctOption.key, "A");

    const timedCreated = await request("/api/teaching/sessions", learner, "POST", {
      mode: "exam", questionCount: 1, timed: true, timeLimitSeconds: 60,
      filters: { ...filters, questionState: "all" },
    });
    assert.equal(timedCreated.status, 201);
    const timedId = timedCreated.data.sessionId as number;
    const beforeExpiry = await request(`/api/teaching/sessions/${timedId}`);
    assert.ok(beforeExpiry.data.remainingSeconds > 0 && beforeExpiry.data.remainingSeconds <= 60);
    await pool.query("update teaching.sessions set started_at = now() - interval '61 seconds' where id = $1", [timedId]);
    const expired = await request(`/api/teaching/sessions/${timedId}`);
    assert.equal(expired.data.status, "submitted");
    assert.equal(expired.data.remainingSeconds, 0);
    assert.equal(expired.data.progress.answered, 0);
    const afterExpiry = await request(`/api/teaching/sessions/${timedId}/questions/1`);
    assert.equal(afterExpiry.data.feedback.isCorrect, null);
    const lateResponse = await request(`/api/teaching/sessions/${timedId}/questions/1/response`, learner, "PUT", { selectedOptionKey: "A" });
    assert.equal(lateResponse.data.saved, false);
    assert.equal(lateResponse.data.submitted, true);

    const pinnedCreated = await request("/api/teaching/sessions", learner, "POST", {
      mode: "study", questionCount: 1, filters: { ...filters, questionState: "all" },
    });
    const pinnedId = pinnedCreated.data.sessionId as number;
    const pinnedBefore = await request(`/api/teaching/sessions/${pinnedId}/questions/1`);
    assert.equal(pinnedBefore.data.stem, "Synthetic question A revision 1.");
    await pool.query(
      `update teaching.question_revisions set status = 'published',
         reviewed_by_identity_issuer = 'rispro', reviewed_by_identity_subject = $2, reviewed_at = now(),
         published_by_identity_issuer = 'rispro', published_by_identity_subject = $2, published_at = now()
       where id = $1`,
      [Number(questionA.draftRevisionId), learner],
    );
    const pinnedAfter = await request(`/api/teaching/sessions/${pinnedId}/questions/1`);
    assert.equal(pinnedAfter.data.stem, "Synthetic question A revision 1.");
    const newlyPublished = await request("/api/teaching/sessions", learner, "POST", {
      mode: "study", questionCount: 1, filters: { ...filters, questionState: "all" },
    });
    const revisionTwo = await request(`/api/teaching/sessions/${newlyPublished.data.sessionId}/questions/1`);
    assert.equal(revisionTwo.data.stem, "Synthetic question A revision 2.");
    const snapshotChange = await pool.query(
      "update teaching.session_questions set question_revision_id = $2 where session_id = $1 and position = 1",
      [pinnedId, Number(questionA.draftRevisionId)],
    ).then(() => null, (error: unknown) => error);
    assert.ok(snapshotChange && typeof snapshotChange === "object" && "code" in snapshotChange && snapshotChange.code === "55000");

    const history = await request("/api/teaching/history?page=1&pageSize=20");
    assert.equal(history.status, 200);
    assert.ok(history.data.items.some((item: Json) => item.id === studyId && item.status === "submitted"));
    const dashboard = await request("/api/teaching/qbank/dashboard");
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.data.publishedQuestionCount, 4);
    const learnerQuestionState = await pool.query<{ attempted: number; correct: number; incorrect: number }>(
      `select count(*)::int as attempted,
         count(*) filter (where state = 'correct')::int as correct,
         count(*) filter (where state = 'incorrect')::int as incorrect
       from teaching.user_question_state where identity_issuer = 'rispro' and identity_subject = $1`,
      [learner],
    );
    assert.equal(dashboard.data.progress.attemptedQuestions, learnerQuestionState.rows[0]?.attempted);
    assert.equal(dashboard.data.progress.correctQuestions, learnerQuestionState.rows[0]?.correct);
    assert.equal(dashboard.data.progress.incorrectQuestions, learnerQuestionState.rows[0]?.incorrect);
    assert.equal(dashboard.data.progress.unseenQuestions + dashboard.data.progress.attemptedQuestions, 4);

    const neuroFilters = { specialty: "radiology", domain: "neuroradiology", topics: ["brain-tumors"] };
    const preview = await request("/api/teaching/progress/preview?questionBank=radiology-main&scopeType=topic&scopeCode=brain-tumors&domain=neuroradiology");
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.equal(preview.data.eligibleQuestionCount, 3);
    assert.ok(preview.data.activeSessionCount > 0, "reset preview reports intersecting active sessions");

    const beforeResetCounts = await pool.query<{ attempts: number; sessions: number; sessionQuestions: number }>(
      `select (select count(*)::int from teaching.attempts where identity_issuer = 'rispro' and identity_subject = $1) as attempts,
        (select count(*)::int from teaching.sessions where identity_issuer = 'rispro' and identity_subject = $1) as sessions,
        (select count(*)::int from teaching.session_questions item join teaching.sessions session on session.id = item.session_id
          where session.identity_issuer = 'rispro' and session.identity_subject = $1) as "sessionQuestions"`,
      [learner],
    );
    const resetTopicKey = randomUUID();
    const topicResetBody = {
      questionBank: "radiology-main", scope: { type: "topic", code: "brain-tumors", domain: "neuroradiology" }, idempotencyKey: resetTopicKey,
    };
    const [topicReset, duplicateReset] = await Promise.all([
      request("/api/teaching/progress/reset", learner, "POST", topicResetBody),
      request("/api/teaching/progress/reset", learner, "POST", topicResetBody),
    ]);
    assert.equal(topicReset.status, 201, JSON.stringify(topicReset.data));
    assert.equal(topicReset.data.scope.code, "brain-tumors");
    assert.equal(topicReset.data.cycleNumber, 2);
    assert.equal(topicReset.data.attempted, 0);
    assert.equal(duplicateReset.status, 201);
    assert.notEqual(duplicateReset.data.alreadyApplied, topicReset.data.alreadyApplied);
    assert.equal(duplicateReset.data.cycleNumber, topicReset.data.cycleNumber);
    const afterResetCounts = await pool.query<{ attempts: number; sessions: number; sessionQuestions: number }>(
      `select (select count(*)::int from teaching.attempts where identity_issuer = 'rispro' and identity_subject = $1) as attempts,
        (select count(*)::int from teaching.sessions where identity_issuer = 'rispro' and identity_subject = $1) as sessions,
        (select count(*)::int from teaching.session_questions item join teaching.sessions session on session.id = item.session_id
          where session.identity_issuer = 'rispro' and session.identity_subject = $1) as "sessionQuestions"`,
      [learner],
    );
    assert.deepEqual(afterResetCounts.rows[0], beforeResetCounts.rows[0], "reset preserves attempts, sessions, and session-question snapshots");
    assert.equal((await pool.query("select 1 from teaching.sessions where id = $1 and status = 'active'", [pinnedId])).rowCount, 1);
    assert.equal((await pool.query("select 1 from teaching.session_questions where session_id = $1 and question_id = $2 and question_revision_id = $3", [pinnedId, questionA.questionId, questionA.revisionId])).rowCount, 1);
    assert.equal((await pool.query("select 1 from teaching.bookmarks where identity_issuer = 'rispro' and identity_subject = $1 and question_id = $2", [learner, questionA.questionId])).rowCount, 1);
    assert.equal((await pool.query("select note_text from teaching.notes where identity_issuer = 'rispro' and identity_subject = $1 and question_id = $2", [learner, questionA.questionId])).rows[0]?.note_text, "Review the synthetic vessel pattern.");

    const unseenAfterReset = await request("/api/teaching/qbank/availability", learner, "POST", { filters: { ...neuroFilters, questionState: "unseen" } });
    assert.equal(unseenAfterReset.data.available, 3, "old answers are unseen in the new topic cycle");
    const oldSessionAnswer = await request(`/api/teaching/sessions/${pinnedId}/questions/1/answer`, learner, "POST", { selectedOptionKey: "A" });
    assert.equal(oldSessionAnswer.status, 200);
    const unseenAfterOldSessionAnswer = await request("/api/teaching/qbank/availability", learner, "POST", { filters: { ...neuroFilters, questionState: "unseen" } });
    assert.equal(unseenAfterOldSessionAnswer.data.available, 3, "a session opened before reset remains in the earlier learning period");
    const chestStillCorrect = await request("/api/teaching/qbank/availability", learner, "POST", {
      filters: { specialty: "radiology", domain: "chest", questionState: "correct" },
    });
    assert.equal(chestStillCorrect.data.available, 1, "a topic reset leaves another domain unchanged");

    const newCycleSession = await request("/api/teaching/sessions", learner, "POST", {
      mode: "study", questionCount: 1, filters: { ...neuroFilters, tags: ["oncology"], questionState: "unseen" },
    });
    assert.equal(newCycleSession.status, 201);
    const newCycleAnswer = await request(`/api/teaching/sessions/${newCycleSession.data.sessionId}/questions/1/answer`, learner, "POST", { selectedOptionKey: "A" });
    assert.equal(newCycleAnswer.data.feedback.isCorrect, true);

    const summary = await request("/api/teaching/progress?questionBank=radiology-main");
    assert.equal(summary.status, 200, JSON.stringify(summary.data));
    const domainBreakdown = await request("/api/teaching/progress/breakdown?questionBank=radiology-main&dimension=domain");
    assert.equal(domainBreakdown.status, 200, JSON.stringify(domainBreakdown.data));
    const neuroMetrics = domainBreakdown.data.items.find((item: Json) => item.code === "neuroradiology");
    assert.equal(neuroMetrics.eligible, 3);
    assert.equal(neuroMetrics.attempted, 1);
    assert.equal(neuroMetrics.correct, 1);
    assert.equal(neuroMetrics.accuracyPercent, 100);
    assert.ok(neuroMetrics.firstPassAccuracyPercent !== 100, "first-pass accuracy remains a lifetime metric");
    const topicBreakdown = await request("/api/teaching/progress/breakdown?questionBank=radiology-main&dimension=topic&domain=neuroradiology");
    assert.equal(topicBreakdown.data.items.find((item: Json) => item.code === "brain-tumors").eligible, 3);
    for (const dimension of ["modality", "competency", "difficulty", "tag"]) {
      const breakdown = await request(`/api/teaching/progress/breakdown?questionBank=radiology-main&dimension=${dimension}`);
      assert.equal(breakdown.status, 200, `${dimension}: ${JSON.stringify(breakdown.data)}`);
      assert.ok(Array.isArray(breakdown.data.items));
    }
    const topicCycles = await request("/api/teaching/progress/cycles?questionBank=radiology-main&scopeType=topic&scopeCode=brain-tumors&domain=neuroradiology");
    assert.equal(topicCycles.status, 200, JSON.stringify(topicCycles.data));
    assert.equal(topicCycles.data.items[0].current, true);
    assert.equal(topicCycles.data.items[0].attempted, 1);
    assert.ok(topicCycles.data.items.some((cycle: Json) => !cycle.current && cycle.endedAt));

    const domainReset = await request("/api/teaching/progress/reset", learner, "POST", {
      questionBank: "radiology-main", scope: { type: "domain", code: "neuroradiology" }, idempotencyKey: randomUUID(),
    });
    assert.equal(domainReset.status, 201, JSON.stringify(domainReset.data));
    assert.equal((await request("/api/teaching/qbank/availability", learner, "POST", { filters: { ...neuroFilters, questionState: "unseen" } })).data.available, 3);
    assert.equal((await request("/api/teaching/qbank/availability", learner, "POST", { filters: { specialty: "radiology", domain: "chest", questionState: "correct" } })).data.available, 1);

    const bankReset = await request("/api/teaching/progress/reset", learner, "POST", {
      questionBank: "radiology-main", scope: { type: "bank" }, idempotencyKey: randomUUID(),
    });
    assert.equal(bankReset.status, 201, JSON.stringify(bankReset.data));
    assert.equal(bankReset.data.cycleNumber, 2);
    assert.equal((await request("/api/teaching/qbank/availability", learner, "POST", { filters: { specialty: "radiology", domain: "chest", questionState: "unseen" } })).data.available, 1,
      "whole-bank reset supersedes narrower cycle boundaries");
    const bankCycles = await request("/api/teaching/progress/cycles?questionBank=radiology-main&scopeType=bank");
    assert.equal(bankCycles.data.items[0].cycleNumber, 2);
    assert.equal(bankCycles.data.items[0].current, true);
    const afterBankReset = await request("/api/teaching/progress?questionBank=radiology-main");
    assert.equal(afterBankReset.data.currentCycle.attempted, 0);
    assert.equal(afterBankReset.data.currentCycle.eligible, 4);
    assert.ok(afterBankReset.data.lifetime.totalAttempts >= 4);
    assert.ok(afterBankReset.data.lifetime.firstPassAccuracyPercent !== 100);
    const invalidReset = await request("/api/teaching/progress/reset", learner, "POST", {
      questionBank: "radiology-main", scope: { type: "domain", code: "inactive-domain" }, idempotencyKey: randomUUID(),
    });
    assert.equal(invalidReset.status, 404);
    assert.equal((await pool.query("select 1 from teaching.bookmarks where identity_issuer = 'rispro' and identity_subject = $1 and question_id = $2", [learner, questionA.questionId])).rowCount, 1);
    assert.equal((await pool.query("select 1 from teaching.notes where identity_issuer = 'rispro' and identity_subject = $1 and question_id = $2", [learner, questionA.questionId])).rowCount, 1);

    const privateSummary = await request("/api/teaching/progress?questionBank=radiology-main&userId=" + encodeURIComponent(learner), otherLearner);
    assert.equal(privateSummary.status, 200);
    assert.equal(privateSummary.data.lifetime.totalAttempts, 0, "learner APIs ignore userId and return only the authenticated learner's history");

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await cleanupFixtures();
  }
});
