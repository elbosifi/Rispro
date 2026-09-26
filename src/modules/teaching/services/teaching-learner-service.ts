import type { PoolClient } from "pg";
import { pool } from "../../../db/pool.js";
import { HttpError } from "../../../utils/http-error.js";
import type { TeachingIdentity } from "../domain/teaching-identity.js";
import { withTeachingTransaction } from "./teaching-transaction.js";
import { getTeachingProgress } from "./teaching-progress-service.js";

export const TEACHING_SESSION_MODES = ["study", "exam", "review"] as const;
export type TeachingSessionMode = (typeof TEACHING_SESSION_MODES)[number];
export const TEACHING_QUESTION_STATES = ["all", "unseen", "correct", "incorrect", "answered", "marked"] as const;
export type TeachingQuestionStateFilter = (typeof TEACHING_QUESTION_STATES)[number];

export interface TeachingLearnerFilters {
  questionBank: string | null;
  specialty: string | null;
  domain: string | null;
  topics: string[];
  subtopics: string[];
  modalities: string[];
  competencies: string[];
  trainingLevels: string[];
  difficulty: number[];
  tags: string[];
  questionState: TeachingQuestionStateFilter;
}

export interface CreateTeachingSessionInput {
  mode: TeachingSessionMode;
  questionCount: number;
  timed: boolean;
  timeLimitSeconds: number | null;
  filters: TeachingLearnerFilters;
}

interface SessionRow {
  id: string | number;
  identity_issuer: string;
  identity_subject: string;
  mode: TeachingSessionMode;
  status: "active" | "submitted" | "abandoned";
  question_count: number;
  timed: boolean;
  time_limit_seconds: number | null;
  filters_json: TeachingLearnerFilters;
  current_position: number;
  started_at: Date;
  last_activity_at: Date;
  submitted_at: Date | null;
  created_at: Date;
}

interface LearnerScope {
  identityIssuer: string;
  identitySubject: string;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, `${name} must be an object.`);
  return value as Record<string, unknown>;
}

function code(value: unknown, name: string): string {
  if (typeof value !== "string") throw new HttpError(400, `${name} is invalid.`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/.test(normalized) || normalized.length > 100) {
    throw new HttpError(400, `${name} is invalid.`);
  }
  return normalized;
}

function optionalCode(value: unknown, name: string): string | null {
  return value === undefined || value === null || value === "" ? null : code(value, name);
}

function codeList(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new HttpError(400, `${name} must be a list of at most 50 codes.`);
  return [...new Set(value.map((item) => code(item, name)))];
}

function normalizeFilters(value: unknown, mode: TeachingSessionMode): TeachingLearnerFilters {
  const input = value === undefined ? {} : record(value, "filters");
  const requestedState = input.questionState === undefined ? (mode === "review" ? "incorrect" : "all") : input.questionState;
  if (typeof requestedState !== "string" || !(TEACHING_QUESTION_STATES as readonly string[]).includes(requestedState)) {
    throw new HttpError(400, "filters.questionState is invalid.");
  }
  if (mode === "review" && requestedState === "all") {
    throw new HttpError(400, "Review sessions must target incorrect, marked, or previously answered questions.");
  }
  const difficultyValue = input.difficulty;
  let difficulty: number[] = [];
  if (difficultyValue !== undefined && difficultyValue !== null) {
    if (!Array.isArray(difficultyValue) || difficultyValue.length > 5) throw new HttpError(400, "filters.difficulty must contain values from 1 to 5.");
    difficulty = [...new Set(difficultyValue.map((item) => {
      if (!Number.isSafeInteger(item) || Number(item) < 1 || Number(item) > 5) throw new HttpError(400, "filters.difficulty is invalid.");
      return Number(item);
    }))];
  }
  return {
    questionBank: optionalCode(input.questionBank, "filters.questionBank"),
    specialty: optionalCode(input.specialty, "filters.specialty"),
    domain: optionalCode(input.domain, "filters.domain"),
    topics: codeList(input.topics, "filters.topics"),
    subtopics: codeList(input.subtopics, "filters.subtopics"),
    modalities: codeList(input.modalities, "filters.modalities"),
    competencies: codeList(input.competencies, "filters.competencies"),
    trainingLevels: codeList(input.trainingLevels, "filters.trainingLevels"),
    difficulty,
    tags: codeList(input.tags, "filters.tags"),
    questionState: requestedState as TeachingQuestionStateFilter,
  };
}

export function parseTeachingLearnerFilters(value: unknown): TeachingLearnerFilters {
  return normalizeFilters(value, "study");
}

export function parseCreateTeachingSession(value: unknown): CreateTeachingSessionInput {
  const input = record(value, "request");
  if (typeof input.mode !== "string" || !(TEACHING_SESSION_MODES as readonly string[]).includes(input.mode)) {
    throw new HttpError(400, "mode must be study, exam, or review.");
  }
  const mode = input.mode as TeachingSessionMode;
  const questionCount = input.questionCount;
  if (!Number.isSafeInteger(questionCount) || Number(questionCount) < 1 || Number(questionCount) > 100) {
    throw new HttpError(400, "questionCount must be an integer from 1 to 100.");
  }
  const timed = input.timed === undefined ? false : input.timed;
  if (typeof timed !== "boolean") throw new HttpError(400, "timed must be true or false.");
  const rawLimit = input.timeLimitSeconds;
  let timeLimitSeconds: number | null = null;
  if (timed) {
    if (mode !== "exam") throw new HttpError(400, "Only Exam sessions can be timed.");
    if (!Number.isSafeInteger(rawLimit) || Number(rawLimit) < 60 || Number(rawLimit) > 14400) {
      throw new HttpError(400, "timeLimitSeconds must be from 60 to 14400 for a timed Exam.");
    }
    timeLimitSeconds = Number(rawLimit);
  } else if (rawLimit !== undefined && rawLimit !== null) {
    throw new HttpError(400, "timeLimitSeconds requires a timed Exam session.");
  }
  return { mode, questionCount: Number(questionCount), timed, timeLimitSeconds, filters: normalizeFilters(input.filters, mode) };
}

