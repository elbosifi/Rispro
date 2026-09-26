import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../../../db/pool.js";
import { HttpError } from "../../../utils/http-error.js";
import type { TeachingIdentity } from "../domain/teaching-identity.js";
import { withTeachingTransaction } from "./teaching-transaction.js";

export const TEACHING_PROGRESS_DIMENSIONS = ["domain", "topic", "modality", "competency", "difficulty", "tag"] as const;
export type TeachingProgressDimension = (typeof TEACHING_PROGRESS_DIMENSIONS)[number];
export type TeachingResetScopeType = "bank" | "domain" | "topic";

interface LearnerScope {
  identityIssuer: string;
  identitySubject: string;
}

interface ProgressScope {
  type: TeachingResetScopeType;
  id: string;
  code: string;
  label: string;
  domainId: string | null;
  domainCode: string | null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function parseCode(value: unknown, label: string): string {
  if (typeof value !== "string") throw new HttpError(400, `${label} is invalid.`);
  const result = value.trim();
  if (!/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/.test(result) || result.length > 100) throw new HttpError(400, `${label} is invalid.`);
  return result;
}

function identityScope(identity: TeachingIdentity): LearnerScope {
  return { identityIssuer: identity.identityIssuer, identitySubject: identity.identitySubject };
}

function numeric(value: string | number | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator ? Math.round((numerator * 1000) / denominator) / 10 : null;
}

function baseCtes(): string {
  return `
    with current_published_revision as (
      select distinct on (revision.question_id) revision.*
      from teaching.question_revisions revision
      where revision.status = 'published'
      order by revision.question_id, revision.revision_number desc, revision.id desc
    ), eligible as materialized (
      select question.id as question_id, question.question_bank_id, revision.id as question_revision_id,
        revision.domain_id, revision.topic_id, difficulty.value as difficulty,
        bank.code as bank_code, bank.name as bank_name
      from teaching.questions question
      join current_published_revision revision on revision.question_id = question.id
      join teaching.question_banks bank on bank.id = question.question_bank_id and bank.is_active
      join teaching.specialties specialty on specialty.id = revision.specialty_id and specialty.is_active
      join teaching.domains domain on domain.id = revision.domain_id and domain.is_active
      join teaching.difficulties difficulty on difficulty.id = revision.difficulty_id and difficulty.is_active
      where question.question_bank_id = (select id from teaching.question_banks where code = $3 and is_active)
        and question.retired_at is null
    ), effective_questions as materialized (
      select eligible.*,
        greatest(
          coalesce((select max(cycle.started_at) from teaching.study_cycles cycle
            where cycle.identity_issuer = $1 and cycle.identity_subject = $2
              and cycle.question_bank_id = eligible.question_bank_id and cycle.scope_type = 'bank'
              and cycle.scope_id = eligible.question_bank_id), '-infinity'::timestamptz),
          coalesce((select max(cycle.started_at) from teaching.study_cycles cycle
            where cycle.identity_issuer = $1 and cycle.identity_subject = $2
              and cycle.question_bank_id = eligible.question_bank_id and cycle.scope_type = 'domain'
              and cycle.scope_id = eligible.domain_id), '-infinity'::timestamptz),
          coalesce((select max(cycle.started_at) from teaching.study_cycles cycle
            where cycle.identity_issuer = $1 and cycle.identity_subject = $2
              and cycle.question_bank_id = eligible.question_bank_id and cycle.scope_type = 'topic'
              and cycle.scope_id = eligible.topic_id), '-infinity'::timestamptz)
        ) as cycle_started_at
      from eligible
    ), current_state as materialized (
      select distinct on (attempt.question_id) attempt.question_id, attempt.is_correct,
        attempt.answer_duration_ms, attempt.answered_at
      from effective_questions question
      join teaching.attempts attempt on attempt.question_id = question.question_id
        and attempt.identity_issuer = $1 and attempt.identity_subject = $2
      join teaching.sessions session on session.id = attempt.session_id
        and session.started_at >= question.cycle_started_at
      order by attempt.question_id, attempt.answered_at desc, attempt.id desc
    ), lifetime_first as materialized (
      select distinct on (attempt.question_id) attempt.question_id, attempt.is_correct
      from teaching.attempts attempt
      join teaching.questions question on question.id = attempt.question_id
      where attempt.identity_issuer = $1 and attempt.identity_subject = $2
        and question.question_bank_id = (select id from teaching.question_banks where code = $3)
      order by attempt.question_id, attempt.answered_at asc, attempt.id asc
    )`;
}

async function requireQuestionBank(client: PoolClient | typeof pool, bankCode: string) {
  const result = await client.query<{ id: string; code: string; name: string; specialty_id: string }>(
    `select id, code, name, specialty_id from teaching.question_banks where code = $1 and is_active`, [bankCode],
  );
  if (!result.rows[0]) throw new HttpError(404, "Active Teaching question bank not found.");
  return result.rows[0];
}

export function parseTeachingProgressBank(value: unknown): string {
  return parseCode(value, "questionBank");
}

export function parseTeachingProgressDimension(value: unknown): TeachingProgressDimension {
  if (typeof value !== "string" || !(TEACHING_PROGRESS_DIMENSIONS as readonly string[]).includes(value)) {
    throw new HttpError(400, "dimension must be domain, topic, modality, competency, difficulty, or tag.");
  }
  return value as TeachingProgressDimension;
}

export function parseTeachingResetRequest(value: unknown) {
  const input = record(value, "request");
  const bank = parseCode(input.questionBank, "questionBank");
  const scope = record(input.scope, "scope");
  if (scope.type !== "bank" && scope.type !== "domain" && scope.type !== "topic") {
    throw new HttpError(400, "scope.type must be bank, domain, or topic.");
  }
  const type = scope.type as TeachingResetScopeType;
  const code = type === "bank" ? null : parseCode(scope.code, "scope.code");
  const domain = type === "topic" && scope.domain !== undefined ? parseCode(scope.domain, "scope.domain") : null;
  if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey))) {
    throw new HttpError(400, "idempotencyKey must be a UUID.");
  }
  if (typeof input.idempotencyKey !== "string") throw new HttpError(400, "idempotencyKey is required.");
  return { bank, scope: { type, code, domain }, idempotencyKey: input.idempotencyKey };
}

