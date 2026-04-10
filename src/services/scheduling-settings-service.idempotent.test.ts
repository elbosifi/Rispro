import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import {
  getSchedulingEngineConfiguration,
  saveSchedulingEngineConfiguration
} from "./scheduling-settings-service.js";

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

interface FixtureContext {
  adminUserId: number;
  modalityId: number;
  examTypeId: number;
  examTypeId2: number;
  blockedRuleId: number;
  examRuleId: number;
  cleanup: () => Promise<void>;
}

async function createFixture(): Promise<FixtureContext> {
  const suffix = uniqueSuffix();
  const adminHash = bcrypt.hashSync("admin-pass", 10);

  const admin = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [`sched_admin_${suffix}`, `Scheduling Admin ${suffix}`, adminHash]
  );
  const adminUserId = Number(admin.rows[0]?.id);

  const modality = await pool.query<{ id: number }>(
    `
      insert into modalities (code, name_ar, name_en, daily_capacity, is_active)
      values ($1, $2, $3, 10, true)
      returning id
    `,
    [`SCHED${suffix.slice(-6)}`, `جدولة ${suffix}`, `Scheduling Modality ${suffix}`]
  );
  const modalityId = Number(modality.rows[0]?.id);

  const examType1 = await pool.query<{ id: number }>(
    `
      insert into exam_types (modality_id, name_ar, name_en, is_active)
      values ($1, $2, $3, true)
      returning id
    `,
    [modalityId, `فحص 1 ${suffix}`, `Exam 1 ${suffix}`]
  );
  const examTypeId = Number(examType1.rows[0]?.id);

  const examType2 = await pool.query<{ id: number }>(
    `
      insert into exam_types (modality_id, name_ar, name_en, is_active)
      values ($1, $2, $3, true)
      returning id
    `,
    [modalityId, `فحص 2 ${suffix}`, `Exam 2 ${suffix}`]
  );
  const examTypeId2 = Number(examType2.rows[0]?.id);

  // Create an initial blocked rule
  const blockedRule = await pool.query<{ id: number }>(
    `
      insert into modality_blocked_rules (modality_id, rule_type, specific_date, is_overridable, is_active, title, created_by_user_id, updated_by_user_id)
      values ($1, 'specific_date', '2030-01-01', false, true, 'Initial Block', $2, $2)
      returning id
    `,
    [modalityId, adminUserId]
  );
  const blockedRuleId = Number(blockedRule.rows[0]?.id);

  // Create an initial exam rule
  const examRule = await pool.query<{ id: number }>(
    `
      insert into exam_type_schedule_rules (modality_id, rule_type, effect_mode, start_date, end_date, weekday, alternate_weeks, recurrence_anchor_date, title, is_active, created_by_user_id, updated_by_user_id)
      values ($1, 'weekly_recurrence', 'restriction_overridable', '2026-01-01', '2026-12-31', 1, false, null, 'Initial Exam Rule', true, $2, $2)
      returning id
    `,
    [modalityId, adminUserId]
  );
  const examRuleId = Number(examRule.rows[0]?.id);

  await pool.query(
    `insert into exam_type_schedule_rule_items (rule_id, exam_type_id) values ($1, $2)`,
    [examRuleId, examTypeId]
  );

  const cleanup = async () => {
    await pool.query(`delete from exam_type_schedule_rule_items where rule_id in (select id from exam_type_schedule_rules where modality_id = $1)`, [modalityId]);
    await pool.query(`delete from exam_type_schedule_rules where modality_id = $1`, [modalityId]);
    await pool.query(`delete from modality_blocked_rules where modality_id = $1`, [modalityId]);
    await pool.query(`delete from modality_category_daily_limits where modality_id = $1`, [modalityId]);
    await pool.query(`delete from exam_type_special_quotas where exam_type_id = any($1::bigint[])`, [[examTypeId, examTypeId2]]);
    await pool.query(`delete from exam_types where id = any($1::bigint[])`, [[examTypeId, examTypeId2]]);
    await pool.query(`delete from modalities where id = $1`, [modalityId]);
    await pool.query(`delete from special_reason_codes where code like 'TEST_%'`);
    await pool.query(`delete from users where id = $1`, [adminUserId]);
  };

  return { adminUserId, modalityId, examTypeId, examTypeId2, blockedRuleId, examRuleId, cleanup };
}