function learnerScope(identity: TeachingIdentity): LearnerScope {
  return { identityIssuer: identity.identityIssuer, identitySubject: identity.identitySubject };
}

function buildEligibleQuestions(filters: TeachingLearnerFilters, scope: LearnerScope) {
  const values: unknown[] = [];
  const conditions = [
    "question.retired_at is null",
    "bank.is_active",
    "specialty.is_active",
    "domain.is_active",
  ];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const equal = (column: string, value: string | null) => {
    if (value !== null) conditions.push(`${column} = ${bind(value)}`);
  };
  const anyCode = (condition: string, list: string[]) => {
    if (list.length) conditions.push(condition.replace("?", bind(list)));
  };
  equal("bank.code", filters.questionBank);
  equal("specialty.code", filters.specialty);
  equal("domain.code", filters.domain);
  anyCode("exists (select 1 from teaching.topics selected_topic where selected_topic.id = revision.topic_id and selected_topic.is_active and selected_topic.code = any(?::text[]))", filters.topics);
  anyCode("exists (select 1 from teaching.subtopics selected_subtopic where selected_subtopic.id = revision.subtopic_id and selected_subtopic.is_active and selected_subtopic.code = any(?::text[]))", filters.subtopics);
  anyCode("exists (select 1 from teaching.question_revision_modalities link join teaching.modalities item on item.id = link.modality_id where link.question_revision_id = revision.id and item.is_active and item.code = any(?::text[]))", filters.modalities);
  anyCode("exists (select 1 from teaching.question_revision_competencies link join teaching.competencies item on item.id = link.competency_id where link.question_revision_id = revision.id and item.is_active and item.code = any(?::text[]))", filters.competencies);
  anyCode("exists (select 1 from teaching.question_revision_tags link join teaching.tags item on item.id = link.tag_id where link.question_revision_id = revision.id and item.is_active and item.code = any(?::text[]))", filters.tags);
  anyCode("exists (select 1 from teaching.training_levels item where item.id = revision.training_level_id and item.is_active and item.code = any(?::text[]))", filters.trainingLevels);
  if (filters.difficulty.length) conditions.push(`difficulty.value = any(${bind(filters.difficulty)}::smallint[])`);
  let identityIssuer: string | null = null;
  let identitySubject: string | null = null;
  const needsCurrentState = filters.questionState !== "all" && filters.questionState !== "marked";
  if (needsCurrentState || filters.questionState === "marked") {
    identityIssuer = bind(scope.identityIssuer);
    identitySubject = bind(scope.identitySubject);
  }
  if (filters.questionState === "unseen") {
    conditions.push(`not exists (select 1 from current_attempt_state state where state.question_id = question.id)`);
  } else if (filters.questionState === "correct" || filters.questionState === "incorrect") {
    conditions.push(`exists (select 1 from current_attempt_state state where state.question_id = question.id and state.is_correct = ${bind(filters.questionState === "correct")})`);
  } else if (filters.questionState === "answered") {
    conditions.push(`exists (select 1 from current_attempt_state state where state.question_id = question.id)`);
  } else if (filters.questionState === "marked") {
    conditions.push(`exists (select 1 from teaching.bookmarks bookmark where bookmark.identity_issuer = ${identityIssuer} and bookmark.identity_subject = ${identitySubject} and bookmark.question_id = question.id)`);
  }
  const currentAttemptCte = needsCurrentState ? `, current_attempt_state as materialized (
      select distinct on (attempt.question_id) attempt.question_id, attempt.is_correct
      from teaching.attempts attempt
      join teaching.sessions session on session.id = attempt.session_id
      join teaching.questions attempted_question on attempted_question.id = attempt.question_id
      join current_published_revision current_revision on current_revision.question_id = attempted_question.id
      where attempt.identity_issuer = ${identityIssuer} and attempt.identity_subject = ${identitySubject}
        and session.started_at >= greatest(
          coalesce((select max(cycle.started_at) from teaching.study_cycles cycle where cycle.identity_issuer = ${identityIssuer}
            and cycle.identity_subject = ${identitySubject} and cycle.question_bank_id = attempted_question.question_bank_id
            and cycle.scope_type = 'bank' and cycle.scope_id = attempted_question.question_bank_id), '-infinity'::timestamptz),
          coalesce((select max(cycle.started_at) from teaching.study_cycles cycle where cycle.identity_issuer = ${identityIssuer}
            and cycle.identity_subject = ${identitySubject} and cycle.question_bank_id = attempted_question.question_bank_id
            and cycle.scope_type = 'domain' and cycle.scope_id = current_revision.domain_id), '-infinity'::timestamptz),
          coalesce((select max(cycle.started_at) from teaching.study_cycles cycle where cycle.identity_issuer = ${identityIssuer}
            and cycle.identity_subject = ${identitySubject} and cycle.question_bank_id = attempted_question.question_bank_id
            and cycle.scope_type = 'topic' and cycle.scope_id = current_revision.topic_id), '-infinity'::timestamptz)
        )
      order by attempt.question_id, attempt.answered_at desc, attempt.id desc
    )` : "";
  return {
    sql: `with current_published_revision as (
      select distinct on (revision.question_id) revision.*
      from teaching.question_revisions revision
      where revision.status = 'published'
      order by revision.question_id, revision.revision_number desc, revision.id desc
    )${currentAttemptCte}, eligible as materialized (
      select question.id as question_id, revision.id as question_revision_id
      from teaching.questions question
      join current_published_revision revision on revision.question_id = question.id
      join teaching.question_banks bank on bank.id = question.question_bank_id
      join teaching.specialties specialty on specialty.id = revision.specialty_id
      join teaching.domains domain on domain.id = revision.domain_id
      join teaching.difficulties difficulty on difficulty.id = revision.difficulty_id and difficulty.is_active
      where ${conditions.join(" and ")}
    )`,
    values,
  };
}

