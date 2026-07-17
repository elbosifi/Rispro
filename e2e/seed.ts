import bcrypt from "bcryptjs";
import { pool } from "../src/db/pool.js";

if (process.env.RISPRO_E2E !== "1") throw new Error("RISPRO_E2E=1 is required to seed browser E2E data.");

const passwordHash = await bcrypt.hash("E2ePassword!2026", 10);
const users = [
  ["e2e_reception", "E2E Reception", "receptionist"],
  ["e2e_supervisor", "E2E Supervisor", "supervisor"],
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

  // A fixed, synthetic full category provides an override-request fixture.
  for (let index = 1; index <= 5; index += 1) {
    const patient = await pool.query<{ id: number }>(
      `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
       values ($1, $2, $3, $1, 'M', 50, $4, 'national_id', $3) returning id`,
      [`E2E Full Fixture ${index}`, `E2E Full Fixture ${index}`, `1000000001${String(index).padStart(2, "0")}`, `09100001${String(index).padStart(2, "0")}`],
    );
    await pool.query(
      `insert into appointments_v2.bookings
        (patient_id, modality_id, booking_date, case_category, status, policy_version_id, created_by_user_id)
       values ($1, $2, '2035-04-15', 'non_oncology', 'scheduled', $3, $4)`,
      [Number(patient.rows[0].id), modalityId, Number(policyVersion.rows[0].id), supervisorId],
    );
  }
  await pool.query(
    `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
     values
       ('اختبار تشابه واحد', 'E2E Similar One', '100000000001', 'اختبار تشابه واحد', 'M', 41, '0910000001', 'national_id', '100000000001'),
       ('اختبار تشابه اثنان', 'E2E Similar Two', '100000000002', 'اختبار تشابه اثنان', 'F', 39, '0910000002', 'national_id', '100000000002')`,
  );
  console.log("Seeded synthetic E2E users: reception, supervisor, doctor.");
} finally {
  await pool.end();
}