async function ensureDbOrSkip(t: { skip: (message?: string) => void }): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test: saving unchanged config preserves rule IDs
// ---------------------------------------------------------------------------
test("saveSchedulingEngineConfiguration: preserves blocked rule IDs on re-save", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    // Fetch current config
    const config = await getSchedulingEngineConfiguration();
    const blockedRules = config.blockedRules as Array<{ id: number; modality_id: number }>;
    const existingRule = blockedRules.find((r) => r.id === fx.blockedRuleId);
    assert.ok(existingRule, "Blocked rule should exist before re-save");

    // Re-save the exact same config
    await saveSchedulingEngineConfiguration(config, fx.adminUserId);

    // Re-fetch and verify ID is preserved
    const config2 = await getSchedulingEngineConfiguration();
    const blockedRules2 = config2.blockedRules as Array<{ id: number }>;
    const found = blockedRules2.find((r) => r.id === fx.blockedRuleId);
    assert.ok(found, "Blocked rule ID should be preserved after re-save");
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test: updating one blocked rule does not recreate unrelated rules
// ---------------------------------------------------------------------------
test("saveSchedulingEngineConfiguration: updating one blocked rule preserves other rules", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    // Create a second blocked rule
    const secondRule = await pool.query<{ id: number }>(
      `
        insert into modality_blocked_rules (modality_id, rule_type, specific_date, is_overridable, is_active, title, created_by_user_id, updated_by_user_id)
        values ($1, 'specific_date', '2030-06-15', true, true, 'Second Block', $2, $2)
        returning id
      `,
      [fx.modalityId, fx.adminUserId]
    );
    const secondRuleId = Number(secondRule.rows[0]?.id);

    // Update only the first rule, keep both in payload
    const config = await getSchedulingEngineConfiguration();
    const blockedRules = config.blockedRules as Array<Record<string, unknown>>;
    const firstRule = blockedRules.find((r) => Number(r.id) === fx.blockedRuleId);
    assert.ok(firstRule, "First rule should exist");
    if (firstRule) {
      firstRule.title = "Updated Title";
      firstRule.is_overridable = true;
    }

    await saveSchedulingEngineConfiguration(config, fx.adminUserId);

    // Verify both rules still exist with their original IDs
    const config2 = await getSchedulingEngineConfiguration();
    const blockedRules2 = config2.blockedRules as Array<{ id: number; title: string | null }>;

    const firstStillExists = blockedRules2.find((r) => r.id === fx.blockedRuleId);
    assert.ok(firstStillExists, "First rule should still exist");
    assert.equal(String(firstStillExists?.title), "Updated Title", "First rule title should be updated");

    const secondStillExists = blockedRules2.find((r) => r.id === secondRuleId);
    assert.ok(secondStillExists, "Second rule should still exist with original ID");
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test: updating one exam rule preserves its id
// ---------------------------------------------------------------------------
test("saveSchedulingEngineConfiguration: updating exam rule preserves id", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    const config = await getSchedulingEngineConfiguration();
    const examRules = config.examRules as Array<Record<string, unknown>>;
    const existingRule = examRules.find((r) => Number(r.id) === fx.examRuleId);
    assert.ok(existingRule, "Exam rule should exist before update");

    if (existingRule) {
      existingRule.title = "Updated Exam Rule Title";
    }

    await saveSchedulingEngineConfiguration(config, fx.adminUserId);

    const config2 = await getSchedulingEngineConfiguration();
    const examRules2 = config2.examRules as Array<{ id: number; title: string | null }>;
    const updated = examRules2.find((r) => r.id === fx.examRuleId);
    assert.ok(updated, "Exam rule should still exist with original ID");
    assert.equal(String(updated?.title), "Updated Exam Rule Title", "Exam rule title should be updated");
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test: updating exam rule items only affects that rule's items
// ---------------------------------------------------------------------------
test("saveSchedulingEngineConfiguration: exam rule items replacement is per-rule", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    // Create a second exam rule
    const examRule2 = await pool.query<{ id: number }>(
      `
        insert into exam_type_schedule_rules (modality_id, rule_type, effect_mode, start_date, end_date, weekday, alternate_weeks, recurrence_anchor_date, title, is_active, created_by_user_id, updated_by_user_id)
        values ($1, 'date_range', 'restriction_overridable', '2026-03-01', '2026-03-31', null, false, null, 'Second Exam Rule', true, $2, $2)
        returning id
      `,
      [fx.modalityId, fx.adminUserId]
    );
    const examRule2Id = Number(examRule2.rows[0]?.id);

    // Add items to second rule (exam type 2)
    await pool.query(
      `insert into exam_type_schedule_rule_items (rule_id, exam_type_id) values ($1, $2)`,
      [examRule2Id, fx.examTypeId2]
    );

    // Update first rule's items to include both exam types
    const config = await getSchedulingEngineConfiguration();
    const examRules = config.examRules as Array<Record<string, unknown>>;
    const firstRule = examRules.find((r) => Number(r.id) === fx.examRuleId);
    assert.ok(firstRule, "First rule should exist");
    if (firstRule) {
      firstRule.exam_type_ids = [fx.examTypeId, fx.examTypeId2];
    }

    await saveSchedulingEngineConfiguration(config, fx.adminUserId);

    // Verify first rule has both exam types
    const config2 = await getSchedulingEngineConfiguration();
    const examRules2 = config2.examRules as Array<{ id: number; exam_type_ids: number[] }>;
    const firstRule2 = examRules2.find((r) => r.id === fx.examRuleId);
    assert.ok(firstRule2, "First rule should still exist");
    assert.ok(Array.isArray(firstRule2?.exam_type_ids), "Should have exam_type_ids array");
    assert.ok(firstRule2?.exam_type_ids?.includes(fx.examTypeId), "First rule should have exam type 1");
    assert.ok(firstRule2?.exam_type_ids?.includes(fx.examTypeId2), "First rule should have exam type 2");

    // Verify second rule's items are untouched
    const secondRule2 = examRules2.find((r) => r.id === examRule2Id);
    assert.ok(secondRule2, "Second rule should still exist");
    assert.ok(Array.isArray(secondRule2?.exam_type_ids), "Second rule should have exam_type_ids array");
    assert.ok(secondRule2?.exam_type_ids?.includes(fx.examTypeId2), "Second rule should still have exam type 2");
    assert.equal(secondRule2?.exam_type_ids?.length, 1, "Second rule should have exactly 1 exam type");
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test: saving special reasons preserves stable codes
// ---------------------------------------------------------------------------
test("saveSchedulingEngineConfiguration: special reasons preserved across saves", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    const testCode = `TEST_${Date.now()}`;
    const payload = {
      categoryLimits: [],
      blockedRules: [],
      examRules: [],
      specialQuotas: [],
      specialReasons: [
        { code: testCode, labelAr: "سبب تجريبي", labelEn: "Test Reason", isActive: true }
      ],
      identifierTypes: []
    };

    // First save
    await saveSchedulingEngineConfiguration(payload, fx.adminUserId);

    // Second save with same code but updated label
    const payload2 = {
      ...payload,
      specialReasons: [
        { code: testCode, labelAr: "سبب محدث", labelEn: "Updated Reason", isActive: true }
      ]
    };
    await saveSchedulingEngineConfiguration(payload2, fx.adminUserId);

    // Verify code exists with updated label
    const config = await getSchedulingEngineConfiguration();
    const reasons = config.specialReasons as Array<{ code: string; label_ar: string | null; label_en: string | null }>;
    const found = reasons.find((r) => r.code === testCode);
    assert.ok(found, "Special reason should exist after re-save");
    assert.equal(String(found?.label_en), "Updated Reason", "Label should be updated");
    assert.equal(String(found?.label_ar), "سبب محدث", "Arabic label should be updated");
  } finally {
    await fx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Test: repeated saves are idempotent
// ---------------------------------------------------------------------------
test("saveSchedulingEngineConfiguration: repeated saves are idempotent", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    const config = await getSchedulingEngineConfiguration();

    // Save 3 times
    await saveSchedulingEngineConfiguration(config, fx.adminUserId);
    const config2 = await getSchedulingEngineConfiguration();
    await saveSchedulingEngineConfiguration(config2, fx.adminUserId);
    const config3 = await getSchedulingEngineConfiguration();
    await saveSchedulingEngineConfiguration(config3, fx.adminUserId);
    const config4 = await getSchedulingEngineConfiguration();

    // Row counts should be stable
    const countBlocked = (config.blockedRules as unknown[]).length;
    const countBlocked4 = (config4.blockedRules as unknown[]).length;
    assert.equal(countBlocked, countBlocked4, "Blocked rule count should be stable");

    const countExam = (config.examRules as unknown[]).length;
    const countExam4 = (config4.examRules as unknown[]).length;
    assert.equal(countExam, countExam4, "Exam rule count should be stable");

    // IDs should be preserved
    const origIds = new Set((config.blockedRules as Array<{ id: number }>).map((r) => r.id));
    const finalIds = new Set((config4.blockedRules as Array<{ id: number }>).map((r) => r.id));
    assert.deepEqual(origIds, finalIds, "Blocked rule IDs should be identical after repeated saves");
  } finally {
    await fx.cleanup();
  }
});