export async function getTeachingQuestionAvailability(identity: TeachingIdentity, rawFilters: unknown) {
  const filters = parseTeachingLearnerFilters(rawFilters);
  const eligible = buildEligibleQuestions(filters, learnerScope(identity));
  const result = await pool.query<{ available: string }>(`${eligible.sql} select count(*)::text as available from eligible`, eligible.values);
  return { available: Number(result.rows[0]?.available ?? 0), questionState: filters.questionState };
}

export async function createTeachingSession(identity: TeachingIdentity, input: CreateTeachingSessionInput) {
  const scope = learnerScope(identity);
  return withTeachingTransaction(async (client) => {
    const eligible = buildEligibleQuestions(input.filters, scope);
    const limitPlaceholder = `$${eligible.values.length + 1}`;
    const selected = await client.query<{ available: string; question_id: string | null; question_revision_id: string | null }>(
      `${eligible.sql}, eligible_count as (select count(*)::text as available from eligible),
       sampled as (select question_id, question_revision_id from eligible order by random() limit ${limitPlaceholder})
       select eligible_count.available, sampled.question_id, sampled.question_revision_id
       from eligible_count left join sampled on true`,
      [...eligible.values, input.questionCount],
    );
    const available = Number(selected.rows[0]?.available ?? 0);
    if (available < input.questionCount) {
      throw new HttpError(422, `Only ${available} questions match these filters; ${input.questionCount} requested.`);
    }
    const rows = selected.rows.filter((row) => row.question_id !== null && row.question_revision_id !== null);
    const created = await client.query<{ id: string | number; started_at: Date }>(
      `insert into teaching.sessions (
        identity_issuer, identity_subject, mode, question_count, timed, time_limit_seconds, filters_json
       ) values ($1, $2, $3, $4, $5, $6::integer, $7::jsonb) returning id, started_at`,
      [scope.identityIssuer, scope.identitySubject, input.mode, input.questionCount, input.timed, input.timeLimitSeconds, JSON.stringify(input.filters)],
    );
    const sessionId = Number(created.rows[0]!.id);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      await client.query(
        `insert into teaching.session_questions (session_id, question_id, question_revision_id, position)
         values ($1, $2, $3, $4)`,
        [sessionId, row.question_id, row.question_revision_id, index + 1],
      );
    }
    return {
      sessionId,
      questionCount: input.questionCount,
      mode: input.mode,
      status: "active" as const,
      timed: input.timed,
      timeLimitSeconds: input.timeLimitSeconds,
      startedAt: created.rows[0]!.started_at.toISOString(),
      firstPosition: 1,
    };
  });
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function remainingSeconds(session: SessionRow, now = Date.now()): number | null {
  if (!session.timed || session.time_limit_seconds === null) return null;
  const end = session.started_at.getTime() + session.time_limit_seconds * 1000;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

async function loadSession(client: PoolClient, sessionId: number, scope: LearnerScope, lock = false): Promise<SessionRow> {
  const result = await client.query<SessionRow>(
    `select id, identity_issuer, identity_subject, mode, status, question_count, timed, time_limit_seconds,
       filters_json, current_position, started_at, last_activity_at, submitted_at, created_at
     from teaching.sessions where id = $1 and identity_issuer = $2 and identity_subject = $3${lock ? " for update" : ""}`,
    [sessionId, scope.identityIssuer, scope.identitySubject],
  );
  if (!result.rows[0]) throw new HttpError(404, "Teaching session not found.");
  return result.rows[0];
}

async function writeAttemptsFromExamDraft(client: PoolClient, session: SessionRow): Promise<void> {
  await client.query(
    `with inserted as (
       insert into teaching.attempts (
         identity_issuer, identity_subject, session_id, session_question_id, question_id, question_revision_id,
         selected_option_key, is_correct, mode, answer_duration_ms
       )
       select session.identity_issuer, session.identity_subject, session.id, item.id, item.question_id,
         item.question_revision_id, item.draft_selected_option_key, option.is_correct, session.mode,
         greatest(0, least(86400000, floor(extract(epoch from (coalesce(item.draft_selected_at, now()) - coalesce(item.opened_at, session.started_at))) * 1000)::integer))
       from teaching.sessions session
       join teaching.session_questions item on item.session_id = session.id
       join teaching.question_options option on option.question_revision_id = item.question_revision_id
         and option.option_key = item.draft_selected_option_key
       where session.id = $1 and item.draft_selected_option_key is not null
       on conflict (session_question_id) do nothing
       returning id, identity_issuer, identity_subject, question_id, is_correct, answered_at
     )
     insert into teaching.user_question_state (identity_issuer, identity_subject, question_id, state, last_attempt_id, last_answered_at)
     select identity_issuer, identity_subject, question_id, case when is_correct then 'correct' else 'incorrect' end, id, answered_at
     from inserted
     on conflict (identity_issuer, identity_subject, question_id) do update
       set state = excluded.state, last_attempt_id = excluded.last_attempt_id, last_answered_at = excluded.last_answered_at`,
    [session.id],
  );
}

async function submitSessionRow(client: PoolClient, session: SessionRow): Promise<SessionRow> {
  if (session.status === "submitted") return session;
  if (session.mode === "exam") await writeAttemptsFromExamDraft(client, session);
  const result = await client.query<SessionRow>(
    `update teaching.sessions set status = 'submitted', submitted_at = now(), last_activity_at = now()
     where id = $1 and status = 'active'
     returning id, identity_issuer, identity_subject, mode, status, question_count, timed, time_limit_seconds,
       filters_json, current_position, started_at, last_activity_at, submitted_at, created_at`,
    [session.id],
  );
  return result.rows[0] ?? loadSession(client, Number(session.id), { identityIssuer: session.identity_issuer, identitySubject: session.identity_subject });
}

async function submitIfTimedOut(client: PoolClient, session: SessionRow): Promise<SessionRow> {
  if (session.status !== "active" || remainingSeconds(session) !== 0) return session;
  return submitSessionRow(client, session);
}

async function sessionProgress(client: PoolClient, session: SessionRow) {
  const result = await client.query<{ answered: number; correct: number; incorrect: number }>(
    `select count(*) filter (where case when $2 = 'exam' and $3 = 'active'
         then item.draft_selected_option_key is not null else attempt.id is not null end)::int as answered,
       count(attempt.id) filter (where attempt.is_correct)::int as correct,
       count(attempt.id) filter (where not attempt.is_correct)::int as incorrect
     from teaching.session_questions item
     left join teaching.attempts attempt on attempt.session_question_id = item.id
     where item.session_id = $1`,
    [session.id, session.mode, session.status],
  );
  const answered = result.rows[0]?.answered ?? 0;
  const correct = result.rows[0]?.correct ?? 0;
  const incorrect = result.rows[0]?.incorrect ?? 0;
  const unanswered = session.question_count - answered;
  const scorePercent = session.question_count === 0 ? 0 : Math.round((correct / session.question_count) * 1000) / 10;
  const answeredAccuracy = answered === 0 ? null : Math.round((correct / answered) * 1000) / 10;
  const end = session.submitted_at?.getTime() ?? Date.now();
  const elapsed = Math.max(0, Math.floor((end - session.started_at.getTime()) / 1000));
  const timeUsedSeconds = session.time_limit_seconds === null ? elapsed : Math.min(session.time_limit_seconds, elapsed);
  return { total: session.question_count, answered, correct, incorrect, unanswered, scorePercent, answeredAccuracy, timeUsedSeconds };
}

async function sessionPositions(client: PoolClient, session: SessionRow) {
  const result = await client.query<{ position: number; has_attempt: boolean; has_draft_response: boolean }>(
    `select item.position, attempt.id is not null as has_attempt, item.draft_selected_option_key is not null as has_draft_response
     from teaching.session_questions item
     left join teaching.attempts attempt on attempt.session_question_id = item.id
     where item.session_id = $1 order by item.position`,
    [session.id],
  );
  return result.rows.map((row) => ({
    position: row.position,
    answered: session.mode === "exam" && session.status === "active" ? row.has_draft_response : row.has_attempt,
  }));
}

function sessionDto(session: SessionRow, progress: Awaited<ReturnType<typeof sessionProgress>>, questions: Awaited<ReturnType<typeof sessionPositions>>) {
  return {
    id: Number(session.id),
    mode: session.mode,
    status: session.status,
    questionCount: session.question_count,
    timed: session.timed,
    timeLimitSeconds: session.time_limit_seconds,
    remainingSeconds: session.status === "active" ? remainingSeconds(session) : 0,
    currentPosition: Math.min(session.current_position, session.question_count),
    startedAt: iso(session.started_at),
    lastActivityAt: iso(session.last_activity_at),
    submittedAt: iso(session.submitted_at),
    filters: session.filters_json,
    questions,
    progress: session.status === "submitted" || session.mode !== "exam" ? progress : {
      total: session.question_count,
      answered: progress.answered,
      unanswered: session.question_count - progress.answered,
      correct: null,
      incorrect: null,
      scorePercent: null,
      answeredAccuracy: null,
      timeUsedSeconds: progress.timeUsedSeconds,
    },
  };
}

export async function getTeachingSession(identity: TeachingIdentity, sessionId: number) {
  const scope = learnerScope(identity);
  return withTeachingTransaction(async (client) => {
    let session = await loadSession(client, sessionId, scope, true);
    session = await submitIfTimedOut(client, session);
    if (session.status === "abandoned") throw new HttpError(409, "This Teaching session is no longer active.");
    const progress = await sessionProgress(client, session);
    const questions = await sessionPositions(client, session);
    return sessionDto(session, progress, questions);
  });
}

export async function submitTeachingSession(identity: TeachingIdentity, sessionId: number) {
  const scope = learnerScope(identity);
  return withTeachingTransaction(async (client) => {
    let session = await loadSession(client, sessionId, scope, true);
    if (session.status === "abandoned") throw new HttpError(409, "This Teaching session is no longer active.");
    session = await submitSessionRow(client, session);
    const progress = await sessionProgress(client, session);
    const questions = await sessionPositions(client, session);
    return sessionDto(session, progress, questions);
  });
}

export async function listTeachingSessionHistory(identity: TeachingIdentity, page: number, pageSize: number) {
  const scope = learnerScope(identity);
  return withTeachingTransaction(async (client) => {
    const expired = await client.query<SessionRow>(
      `select id, identity_issuer, identity_subject, mode, status, question_count, timed, time_limit_seconds,
         filters_json, current_position, started_at, last_activity_at, submitted_at, created_at
       from teaching.sessions where identity_issuer = $1 and identity_subject = $2 and status = 'active' and timed
         and started_at + make_interval(secs => time_limit_seconds) <= now()
       order by id for update`,
      [scope.identityIssuer, scope.identitySubject],
    );
    for (const session of expired.rows) await submitSessionRow(client, session);
    const offset = (page - 1) * pageSize;
    const totals = await client.query<{ total: string }>(
      `select count(*)::text as total from teaching.sessions where identity_issuer = $1 and identity_subject = $2`,
      [scope.identityIssuer, scope.identitySubject],
    );
    const sessions = await client.query<SessionRow>(
      `select id, identity_issuer, identity_subject, mode, status, question_count, timed, time_limit_seconds,
         filters_json, current_position, started_at, last_activity_at, submitted_at, created_at
       from teaching.sessions where identity_issuer = $1 and identity_subject = $2
       order by created_at desc, id desc limit $3 offset $4`,
      [scope.identityIssuer, scope.identitySubject, pageSize, offset],
    );
    const items = [];
    for (const session of sessions.rows) {
      const progress = await sessionProgress(client, session);
      items.push({
        id: Number(session.id), mode: session.mode, status: session.status,
        questionCount: session.question_count, timed: session.timed,
        timeLimitSeconds: session.time_limit_seconds, startedAt: iso(session.started_at),
        submittedAt: iso(session.submitted_at), durationSeconds: progress.timeUsedSeconds,
        filters: session.filters_json,
        progress: session.status === "submitted" ? progress : {
          total: progress.total, answered: progress.answered, unanswered: progress.unanswered,
          correct: null, incorrect: null, scorePercent: null, answeredAccuracy: null,
        },
      });
    }
    return { items, pagination: { page, pageSize, total: Number(totals.rows[0]?.total ?? 0) } };
  });
}

export async function getTeachingLearnerDashboard(identity: TeachingIdentity) {
  const scope = learnerScope(identity);
  const bank = await pool.query<{ code: string }>(
    `select code from teaching.question_banks where is_active order by (code = 'radiology-main') desc, created_at, id limit 1`,
  );
  const progress = bank.rows[0] ? await getTeachingProgress(identity, bank.rows[0].code) : null;
  const recent = await withTeachingTransaction(async (client) => {
    const expired = await client.query<SessionRow>(
      `select id, identity_issuer, identity_subject, mode, status, question_count, timed, time_limit_seconds,
         filters_json, current_position, started_at, last_activity_at, submitted_at, created_at
       from teaching.sessions where identity_issuer = $1 and identity_subject = $2 and status = 'active' and timed
         and started_at + make_interval(secs => time_limit_seconds) <= now() for update`,
      [scope.identityIssuer, scope.identitySubject],
    );
    for (const session of expired.rows) await submitSessionRow(client, session);
    const result = await client.query<SessionRow>(
      `select id, identity_issuer, identity_subject, mode, status, question_count, timed, time_limit_seconds,
         filters_json, current_position, started_at, last_activity_at, submitted_at, created_at
       from teaching.sessions where identity_issuer = $1 and identity_subject = $2
       order by (status = 'active') desc, last_activity_at desc, id desc limit 5`,
      [scope.identityIssuer, scope.identitySubject],
    );
    const sessions = [];
    for (const session of result.rows) {
      const progress = await sessionProgress(client, session);
      sessions.push({
        id: Number(session.id), mode: session.mode, status: session.status,
        questionCount: session.question_count, timed: session.timed,
        currentPosition: Math.min(session.current_position, session.question_count),
        startedAt: iso(session.started_at), submittedAt: iso(session.submitted_at),
        progress: session.status === "submitted" ? progress : {
          total: progress.total, answered: progress.answered, unanswered: progress.unanswered,
          correct: null, incorrect: null, scorePercent: null, answeredAccuracy: null,
        },
      });
    }
    return sessions;
  });
  const publishedQuestionCount = progress?.questionBank.publishedQuestions ?? 0;
  const attemptedQuestions = progress?.currentCycle.attempted ?? 0;
  return {
    publishedQuestionCount,
    progress: {
      attemptedQuestions,
      unseenQuestions: Math.max(0, publishedQuestionCount - attemptedQuestions),
      correctQuestions: progress?.currentCycle.correct ?? 0,
      incorrectQuestions: progress?.currentCycle.incorrect ?? 0,
      markedQuestions: progress?.currentCycle.marked ?? 0,
      completionPercent: progress?.currentCycle.completionPercent ?? 0,
      currentCycleAccuracyPercent: progress?.currentCycle.accuracyPercent ?? null,
      firstPassAccuracyPercent: progress?.lifetime.firstPassAccuracyPercent ?? null,
      lifetimeUniqueAttempted: progress?.lifetime.uniqueAttempted ?? 0,
      lifetimeAttempts: progress?.lifetime.totalAttempts ?? 0,
      averageAnswerTimeMs: progress?.lifetime.averageAnswerTimeMs ?? null,
    },
    recentSessions: recent,
    continueSession: recent.find((session) => session.status === "active") ?? null,
  };
}

interface SessionQuestionRow {
  id: string | number;
  question_id: string | number;
  question_revision_id: string | number;
  position: number;
  opened_at: Date | null;
  draft_selected_option_key: string | null;
  attempt_id: string | number | null;
  selected_option_key: string | null;
  is_correct: boolean | null;
  external_id: string;
  question_type: string;
  stem: string;
  case_title: string | null;
  clinical_history: string | null;
  explanation_summary: string;
  teaching_point: string;
  further_discussion: string | null;
}

async function loadSessionQuestion(client: PoolClient, session: SessionRow, position: number): Promise<SessionQuestionRow> {
  const result = await client.query<SessionQuestionRow>(
    `select item.id, item.question_id, item.question_revision_id, item.position, item.opened_at,
       item.draft_selected_option_key, attempt.id as attempt_id, attempt.selected_option_key, attempt.is_correct,
       question.external_id, revision.question_type, revision.stem, case_row.title as case_title,
       case_row.clinical_history, revision.explanation_summary, revision.teaching_point, revision.further_discussion
     from teaching.session_questions item
     join teaching.questions question on question.id = item.question_id
     join teaching.question_revisions revision on revision.id = item.question_revision_id and revision.question_id = item.question_id
     left join teaching.cases case_row on case_row.id = revision.case_id
     left join teaching.attempts attempt on attempt.session_question_id = item.id
     where item.session_id = $1 and item.position = $2`,
    [session.id, position],
  );
  if (!result.rows[0]) throw new HttpError(404, "Teaching session question not found.");
  return result.rows[0];
}

async function buildQuestionView(client: PoolClient, session: SessionRow, position: number, scope: LearnerScope) {
  const question = await loadSessionQuestion(client, session, position);
  const canReview = session.status === "submitted" || (session.mode !== "exam" && question.attempt_id !== null);
  const optionRows = await client.query<{ key: string; text: string; is_correct?: boolean; explanation?: string | null }>(
      `select option_key as key, text${canReview ? ", is_correct, explanation" : ""}
       from teaching.question_options where question_revision_id = $1 order by sort_order`,
      [question.question_revision_id],
    );
  const imageRows = await client.query<{ id: string | number; mime_type: string; alt_text: string }>(
      `select asset.id, asset.mime_type, coalesce(link.alt_text, asset.alt_text) as alt_text
       from teaching.question_revision_assets link join teaching.assets asset on asset.id = link.asset_id
       where link.question_revision_id = $1 order by link.sort_order`,
      [question.question_revision_id],
    );
  const caseImageRows = await client.query<{ id: string | number; mime_type: string; alt_text: string }>(
      `select asset.id, asset.mime_type, asset.alt_text
       from teaching.question_revisions revision
       join teaching.case_assets link on link.case_id = revision.case_id
       join teaching.assets asset on asset.id = link.asset_id
       where revision.id = $1 order by link.sort_order`,
      [question.question_revision_id],
    );
  const bookmark = await client.query<{ marked: boolean }>(
      `select exists(select 1 from teaching.bookmarks where identity_issuer = $1 and identity_subject = $2 and question_id = $3) as marked`,
      [scope.identityIssuer, scope.identitySubject, question.question_id],
    );
  const note = await client.query<{ note_text: string }>(
      `select note_text from teaching.notes where identity_issuer = $1 and identity_subject = $2 and question_id = $3`,
      [scope.identityIssuer, scope.identitySubject, question.question_id],
    );
  const imageById = new Map<string, { id: number; mimeType: string; altText: string; url: string }>();
  for (const image of [...imageRows.rows, ...caseImageRows.rows]) {
    const id = Number(image.id);
    imageById.set(String(id), { id, mimeType: image.mime_type, altText: image.alt_text, url: `/api/teaching/assets/${id}` });
  }
  const selectedOptionKey = question.selected_option_key ?? question.draft_selected_option_key;
  const dto: Record<string, unknown> = {
    session: {
      id: Number(session.id), mode: session.mode, status: session.status, timed: session.timed,
      timeLimitSeconds: session.time_limit_seconds,
      remainingSeconds: session.status === "active" ? remainingSeconds(session) : 0,
    },
    position: question.position,
    totalQuestions: session.question_count,
    questionId: Number(question.question_id),
    externalId: question.external_id,
    type: question.question_type,
    stem: question.stem,
    case: question.case_title === null && question.clinical_history === null ? null : {
      title: question.case_title,
      clinicalHistory: question.clinical_history,
    },
    images: [...imageById.values()],
    options: optionRows.rows.map((option) => ({ key: option.key, text: option.text })),
    selectedOptionKey,
    answered: session.mode === "exam" && session.status === "active"
      ? question.draft_selected_option_key !== null
      : question.attempt_id !== null,
    bookmarked: bookmark.rows[0]?.marked ?? false,
    note: note.rows[0]?.note_text ?? "",
  };
  if (canReview) {
    const correctOption = optionRows.rows.find((option) => option.is_correct);
    const references = await client.query<{
      title: string; organization: string | null; authors: string[]; year: number | null; edition: string | null;
      url: string | null; doi: string | null; citation_text: string | null;
    }>(
      `select reference.title, reference.organization, reference.authors, reference.year, reference.edition,
         reference.url, reference.doi, reference.citation_text
       from teaching.question_references link join teaching."references" reference on reference.id = link.reference_id
       where link.question_revision_id = $1 order by link.sort_order`,
      [question.question_revision_id],
    );
    dto.feedback = {
      isCorrect: question.is_correct,
      selectedOptionKey: question.selected_option_key,
      correctOption: correctOption ? { key: correctOption.key, text: correctOption.text } : null,
      explanation: {
        summary: question.explanation_summary,
        teachingPoint: question.teaching_point,
        furtherDiscussion: question.further_discussion,
      },
      optionExplanations: optionRows.rows
        .filter((option) => typeof option.explanation === "string" && option.explanation.trim() !== "")
        .map((option) => ({ key: option.key, explanation: option.explanation })),
      references: references.rows.map((reference) => ({
        title: reference.title, organization: reference.organization, authors: reference.authors,
        year: reference.year, edition: reference.edition, url: reference.url, doi: reference.doi,
        citationText: reference.citation_text,
      })),
    };
    dto.options = optionRows.rows.map((option) => ({
      key: option.key, text: option.text,
      ...(typeof option.explanation === "string" ? { explanation: option.explanation } : {}),
    }));
  }
  return dto;
}

export async function getTeachingSessionQuestion(identity: TeachingIdentity, sessionId: number, position: number) {
  const scope = learnerScope(identity);
  return withTeachingTransaction(async (client) => {
    let session = await loadSession(client, sessionId, scope, true);
    session = await submitIfTimedOut(client, session);
    if (session.status === "abandoned") throw new HttpError(409, "This Teaching session is no longer active.");
    if (!Number.isSafeInteger(position) || position < 1 || position > session.question_count) throw new HttpError(404, "Teaching session question not found.");
    const question = await loadSessionQuestion(client, session, position);
    if (session.status === "active") {
      await client.query("update teaching.session_questions set opened_at = coalesce(opened_at, now()) where id = $1", [question.id]);
      await client.query("update teaching.sessions set current_position = $2, last_activity_at = now() where id = $1", [session.id, position]);
      session = await loadSession(client, sessionId, scope);
    }
    return buildQuestionView(client, session, position, scope);
  });
}

function selectedOptionKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]$/.test(value)) throw new HttpError(400, "selectedOptionKey is invalid.");
  return value;
}

