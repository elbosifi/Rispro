import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../../db/pool.js";
import type { DayManagementContextDto } from "../../api/dto/admin-scheduling.dto.js";
import { canReachDatabase, createTestApp, createTestAuthCookie, fetchJson, isDatabaseAvailable, seedTestData, setupTestDatabase, type TestData } from "./helpers.js";

const PREFIX = "DAY_MANAGEMENT_MUTATIONS_";
const DATE = "2027-05-20";
const PAST_DATE = "2000-01-01";
const DATE_RANGE_DATE = "2030-02-20";
const DATE_RANGE_START = "2030-02-19";
const DATE_RANGE_END = "2030-02-21";
const RECURRING_DATE = "2030-03-04";
const EVALUATOR_DATE = "2032-04-15";
const available = isDatabaseAvailable();

type ErrorResponse = { error?: { reasonCodes?: string[] } };

async function fetchWithReasonCodes(testApp: Awaited<ReturnType<typeof createTestApp>>, path: string, options: Parameters<typeof fetchJson>[2]): Promise<{ status: number; data: ErrorResponse; reasonCodes: string[] }> {
  let capturedReasonCodes: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const error = args.find((value) => value && typeof value === "object" && Array.isArray((value as { reasonCodes?: unknown }).reasonCodes)) as { reasonCodes?: unknown } | undefined;
    if (error) capturedReasonCodes = (error.reasonCodes as unknown[]).filter((code): code is string => typeof code === "string");
    originalError(...args);
  };
  try {
    const response = await fetchJson<ErrorResponse>(testApp.baseUrl, path, options);
    const responseReasonCodes = response.data.error?.reasonCodes ?? [];
    return { ...response, reasonCodes: responseReasonCodes.length > 0 ? responseReasonCodes : capturedReasonCodes };
  } finally {
    console.error = originalError;
  }
}

async function policySafetyState(testData: TestData, date: string, reason: string): Promise<{
  publishedVersionId: number;
  publishedConfigHash: string;
  draftVersionId: number | null;
  draftConfigHash: string | null;
  totalVersionCount: number;
  draftCount: number;
  matchingDayRuleCount: number;
  matchingAuditCount: number;
}> {
  const published = await pool.query<{ id: string; configHash: string }>(
    `select id::text as id, config_hash as "configHash"
       from appointments_v2.policy_versions
      where policy_set_id = $1 and status = 'published'
      order by version_no desc limit 1`,
    [testData.policySetId]
  );
  const draft = await pool.query<{ id: string; configHash: string }>(
    `select id::text as id, config_hash as "configHash"
       from appointments_v2.policy_versions
      where policy_set_id = $1 and status = 'draft'
      order by version_no desc limit 1`,
    [testData.policySetId]
  );
  const publishedVersionId = Number(published.rows[0]!.id);
  const [versions, drafts, dayRules, audits] = await Promise.all([
    pool.query<{ count: number }>(`select count(*)::int as count from appointments_v2.policy_versions where policy_set_id = $1`, [testData.policySetId]),
    pool.query<{ count: number }>(`select count(*)::int as count from appointments_v2.policy_versions where policy_set_id = $1 and status = 'draft'`, [testData.policySetId]),
    pool.query<{ count: number }>(
      `select count(*)::int as count
         from appointments_v2.modality_blocked_rules
        where policy_version_id = $1 and modality_id = $2 and rule_type = 'specific_date'
          and specific_date = $3::date and is_active = true`,
      [publishedVersionId, testData.modalityId, date]
    ),
    pool.query<{ count: number }>(
      `select count(*)::int as count
         from audit_log
        where entity_type = 'scheduling_policy_day' and changed_by_user_id = $1
          and new_values ->> 'reason' = $2`,
      [testData.userId, reason]
    ),
  ]);
  return {
    publishedVersionId,
    publishedConfigHash: published.rows[0]!.configHash,
    draftVersionId: draft.rows[0] ? Number(draft.rows[0].id) : null,
    draftConfigHash: draft.rows[0]?.configHash ?? null,
    totalVersionCount: versions.rows[0]!.count,
    draftCount: drafts.rows[0]!.count,
    matchingDayRuleCount: dayRules.rows[0]!.count,
    matchingAuditCount: audits.rows[0]!.count,
  };
}

