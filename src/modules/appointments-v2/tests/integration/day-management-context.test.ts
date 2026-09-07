import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../../db/pool.js";
import type { DayManagementContextDto } from "../../api/dto/admin-scheduling.dto.js";
import {
  canReachDatabase,
  createTestApp,
  createTestAuthCookie,
  fetchJson,
  isDatabaseAvailable,
  seedTestData,
  setupTestDatabase,
  type TestData,
} from "./helpers.js";

const TEST_PREFIX = "DAY_MANAGEMENT_";
const TEST_DATE = "2026-05-20";
const runTests = isDatabaseAvailable();

describe("Day management context integration", { skip: !runTests ? "Database URL not set" : false }, () => {
  let dbReachable = false;
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;

  before(async () => {
    dbReachable = await canReachDatabase();
    if (!dbReachable) return;
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);

    const blocked = await pool.query<{ id: number }>(
      `insert into appointments_v2.modality_blocked_rules
       (policy_version_id, modality_id, rule_type, specific_date, is_overridable, is_active, title, notes)
       values ($1, $2, 'specific_date', $3, false, true, 'Published maintenance', 'Published day rule')
       returning id`,
      [testData.policyVersionId, testData.modalityId, TEST_DATE]
    );
    await pool.query(
      `insert into appointments_v2.modality_blocked_rules
       (policy_version_id, modality_id, rule_type, specific_date, is_overridable, is_active, title)
       values ($1, $2, 'specific_date', '2026-05-21', false, true, 'Unrelated date rule')`,
      [testData.policyVersionId, testData.modalityId]
    );
    const restriction = await pool.query<{ id: number }>(
      `insert into appointments_v2.exam_type_rules
       (policy_version_id, modality_id, rule_type, effect_mode, specific_date, alternate_weeks, is_active, title)
       values ($1, $2, 'specific_date', 'hard_restriction', $3, false, true, 'Published exam restriction')
       returning id`,
      [testData.policyVersionId, testData.modalityId, TEST_DATE]
    );
    await pool.query(
      `insert into appointments_v2.exam_type_rule_items (rule_id, exam_type_id) values ($1, $2)`,
      [restriction.rows[0]!.id, testData.examTypeId]
    );
    const quota = await pool.query<{ id: number }>(
      `insert into appointments_v2.exam_mix_quota_rules
       (policy_version_id, modality_id, rule_type, specific_date, alternate_weeks, daily_limit, is_active, title)
       values ($1, $2, 'specific_date', $3, false, 2, true, 'Published exam-mix quota')
       returning id`,
      [testData.policyVersionId, testData.modalityId, TEST_DATE]
    );
    await pool.query(
      `insert into appointments_v2.exam_mix_quota_rule_items (rule_id, exam_type_id) values ($1, $2)`,
      [quota.rows[0]!.id, testData.examTypeId]
    );
    const draft = await pool.query<{ id: number }>(
      `insert into appointments_v2.policy_versions
       (policy_set_id, version_no, status, config_hash, created_by_user_id)
       values ($1, 2, 'draft', 'day_management_draft', $2)
       returning id`,
      [testData.policySetId, testData.userId]
    );
    await pool.query(
      `insert into appointments_v2.modality_blocked_rules
       (policy_version_id, modality_id, rule_type, specific_date, is_overridable, is_active, title)
       values ($1, $2, 'specific_date', $3, false, true, 'Draft-only block')`,
      [draft.rows[0]!.id, testData.modalityId, TEST_DATE]
    );
    assert.ok(blocked.rows[0]?.id);
    app = await createTestApp();
  });

  after(async () => {
    if (!dbReachable) return;
    await app.close();
    await testDb.cleanup();
  });

  it("returns published day rules and draft metadata without evaluating draft rules", async () => {
    if (!dbReachable) return;
    const { status, data } = await fetchJson<DayManagementContextDto>(
      app.baseUrl,
      `/api/v2/scheduling/admin/day-management/context?modalityId=${testData.modalityId}&date=${TEST_DATE}&policySetKey=${testData.policySetKey}`,
      { cookie: createTestAuthCookie(testData.userId, "super_admin") }
    );

    assert.equal(status, 200);
    assert.equal(data.date, TEST_DATE);
    assert.equal(data.modality.id, testData.modalityId);
    assert.equal(typeof data.bookingSummary.bookedTotal, "number");
    assert.equal(data.effectiveRules.modalityBlocks.length, 1);
    assert.equal(data.effectiveRules.modalityBlocks[0].title, "Published maintenance");
    const restriction = data.effectiveRules.examTypeRestrictions[0]!;
    assert.equal(restriction.title, "Published exam restriction");
    assert.equal(restriction.examTypes[0]!.id, testData.examTypeId);
    assert.ok(restriction.examTypes[0]!.nameEn?.includes("CT Head"));
    assert.equal(data.effectiveRules.examMixQuotas[0].dailyLimit, 2);
    assert.equal(data.globalConstraints.categoryDailyLimits[0].dailyLimit, 5);
    assert.ok(data.policy.draft);
    assert.equal(data.policy.draft.versionNo, 2);
    assert.equal(data.effectiveRules.modalityBlocks.some((rule) => rule.title === "Draft-only block"), false);
    assert.deepEqual(data.supportedDayRuleTypes, ["block_modality", "restrict_exam_types", "set_exam_mix_quota"]);
  });

  it("requires the super_admin role", async () => {
    if (!dbReachable) return;
    const { status } = await fetchJson(
      app.baseUrl,
      `/api/v2/scheduling/admin/day-management/context?modalityId=${testData.modalityId}&date=${TEST_DATE}&policySetKey=${testData.policySetKey}`,
      { cookie: createTestAuthCookie(testData.userId, "supervisor") }
    );
    assert.equal(status, 403);
  });

  it("rejects an invalid date", async () => {
    if (!dbReachable) return;
    const { status } = await fetchJson(
      app.baseUrl,
      `/api/v2/scheduling/admin/day-management/context?modalityId=${testData.modalityId}&date=2026-02-31&policySetKey=${testData.policySetKey}`,
      { cookie: createTestAuthCookie(testData.userId, "super_admin") }
    );
    assert.equal(status, 400);
  });
});