async function validateOption(client: PoolClient, questionRevisionId: string | number, key: string) {
  const result = await client.query<{ is_correct: boolean }>(
    "select is_correct from teaching.question_options where question_revision_id = $1 and option_key = $2",
    [questionRevisionId, key],
  );
  if (!result.rows[0]) throw new HttpError(400, "Selected option is not part of this question revision.");
  return result.rows[0].is_correct;
}

function durationMs(openedAt: Date | null, startedAt: Date, now = Date.now()): number {
  const start = openedAt?.getTime() ?? startedAt.getTime();
  return Math.max(0, Math.min(86400000, now - start));
}

export async function submitTeachingStudyAnswer(identity: TeachingIdentity, sessionId: number, position: number, rawKey: unknown) {
  const key = selectedOptionKey(rawKey);
  const scope = learnerScope(identity);
  return withTeachingTransaction(async (client) => {
    let session = await loadSession(client, sessionId, scope, true);
    if (session.mode === "exam") throw new HttpError(409, "Exam responses are saved until the whole session is submitted.");
    if (session.status === "active") session = await submitIfTimedOut(client, session);
    if (session.status === "abandoned") throw new HttpError(409, "This Teaching session is no longer active.");
    const question = await loadSessionQuestion(client, session, position);
    const existing = await client.query<{ selected_option_key: string }>(
      "select selected_option_key from teaching.attempts where session_question_id = $1",
      [question.id],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].selected_option_key !== key) throw new HttpError(409, "This answer has already been finalized and cannot be changed.");
      return buildQuestionView(client, session, position, scope);
    }
    if (session.status !== "active") throw new HttpError(409, "This session is already submitted.");
    const isCorrect = await validateOption(client, question.question_revision_id, key);
    const created = await client.query<{ id: string | number; answered_at: Date }>(
      `insert into teaching.attempts (
        identity_issuer, identity_subject, session_id, session_question_id, question_id, question_revision_id,
        selected_option_key, is_correct, mode, answer_duration_ms
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id, answered_at`,
      [scope.identityIssuer, scope.identitySubject, session.id, question.id, question.question_id,
        question.question_revision_id, key, isCorrect, session.mode, durationMs(question.opened_at, session.started_at)],
    );
    await client.query(
      `insert into teaching.user_question_state (identity_issuer, identity_subject, question_id, state, last_attempt_id, last_answered_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (identity_issuer, identity_subject, question_id) do update
         set state = excluded.state, last_attempt_id = excluded.last_attempt_id, last_answered_at = excluded.last_answered_at`,
      [scope.identityIssuer, scope.identitySubject, question.question_id, isCorrect ? "correct" : "incorrect", created.rows[0]!.id, created.rows[0]!.answered_at],
    );
    await client.query("update teaching.sessions set current_position = $2, last_activity_at = now() where id = $1", [session.id, position]);
    session = await loadSession(client, sessionId, scope);
    return buildQuestionView(client, session, position, scope);
  });
}