async function cleanupCreatedDraft(draftVersionId: number): Promise<void> {
  await pool.query(
    `delete from appointments_v2.exam_type_rule_items
      where rule_id in (select id from appointments_v2.exam_type_rules where policy_version_id = $1)`,
    [draftVersionId]
  );
  await pool.query(
    `delete from appointments_v2.exam_mix_quota_rule_items
      where rule_id in (select id from appointments_v2.exam_mix_quota_rules where policy_version_id = $1)`,
    [draftVersionId]
  );
  await pool.query(`delete from appointments_v2.exam_type_rules where policy_version_id = $1`, [draftVersionId]);
  await pool.query(`delete from appointments_v2.exam_mix_quota_rules where policy_version_id = $1`, [draftVersionId]);
  await pool.query(`delete from appointments_v2.modality_blocked_rules where policy_version_id = $1`, [draftVersionId]);
  await pool.query(`delete from appointments_v2.category_daily_limits where policy_version_id = $1`, [draftVersionId]);
  await pool.query(`delete from appointments_v2.policy_versions where id = $1 and status = 'draft'`, [draftVersionId]);
}

describe("day management mutations integration", { skip: !available ? "Database URL not set" : false }, () => {
  let reachable = false; let testDb: Awaited<ReturnType<typeof setupTestDatabase>>; let data: TestData; let app: Awaited<ReturnType<typeof createTestApp>>;
  const cookie = () => createTestAuthCookie(data.userId, "super_admin");
  const context = () => fetchJson<DayManagementContextDto>(app.baseUrl, `/api/v2/scheduling/admin/day-management/context?modalityId=${data.modalityId}&date=${DATE}&policySetKey=${data.policySetKey}`, { cookie: cookie() });
  const body = (versionId: number, reason = "Scanner maintenance", date = DATE) => ({ policySetKey: data.policySetKey, modalityId: data.modalityId, date, expectedPublishedVersionId: versionId, reason });
  before(async () => { reachable = await canReachDatabase(); if (!reachable) return; testDb = await setupTestDatabase(PREFIX); data = await seedTestData(testDb.schemaName, PREFIX); app = await createTestApp(); });
  after(async () => { if (!reachable) return; await app.close(); await testDb.cleanup(); });

  it("quick-publishes a specific-date block without changing existing bookings, audits it, and removes it", async () => {
    if (!reachable) return;
    const beforeContext = await context(); assert.equal(beforeContext.status, 200); const oldId = beforeContext.data.policy.published!.id;
    const created = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/block-modality", { method: "POST", cookie: cookie(), body: { ...body(oldId), isOverridable: false } });
    assert.equal(created.status, 201); const createdData = created.data as { published: { id: number; versionNo: number; status: string } }; assert.equal(createdData.published.status, "published"); assert.ok(createdData.published.versionNo > beforeContext.data.policy.published!.versionNo);
    const afterCreate = await context(); const rule = afterCreate.data.effectiveRules.modalityBlocks.find((item) => item.ruleType === "specific_date"); assert.ok(rule); assert.equal(afterCreate.data.policy.draft, null);
    const archived = await pool.query<{ status: string }>("select status from appointments_v2.policy_versions where id = $1", [oldId]); assert.equal(archived.rows[0]?.status, "archived");
    const audit = await pool.query<{ action_type: string; new_values: { date: string; reason: string; bookedTotal: number } }>("select action_type, new_values from audit_log where entity_type = 'scheduling_policy_day' and changed_by_user_id = $1 order by id desc limit 1", [data.userId]); assert.equal(audit.rows[0]?.action_type, "modality_day_block_created"); assert.equal(audit.rows[0]?.new_values.date, DATE); assert.equal(audit.rows[0]?.new_values.reason, "Scanner maintenance");
    const removed = await fetchJson(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/block_modality/${rule!.id}/remove`, { method: "POST", cookie: cookie(), body: body(afterCreate.data.policy.published!.id, "Maintenance complete") }); assert.equal(removed.status, 200);
    const afterRemove = await context(); assert.equal(afterRemove.data.effectiveRules.modalityBlocks.some((item) => item.id === rule!.id), false);
  });

  it("validates dates, reasons, restriction/quota inputs, stale versions, and super-admin authorization", async () => {
    if (!reachable) return;
    const current = await context(); const versionId = current.data.policy.published!.id;
    const blank = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/block-modality", { method: "POST", cookie: cookie(), body: { ...body(versionId, ""), isOverridable: false } }); assert.equal(blank.status, 400);
    const stale = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/block-modality", { method: "POST", cookie: cookie(), body: { ...body(versionId - 1), isOverridable: false } }); assert.equal(stale.status, 409);
    const supervisor = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/block-modality", { method: "POST", cookie: createTestAuthCookie(data.userId, "supervisor"), body: { ...body(versionId), isOverridable: false } }); assert.equal(supervisor.status, 403);
    const invalidExam = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/exam-restriction", { method: "POST", cookie: cookie(), body: { ...body(versionId), examTypeIds: [999999], effectMode: "hard_restriction" } }); assert.equal(invalidExam.status, 400);
    const invalidQuota = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/exam-mix-quota", { method: "POST", cookie: cookie(), body: { ...body(versionId), examTypeIds: [data.examTypeId], dailyLimit: 0 } }); assert.equal(invalidQuota.status, 400);
  });

  it("creates exam restriction and exam-mix quota as specific-date rules", async () => {
    if (!reachable) return;
    let current = await context();
    const restriction = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/exam-restriction", { method: "POST", cookie: cookie(), body: { ...body(current.data.policy.published!.id), examTypeIds: [data.examTypeId], effectMode: "restriction_overridable" } }); assert.equal(restriction.status, 201);
    current = await context(); assert.equal(current.data.effectiveRules.examTypeRestrictions.some((item) => item.ruleType === "specific_date" && item.effectMode === "restriction_overridable"), true);
    const quota = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/exam-mix-quota", { method: "POST", cookie: cookie(), body: { ...body(current.data.policy.published!.id), examTypeIds: [data.examTypeId], dailyLimit: 2 } }); assert.equal(quota.status, 201);
    current = await context(); assert.equal(current.data.effectiveRules.examMixQuotas.some((item) => item.ruleType === "specific_date" && item.dailyLimit === 2), true);
  });

  it("rejects an active draft without publishing, mutating, or creating audit residue", async () => {
    if (!reachable) return;
    const draftReason = "Draft conflict safety check 2031";
    const draftCreated = await fetchJson<{ draft?: { id: number } }>(app.baseUrl, "/api/v2/scheduling/admin/policy/draft", {
      method: "POST", cookie: cookie(), body: { policySetKey: data.policySetKey, changeNote: "Unrelated active draft for safety coverage" },
    });
    assert.equal(draftCreated.status, 201);
    const draftVersionId = Number(draftCreated.data.draft?.id);
    assert.ok(draftVersionId > 0);
    const before = await policySafetyState(data, "2031-06-17", draftReason);
    try {
      const rejected = await fetchWithReasonCodes(app, "/api/v2/scheduling/admin/day-management/block-modality", {
        method: "POST", cookie: cookie(), body: { ...body(before.publishedVersionId, draftReason, "2031-06-17"), isOverridable: false },
      });
      assert.equal(rejected.status, 409);
      assert.ok(rejected.reasonCodes.includes("day_management_draft_conflict"));

      const after = await policySafetyState(data, "2031-06-17", draftReason);
      assert.equal(after.publishedVersionId, before.publishedVersionId);
      assert.equal(after.publishedConfigHash, before.publishedConfigHash);
      assert.equal(after.draftVersionId, before.draftVersionId);
      assert.equal(after.draftConfigHash, before.draftConfigHash);
      assert.equal(after.totalVersionCount, before.totalVersionCount);
      assert.equal(after.draftCount, before.draftCount);
      assert.equal(after.matchingDayRuleCount, before.matchingDayRuleCount);
      assert.equal(after.matchingAuditCount, before.matchingAuditCount);
    } finally {
      await cleanupCreatedDraft(draftVersionId);
    }
  });

  it("rejects a historical date without publishing, creating a rule, or auditing", async () => {
    if (!reachable) return;
    const reason = "Historical date safety check 2000";
    const before = await policySafetyState(data, PAST_DATE, reason);
    const rejected = await fetchWithReasonCodes(app, "/api/v2/scheduling/admin/day-management/block-modality", {
      method: "POST", cookie: cookie(), body: { ...body(before.publishedVersionId, reason, PAST_DATE), isOverridable: false },
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.reasonCodes.includes("day_management_past_date"));
    const after = await policySafetyState(data, PAST_DATE, reason);
    assert.equal(after.publishedVersionId, before.publishedVersionId);
    assert.equal(after.totalVersionCount, before.totalVersionCount);
    assert.equal(after.matchingDayRuleCount, before.matchingDayRuleCount);
    assert.equal(after.matchingAuditCount, before.matchingAuditCount);
  });

  it("rejects removal of an active date-range rule without mutation, publication, or audit", async () => {
    if (!reachable) return;
    const reason = "Date range removal safety check 2030";
    const beforePublished = await policySafetyState(data, DATE_RANGE_DATE, reason);
    const inserted = await pool.query<{ id: number }>(
      `insert into appointments_v2.modality_blocked_rules
       (policy_version_id, modality_id, rule_type, start_date, end_date, is_overridable, is_active, title)
       values ($1, $2, 'date_range', $3::date, $4::date, false, true, 'Manage Day date-range safety rule')
       returning id`,
      [beforePublished.publishedVersionId, data.modalityId, DATE_RANGE_START, DATE_RANGE_END]
    );
    const ruleId = Number(inserted.rows[0]!.id);
    try {
      const before = await policySafetyState(data, DATE_RANGE_DATE, reason);
      const rejected = await fetchWithReasonCodes(app, `/api/v2/scheduling/admin/day-management/rules/block_modality/${ruleId}/remove`, {
        method: "POST", cookie: cookie(), body: body(before.publishedVersionId, reason, DATE_RANGE_DATE),
      });
      assert.equal(rejected.status, 409);
      assert.ok(rejected.reasonCodes.includes("day_management_rule_not_day_specific"));
      const rule = await pool.query(`select id from appointments_v2.modality_blocked_rules where id = $1`, [ruleId]);
      assert.equal(rule.rows.length, 1);
      const after = await policySafetyState(data, DATE_RANGE_DATE, reason);
      assert.equal(after.publishedVersionId, before.publishedVersionId);
      assert.equal(after.totalVersionCount, before.totalVersionCount);
      assert.equal(after.matchingDayRuleCount, before.matchingDayRuleCount);
      assert.equal(after.matchingAuditCount, before.matchingAuditCount);
    } finally {
      await pool.query(`delete from appointments_v2.modality_blocked_rules where id = $1`, [ruleId]);
    }
  });

  it("rejects removal of an active recurring exam rule without mutation, publication, or audit", async () => {
    if (!reachable) return;
    const reason = "Recurring rule removal safety check 2030";
    const beforePublished = await policySafetyState(data, RECURRING_DATE, reason);
    const inserted = await pool.query<{ id: number }>(
      `insert into appointments_v2.exam_type_rules
       (policy_version_id, modality_id, rule_type, effect_mode, weekday, alternate_weeks, recurrence_anchor_date, is_active, title)
       values ($1, $2, 'weekly_recurrence', 'hard_restriction', 1, false, $3::date, true, 'Manage Day recurring safety rule')
       returning id`,
      [beforePublished.publishedVersionId, data.modalityId, RECURRING_DATE]
    );
    const ruleId = Number(inserted.rows[0]!.id);
    await pool.query(`insert into appointments_v2.exam_type_rule_items (rule_id, exam_type_id) values ($1, $2)`, [ruleId, data.examTypeId]);
    try {
      const before = await policySafetyState(data, RECURRING_DATE, reason);
      const rejected = await fetchWithReasonCodes(app, `/api/v2/scheduling/admin/day-management/rules/restrict_exam_types/${ruleId}/remove`, {
        method: "POST", cookie: cookie(), body: body(before.publishedVersionId, reason, RECURRING_DATE),
      });
      assert.equal(rejected.status, 409);
      assert.ok(rejected.reasonCodes.includes("day_management_rule_not_day_specific"));
      const rule = await pool.query(`select id from appointments_v2.exam_type_rules where id = $1`, [ruleId]);
      assert.equal(rule.rows.length, 1);
      const after = await policySafetyState(data, RECURRING_DATE, reason);
      assert.equal(after.publishedVersionId, before.publishedVersionId);
      assert.equal(after.totalVersionCount, before.totalVersionCount);
      assert.equal(after.matchingAuditCount, before.matchingAuditCount);
    } finally {
      await pool.query(`delete from appointments_v2.exam_type_rules where id = $1`, [ruleId]);
    }
  });

  it("feeds a Manage Day hard exam restriction into the real evaluator", async () => {
    if (!reachable) return;
    const current = await policySafetyState(data, EVALUATOR_DATE, "Hard evaluator safety check 2032");
    const created = await fetchJson<{ published?: { id: number } }>(app.baseUrl, "/api/v2/scheduling/admin/day-management/exam-restriction", {
      method: "POST", cookie: cookie(), body: { ...body(current.publishedVersionId, "Hard evaluator safety check 2032", EVALUATOR_DATE), examTypeIds: [data.examTypeId], effectMode: "hard_restriction" },
    });
    assert.equal(created.status, 201);
    assert.ok(Number(created.data.published?.id) > current.publishedVersionId);

    const evaluated = await fetchJson<{
      isAllowed: boolean;
      requiresSupervisorOverride: boolean;
      displayStatus: string;
      reasons: Array<{ code: string }>;
    }>(app.baseUrl, "/api/v2/scheduling/evaluate", {
      method: "POST", cookie: cookie(), body: {
        patientId: data.patientId,
        modalityId: data.modalityId,
        examTypeId: data.examTypeId,
        scheduledDate: EVALUATOR_DATE,
        caseCategory: "non_oncology",
        policySetKey: data.policySetKey,
      },
    });
    assert.equal(evaluated.status, 200);
    assert.equal(evaluated.data.isAllowed, false);
    assert.equal(evaluated.data.requiresSupervisorOverride, false);
    assert.equal(evaluated.data.displayStatus, "blocked");
    assert.ok(evaluated.data.reasons.some((reason) => reason.code === "exam_type_not_allowed_for_rule"));
  });
});
