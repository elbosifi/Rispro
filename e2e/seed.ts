import bcrypt from "bcryptjs";
import { pool } from "../src/db/pool.js";
import { e2eTodayInTripoli, e2eTomorrowInTripoli, e2eYesterdayInTripoli } from "./helpers/fixtures.js";

if (process.env.RISPRO_E2E !== "1") throw new Error("RISPRO_E2E=1 is required to seed browser E2E data.");

const passwordHash = await bcrypt.hash("E2ePassword!2026", 10);
const fullFixtureDate = e2eTomorrowInTripoli();
const users = [
  ["e2e_reception", "E2E Reception", "receptionist"],
  ["e2e_supervisor", "E2E Supervisor", "supervisor"],
  ["e2e_super_admin", "E2E Super Admin", "super_admin"],
  ["e2e_doctor", "E2E Doctor", "doctor"],
  ["e2e_doctor_other", "E2E Other Doctor", "doctor"],
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
  await pool.query(
    `update system_settings
     set setting_value = jsonb_set(
       setting_value,
       '{value,comparisons}',
       '["receptionist", "modality_staff", "supervisor", "super_admin"]'::jsonb
     )
     where category = 'users_and_roles' and setting_key = 'page_visibility_by_role'`,
  );
  await pool.query("update users set can_request_scheduling_override = true where username = 'e2e_reception'");
  const modality = await pool.query<{ id: number }>(
    `insert into modalities (name_ar, name_en, code, daily_capacity, is_active)
     values ('التصوير المقطعي E2E', 'E2E CT', 'E2E_CT', 5, true) returning id`,
  );
  const modalityId = Number(modality.rows[0].id);
  const brainRegion = await pool.query<{ id: number }>(
    `insert into protocol_anatomy_regions (name, body_system, modality_scope, default_coverage_note, is_active)
     values ('Brain', 'Neuro', 'BOTH', 'Vertex to skull base', true) returning id`,
  );
  const capRegion = await pool.query<{ id: number }>(
    `insert into protocol_anatomy_regions (name, body_system, modality_scope, default_coverage_note, is_active)
     values ('Chest / abdomen / pelvis', 'Body', 'CT', 'Lung apices through symphysis pubis', true) returning id`,
  );
  const seedProtocol = async ({
    name,
    modality: protocolModality,
    anatomyRegionId,
    category,
    indication,
    contrastPolicy,
    isActive = true,
    activeVersion,
    draftVersion,
  }: {
    name: string;
    modality: "CT" | "MRI";
    anatomyRegionId: number;
    category: "General" | "Oncology";
    indication: string;
    contrastPolicy: string;
    isActive?: boolean;
    activeVersion?: string;
    draftVersion?: string;
  }) => {
    const protocol = await pool.query<{ id: number }>(
      `insert into protocols (name, modality, anatomy_region_id, category, indication, contrast_policy, is_active)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [name, protocolModality, anatomyRegionId, category, indication, contrastPolicy, isActive],
    );
    const protocolId = Number(protocol.rows[0].id);
    let activeVersionId: number | null = null;
    if (activeVersion) {
      const version = await pool.query<{ id: number }>(
        `insert into protocol_versions (protocol_id, version_number, status, change_summary, created_by)
         values ($1, $2, 'ACTIVE', 'E2E active protocol', $3) returning id`,
        [protocolId, activeVersion, supervisorId],
      );
      activeVersionId = Number(version.rows[0].id);
    }
    if (draftVersion) {
      await pool.query(
        `insert into protocol_versions (protocol_id, version_number, status, change_summary, created_by)
         values ($1, $2, 'DRAFT', 'E2E draft changes', $3)`,
        [protocolId, draftVersion, supervisorId],
      );
    }
    if (activeVersionId) await pool.query("update protocols set active_version_id = $2 where id = $1", [protocolId, activeVersionId]);
    return { protocolId, activeVersionId };
  };
  const acuteProtocol = await seedProtocol({ name: "CT Brain - Acute", modality: "CT", anatomyRegionId: Number(brainRegion.rows[0].id), category: "General", indication: "Trauma and stroke imaging", contrastPolicy: "Non-contrast", activeVersion: "1.0" });
  if (!acuteProtocol.activeVersionId) throw new Error("E2E acute protocol requires an active version.");
  await seedProtocol({ name: "CT Brain - Tumor", modality: "CT", anatomyRegionId: Number(brainRegion.rows[0].id), category: "Oncology", indication: "Tumor and infection assessment", contrastPolicy: "With IV contrast", draftVersion: "1.0" });
  await seedProtocol({ name: "CT CAP - Oncology", modality: "CT", anatomyRegionId: Number(capRegion.rows[0].id), category: "Oncology", indication: "Staging and treatment response", contrastPolicy: "With IV contrast", activeVersion: "2.0", draftVersion: "2.1" });
  await seedProtocol({ name: "MRI Brain", modality: "MRI", anatomyRegionId: Number(brainRegion.rows[0].id), category: "General", indication: "Neuroimaging for headache and seizure", contrastPolicy: "Conditional / radiologist decision", activeVersion: "1.0" });
  await pool.query(
    "update modalities set safety_warning_ar = $2, safety_warning_en = $3, safety_warning_enabled = true where id = $1",
    [modalityId, "E2E synthetic CT safety warning", "E2E synthetic CT safety warning"],
  );
  await pool.query(
    `insert into exam_types (modality_id, name_ar, name_en, code, is_active)
     values ($1, 'رأس E2E', 'E2E CT Head', 'E2E_CT_HEAD', true)`,
    [modalityId],
  );
  await pool.query(
    `insert into exam_types (modality_id, name_ar, name_en, code, is_active)
     values ($1, 'صدر E2E', 'E2E CT Chest', 'E2E_CT_CHEST', true)`,
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
     values ($1, 'Dr E2E', 'consultant', true, true, true, true) returning id`, [doctorUserId],
  )).rows[0].id);
  await pool.query(
    `insert into doctor_portal.doctor_modality_permissions (doctor_id, modality_id, can_protocol, can_report, can_supervise, active)
     values ($1, $2, true, true, true, true)`,
    [doctorProfileId, modalityId],
  );
  const otherDoctorUserId = Number((await pool.query<{ id: number }>("select id from users where username = 'e2e_doctor_other'")).rows[0].id);
  const otherDoctorProfileId = Number((await pool.query<{ id: number }>(
    `insert into doctor_portal.doctor_profiles (user_id, display_name, doctor_role, active, can_finalize_reports, can_assign_protocols, can_supervise)
     values ($1, 'Dr E2E Other', 'consultant', true, true, true, true) returning id`, [otherDoctorUserId],
  )).rows[0].id);
  await pool.query(
    `insert into doctor_portal.doctor_modality_permissions (doctor_id, modality_id, can_protocol, can_report, can_supervise, active)
     values ($1, $2, true, true, true, true)`,
    [otherDoctorProfileId, modalityId],
  );
  const supervisorProfileId = Number((await pool.query<{ id: number }>(
    `insert into doctor_portal.doctor_profiles (user_id, display_name, doctor_role, active, can_finalize_reports, can_assign_protocols, can_supervise)
     values ($1, 'Dr E2E Supervisor', 'consultant', true, true, true, true) returning id`, [supervisorId],
  )).rows[0].id);
  await pool.query(
    `insert into doctor_portal.doctor_modality_permissions (doctor_id, modality_id, can_protocol, can_report, can_supervise, active)
     values ($1, $2, true, true, true, true)`,
    [supervisorProfileId, modalityId],
  );
  const performedDevice = await pool.query<{ id: number }>(
    `insert into dicom_devices (modality_id, device_name, modality_ae_title, scheduled_station_ae_title, is_active)
     values ($1, 'E2E Performed CT device', 'E2E_MPPS_CT', 'E2E_MPPS_STATION', true) returning id`,
    [modalityId],
  );
  await pool.query(
    `insert into equipment (name, equipment_type, modality, modality_id, vendor, model, dicom_device_id, is_active)
     values ('E2E Performed CT', 'CT', 'CT', $1, 'Philips', 'Incisive', $2, true) returning id`,
    [modalityId, Number(performedDevice.rows[0].id)],
  );
  const plannedEquipment = await pool.query<{ id: number }>(
    `insert into equipment (name, equipment_type, modality, modality_id, vendor, model, is_active)
     values ('E2E Planned CT', 'CT', 'CT', $1, 'GE', 'Revolution', true) returning id`,
    [modalityId],
  );
  const acquisitionPatient = await pool.query<{ id: number }>(
    `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
     values ('E2E Acquisition Patient', 'E2E Acquisition Patient', '100000000097', 'E2E Acquisition Patient', 'F', 39, '0910000097', 'national_id', '100000000097') returning id`,
  );
  const acquisitionBooking = await pool.query<{ id: number }>(
    `insert into appointments_v2.bookings (patient_id, modality_id, exam_type_id, booking_date, case_category, requires_report, status, completed_at, policy_version_id, created_by_user_id, updated_by_user_id)
     values ($1, $2, $3, $4::date, 'non_oncology', true, 'completed', now(), $5, $6, $6) returning id`,
    [Number(acquisitionPatient.rows[0].id), modalityId, Number((await pool.query<{ id: number }>("select id from exam_types where code = 'E2E_CT_HEAD'")).rows[0].id), e2eTodayInTripoli(), Number(policyVersion.rows[0].id), supervisorId],
  );
  const acquisitionBookingId = Number(acquisitionBooking.rows[0].id);
  const acquisitionDicomDate = e2eTodayInTripoli().replaceAll("-", "");
  await pool.query(
    `insert into appointment_protocol_assignments (appointment_id, protocol_id, protocol_version_id, scanner_id, assigned_by, assigned_at, status)
     values ($1, $2, $3, $4, $5, now(), 'ASSIGNED')`,
    [acquisitionBookingId, acuteProtocol.protocolId, acuteProtocol.activeVersionId, Number(plannedEquipment.rows[0].id), supervisorId],
  );
  await pool.query(
    `insert into mpps_event_log (dedupe_key, event_type, source_ae_title, mpps_instance_uid, performed_step_status, performed_start_date, performed_start_time, correlated_appointment_id, correlation_status, processing_status)
     values ($1, 'n-create', 'E2E_MPPS_CT', $2, 'IN PROGRESS', $3, '090000', $4, 'matched', 'processed')`,
    ['e2e-acquisition-mpps-start', '1.2.826.0.1.3680043.10.543.e2e.acquisition', acquisitionDicomDate, acquisitionBookingId],
  );
  await pool.query(
    `insert into mpps_event_log (dedupe_key, event_type, source_ae_title, mpps_instance_uid, performed_step_status, performed_end_date, performed_end_time, correlated_appointment_id, correlation_status, processing_status)
     values ($1, 'n-set', 'E2E_MPPS_CT', $2, 'COMPLETED', $3, '092700', $4, 'matched', 'processed')`,
    ['e2e-acquisition-mpps-end', '1.2.826.0.1.3680043.10.543.e2e.acquisition', acquisitionDicomDate, acquisitionBookingId],
  );
  await pool.query(
    `insert into doctor_portal.reporting_board_sonicdicom_cache (appointment_id, report_status, source, last_success_at, last_attempt_at, next_check_at, status_changed_at, failure_count, accession_number_snapshot)
     values ($1, 'draft', 'sonicdicom', now(), now(), now() + interval '1 hour', now(), 0, 'V2-' || lpad(($1::bigint)::text, 6, '0'))`,
    [acquisitionBookingId],
  );
  const reportingPatient = await pool.query<{ id: number }>(
    `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
     values ('اختبار لوحة التقارير', 'E2E Reporting Patient', '100000000098', 'اختبار لوحة التقارير', 'F', 44, '0910000098', 'national_id', '100000000098') returning id`,
  );
  await pool.query(
    `insert into appointments_v2.bookings (patient_id, modality_id, exam_type_id, booking_date, case_category, requires_report, status, policy_version_id, created_by_user_id, updated_by_user_id)
     values ($1, $2, $3, $4::date, 'non_oncology', true, 'completed', $5, $6, $6)`,
    [Number(reportingPatient.rows[0].id), modalityId, Number((await pool.query<{ id: number }>("select id from exam_types where code = 'E2E_CT_HEAD'")).rows[0].id), e2eTodayInTripoli(), Number(policyVersion.rows[0].id), supervisorId],
  );
  const protocolingPatient = await pool.query<{ id: number }>(
    `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
     values ('E2E Protocoling Exam Patient', 'E2E Protocoling Exam Patient', '100000000096', 'E2E Protocoling Exam Patient', 'F', 46, '0910000096', 'national_id', '100000000096') returning id`,
  );
  await pool.query(
    `insert into appointments_v2.bookings (patient_id, modality_id, exam_type_id, booking_date, case_category, status, policy_version_id, created_by_user_id, updated_by_user_id)
     values ($1, $2, $3, $4::date, 'non_oncology', 'scheduled', $5, $6, $6)`,
    [Number(protocolingPatient.rows[0].id), modalityId, Number((await pool.query<{ id: number }>("select id from exam_types where code = 'E2E_CT_HEAD'")).rows[0].id), fullFixtureDate, Number(policyVersion.rows[0].id), supervisorId],
  );
  await pool.query(`update system_settings set setting_value = '{"value":{"enabledModalityCodes":["E2E_CT"],"daysBack":30,"defaultRequiresReport":true,"defaultReportStatusFilter":"required_not_final"}}'::jsonb where category = 'doctor_portal_reporting_board' and setting_key = 'config'`);
  await pool.query(
    `insert into doctor_portal.reporting_board_saved_views (owner_user_id, owner_doctor_id, target_doctor_id, name, token, filters_json, notification_settings_json, active, link_kind, system_managed, created_by_user_id, updated_by_user_id)
     values ($1, $2, $2, 'E2E Mobile Reporting', 'e2e-mobile-reporting-token', '{}'::jsonb, '{}'::jsonb, true, 'doctor_worklist', true, $1, $1)`,
    [doctorUserId, doctorProfileId],
  );

  const reportingPriorities = await pool.query<{ id: number; code: string }>(
    "select id, code from reporting_priorities where code = any($1::text[])",
    [["routine", "urgent"]],
  );
  const reportingPriorityId = (code: "routine" | "urgent") => Number(reportingPriorities.rows.find((priority) => priority.code === code)?.id);
  const reportingExamTypeId = Number((await pool.query<{ id: number }>("select id from exam_types where code = 'E2E_CT_HEAD'")).rows[0].id);
  const seedPersonalReportingCase = async ({
    patientName,
    nationalId,
    priority = "routine",
    assigned = false,
    expectedReportingDate = e2eTodayInTripoli(),
    reportStatus = "draft",
  }: {
    patientName: string;
    nationalId: string;
    priority?: "routine" | "urgent";
    assigned?: boolean;
    expectedReportingDate?: string;
    reportStatus?: "draft" | "final";
  }) => {
    const patient = await pool.query<{ id: number }>(
      `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
       values ($1::varchar, $1::varchar, $2::varchar, $1::text, 'F', 44, $3::varchar, 'national_id', $2::text) returning id`,
      [patientName, nationalId, `091${nationalId.slice(-7)}`],
    );
    const booking = await pool.query<{ id: number }>(
      `insert into appointments_v2.bookings (patient_id, modality_id, exam_type_id, reporting_priority_id, booking_date, case_category, requires_report, status, completed_at, policy_version_id, created_by_user_id, updated_by_user_id)
       values ($1, $2, $3, $4, $5::date, 'non_oncology', true, 'completed', now(), $6, $7, $7) returning id`,
      [Number(patient.rows[0].id), modalityId, reportingExamTypeId, reportingPriorityId(priority), e2eTodayInTripoli(), Number(policyVersion.rows[0].id), supervisorId],
    );
    const bookingId = Number(booking.rows[0].id);
    await pool.query(
      `insert into doctor_portal.reporting_board_sonicdicom_cache (appointment_id, report_status, report_final_at, source, last_success_at, last_attempt_at, next_check_at, status_changed_at, failure_count, accession_number_snapshot)
       values ($1::bigint, $2, case when $2 = 'final' then now() else null end, 'sonicdicom', now(), now(), now() + interval '1 hour', now(), 0, 'V2-' || lpad(($1::bigint)::text, 6, '0'))`,
      [bookingId, reportStatus],
    );
    if (assigned) {
      await pool.query(
        `insert into doctor_portal.case_team_assignments (appointment_id, roster_assignment_id, assigned_doctor_id, modality_id, assignment_type, expected_reporting_date, assigned_at, status)
         values ($1, null, $2, $3, 'reporting', $4::date, now(), 'active')`,
        [bookingId, doctorProfileId, modalityId, expectedReportingDate],
      );
    }
  };
  await seedPersonalReportingCase({ patientName: "E2E Reporting Assigned", nationalId: "100000000081", assigned: true });
  await seedPersonalReportingCase({ patientName: "E2E Reporting Available", nationalId: "100000000082" });
  await seedPersonalReportingCase({ patientName: "E2E Reporting Overdue", nationalId: "100000000083", assigned: true, expectedReportingDate: e2eYesterdayInTripoli() });
  await seedPersonalReportingCase({ patientName: "E2E Reporting Urgent", nationalId: "100000000084", priority: "urgent" });
  await seedPersonalReportingCase({ patientName: "E2E Reporting Claim", nationalId: "100000000085" });
  await seedPersonalReportingCase({ patientName: "E2E Reporting Final Guard", nationalId: "100000000087", reportStatus: "final" });
  await seedPersonalReportingCase({ patientName: "E2E Reporting Finalize", nationalId: "100000000086", assigned: true });

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