export async function saveTeachingExamResponse(identity: TeachingIdentity, sessionId: number, position: number, rawKey: unknown) {
  const key = selectedOptionKey(rawKey);
  const scope = learnerScope(identity);
  return withTeachingTransaction(async (client) => {
    let session = await loadSession(client, sessionId, scope, true);
    if (session.mode !== "exam") throw new HttpError(409, "Only Exam sessions accept draft responses.");
    if (session.status === "abandoned") throw new HttpError(409, "This Teaching session is no longer active.");
    if (session.status === "active") session = await submitIfTimedOut(client, session);
    if (session.status !== "active") {
      const progress = await sessionProgress(client, session);
      const questions = await sessionPositions(client, session);
      return { saved: false, submitted: true, session: sessionDto(session, progress, questions) };
    }
    const question = await loadSessionQuestion(client, session, position);
    await validateOption(client, question.question_revision_id, key);
    await client.query(
      `update teaching.session_questions set draft_selected_option_key = $2, draft_selected_at = now()
       where id = $1 and draft_selected_option_key is distinct from $2`,
      [question.id, key],
    );
    await client.query("update teaching.sessions set current_position = $2, last_activity_at = now() where id = $1", [session.id, position]);
    session = await loadSession(client, sessionId, scope);
    const progress = await sessionProgress(client, session);
    const questions = await sessionPositions(client, session);
    return { saved: true, submitted: false, session: sessionDto(session, progress, questions) };
  });
}