async function resolveScope(client: PoolClient | typeof pool, bankCode: string, rawScope: { type: TeachingResetScopeType; code: string | null; domain: string | null }): Promise<{ bank: Awaited<ReturnType<typeof requireQuestionBank>>; scope: ProgressScope }> {
  const bank = await requireQuestionBank(client, bankCode);
  if (rawScope.type === "bank") {
    return { bank, scope: { type: "bank", id: bank.id, code: bank.code, label: bank.name, domainId: null, domainCode: null } };
  }
  if (rawScope.type === "domain") {
    const result = await client.query<{ id: string; code: string; label: string }>(
      `select id, code, label from teaching.domains where specialty_id = $1 and code = $2 and is_active`,
      [bank.specialty_id, rawScope.code],
    );
    const row = result.rows[0];
    if (!row) throw new HttpError(404, "Active domain not found in this question bank.");
    return { bank, scope: { type: "domain", id: row.id, code: row.code, label: row.label, domainId: row.id, domainCode: row.code } };
  }
  const result = await client.query<{ id: string; code: string; label: string; domain_id: string; domain_code: string }>(
    `select topic.id, topic.code, topic.label, domain.id as domain_id, domain.code as domain_code
     from teaching.topics topic join teaching.domains domain on domain.id = topic.domain_id
     where domain.specialty_id = $1 and domain.is_active and topic.is_active and topic.code = $2
       and ($3::text is null or domain.code = $3)
     order by domain.sort_order, topic.sort_order`,
    [bank.specialty_id, rawScope.code, rawScope.domain],
  );
  if (!result.rows.length) throw new HttpError(404, "Active topic not found in this question bank.");
  if (result.rows.length > 1) throw new HttpError(400, "scope.domain is required when a topic code is used in more than one domain.");
  const row = result.rows[0]!;
  return { bank, scope: { type: "topic", id: row.id, code: row.code, label: row.label, domainId: row.domain_id, domainCode: row.domain_code } };
}

function currentSummarySql(scope?: ProgressScope): string {
  const scopePredicate = !scope ? "true"
    : scope.type === "bank" ? "question.question_bank_id = $4"
      : scope.type === "domain" ? "question.domain_id = $4"
        : "question.topic_id = $4";
  return `${baseCtes()}
    select count(question.question_id)::int as eligible,
      count(state.question_id)::int as attempted,
      count(state.question_id) filter (where state.is_correct)::int as correct,
      count(state.question_id) filter (where not state.is_correct)::int as incorrect,
      count(bookmark.question_id)::int as marked
    from effective_questions question
    left join current_state state on state.question_id = question.question_id
    left join teaching.bookmarks bookmark on bookmark.question_id = question.question_id
      and bookmark.identity_issuer = $1 and bookmark.identity_subject = $2
    where ${scopePredicate}`;
}

function summaryDto(row: { eligible: string | number; attempted: string | number; correct: string | number; incorrect: string | number; marked: string | number }) {
  const eligible = numeric(row.eligible);
  const attempted = numeric(row.attempted);
  const correct = numeric(row.correct);
  const incorrect = numeric(row.incorrect);
  return {
    eligibleQuestionCount: eligible,
    attempted,
    correct,
    incorrect,
    unseen: Math.max(0, eligible - attempted),
    completionPercent: percentage(attempted, eligible) ?? 0,
    accuracyPercent: percentage(correct, attempted),
    marked: numeric(row.marked),
  };
}

