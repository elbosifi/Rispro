import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../../db/pool.js";
import { DEFAULT_ACTION_PIN_POLICY } from "../../../../services/action-pin-policy-service.js";
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
const AUDIT_CREATE_DATE = "2033-06-11";
const AUDIT_REMOVE_DATE = "2033-06-12";
const RESTRICTION_DUPLICATE_DATE = "2034-06-11";
const RESTRICTION_SCOPE_CONFLICT_DATE = "2034-06-12";
const QUOTA_DUPLICATE_DATE = "2034-06-13";
const QUOTA_SCOPE_CONFLICT_DATE = "2034-06-14";
const ACTION_PIN_CREATE_DATE = "2035-06-11";
const ACTION_PIN_REMOVE_DATE = "2035-06-12";
const available = isDatabaseAvailable();

type ErrorResponse = { error?: { reasonCodes?: string[] } };
type DraftResponse = { draft?: { id: number; status: string }; basedOnVersionId?: number | string };

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

async function setAuditTrailForTest(value: "enabled" | "disabled", userId: number): Promise<() => Promise<void>> {
  const existing = await pool.query<{ setting_value: unknown; updated_by_user_id: number | string | null }>(
    `select setting_value, updated_by_user_id
       from system_settings
      where category = 'audit_and_logging' and setting_key = 'audit_trail'
      limit 1`
  );
  await pool.query(
    `insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
     values ('audit_and_logging', 'audit_trail', $1::jsonb, $2)
     on conflict (category, setting_key) do update set
       setting_value = excluded.setting_value,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = now()`,
    [JSON.stringify({ value }), userId]
  );
  return async () => {
    if (existing.rows[0]) {
      await pool.query(
        `update system_settings
            set setting_value = $1::jsonb,
                updated_by_user_id = $2,
                updated_at = now()
          where category = 'audit_and_logging' and setting_key = 'audit_trail'`,
        [JSON.stringify(existing.rows[0].setting_value), existing.rows[0].updated_by_user_id]
      );
    } else {
      await pool.query(
        `delete from system_settings where category = 'audit_and_logging' and setting_key = 'audit_trail'`
      );
    }
  };
}

async function setActionPinPolicyForTest(value: unknown, userId: number): Promise<() => Promise<void>> {
  const existing = await pool.query<{ setting_value: unknown; updated_by_user_id: number | string | null }>(
    `select setting_value, updated_by_user_id
       from system_settings
      where category = 'users_and_roles' and setting_key = 'action_pin_policy'
      limit 1`
  );
  await pool.query(
    `insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
     values ('users_and_roles', 'action_pin_policy', $1::jsonb, $2)
     on conflict (category, setting_key) do update set
       setting_value = excluded.setting_value,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = now()`,
    [JSON.stringify({ value }), userId]
  );
  return async () => {
    if (existing.rows[0]) {
      await pool.query(
        `update system_settings
            set setting_value = $1::jsonb,
                updated_by_user_id = $2,
                updated_at = now()
          where category = 'users_and_roles' and setting_key = 'action_pin_policy'`,
        [JSON.stringify(existing.rows[0].setting_value), existing.rows[0].updated_by_user_id]
      );
    } else {
      await pool.query(`delete from system_settings where category = 'users_and_roles' and setting_key = 'action_pin_policy'`);
    }
  };
}

function enabledActionPinPolicy() {
  return {
    ...DEFAULT_ACTION_PIN_POLICY,
    enabled: true,
    actionModes: {
      ...DEFAULT_ACTION_PIN_POLICY.actionModes,
      scheduling_day_policy_change: {
        ...DEFAULT_ACTION_PIN_POLICY.actionModes.scheduling_day_policy_change,
        super_admin: "required_every_time",
      },
    },
  };
}

async function matchingSpecificDateRestrictions(policyVersionId: number, modalityId: number, date: string, examTypeId: number) {
  return pool.query<{ id: number; effectMode: string }>(
    `select rule.id, rule.effect_mode as "effectMode"
       from appointments_v2.exam_type_rules rule
      where rule.policy_version_id = $1
        and rule.modality_id = $2
        and rule.rule_type = 'specific_date'
        and rule.specific_date = $3::date
        and rule.is_active = true
        and (select array_agg(item.exam_type_id order by item.exam_type_id) from appointments_v2.exam_type_rule_items item where item.rule_id = rule.id) = array[$4]::bigint[]`,
    [policyVersionId, modalityId, date, examTypeId]
  );
}

async function matchingSpecificDateExamMixQuotas(policyVersionId: number, modalityId: number, date: string, examTypeId: number) {
  return pool.query<{ id: number; dailyLimit: number }>(
    `select rule.id, rule.daily_limit as "dailyLimit"
       from appointments_v2.exam_mix_quota_rules rule
      where rule.policy_version_id = $1
        and rule.modality_id = $2
        and rule.rule_type = 'specific_date'
        and rule.specific_date = $3::date
        and rule.is_active = true
        and (select array_agg(item.exam_type_id order by item.exam_type_id) from appointments_v2.exam_mix_quota_rule_items item where item.rule_id = rule.id) = array[$4]::bigint[]`,
    [policyVersionId, modalityId, date, examTypeId]
  );
}