export async function setTeachingQuestionBookmark(identity: TeachingIdentity, questionId: number, marked: boolean) {
  const scope = learnerScope(identity);
  return withTeachingTransaction(async (client) => {
    const exists = await client.query("select 1 from teaching.questions where id = $1", [questionId]);
    if (!exists.rowCount) throw new HttpError(404, "Teaching question not found.");
    if (marked) {
      await client.query(
        `insert into teaching.bookmarks (identity_issuer, identity_subject, question_id) values ($1, $2, $3)
         on conflict (identity_issuer, identity_subject, question_id) do nothing`,
        [scope.identityIssuer, scope.identitySubject, questionId],
      );
    } else {
      await client.query("delete from teaching.bookmarks where identity_issuer = $1 and identity_subject = $2 and question_id = $3", [scope.identityIssuer, scope.identitySubject, questionId]);
    }
    return { questionId, marked };
  });
}

export async function saveTeachingQuestionNote(identity: TeachingIdentity, questionId: number, rawText: unknown) {
  if (typeof rawText !== "string" || rawText.trim().length < 1 || rawText.length > 5000) {
    throw new HttpError(400, "note must contain 1 to 5000 characters.");
  }
  const scope = learnerScope(identity);
  return withTeachingTransaction(async (client) => {
    const exists = await client.query("select 1 from teaching.questions where id = $1", [questionId]);
    if (!exists.rowCount) throw new HttpError(404, "Teaching question not found.");
    await client.query(
      `insert into teaching.notes (identity_issuer, identity_subject, question_id, note_text)
       values ($1, $2, $3, $4)
       on conflict (identity_issuer, identity_subject, question_id) do update
         set note_text = excluded.note_text, updated_at = now()`,
      [scope.identityIssuer, scope.identitySubject, questionId, rawText.trim()],
    );
    return { questionId, note: rawText.trim() };
  });
}