export async function getTeachingProgress(identity: TeachingIdentity, rawBankCode: unknown) {
  const bankCode = parseTeachingProgressBank(rawBankCode);
  const scope = identityScope(identity);
  await requireQuestionBank(pool, bankCode);
  const result = await pool.query<{
    eligible: string; attempted: string; correct: string; incorrect: string; marked: string;
    lifetime_unique: string; lifetime_attempts: string; first_pass_correct: string; first_pass_attempted: string;
    average_answer_time_ms: string | null;
  }>(
    `${baseCtes()}
     select
       (select count(*)::text from eligible) as eligible,
       (select count(*)::text from current_state) as attempted,
       (select count(*)::text from current_state where is_correct) as correct,
       (select count(*)::text from current_state where not is_correct) as incorrect,
       (select count(*)::text from teaching.bookmarks bookmark join teaching.questions question on question.id = bookmark.question_id
        where bookmark.identity_issuer = $1 and bookmark.identity_subject = $2 and question.question_bank_id = (select id from teaching.question_banks where code = $3)) as marked,
       (select count(*)::text from lifetime_first) as lifetime_unique,
       (select count(*)::text from teaching.attempts attempt join teaching.questions question on question.id = attempt.question_id
        where attempt.identity_issuer = $1 and attempt.identity_subject = $2 and question.question_bank_id = (select id from teaching.question_banks where code = $3)) as lifetime_attempts,
       (select count(*)::text from lifetime_first where is_correct) as first_pass_correct,
       (select count(*)::text from lifetime_first) as first_pass_attempted,
       (select round(avg(attempt.answer_duration_ms))::text from teaching.attempts attempt join teaching.questions question on question.id = attempt.question_id
        where attempt.identity_issuer = $1 and attempt.identity_subject = $2 and question.question_bank_id = (select id from teaching.question_banks where code = $3)
          and attempt.answer_duration_ms between 1 and 86400000) as average_answer_time_ms`,
    [scope.identityIssuer, scope.identitySubject, bankCode],
  );
  const row = result.rows[0]!;
  const summary = summaryDto({ eligible: row.eligible, attempted: row.attempted, correct: row.correct, incorrect: row.incorrect, marked: row.marked });
  const firstPassCorrect = numeric(row.first_pass_correct);
  const firstPassAttempted = numeric(row.first_pass_attempted);
  return {
    questionBank: { code: bankCode, publishedQuestions: summary.eligibleQuestionCount },
    currentCycle: {
      attempted: summary.attempted,
      eligible: summary.eligibleQuestionCount,
      correct: summary.correct,
      incorrect: summary.incorrect,
      unseen: summary.unseen,
      completionPercent: summary.completionPercent,
      accuracyPercent: summary.accuracyPercent,
      marked: summary.marked,
    },
    lifetime: {
      uniqueAttempted: numeric(row.lifetime_unique),
      totalAttempts: numeric(row.lifetime_attempts),
      firstPassCorrect,
      firstPassAttempted,
      firstPassAccuracyPercent: percentage(firstPassCorrect, firstPassAttempted),
      averageAnswerTimeMs: row.average_answer_time_ms === null ? null : numeric(row.average_answer_time_ms),
    },
  };
}

function dimensionSql(dimension: TeachingProgressDimension): { catalog: string; questions: string; filter?: string } {
  switch (dimension) {
    case "domain":
      return {
        catalog: `select item.id, item.code, item.label, item.sort_order from teaching.domains item
          where item.is_active and item.specialty_id = (select specialty_id from teaching.question_banks where code = $3)`,
        questions: `select question.question_id, item.id as dimension_id from eligible question join teaching.domains item on item.id = question.domain_id`,
      };
    case "topic":
      return {
        catalog: `select item.id, item.code, item.label, item.sort_order from teaching.topics item
          join teaching.domains parent on parent.id = item.domain_id
          where item.is_active and parent.is_active and parent.specialty_id = (select specialty_id from teaching.question_banks where code = $3)
            and ($5::text is null or parent.code = $5)`,
        questions: `select question.question_id, item.id as dimension_id from eligible question join teaching.topics item on item.id = question.topic_id
          join teaching.domains parent on parent.id = item.domain_id
          where item.is_active and parent.is_active and ($5::text is null or parent.code = $5)`,
      };
    case "modality":
      return {
        catalog: `select item.id, item.code, item.label, item.sort_order from teaching.modalities item where item.is_active`,
        questions: `select distinct question.question_id, item.id as dimension_id from eligible question
          join teaching.question_revision_modalities link on link.question_revision_id = question.question_revision_id
          join teaching.modalities item on item.id = link.modality_id and item.is_active`,
      };
    case "competency":
      return {
        catalog: `select item.id, item.code, item.label, item.sort_order from teaching.competencies item where item.is_active`,
        questions: `select distinct question.question_id, item.id as dimension_id from eligible question
          join teaching.question_revision_competencies link on link.question_revision_id = question.question_revision_id
          join teaching.competencies item on item.id = link.competency_id and item.is_active`,
      };
    case "difficulty":
      return {
        catalog: `select item.id, item.value::text as code, item.value::text || ' - ' || item.label as label, item.value::integer as sort_order
          from teaching.difficulties item where item.is_active`,
        questions: `select question.question_id, item.id as dimension_id from eligible question join teaching.difficulties item on item.value = question.difficulty and item.is_active`,
      };
    case "tag":
      return {
        catalog: `select item.id, item.code, item.label, item.id::integer as sort_order from teaching.tags item
          where item.is_active and ($5::text is null or item.code ilike '%' || $5 || '%' or item.label ilike '%' || $5 || '%')`,
        questions: `select distinct question.question_id, item.id as dimension_id from eligible question
          join teaching.question_revision_tags link on link.question_revision_id = question.question_revision_id
          join teaching.tags item on item.id = link.tag_id and item.is_active`,
      };
  }
}