async function latestRemovedDayAudit(userId: number, removalReason: string): Promise<{
  action_type: string;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
}> {
  const result = await pool.query<{
    action_type: string;
    old_values: Record<string, unknown>;
    new_values: Record<string, unknown>;
  }>(
    `select action_type, old_values, new_values
       from audit_log
      where entity_type = 'scheduling_policy_day'
        and changed_by_user_id = $1
        and action_type = 'modality_day_rule_removed'
        and new_values ->> 'reason' = $2
      order by id desc
      limit 1`,
    [userId, removalReason]
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0]!;
}

describe("day management mutations integration", { skip: !available ? "Database URL not set" : false }, () => {
  let reachable = false; let testDb: Awaited<ReturnType<typeof setupTestDatabase>>; let data: TestData; let app: Awaited<ReturnType<typeof createTestApp>>;
  const cookie = () => createTestAuthCookie(data.userId, "super_admin");
  const context = (date = DATE) => fetchJson<DayManagementContextDto>(app.baseUrl, `/api/v2/scheduling/admin/day-management/context?modalityId=${data.modalityId}&date=${date}&policySetKey=${data.policySetKey}`, { cookie: cookie() });
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

  it("records the complete block configuration when removing a day rule", async () => {
    if (!reachable) return;
    const date = "2036-06-11";
    const createReason = "Audit block original reason";
    const removalReason = "Audit block removal reason";
    const beforeCreate = await context(date);
    const created = await fetchJson<{ published?: { id: number } }>(app.baseUrl, "/api/v2/scheduling/admin/day-management/block-modality", {
      method: "POST", cookie: cookie(), body: { ...body(beforeCreate.data.policy.published!.id, createReason, date), isOverridable: true },
    });
    assert.equal(created.status, 201);

    const beforeRemoval = await context(date);
    const rule = beforeRemoval.data.effectiveRules.modalityBlocks.find((item) => item.ruleType === "specific_date" && item.specificDate === date);
    assert.ok(rule);
    const removed = await fetchJson<{ published?: { id: number } }>(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/block_modality/${rule.id}/remove`, {
      method: "POST", cookie: cookie(), body: body(beforeRemoval.data.policy.published!.id, removalReason, date),
    });
    assert.equal(removed.status, 200);

    const audit = await latestRemovedDayAudit(data.userId, removalReason);
    assert.equal(audit.action_type, "modality_day_rule_removed");
    assert.equal(audit.old_values.ruleId, Number(rule.id));
    assert.equal(audit.old_values.ruleType, "block_modality");
    assert.equal(audit.old_values.title, rule.title);
    assert.equal(audit.old_values.specificDate, date);
    assert.equal(audit.old_values.isOverridable, true);
    assert.equal(audit.old_values.notes, createReason);
    assert.equal(audit.new_values.modalityId, data.modalityId);
    assert.equal(typeof audit.new_values.modalityCode, "string");
    assert.equal(audit.new_values.date, date);
    assert.equal(audit.new_values.reason, removalReason);
    assert.equal(audit.new_values.previousPublishedVersionId, String(beforeRemoval.data.policy.published!.id));
    assert.equal(audit.new_values.newPublishedVersionId, String(removed.data.published!.id));
  });

  it("records the complete exam restriction configuration when removing a day rule", async () => {
    if (!reachable) return;
    const date = "2036-06-12";
    const createReason = "Audit restriction original reason";
    const removalReason = "Audit restriction removal reason";
    const beforeCreate = await context(date);
    const created = await fetchJson<{ published?: { id: number } }>(app.baseUrl, "/api/v2/scheduling/admin/day-management/exam-restriction", {
      method: "POST", cookie: cookie(), body: { ...body(beforeCreate.data.policy.published!.id, createReason, date), examTypeIds: [data.examTypeId], effectMode: "restriction_overridable" },
    });
    assert.equal(created.status, 201);

    const beforeRemoval = await context(date);
    const rule = beforeRemoval.data.effectiveRules.examTypeRestrictions.find((item) => item.ruleType === "specific_date" && item.specificDate === date);
    assert.ok(rule);
    const removed = await fetchJson<{ published?: { id: number } }>(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/restrict_exam_types/${rule.id}/remove`, {
      method: "POST", cookie: cookie(), body: body(beforeRemoval.data.policy.published!.id, removalReason, date),
    });
    assert.equal(removed.status, 200);

    const audit = await latestRemovedDayAudit(data.userId, removalReason);
    assert.equal(audit.action_type, "modality_day_rule_removed");
    assert.equal(audit.old_values.ruleId, Number(rule.id));
    assert.equal(audit.old_values.ruleType, "restrict_exam_types");
    assert.equal(audit.old_values.title, rule.title);
    assert.equal(audit.old_values.specificDate, date);
    assert.equal(audit.old_values.effectMode, "restriction_overridable");
    assert.deepEqual(audit.old_values.examTypeIds, [data.examTypeId]);
    assert.equal(audit.old_values.notes, createReason);
    assert.equal(audit.new_values.reason, removalReason);
  });

  it("records the complete exam-mix quota configuration when removing a day rule", async () => {
    if (!reachable) return;
    const date = "2036-06-13";
    const removalReason = "Audit quota removal reason";
    const beforeCreate = await context(date);
    const created = await fetchJson<{ published?: { id: number } }>(app.baseUrl, "/api/v2/scheduling/admin/day-management/exam-mix-quota", {
      method: "POST", cookie: cookie(), body: { ...body(beforeCreate.data.policy.published!.id, "Audit quota original reason", date), examTypeIds: [data.examTypeId], dailyLimit: 2 },
    });
    assert.equal(created.status, 201);

    const beforeRemoval = await context(date);
    const rule = beforeRemoval.data.effectiveRules.examMixQuotas.find((item) => item.ruleType === "specific_date" && item.specificDate === date);
    assert.ok(rule);
    const removed = await fetchJson<{ published?: { id: number } }>(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/set_exam_mix_quota/${rule.id}/remove`, {
      method: "POST", cookie: cookie(), body: body(beforeRemoval.data.policy.published!.id, removalReason, date),
    });
    assert.equal(removed.status, 200);

    const audit = await latestRemovedDayAudit(data.userId, removalReason);
    assert.equal(audit.action_type, "modality_day_rule_removed");
    assert.equal(audit.old_values.ruleId, Number(rule.id));
    assert.equal(audit.old_values.ruleType, "set_exam_mix_quota");
    assert.equal(audit.old_values.title, rule.title);
    assert.equal(audit.old_values.specificDate, date);
    assert.equal(audit.old_values.dailyLimit, 2);
    assert.deepEqual(audit.old_values.examTypeIds, [data.examTypeId]);
    assert.equal(Object.prototype.hasOwnProperty.call(audit.old_values, "notes"), false);
    assert.equal(audit.new_values.reason, removalReason);
  });

  it("requires Action PIN before creating a Manage Day policy change", async () => {
    if (!reachable) return;
    const reason = "Action PIN create challenge 2035";
    const before = await policySafetyState(data, ACTION_PIN_CREATE_DATE, reason);
    const restore = await setActionPinPolicyForTest(enabledActionPinPolicy(), data.userId);
    try {
      const rejected = await fetchJson<{ error?: string; actionKey?: string; requiresReason?: boolean }>(app.baseUrl, "/api/v2/scheduling/admin/day-management/block-modality", {
        method: "POST", cookie: cookie(), body: { ...body(before.publishedVersionId, reason, ACTION_PIN_CREATE_DATE), isOverridable: false },
      });
      assert.equal(rejected.status, 403);
      assert.equal(rejected.data.error, "action_pin_required");
      assert.equal(rejected.data.actionKey, "scheduling_day_policy_change");
      assert.equal(rejected.data.requiresReason, false);

      const after = await policySafetyState(data, ACTION_PIN_CREATE_DATE, reason);
      assert.equal(after.publishedVersionId, before.publishedVersionId);
      assert.equal(after.publishedConfigHash, before.publishedConfigHash);
      assert.equal(after.totalVersionCount, before.totalVersionCount);
      assert.equal(after.draftCount, 0);
      assert.equal(after.matchingDayRuleCount, 0);
      assert.equal(after.matchingAuditCount, 0);
    } finally {
      await restore();
    }
  });

  it("requires Action PIN before removing a Manage Day rule", async () => {
    if (!reachable) return;
    const createReason = "Action PIN removal setup 2035";
    const removalReason = "Action PIN removal challenge 2035";
    let ruleId = 0;
    let cleanupComplete = false;
    try {
      const beforeCreate = await policySafetyState(data, ACTION_PIN_REMOVE_DATE, createReason);
      const created = await fetchJson<{ published?: { id: number } }>(app.baseUrl, "/api/v2/scheduling/admin/day-management/block-modality", {
        method: "POST", cookie: cookie(), body: { ...body(beforeCreate.publishedVersionId, createReason, ACTION_PIN_REMOVE_DATE), isOverridable: false },
      });
      assert.equal(created.status, 201);
      const afterCreate = await context(ACTION_PIN_REMOVE_DATE);
      const createdRule = afterCreate.data.effectiveRules.modalityBlocks.find((rule) => rule.ruleType === "specific_date" && rule.specificDate === ACTION_PIN_REMOVE_DATE);
      assert.ok(createdRule);
      ruleId = Number(createdRule.id);

      const beforeRemoval = await policySafetyState(data, ACTION_PIN_REMOVE_DATE, removalReason);
      const restore = await setActionPinPolicyForTest(enabledActionPinPolicy(), data.userId);
      try {
        const rejected = await fetchJson<{ error?: string; actionKey?: string; requiresReason?: boolean }>(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/block_modality/${ruleId}/remove`, {
          method: "POST", cookie: cookie(), body: body(beforeRemoval.publishedVersionId, removalReason, ACTION_PIN_REMOVE_DATE),
        });
        assert.equal(rejected.status, 403);
        assert.equal(rejected.data.error, "action_pin_required");
        assert.equal(rejected.data.actionKey, "scheduling_day_policy_change");
        assert.equal(rejected.data.requiresReason, false);

        const afterRemoval = await policySafetyState(data, ACTION_PIN_REMOVE_DATE, removalReason);
        assert.equal(afterRemoval.publishedVersionId, beforeRemoval.publishedVersionId);
        assert.equal(afterRemoval.publishedConfigHash, beforeRemoval.publishedConfigHash);
        assert.equal(afterRemoval.totalVersionCount, beforeRemoval.totalVersionCount);
        assert.equal(afterRemoval.draftCount, 0);
        assert.equal(afterRemoval.matchingDayRuleCount, 1);
        assert.equal(afterRemoval.matchingAuditCount, 0);
      } finally {
        await restore();
      }

      const cleanupState = await policySafetyState(data, ACTION_PIN_REMOVE_DATE, "Action PIN removal cleanup 2035");
      const cleanup = await fetchJson(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/block_modality/${ruleId}/remove`, {
        method: "POST", cookie: cookie(), body: body(cleanupState.publishedVersionId, "Action PIN removal cleanup 2035", ACTION_PIN_REMOVE_DATE),
      });
      assert.equal(cleanup.status, 200);
      cleanupComplete = true;
    } finally {
      if (ruleId > 0 && !cleanupComplete) {
        const cleanupState = await policySafetyState(data, ACTION_PIN_REMOVE_DATE, "Action PIN removal cleanup fallback 2035");
        await fetchJson(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/block_modality/${ruleId}/remove`, {
          method: "POST", cookie: cookie(), body: body(cleanupState.publishedVersionId, "Action PIN removal cleanup fallback 2035", ACTION_PIN_REMOVE_DATE),
        });
      }
    }
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

  it("normal policy draft creation waits on the policy-set row lock", async () => {
    if (!reachable) return;
    const before = await policySafetyState(data, DATE, "Policy-set lock concurrency test");
    assert.equal(before.draftCount, 0);
    const publishedVersionId = before.publishedVersionId;
    const client = await pool.connect();
    let transactionOpen = false;
    let requestPromise: Promise<{ status: number; data: DraftResponse }> | undefined;
    let requestResult: { status: number; data: DraftResponse } | undefined;
    try {
      await client.query("begin");
      transactionOpen = true;
      await client.query(
        "select id from appointments_v2.policy_sets where id = $1 for update",
        [data.policySetId]
      );

      requestPromise = fetchJson<DraftResponse>(app.baseUrl, "/api/v2/scheduling/admin/policy/draft", {
        method: "POST", cookie: cookie(), body: { policySetKey: data.policySetKey, changeNote: "Policy-set lock concurrency test" },
      });
      const earlyResult = await Promise.race([
        requestPromise.then(() => "settled"),
        new Promise<"still_waiting">((resolve) => setTimeout(() => resolve("still_waiting"), 100)),
      ]);
      assert.equal(earlyResult, "still_waiting");

      await client.query("commit");
      transactionOpen = false;
      requestResult = await requestPromise;
      assert.equal(requestResult.status, 201);
      assert.equal(requestResult.data.draft?.status, "draft");
      assert.equal(Number(requestResult.data.basedOnVersionId), publishedVersionId);

      const draftVersionId = Number(requestResult.data.draft?.id);
      assert.ok(draftVersionId > 0);
      const [drafts, published, duplicateVersionNumbers] = await Promise.all([
        pool.query<{ id: number }>("select id from appointments_v2.policy_versions where policy_set_id = $1 and status = 'draft'", [data.policySetId]),
        pool.query<{ count: number }>("select count(*)::int as count from appointments_v2.policy_versions where policy_set_id = $1 and status = 'published'", [data.policySetId]),
        pool.query("select version_no from appointments_v2.policy_versions where policy_set_id = $1 group by version_no having count(*) > 1", [data.policySetId]),
      ]);
      assert.equal(drafts.rows.length, 1);
      assert.equal(Number(drafts.rows[0]?.id), draftVersionId);
      assert.equal(published.rows[0]?.count, 1);
      assert.equal(duplicateVersionNumbers.rows.length, 0);
    } finally {
      if (transactionOpen) await client.query("rollback").catch(() => undefined);
      client.release();
      if (!requestResult && requestPromise) requestResult = await requestPromise.catch(() => undefined);
      const draftVersionId = Number(requestResult?.data.draft?.id);
      if (draftVersionId > 0) await cleanupCreatedDraft(draftVersionId);
    }
  });

  it("concurrent normal policy draft creation yields one draft and one conflict", async () => {
    if (!reachable) return;
    const before = await policySafetyState(data, DATE, "Concurrent normal policy draft test");
    assert.equal(before.draftCount, 0);
    const request = () => fetchJson<DraftResponse & ErrorResponse>(app.baseUrl, "/api/v2/scheduling/admin/policy/draft", {
      method: "POST", cookie: cookie(), body: { policySetKey: data.policySetKey, changeNote: "Concurrent normal policy draft test" },
    });
    let capturedReasonCodes: string[] = [];
    let results: Array<{ status: number; data: DraftResponse & ErrorResponse }> = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      const error = args.find((value) => value && typeof value === "object" && Array.isArray((value as { reasonCodes?: unknown }).reasonCodes)) as { reasonCodes?: unknown } | undefined;
      if (error) capturedReasonCodes = (error.reasonCodes as unknown[]).filter((code): code is string => typeof code === "string");
      originalError(...args);
    };
    try {
      results = await Promise.all([request(), request()]);
      const created = results.find((result) => result.status === 201);
      const conflict = results.find((result) => result.status === 409);
      assert.equal(results.filter((result) => result.status === 201).length, 1);
      assert.equal(results.filter((result) => result.status === 409).length, 1);
      assert.ok((conflict?.data.error?.reasonCodes ?? capturedReasonCodes).includes("draft_already_exists"));

      const draftVersionId = Number(created?.data.draft?.id);
      assert.ok(draftVersionId > 0);
      const [drafts, published, duplicateVersionNumbers] = await Promise.all([
        pool.query<{ id: number }>("select id from appointments_v2.policy_versions where policy_set_id = $1 and status = 'draft'", [data.policySetId]),
        pool.query<{ count: number }>("select count(*)::int as count from appointments_v2.policy_versions where policy_set_id = $1 and status = 'published'", [data.policySetId]),
        pool.query("select version_no from appointments_v2.policy_versions where policy_set_id = $1 group by version_no having count(*) > 1", [data.policySetId]),
      ]);
      assert.equal(drafts.rows.length, 1);
      assert.equal(Number(drafts.rows[0]?.id), draftVersionId);
      assert.equal(published.rows[0]?.count, 1);
      assert.equal(duplicateVersionNumbers.rows.length, 0);
    } finally {
      console.error = originalError;
      const draftVersionId = Number(results.find((result) => result.status === 201)?.data.draft?.id);
      if (draftVersionId > 0) await cleanupCreatedDraft(draftVersionId);
    }
  });

  it("rolls back Manage Day creation when audit trail is disabled", async () => {
    if (!reachable) return;
    const reason = "Audit-disabled creation rollback 2033";
    const restoreAuditEnabled = await setAuditTrailForTest("enabled", data.userId);
    try {
      const before = await policySafetyState(data, AUDIT_CREATE_DATE, reason);
      assert.equal(before.draftCount, 0);
      const restoreAuditDisabled = await setAuditTrailForTest("disabled", data.userId);
      try {
        const rejected = await fetchWithReasonCodes(app, "/api/v2/scheduling/admin/day-management/block-modality", {
          method: "POST", cookie: cookie(), body: { ...body(before.publishedVersionId, reason, AUDIT_CREATE_DATE), isOverridable: false },
        });
        assert.equal(rejected.status, 503);
        assert.ok(rejected.reasonCodes.includes("day_management_audit_required"));

        const after = await policySafetyState(data, AUDIT_CREATE_DATE, reason);
        assert.equal(after.publishedVersionId, before.publishedVersionId);
        assert.equal(after.publishedConfigHash, before.publishedConfigHash);
        assert.equal(after.totalVersionCount, before.totalVersionCount);
        assert.equal(after.draftCount, before.draftCount);
        assert.equal(after.matchingDayRuleCount, before.matchingDayRuleCount);
        assert.equal(after.matchingAuditCount, before.matchingAuditCount);
        const previousPublished = await pool.query<{ status: string }>("select status from appointments_v2.policy_versions where id = $1", [before.publishedVersionId]);
        assert.equal(previousPublished.rows[0]?.status, "published");
      } finally {
        await restoreAuditDisabled();
      }
    } finally {
      await restoreAuditEnabled();
    }
  });

  it("rolls back Manage Day rule removal when audit trail is disabled", async () => {
    if (!reachable) return;
    const createReason = "Audit-disabled removal setup 2033";
    const removalReason = "Audit-disabled removal rollback 2033";
    const restoreAuditEnabled = await setAuditTrailForTest("enabled", data.userId);
    let ruleId: number | null = null;
    let cleanupComplete = false;
    try {
      const beforeCreate = await context();
      const created = await fetchJson<{ published?: { id: number } }>(app.baseUrl, "/api/v2/scheduling/admin/day-management/block-modality", {
        method: "POST", cookie: cookie(), body: { ...body(beforeCreate.data.policy.published!.id, createReason, AUDIT_REMOVE_DATE), isOverridable: false },
      });
      assert.equal(created.status, 201);
      const afterCreate = await context(AUDIT_REMOVE_DATE);
      const createdRule = afterCreate.data.effectiveRules.modalityBlocks.find((item) => item.ruleType === "specific_date" && item.specificDate === AUDIT_REMOVE_DATE);
      assert.ok(createdRule);
      ruleId = Number(createdRule!.id);
      assert.ok(ruleId > 0);

      const beforeRemoval = await policySafetyState(data, AUDIT_REMOVE_DATE, removalReason);
      const restoreAuditDisabled = await setAuditTrailForTest("disabled", data.userId);
      try {
        const rejected = await fetchWithReasonCodes(app, `/api/v2/scheduling/admin/day-management/rules/block_modality/${ruleId}/remove`, {
          method: "POST", cookie: cookie(), body: body(beforeRemoval.publishedVersionId, removalReason, AUDIT_REMOVE_DATE),
        });
        assert.equal(rejected.status, 503);
        assert.ok(rejected.reasonCodes.includes("day_management_audit_required"));

        const afterRemoval = await policySafetyState(data, AUDIT_REMOVE_DATE, removalReason);
        assert.equal(afterRemoval.publishedVersionId, beforeRemoval.publishedVersionId);
        assert.equal(afterRemoval.publishedConfigHash, beforeRemoval.publishedConfigHash);
        assert.equal(afterRemoval.totalVersionCount, beforeRemoval.totalVersionCount);
        assert.equal(afterRemoval.draftCount, beforeRemoval.draftCount);
        assert.equal(afterRemoval.matchingDayRuleCount, beforeRemoval.matchingDayRuleCount);
        assert.equal(afterRemoval.matchingAuditCount, beforeRemoval.matchingAuditCount);
        const originalRule = await pool.query<{ id: number }>(
          "select id from appointments_v2.modality_blocked_rules where id = $1 and policy_version_id = $2 and is_active = true",
          [ruleId, beforeRemoval.publishedVersionId]
        );
        assert.equal(originalRule.rows.length, 1);
      } finally {
        await restoreAuditDisabled();
      }

      const cleanupContext = await context(AUDIT_REMOVE_DATE);
      const cleanup = await fetchJson(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/block_modality/${ruleId}/remove`, {
        method: "POST", cookie: cookie(), body: body(cleanupContext.data.policy.published!.id, "Audit-disabled removal cleanup 2033", AUDIT_REMOVE_DATE),
      });
      assert.equal(cleanup.status, 200);
      cleanupComplete = true;
    } finally {
      try {
        if (ruleId && !cleanupComplete) {
          const cleanupContext = await context(AUDIT_REMOVE_DATE);
          const cleanup = await fetchJson(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/block_modality/${ruleId}/remove`, {
            method: "POST", cookie: cookie(), body: body(cleanupContext.data.policy.published!.id, "Audit-disabled removal cleanup 2033", AUDIT_REMOVE_DATE),
          });
          assert.equal(cleanup.status, 200);
        }
      } finally {
        await restoreAuditEnabled();
      }
    }
  });

  it("rejects an identical same-scope specific-date exam restriction without residue", async () => {
    if (!reachable) return;
    const createReason = "Restriction duplicate setup 2034";
    const rejectedReason = "Restriction duplicate rejection 2034";
    let ruleId = 0;
    let cleanupComplete = false;
    try {
      const beforeCreate = await policySafetyState(data, RESTRICTION_DUPLICATE_DATE, createReason);
      const created = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/exam-restriction", {
        method: "POST", cookie: cookie(), body: { ...body(beforeCreate.publishedVersionId, createReason, RESTRICTION_DUPLICATE_DATE), examTypeIds: [data.examTypeId], effectMode: "hard_restriction" },
      });
      assert.equal(created.status, 201);
      const beforeRejected = await policySafetyState(data, RESTRICTION_DUPLICATE_DATE, rejectedReason);
      const beforeRules = await matchingSpecificDateRestrictions(beforeRejected.publishedVersionId, data.modalityId, RESTRICTION_DUPLICATE_DATE, data.examTypeId);
      assert.equal(beforeRules.rows.length, 1);
      ruleId = Number(beforeRules.rows[0]?.id);

      const rejected = await fetchWithReasonCodes(app, "/api/v2/scheduling/admin/day-management/exam-restriction", {
        method: "POST", cookie: cookie(), body: { ...body(beforeRejected.publishedVersionId, rejectedReason, RESTRICTION_DUPLICATE_DATE), examTypeIds: [data.examTypeId], effectMode: "hard_restriction" },
      });
      assert.equal(rejected.status, 409);
      assert.ok(rejected.reasonCodes.includes("day_management_rule_already_exists"));

      const afterRejected = await policySafetyState(data, RESTRICTION_DUPLICATE_DATE, rejectedReason);
      const afterRules = await matchingSpecificDateRestrictions(afterRejected.publishedVersionId, data.modalityId, RESTRICTION_DUPLICATE_DATE, data.examTypeId);
      assert.equal(afterRejected.publishedVersionId, beforeRejected.publishedVersionId);
      assert.equal(afterRejected.publishedConfigHash, beforeRejected.publishedConfigHash);
      assert.equal(afterRejected.totalVersionCount, beforeRejected.totalVersionCount);
      assert.equal(afterRejected.matchingAuditCount, beforeRejected.matchingAuditCount);
      assert.equal(afterRules.rows.length, 1);
    } finally {
      if (ruleId > 0 && !cleanupComplete) {
        const cleanupState = await policySafetyState(data, RESTRICTION_DUPLICATE_DATE, "Restriction duplicate cleanup 2034");
        const cleanup = await fetchJson(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/restrict_exam_types/${ruleId}/remove`, {
          method: "POST", cookie: cookie(), body: body(cleanupState.publishedVersionId, "Restriction duplicate cleanup 2034", RESTRICTION_DUPLICATE_DATE),
        });
        assert.equal(cleanup.status, 200);
        cleanupComplete = true;
      }
    }
  });

  it("rejects a different-mode same-scope specific-date exam restriction without residue", async () => {
    if (!reachable) return;
    const createReason = "Restriction scope setup 2034";
    const rejectedReason = "Restriction scope rejection 2034";
    let ruleId = 0;
    try {
      const beforeCreate = await policySafetyState(data, RESTRICTION_SCOPE_CONFLICT_DATE, createReason);
      const created = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/exam-restriction", {
        method: "POST", cookie: cookie(), body: { ...body(beforeCreate.publishedVersionId, createReason, RESTRICTION_SCOPE_CONFLICT_DATE), examTypeIds: [data.examTypeId], effectMode: "hard_restriction" },
      });
      assert.equal(created.status, 201);
      const beforeRejected = await policySafetyState(data, RESTRICTION_SCOPE_CONFLICT_DATE, rejectedReason);
      const beforeRules = await matchingSpecificDateRestrictions(beforeRejected.publishedVersionId, data.modalityId, RESTRICTION_SCOPE_CONFLICT_DATE, data.examTypeId);
      assert.equal(beforeRules.rows.length, 1);
      assert.equal(beforeRules.rows[0]?.effectMode, "hard_restriction");
      ruleId = Number(beforeRules.rows[0]?.id);

      const rejected = await fetchWithReasonCodes(app, "/api/v2/scheduling/admin/day-management/exam-restriction", {
        method: "POST", cookie: cookie(), body: { ...body(beforeRejected.publishedVersionId, rejectedReason, RESTRICTION_SCOPE_CONFLICT_DATE), examTypeIds: [data.examTypeId], effectMode: "restriction_overridable" },
      });
      assert.equal(rejected.status, 409);
      assert.ok(rejected.reasonCodes.includes("day_management_rule_scope_conflict"));

      const afterRejected = await policySafetyState(data, RESTRICTION_SCOPE_CONFLICT_DATE, rejectedReason);
      const afterRules = await matchingSpecificDateRestrictions(afterRejected.publishedVersionId, data.modalityId, RESTRICTION_SCOPE_CONFLICT_DATE, data.examTypeId);
      assert.equal(afterRejected.publishedVersionId, beforeRejected.publishedVersionId);
      assert.equal(afterRejected.publishedConfigHash, beforeRejected.publishedConfigHash);
      assert.equal(afterRejected.totalVersionCount, beforeRejected.totalVersionCount);
      assert.equal(afterRejected.matchingAuditCount, beforeRejected.matchingAuditCount);
      assert.equal(afterRules.rows.length, 1);
      assert.equal(afterRules.rows[0]?.effectMode, "hard_restriction");
    } finally {
      if (ruleId > 0) {
        const cleanupState = await policySafetyState(data, RESTRICTION_SCOPE_CONFLICT_DATE, "Restriction scope cleanup 2034");
        const cleanup = await fetchJson(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/restrict_exam_types/${ruleId}/remove`, {
          method: "POST", cookie: cookie(), body: body(cleanupState.publishedVersionId, "Restriction scope cleanup 2034", RESTRICTION_SCOPE_CONFLICT_DATE),
        });
        assert.equal(cleanup.status, 200);
      }
    }
  });

  it("rejects an identical same-scope specific-date exam-mix quota without residue", async () => {
    if (!reachable) return;
    const createReason = "Quota duplicate setup 2034";
    const rejectedReason = "Quota duplicate rejection 2034";
    let ruleId = 0;
    try {
      const beforeCreate = await policySafetyState(data, QUOTA_DUPLICATE_DATE, createReason);
      const created = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/exam-mix-quota", {
        method: "POST", cookie: cookie(), body: { ...body(beforeCreate.publishedVersionId, createReason, QUOTA_DUPLICATE_DATE), examTypeIds: [data.examTypeId], dailyLimit: 2 },
      });
      assert.equal(created.status, 201);
      const beforeRejected = await policySafetyState(data, QUOTA_DUPLICATE_DATE, rejectedReason);
      const beforeRules = await matchingSpecificDateExamMixQuotas(beforeRejected.publishedVersionId, data.modalityId, QUOTA_DUPLICATE_DATE, data.examTypeId);
      assert.equal(beforeRules.rows.length, 1);
      ruleId = Number(beforeRules.rows[0]?.id);

      const rejected = await fetchWithReasonCodes(app, "/api/v2/scheduling/admin/day-management/exam-mix-quota", {
        method: "POST", cookie: cookie(), body: { ...body(beforeRejected.publishedVersionId, rejectedReason, QUOTA_DUPLICATE_DATE), examTypeIds: [data.examTypeId], dailyLimit: 2 },
      });
      assert.equal(rejected.status, 409);
      assert.ok(rejected.reasonCodes.includes("day_management_rule_already_exists"));

      const afterRejected = await policySafetyState(data, QUOTA_DUPLICATE_DATE, rejectedReason);
      const afterRules = await matchingSpecificDateExamMixQuotas(afterRejected.publishedVersionId, data.modalityId, QUOTA_DUPLICATE_DATE, data.examTypeId);
      assert.equal(afterRejected.publishedVersionId, beforeRejected.publishedVersionId);
      assert.equal(afterRejected.publishedConfigHash, beforeRejected.publishedConfigHash);
      assert.equal(afterRejected.totalVersionCount, beforeRejected.totalVersionCount);
      assert.equal(afterRejected.matchingAuditCount, beforeRejected.matchingAuditCount);
      assert.equal(afterRules.rows.length, 1);
    } finally {
      if (ruleId > 0) {
        const cleanupState = await policySafetyState(data, QUOTA_DUPLICATE_DATE, "Quota duplicate cleanup 2034");
        const cleanup = await fetchJson(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/set_exam_mix_quota/${ruleId}/remove`, {
          method: "POST", cookie: cookie(), body: body(cleanupState.publishedVersionId, "Quota duplicate cleanup 2034", QUOTA_DUPLICATE_DATE),
        });
        assert.equal(cleanup.status, 200);
      }
    }
  });

  it("rejects a different-limit same-scope specific-date exam-mix quota without residue", async () => {
    if (!reachable) return;
    const createReason = "Quota scope setup 2034";
    const rejectedReason = "Quota scope rejection 2034";
    let ruleId = 0;
    try {
      const beforeCreate = await policySafetyState(data, QUOTA_SCOPE_CONFLICT_DATE, createReason);
      const created = await fetchJson(app.baseUrl, "/api/v2/scheduling/admin/day-management/exam-mix-quota", {
        method: "POST", cookie: cookie(), body: { ...body(beforeCreate.publishedVersionId, createReason, QUOTA_SCOPE_CONFLICT_DATE), examTypeIds: [data.examTypeId], dailyLimit: 2 },
      });
      assert.equal(created.status, 201);
      const beforeRejected = await policySafetyState(data, QUOTA_SCOPE_CONFLICT_DATE, rejectedReason);
      const beforeRules = await matchingSpecificDateExamMixQuotas(beforeRejected.publishedVersionId, data.modalityId, QUOTA_SCOPE_CONFLICT_DATE, data.examTypeId);
      assert.equal(beforeRules.rows.length, 1);
      assert.equal(Number(beforeRules.rows[0]?.dailyLimit), 2);
      ruleId = Number(beforeRules.rows[0]?.id);

      const rejected = await fetchWithReasonCodes(app, "/api/v2/scheduling/admin/day-management/exam-mix-quota", {
        method: "POST", cookie: cookie(), body: { ...body(beforeRejected.publishedVersionId, rejectedReason, QUOTA_SCOPE_CONFLICT_DATE), examTypeIds: [data.examTypeId], dailyLimit: 3 },
      });
      assert.equal(rejected.status, 409);
      assert.ok(rejected.reasonCodes.includes("day_management_rule_scope_conflict"));

      const afterRejected = await policySafetyState(data, QUOTA_SCOPE_CONFLICT_DATE, rejectedReason);
      const afterRules = await matchingSpecificDateExamMixQuotas(afterRejected.publishedVersionId, data.modalityId, QUOTA_SCOPE_CONFLICT_DATE, data.examTypeId);
      assert.equal(afterRejected.publishedVersionId, beforeRejected.publishedVersionId);
      assert.equal(afterRejected.publishedConfigHash, beforeRejected.publishedConfigHash);
      assert.equal(afterRejected.totalVersionCount, beforeRejected.totalVersionCount);
      assert.equal(afterRejected.matchingAuditCount, beforeRejected.matchingAuditCount);
      assert.equal(afterRules.rows.length, 1);
      assert.equal(Number(afterRules.rows[0]?.dailyLimit), 2);
    } finally {
      if (ruleId > 0) {
        const cleanupState = await policySafetyState(data, QUOTA_SCOPE_CONFLICT_DATE, "Quota scope cleanup 2034");
        const cleanup = await fetchJson(app.baseUrl, `/api/v2/scheduling/admin/day-management/rules/set_exam_mix_quota/${ruleId}/remove`, {
          method: "POST", cookie: cookie(), body: body(cleanupState.publishedVersionId, "Quota scope cleanup 2034", QUOTA_SCOPE_CONFLICT_DATE),
        });
        assert.equal(cleanup.status, 200);
      }
    }
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
