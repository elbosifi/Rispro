import bcrypt from "bcryptjs";
import { pool } from "../src/db/pool.js";
import { e2eTodayInTripoli, e2eTomorrowInTripoli } from "./helpers/fixtures.js";

if (process.env.RISPRO_E2E !== "1") throw new Error("RISPRO_E2E=1 is required to seed browser E2E data.");

const passwordHash = await bcrypt.hash("E2ePassword!2026", 10);
const fullFixtureDate = e2eTomorrowInTripoli();
const users = [
  ["e2e_reception", "E2E Reception", "receptionist"],
  ["e2e_supervisor", "E2E Supervisor", "supervisor"],
  ["e2e_super_admin", "E2E Super Admin", "super_admin"],
  ["e2e_doctor", "E2E Doctor", "doctor"],
] as const;

try {
  for (const [username, fullName, role] of users) {
    await pool.query(
      "insert into users (username, full_name, password_hash, role, is_active) values ($1, $2, $3, $4, true)",
      [username, fullName, passwordHash, role],
    );
  }
  const supervisorId = Number((await pool.query<{ id: number }>("select id from users where username = 'e2e_supervisor'")).rows[0].id);
  await pool.query(
    `update system_settings
     set setting_value = jsonb_set(
       setting_value,
       '{value,settings}',
       coalesce(setting_value->'value'->'settings', '[]'::jsonb) || '["supervisor"]'::jsonb
     )
     where category = 'users_and_roles' and setting_key = 'page_visibility_by_role'`,
  );
  await pool.query("update users set can_request_scheduling_override = true where username = 'e2e_reception'");
  const modality = await pool.query<{ id: number }>(
    `insert into modalities (name_ar, name_en, code, daily_capacity, is_active)
     values ('التصوير المقطعي E2E', 'E2E CT', 'E2E_CT', 5, true) returning id`,
  );
  const modalityId = Number(modality.rows[0].id);
  await pool.query(
    `insert into exam_types (modality_id, name_ar, name_en, code, is_active)
     values ($1, 'رأس E2E', 'E2E CT Head', 'E2E_CT_HEAD', true)`,
    [modalityId],
  );
  const policySet = await pool.query<{ id: number }>(
    `insert into appointments_v2.policy_sets (key, name, created_by_user_id)
     values ('default', 'E2E default policy', $1)
     on conflict (key) do update set name = excluded.name, created_by_user_id = excluded.created_by_user_id
     returning id`,
    [supervisorId],
  );
  const policySetId = Number(policySet.rows[0].id);
  const policyVersion = await pool.query<{ id: number }>(
    `insert into appointments_v2.policy_versions
      (policy_set_id, version_no, status, config_hash, created_by_user_id, published_at, published_by_user_id)
     values ($1, 1, 'published', 'e2e-default-policy-v1', $2, now(), $2) returning id`,
    [policySetId, supervisorId],
  );
  await pool.query(
    `insert into appointments_v2.category_daily_limits
      (policy_version_id, modality_id, case_category, daily_limit, is_active)
     values ($1, $2, 'non_oncology', 5, true), ($1, $2, 'oncology', 5, true)`,
    [Number(policyVersion.rows[0].id), modalityId],
  );
  await pool.query(
    `insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
     values
       ('scheduling_and_capacity', 'allow_reception_override_requests_from_availability', '{"value":"enabled"}'::jsonb, $1),
       ('scheduling_and_capacity', 'can_request_scheduling_override', '{"value":"enabled"}'::jsonb, $1)
     on conflict (category, setting_key) do update set setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id`,
    [supervisorId],
  );
  const queuePatient = await pool.query<{ id: number }>(
    `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
     values ('اختبار قائمة الانتظار', 'E2E Queue Patient', '100000000099', 'اختبار قائمة الانتظار', 'M', 42, '0910000099', 'national_id', '100000000099') returning id`,
  );
  await pool.query(
    `insert into appointments_v2.bookings (patient_id, modality_id, exam_type_id, booking_date, case_category, status, policy_version_id, created_by_user_id, updated_by_user_id)
     values ($1, $2, $3, $4::date, 'non_oncology', 'scheduled', $5, $6, $6)`,
    [Number(queuePatient.rows[0].id), modalityId, Number((await pool.query<{ id: number }>("select id from exam_types where code = 'E2E_CT_HEAD'")).rows[0].id), e2eTodayInTripoli(), Number(policyVersion.rows[0].id), supervisorId],
  );
  const doctorUserId = Number((await pool.query<{ id: number }>("select id from users where username = 'e2e_doctor'")).rows[0].id);
  const doctorProfileId = Number((await pool.query<{ id: number }>(
    `insert into doctor_portal.doctor_profiles (user_id, display_name, doctor_role, active, can_finalize_reports, can_assign_protocols, can_supervise)
     values ($1, 'Dr E2E', 'consultant', true, true, true, false) returning id`, [doctorUserId],
  )).rows[0].id);
  await pool.query(`insert into doctor_portal.doctor_modality_permissions (doctor_id, modality_id, can_report, active) values ($1, $2, true, true)`, [doctorProfileId, modalityId]);
  const reportingPatient = await pool.query<{ id: number }>(
    `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
     values ('اختبار لوحة التقارير', 'E2E Reporting Patient', '100000000098', 'اختبار لوحة التقارير', 'F', 44, '0910000098', 'national_id', '100000000098') returning id`,
  );
  await pool.query(
    `insert into appointments_v2.bookings (patient_id, modality_id, exam_type_id, booking_date, case_category, requires_report, status, policy_version_id, created_by_user_id, updated_by_user_id)
     values ($1, $2, $3, $4::date, 'non_oncology', true, 'completed', $5, $6, $6)`,
    [Number(reportingPatient.rows[0].id), modalityId, Number((await pool.query<{ id: number }>("select id from exam_types where code = 'E2E_CT_HEAD'")).rows[0].id), e2eTodayInTripoli(), Number(policyVersion.rows[0].id), supervisorId],
  );
  await pool.query(`update system_settings set setting_value = '{"value":{"enabledModalityCodes":["E2E_CT"],"daysBack":30,"defaultRequiresReport":true,"defaultReportStatusFilter":"required_not_final"}}'::jsonb where category = 'doctor_portal_reporting_board' and setting_key = 'config'`);
  await pool.query(
    `insert into doctor_portal.reporting_board_saved_views (owner_user_id, owner_doctor_id, name, token, filters_json, notification_settings_json, active, link_kind, system_managed, created_by_user_id, updated_by_user_id)
     values ($1, $2, 'E2E Mobile Reporting', 'e2e-mobile-reporting-token', '{}'::jsonb, '{}'::jsonb, true, 'admin_saved_view', false, $1, $1)`,
    [doctorUserId, doctorProfileId],
  );

  // A fixed, synthetic full category provides an override-request fixture.
  for (let index = 1; index <= 5; index += 1) {
    const patient = await pool.query<{ id: number }>(
      `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
       values ($1, $2, $3::varchar, $1::text, 'M', 50, $4, 'national_id', $3::text) returning id`,
      [`E2E Full Fixture ${index}`, `E2E Full Fixture ${index}`, `1000000001${String(index).padStart(2, "0")}`, `09100001${String(index).padStart(2, "0")}`],
    );
    await pool.query(
      `insert into appointments_v2.bookings
        (patient_id, modality_id, booking_date, case_category, status, policy_version_id, created_by_user_id)
       values ($1, $2, $3::date, 'non_oncology', 'scheduled', $4, $5)`,
      [Number(patient.rows[0].id), modalityId, fullFixtureDate, Number(policyVersion.rows[0].id), supervisorId],
    );
  }
  await pool.query(
    `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, estimated_date_of_birth, demographics_estimated, phone_1, identifier_type, identifier_value)
     values
       ('اختبار تشابه مريض واحد', 'E2E Similar Patient One', '100000000001', 'اختبار تشابه مريض واحد', 'M', 41, '1985-01-02', false, '0910000001', 'national_id', '100000000001'),
       ('اختبار تشابه مريض اثنان', 'E2E Similar Patient Two', '100000000002', 'اختبار تشابه مريض اثنان', 'F', 39, '1987-02-03', false, '0910000002', 'national_id', '100000000002')`,
  );
  console.log("Seeded synthetic E2E users: reception, supervisor, super admin, doctor.");
} finally {
  await pool.end();
}