export async function getTeachingProgressBreakdown(
  identity: TeachingIdentity,
  rawBankCode: unknown,
  rawDimension: unknown,
  options: { domain?: unknown; search?: unknown } = {},
) {
  const bankCode = parseTeachingProgressBank(rawBankCode);
  const dimension = parseTeachingProgressDimension(rawDimension);
  let filter: string | null = null;
  if (dimension === "topic" && options.domain !== undefined && options.domain !== "") filter = parseCode(options.domain, "domain");
  if (dimension === "tag" && options.search !== undefined && options.search !== "") {
    if (typeof options.search !== "string" || options.search.trim().length > 100) throw new HttpError(400, "search is invalid or too long.");
    filter = options.search.trim();
  }
  await requireQuestionBank(pool, bankCode);
  const scope = identityScope(identity);
  const sql = dimensionSql(dimension);
  const result = await pool.query<{
    code: string; label: string; eligible: string; attempted: string; correct: string; incorrect: string;
    first_attempted: string; first_correct: string; average_time_ms: string | null; timed_attempts: string;
  }>(
    `${baseCtes()}, dimension_catalog as materialized (${sql.catalog}),
      dimension_questions as materialized (${sql.questions}),
      current_rollup as (
        select item.dimension_id, count(*) filter (where state.question_id is not null)::text as attempted,
          count(*) filter (where state.is_correct)::text as correct,
          count(*) filter (where state.question_id is not null and not state.is_correct)::text as incorrect
        from dimension_questions item left join current_state state on state.question_id = item.question_id
        group by item.dimension_id
      ), first_rollup as (
        select item.dimension_id, count(first.question_id)::text as attempted,
          count(first.question_id) filter (where first.is_correct)::text as correct
        from dimension_questions item left join lifetime_first first on first.question_id = item.question_id
        group by item.dimension_id
      ), time_rollup as (
        select item.dimension_id, round(avg(attempt.answer_duration_ms))::text as average_time_ms, count(*)::text as timed_attempts
        from dimension_questions item join teaching.attempts attempt on attempt.question_id = item.question_id
          and attempt.identity_issuer = $1 and attempt.identity_subject = $2
        where attempt.answer_duration_ms between 1 and 86400000 group by item.dimension_id
      )
      select catalog.code, catalog.label, count(distinct questions.question_id)::text as eligible,
        coalesce(current.attempted, '0') as attempted, coalesce(current.correct, '0') as correct,
        coalesce(current.incorrect, '0') as incorrect, coalesce(first.attempted, '0') as first_attempted,
        coalesce(first.correct, '0') as first_correct, time.average_time_ms,
        coalesce(time.timed_attempts, '0') as timed_attempts
      from dimension_catalog catalog left join dimension_questions questions on questions.dimension_id = catalog.id
      left join current_rollup current on current.dimension_id = catalog.id
      left join first_rollup first on first.dimension_id = catalog.id
      left join time_rollup time on time.dimension_id = catalog.id
      group by catalog.id, catalog.code, catalog.label, catalog.sort_order, current.attempted, current.correct,
        current.incorrect, first.attempted, first.correct, time.average_time_ms, time.timed_attempts
      having $4 <> 'tag' or $5::text is not null or max(coalesce(current.attempted, '0')::integer) > 0
      order by case when $4 = 'tag' and $5::text is null then coalesce(current.attempted, '0')::integer end desc,
        catalog.sort_order, catalog.label
      ${dimension === "tag" ? "limit 25" : ""}`,
    [scope.identityIssuer, scope.identitySubject, bankCode, dimension, filter],
  );
  return {
    questionBank: bankCode,
    dimension,
    items: result.rows.map((row) => {
      const eligible = numeric(row.eligible);
      const attempted = numeric(row.attempted);
      const correct = numeric(row.correct);
      const firstAttempted = numeric(row.first_attempted);
      const firstCorrect = numeric(row.first_correct);
      return {
        code: row.code,
        label: row.label,
        eligible,
        attempted,
        correct,
        incorrect: numeric(row.incorrect),
        unseen: Math.max(0, eligible - attempted),
        completionPercent: percentage(attempted, eligible) ?? 0,
        accuracyPercent: percentage(correct, attempted),
        firstPassAttempted: firstAttempted,
        firstPassCorrect: firstCorrect,
        firstPassAccuracyPercent: percentage(firstCorrect, firstAttempted),
        averageAnswerTimeMs: row.average_time_ms === null ? null : numeric(row.average_time_ms),
        timedAttemptCount: numeric(row.timed_attempts),
      };
    }),
  };
}