export async function clearTeachingQuestionNote(identity: TeachingIdentity, questionId: number) {
  const scope = learnerScope(identity);
  return withTeachingTransaction(async (client) => {
    await client.query("delete from teaching.notes where identity_issuer = $1 and identity_subject = $2 and question_id = $3", [scope.identityIssuer, scope.identitySubject, questionId]);
    return { questionId, cleared: true };
  });
}

export async function assertLearnerTeachingAssetAccessible(identity: TeachingIdentity, assetId: number): Promise<void> {
  const scope = learnerScope(identity);
  const result = await pool.query<{ accessible: boolean }>(
    `select (
       exists (
         select 1 from teaching.question_revisions revision
         left join teaching.question_revision_assets image_link on image_link.question_revision_id = revision.id
         left join teaching.cases case_row on case_row.id = revision.case_id
         left join teaching.case_assets case_image on case_image.case_id = case_row.id
         where revision.status = 'published'
           and (image_link.asset_id = $1 or case_image.asset_id = $1)
       ) or exists (
         select 1 from teaching.session_questions item
         join teaching.sessions session on session.id = item.session_id
         join teaching.question_revisions revision on revision.id = item.question_revision_id
         left join teaching.question_revision_assets image_link on image_link.question_revision_id = revision.id
         left join teaching.cases case_row on case_row.id = revision.case_id
         left join teaching.case_assets case_image on case_image.case_id = case_row.id
         where session.identity_issuer = $2 and session.identity_subject = $3
           and (image_link.asset_id = $1 or case_image.asset_id = $1)
       )
     ) as accessible`,
    [assetId, scope.identityIssuer, scope.identitySubject],
  );
  if (!result.rows[0]?.accessible) throw new HttpError(404, "Teaching asset not found.");
}

export function parseTeachingHistoryPagination(pageValue: unknown, pageSizeValue: unknown) {
  const parse = (value: unknown, fallback: number, maximum: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^\d+$/.test(value)) throw new HttpError(400, "History pagination is invalid.");
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(400, "History pagination is invalid.");
    return Math.min(parsed, maximum);
  };
  const page = parse(pageValue, 1, 100000);
  const pageSize = parse(pageSizeValue, 20, 100);
  return { page, pageSize };
}
