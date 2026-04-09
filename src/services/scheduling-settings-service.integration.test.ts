import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import {
  getSchedulingEngineConfiguration,
  saveSchedulingEngineConfiguration
} from "./scheduling-settings-service.js";

interface SettingsFixture {
  userId: number;
  modalityId: number;
  examTypeId: number;
  cleanup: () => Promise<void>;
}

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
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

async function createFixture(): Promise<SettingsFixture> {
  const suffix = uniqueSuffix();
  const passwordHash = bcrypt.hashSync("test-pass", 10);

  const user = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [`test_sched_cfg_${suffix}`, `Sched Config ${suffix}`, passwordHash]
  );
  const userId = Number(user.rows[0]?.id);

  const modality = await pool.query<{ id: number }>(
    `
      insert into modalities (code, name_ar, name_en, daily_capacity, is_active)
      values ($1, $2, $3, 20, true)
      returning id
    `,
    [`SC${suffix.slice(-6)}`, `موداليتي ${suffix}`, `Sched Modality ${suffix}`]
  );
  const modalityId = Number(modality.rows[0]?.id);

  const examType = await pool.query<{ id: number }>(
    `
      insert into exam_types (modality_id, name_ar, name_en, is_active)
      values ($1, $2, $3, true)
      returning id
    `,
    [modalityId, `فحص ${suffix}`, `Sched Exam ${suffix}`]
  );
  const examTypeId = Number(examType.rows[0]?.id);

  await pool.query(
    `
      insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
      values ('audit_and_logging', 'audit_trail', '{"value":"enabled"}'::jsonb, $1)
      on conflict (category, setting_key)
      do update set setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
    `,
    [userId]
  );

  const cleanup = async () => {
    await pool.query(`delete from audit_log where entity_type = 'scheduling_configuration' and changed_by_user_id = $1`, [userId]);
    await pool.query(`delete from exam_type_schedule_rule_items where rule_id in (select id from exam_type_schedule_rules where modality_id = $1)`, [modalityId]);
    await pool.query(`delete from exam_type_schedule_rules where modality_id = $1`, [modalityId]);
    await pool.query(`delete from modality_blocked_rules where modality_id = $1`, [modalityId]);
    await pool.query(`delete from modality_category_daily_limits where modality_id = $1`, [modalityId]);
    await pool.query(`delete from exam_type_special_quotas where exam_type_id = $1`, [examTypeId]);
    await pool.query(`delete from exam_types where id = $1`, [examTypeId]);
    await pool.query(`delete from modalities where id = $1`, [modalityId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  };

  return {
    userId,
    modalityId,
    examTypeId,
    cleanup
  };
}

test("integration: scheduling settings save persists rules and writes audit log", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    const payload = {
      categoryLimits: [
        {
          modalityId: fx.modalityId,
          caseCategory: "oncology",
          dailyLimit: 4,
          isActive: true
        },
        {
          modalityId: fx.modalityId,
          caseCategory: "non_oncology",
          dailyLimit: 7,
          isActive: true
        }
      ],
      blockedRules: [
        {
          modalityId: fx.modalityId,
          ruleType: "specific_date",
          specificDate: "2030-01-15",
          isOverridable: false,
          isActive: true,
          title: "Maintenance",
          notes: "Planned maintenance window"
        }
      ],
      examRules: [
        {
          modalityId: fx.modalityId,
          ruleType: "weekly_recurrence",
          effectMode: "restriction_overridable",
          weekday: 1,
          startDate: "2030-01-01",
          endDate: "2030-03-01",
          alternateWeeks: true,
          recurrenceAnchorDate: "2030-01-01",
          examTypeIds: [fx.examTypeId],
          isActive: true,
          title: "Weekly pattern",
          notes: "Only selected exam type on pattern"
        }
      ],
      specialQuotas: [
        {
          examTypeId: fx.examTypeId,
          dailyExtraSlots: 2,
          isActive: true
        }
      ],
      specialReasons: [
        {
          code: "sched_test_reason",
          labelEn: "Scheduling test reason",
          labelAr: "سبب اختبار الجدولة",
          isActive: true
        }
      ],
      identifierTypes: [
        {
          code: "hospital_file",
          labelEn: "Hospital File",
          labelAr: "رقم ملف المستشفى",
          isActive: true
        }
      ]
    };

    const saved = await saveSchedulingEngineConfiguration(payload, fx.userId);
    const config = await getSchedulingEngineConfiguration();

    const categoryLimit = (saved.categoryLimits as Array<{ modality_id: number; case_category: string; daily_limit: number }>).find(
      (row) => Number(row.modality_id) === fx.modalityId && row.case_category === "oncology"
    );
    assert.equal(Number(categoryLimit?.daily_limit || 0), 4);

    const blockedRule = (config.blockedRules as Array<{ modality_id: number; rule_type: string; specific_date: string }>).find(
      (row) => Number(row.modality_id) === fx.modalityId && row.rule_type === "specific_date"
    );
    assert.ok(blockedRule);
    assert.equal(String(blockedRule?.specific_date || "").slice(0, 10), "2030-01-15");

    const examRule = (config.examRules as Array<{ modality_id: number; rule_type: string; exam_type_ids: number[] }>).find(
      (row) => Number(row.modality_id) === fx.modalityId && row.rule_type === "weekly_recurrence"
    );
    assert.ok(examRule);
    assert.deepEqual(examRule?.exam_type_ids || [], [fx.examTypeId]);

    const quota = (config.specialQuotas as Array<{ exam_type_id: number; daily_extra_slots: number }>).find(
      (row) => Number(row.exam_type_id) === fx.examTypeId
    );
    assert.equal(Number(quota?.daily_extra_slots || 0), 2);
    const reason = (config.specialReasons as Array<{ code: string; label_en: string }>).find(
      (row) => row.code === "sched_test_reason"
    );
    assert.ok(reason);
    assert.equal(reason?.label_en, "Scheduling test reason");

    const idType = (config.identifierTypes as Array<{ code: string; label_en: string }>).find(
      (row) => row.code === "hospital_file"
    );
    assert.ok(idType);
    assert.equal(idType?.label_en, "Hospital File");

    const auditRows = await pool.query<{ action_type: string }>(
      `
        select action_type
        from audit_log
        where entity_type = 'scheduling_configuration'
          and changed_by_user_id = $1
        order by id desc
        limit 1
      `,
      [fx.userId]
    );
    assert.equal(auditRows.rows[0]?.action_type, "bulk_save");
  } finally {
    await fx.cleanup();
  }
});

test("integration: scheduling settings save rolls back on invalid payload", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    await pool.query(
      `
        insert into modality_category_daily_limits (
          modality_id, case_category, daily_limit, is_active, created_by_user_id, updated_by_user_id
        ) values ($1, 'oncology', 9, true, $2, $2)
        on conflict (modality_id, case_category)
        do update set daily_limit = excluded.daily_limit, updated_at = now(), updated_by_user_id = excluded.updated_by_user_id
      `,
      [fx.modalityId, fx.userId]
    );

    await assert.rejects(
      saveSchedulingEngineConfiguration(
        {
          categoryLimits: [
            {
              modalityId: fx.modalityId,
              caseCategory: "bad_category",
              dailyLimit: 1,
              isActive: true
            }
          ]
        },
        fx.userId
      ),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal((error as HttpError).statusCode, 400);
        return true;
      }
    );

    const row = await pool.query<{ daily_limit: number }>(
      `
        select daily_limit
        from modality_category_daily_limits
        where modality_id = $1
          and case_category = 'oncology'
      `,
      [fx.modalityId]
    );
    assert.equal(Number(row.rows[0]?.daily_limit || 0), 9);
  } finally {
    await fx.cleanup();
  }
});