interface ScopeMetricRow {
  eligible: string; attempted: string; correct: string; incorrect: string;
}

async function scopeSummary(client: PoolClient | typeof pool, identity: LearnerScope, bankCode: string, scope?: ProgressScope) {
  const values: unknown[] = [identity.identityIssuer, identity.identitySubject, bankCode];
  if (scope) values.push(scope.id);
  const result = await client.query<ScopeMetricRow & { marked?: string }>(currentSummarySql(scope), values);
  return summaryDto({ ...result.rows[0]!, marked: result.rows[0]?.marked ?? "0" });
}

export async function getTeachingProgressPreview(identity: TeachingIdentity, rawBankCode: unknown, rawScope: unknown) {
  const bankCode = parseTeachingProgressBank(rawBankCode);
  const requestScope = record(rawScope, "scope");
  if (requestScope.type !== "bank" && requestScope.type !== "domain" && requestScope.type !== "topic") throw new HttpError(400, "scope.type is invalid.");
  const parsed = { type: requestScope.type as TeachingResetScopeType,
    code: requestScope.type === "bank" ? null : parseCode(requestScope.code, "scope.code"),
    domain: requestScope.type === "topic" && requestScope.domain !== undefined ? parseCode(requestScope.domain, "scope.domain") : null };
  const resolved = await resolveScope(pool, bankCode, parsed);
  const summary = await scopeSummary(pool, identityScope(identity), bankCode, resolved.scope);
  const active = await pool.query<{ sessions: string; questions: string }>(
    `select count(distinct session.id)::text as sessions, count(distinct item.id)::text as questions
     from teaching.sessions session join teaching.session_questions item on item.session_id = session.id
     join teaching.questions question on question.id = item.question_id
     join teaching.question_revisions revision on revision.id = item.question_revision_id
     where session.identity_issuer = $1 and session.identity_subject = $2 and session.status = 'active'
       and question.question_bank_id = $3
       and ($4 = 'bank' or ($4 = 'domain' and revision.domain_id = $5) or ($4 = 'topic' and revision.topic_id = $5))`,
    [identity.identityIssuer, identity.identitySubject, resolved.bank.id, resolved.scope.type, resolved.scope.id],
  );
  return {
    questionBank: bankCode,
    scope: { type: resolved.scope.type, code: resolved.scope.code, label: resolved.scope.label },
    ...summary,
    activeSessionCount: numeric(active.rows[0]?.sessions),
    activeSessionQuestionCount: numeric(active.rows[0]?.questions),
  };
}

export async function resetTeachingProgress(identity: TeachingIdentity, rawInput: unknown) {
  const input = parseTeachingResetRequest(rawInput);
  const learner = identityScope(identity);
  return withTeachingTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))", [learner.identityIssuer, learner.identitySubject]);
    const resolved = await resolveScope(client, input.bank, input.scope);
    const duplicate = await client.query<{ question_bank_id: string; scope_type: TeachingResetScopeType; scope_id: string; cycle_number: number; started_at: Date }>(
      `select question_bank_id, scope_type, scope_id, cycle_number, started_at from teaching.study_cycles
       where identity_issuer = $1 and identity_subject = $2 and request_key = $3`,
      [learner.identityIssuer, learner.identitySubject, input.idempotencyKey],
    );
    if (duplicate.rows[0]) {
      const prior = duplicate.rows[0];
      if (prior.question_bank_id !== resolved.bank.id || prior.scope_type !== resolved.scope.type || prior.scope_id !== resolved.scope.id) {
        throw new HttpError(409, "idempotencyKey was already used for another Teaching reset.");
      }
      const summary = await scopeSummary(client, learner, input.bank, resolved.scope);
      return { ...summary, questionBank: input.bank, scope: { type: resolved.scope.type, code: resolved.scope.code, label: resolved.scope.label },
        cycleNumber: prior.cycle_number, startedAt: prior.started_at.toISOString(), alreadyApplied: true };
    }

    const targets = await client.query<{ scope_type: TeachingResetScopeType; scope_id: string; domain_id: string | null }>(
      `with bank as (select id, specialty_id from teaching.question_banks where id = $1),
       target as (select $2::text as scope_type, $3::bigint as scope_id, null::bigint as domain_id
         where $2 = 'bank' union all
         select 'domain', domain.id, domain.id from teaching.domains domain cross join bank
         where domain.specialty_id = bank.specialty_id and ($2 = 'bank' or ($2 = 'domain' and domain.id = $3)) union all
         select 'topic', topic.id, topic.domain_id from teaching.topics topic join teaching.domains domain on domain.id = topic.domain_id cross join bank
         where domain.specialty_id = bank.specialty_id and ($2 = 'bank' or ($2 = 'domain' and domain.id = $3) or ($2 = 'topic' and topic.id = $3)))
       select distinct scope_type, scope_id, domain_id from target order by scope_type, scope_id`,
      [resolved.bank.id, resolved.scope.type, resolved.scope.id],
    );
    const targetRows = targets.rows;
    const targetTypes = targetRows.map((row) => row.scope_type);
    const targetIds = targetRows.map((row) => row.scope_id);
    const targetDomainIds = targetRows.map((row) => row.domain_id);

    const metricsResult = await client.query<ScopeMetricRow & { scope_type: string; scope_id: string }>(
      `${baseCtes()}, scopes as materialized (
         select * from unnest($4::text[], $5::bigint[], $6::bigint[]) as item(scope_type, scope_id, domain_id)
       ), metrics as (
         select scope.scope_type, scope.scope_id, count(question.question_id)::int as eligible,
           count(state.question_id)::int as attempted,
           count(state.question_id) filter (where state.is_correct)::int as correct,
           count(state.question_id) filter (where state.question_id is not null and not state.is_correct)::int as incorrect
         from scopes scope left join effective_questions question on
           (scope.scope_type = 'bank' and question.question_bank_id = scope.scope_id)
           or (scope.scope_type = 'domain' and question.domain_id = scope.scope_id)
           or (scope.scope_type = 'topic' and question.topic_id = scope.scope_id)
         left join current_state state on state.question_id = question.question_id
         group by scope.scope_type, scope.scope_id
       ) select scope_type, scope_id::text, eligible::text, attempted::text, correct::text, incorrect::text from metrics`,
      [learner.identityIssuer, learner.identitySubject, input.bank, targetTypes, targetIds, targetDomainIds],
    );

    const metadata = await client.query<{
      scope_type: TeachingResetScopeType; scope_id: string; latest_cycle: string | null; has_active: boolean;
      relevant_events: string; effective_started_at: Date | null; profile_created_at: Date;
    }>(
      `with scopes as (select * from unnest($4::text[], $5::bigint[], $6::bigint[]) as item(scope_type, scope_id, domain_id)),
       profile as (select created_at from teaching.user_profiles where identity_issuer = $1 and identity_subject = $2)
       select scope.scope_type, scope.scope_id::text,
         max(cycle.cycle_number) filter (where cycle.scope_type = scope.scope_type and cycle.scope_id = scope.scope_id)::text as latest_cycle,
         coalesce(bool_or(cycle.ended_at is null) filter (where cycle.scope_type = scope.scope_type and cycle.scope_id = scope.scope_id), false) as has_active,
         count(distinct cycle.reset_event_id)::text as relevant_events, max(cycle.started_at) as effective_started_at,
         (select created_at from profile) as profile_created_at
       from scopes scope left join teaching.study_cycles cycle on cycle.identity_issuer = $1 and cycle.identity_subject = $2
         and cycle.question_bank_id = $3 and (
           (cycle.scope_type = 'bank' and cycle.scope_id = $3)
           or (cycle.scope_type = 'domain' and scope.scope_type in ('domain', 'topic') and cycle.scope_id = scope.domain_id)
           or (cycle.scope_type = 'topic' and scope.scope_type = 'topic' and cycle.scope_id = scope.scope_id))
       group by scope.scope_type, scope.scope_id, scope.domain_id
       order by scope.scope_type, scope.scope_id`,
      [learner.identityIssuer, learner.identitySubject, resolved.bank.id, targetTypes, targetIds, targetDomainIds],
    );

    const metricByScope = new Map(metricsResult.rows.map((row) => [`${row.scope_type}:${row.scope_id}`, row]));
    const metaByScope = new Map(metadata.rows.map((row) => [`${row.scope_type}:${row.scope_id}`, row]));
    const endedAt = new Date();
    const toSnapshot = (metric: ScopeMetricRow) => {
      const eligible = numeric(metric.eligible);
      const attempted = numeric(metric.attempted);
      const correct = numeric(metric.correct);
      const incorrect = numeric(metric.incorrect);
      return { eligible, attempted, correct, incorrect, completion: percentage(attempted, eligible) ?? 0, accuracy: percentage(correct, attempted) };
    };

    const activeToClose = targetRows.filter((row) => metaByScope.get(`${row.scope_type}:${row.scope_id}`)?.has_active);
    if (activeToClose.length) {
      const closing = activeToClose.map((target) => {
        const metric = toSnapshot(metricByScope.get(`${target.scope_type}:${target.scope_id}`)!);
        return { ...target, metric };
      });
      await client.query(
        `update teaching.study_cycles cycle set ended_at = $7,
           eligible_question_count = item.eligible, attempted_question_count = item.attempted,
           correct_question_count = item.correct, incorrect_question_count = item.incorrect,
           completion_percentage = item.completion, accuracy_percentage = item.accuracy
         from unnest($4::text[], $5::bigint[], $6::integer[], $8::integer[], $9::integer[], $10::integer[], $11::numeric[], $12::numeric[]) as item(scope_type, scope_id, eligible, attempted, correct, incorrect, completion, accuracy)
         where cycle.identity_issuer = $1 and cycle.identity_subject = $2 and cycle.question_bank_id = $3
           and cycle.scope_type = item.scope_type and cycle.scope_id = item.scope_id and cycle.ended_at is null`,
        [learner.identityIssuer, learner.identitySubject, resolved.bank.id, closing.map((item) => item.scope_type), closing.map((item) => item.scope_id),
          closing.map((item) => item.metric.eligible), endedAt,
          closing.map((item) => item.metric.attempted), closing.map((item) => item.metric.correct), closing.map((item) => item.metric.incorrect),
          closing.map((item) => item.metric.completion), closing.map((item) => item.metric.accuracy)],
      );
    }

    const implicitClosures = targetRows.filter((target) => {
      const meta = metaByScope.get(`${target.scope_type}:${target.scope_id}`)!;
      return !meta.has_active && meta.latest_cycle === null;
    }).map((target) => {
      const meta = metaByScope.get(`${target.scope_type}:${target.scope_id}`)!;
      const metric = toSnapshot(metricByScope.get(`${target.scope_type}:${target.scope_id}`)!);
      return {
        ...target,
        cycleNumber: numeric(meta.relevant_events) + 1,
        startedAt: meta.effective_started_at ?? meta.profile_created_at,
        endedAt,
        eventId: randomUUID(),
        metric,
      };
    });
    if (implicitClosures.length) {
      await client.query(
        `insert into teaching.study_cycles (identity_issuer, identity_subject, question_bank_id, scope_type, scope_id,
           cycle_number, reset_event_id, started_at, ended_at, eligible_question_count, attempted_question_count,
           correct_question_count, incorrect_question_count, completion_percentage, accuracy_percentage)
         select $1, $2, $3, item.scope_type, item.scope_id, item.cycle_number, item.event_id, item.started_at, item.ended_at,
           item.eligible, item.attempted, item.correct, item.incorrect, item.completion, item.accuracy
         from unnest($4::text[], $5::bigint[], $6::integer[], $7::uuid[], $8::timestamptz[], $9::timestamptz[],
           $10::integer[], $11::integer[], $12::integer[], $13::integer[], $14::numeric[], $15::numeric[])
           as item(scope_type, scope_id, cycle_number, event_id, started_at, ended_at, eligible, attempted, correct, incorrect, completion, accuracy)`,
        [learner.identityIssuer, learner.identitySubject, resolved.bank.id, implicitClosures.map((item) => item.scope_type),
          implicitClosures.map((item) => item.scope_id), implicitClosures.map((item) => item.cycleNumber), implicitClosures.map((item) => item.eventId),
          implicitClosures.map((item) => item.startedAt), implicitClosures.map((item) => item.endedAt), implicitClosures.map((item) => item.metric.eligible),
          implicitClosures.map((item) => item.metric.attempted), implicitClosures.map((item) => item.metric.correct), implicitClosures.map((item) => item.metric.incorrect),
          implicitClosures.map((item) => item.metric.completion), implicitClosures.map((item) => item.metric.accuracy)],
      );
    }

    const nextRows = targetRows.map((target) => {
      const meta = metaByScope.get(`${target.scope_type}:${target.scope_id}`)!;
      const previousCycle = meta.latest_cycle === null ? numeric(meta.relevant_events) + 1 : numeric(meta.latest_cycle);
      return { ...target, cycleNumber: previousCycle + 1 };
    });
    const eventId = randomUUID();
    const inserted = await client.query<{ scope_type: TeachingResetScopeType; scope_id: string; cycle_number: number; started_at: Date }>(
      `insert into teaching.study_cycles (identity_issuer, identity_subject, question_bank_id, scope_type, scope_id,
         cycle_number, reset_event_id, request_key, started_at)
       select $1, $2, $3, item.scope_type, item.scope_id, item.cycle_number, $4,
         case when item.scope_type = $8 and item.scope_id = $9 then $10::uuid else null end, $11
       from unnest($5::text[], $6::bigint[], $7::integer[]) as item(scope_type, scope_id, cycle_number)
       returning scope_type, scope_id::text, cycle_number, started_at`,
      [learner.identityIssuer, learner.identitySubject, resolved.bank.id, eventId, nextRows.map((row) => row.scope_type), nextRows.map((row) => row.scope_id),
        nextRows.map((row) => row.cycleNumber), resolved.scope.type, resolved.scope.id, input.idempotencyKey, endedAt],
    );
    const current = inserted.rows.find((row) => row.scope_type === resolved.scope.type && row.scope_id === resolved.scope.id)!;
    const summary = await scopeSummary(client, learner, input.bank, resolved.scope);
    return { ...summary, questionBank: input.bank,
      scope: { type: resolved.scope.type, code: resolved.scope.code, label: resolved.scope.label },
      cycleNumber: current.cycle_number, startedAt: current.started_at.toISOString(), alreadyApplied: false };
  });
}

export async function getTeachingProgressCycles(identity: TeachingIdentity, rawBankCode: unknown, rawScope: unknown) {
  const bankCode = parseTeachingProgressBank(rawBankCode);
  const requestScope = record(rawScope, "scope");
  if (requestScope.type !== "bank" && requestScope.type !== "domain" && requestScope.type !== "topic") throw new HttpError(400, "scope.type is invalid.");
  const parsed = { type: requestScope.type as TeachingResetScopeType,
    code: requestScope.type === "bank" ? null : parseCode(requestScope.code, "scope.code"),
    domain: requestScope.type === "topic" && requestScope.domain !== undefined ? parseCode(requestScope.domain, "scope.domain") : null };
  const resolved = await resolveScope(pool, bankCode, parsed);
  const learner = identityScope(identity);
  const result = await pool.query<{
    id: string; cycle_number: number; started_at: Date; ended_at: Date | null; eligible_question_count: number | null;
    attempted_question_count: number | null; correct_question_count: number | null; incorrect_question_count: number | null;
    completion_percentage: string | null; accuracy_percentage: string | null;
  }>(
    `select id, cycle_number, started_at, ended_at, eligible_question_count, attempted_question_count,
       correct_question_count, incorrect_question_count, completion_percentage, accuracy_percentage
     from teaching.study_cycles where identity_issuer = $1 and identity_subject = $2 and question_bank_id = $3
       and scope_type = $4 and scope_id = $5 order by cycle_number desc`,
    [learner.identityIssuer, learner.identitySubject, resolved.bank.id, resolved.scope.type, resolved.scope.id],
  );
  const summary = await scopeSummary(pool, learner, bankCode, resolved.scope);
  const currentRow = result.rows.find((row) => row.ended_at === null);
  let virtualCurrent: { cycleNumber: number; startedAt: string } | null = null;
  if (!currentRow) {
    const meta = await pool.query<{ cycle_number: string; started_at: Date | null; profile_created_at: Date }>(
      `select count(distinct cycle.reset_event_id)::text as cycle_number, max(cycle.started_at) as started_at,
        (select created_at from teaching.user_profiles where identity_issuer = $1 and identity_subject = $2) as profile_created_at
       from teaching.study_cycles cycle where cycle.identity_issuer = $1 and cycle.identity_subject = $2 and cycle.question_bank_id = $3
         and ((cycle.scope_type = 'bank' and cycle.scope_id = $3)
           or (cycle.scope_type = 'domain' and $4 in ('domain','topic') and cycle.scope_id = $6)
           or (cycle.scope_type = 'topic' and $4 = 'topic' and cycle.scope_id = $5))`,
      [learner.identityIssuer, learner.identitySubject, resolved.bank.id, resolved.scope.type, resolved.scope.id, resolved.scope.domainId],
    );
    virtualCurrent = { cycleNumber: numeric(meta.rows[0]?.cycle_number) + 1,
      startedAt: (meta.rows[0]?.started_at ?? meta.rows[0]?.profile_created_at).toISOString() };
  }
  const items: Array<{
    id: string; cycleNumber: number; startedAt: string; endedAt: string | null; eligible: number;
    attempted: number; correct: number; incorrect: number; completionPercent: number; accuracyPercent: number | null; current: boolean;
  }> = result.rows.filter((row) => row.ended_at !== null).map((row) => ({
    id: row.id,
    cycleNumber: row.cycle_number,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at!.toISOString(),
    eligible: numeric(row.eligible_question_count),
    attempted: numeric(row.attempted_question_count),
    correct: numeric(row.correct_question_count),
    incorrect: numeric(row.incorrect_question_count),
    completionPercent: numeric(row.completion_percentage),
    accuracyPercent: row.accuracy_percentage === null ? null : numeric(row.accuracy_percentage),
    current: false,
  }));
  items.unshift({
    id: currentRow?.id ?? "current",
    cycleNumber: currentRow?.cycle_number ?? virtualCurrent!.cycleNumber,
    startedAt: currentRow?.started_at.toISOString() ?? virtualCurrent!.startedAt,
    endedAt: null,
    eligible: summary.eligibleQuestionCount,
    attempted: summary.attempted,
    correct: summary.correct,
    incorrect: summary.incorrect,
    completionPercent: summary.completionPercent,
    accuracyPercent: summary.accuracyPercent,
    current: true,
  });
  return { questionBank: bankCode, scope: { type: resolved.scope.type, code: resolved.scope.code, label: resolved.scope.label }, items };
}
