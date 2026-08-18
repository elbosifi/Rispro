import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import { __patientIdentityReconciliationTestables } from "./patient-identity-reconciliation-service.js";

test("reconciliation target PatientID prefers the primary patient identifier and never falls back to MRN", async (t) => {
  try {
    await pool.query("select 1");
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return;
  }
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const mrn = `M${suffix.slice(-18)}`;
  const nationalId = `9${suffix.slice(-11)}`;
  const legacyId = `LEGACY-${suffix}`;
  const user = (await pool.query<{ id: number }>(
    "insert into users(username,full_name,password_hash,role,is_active) values($1,'PIR Identity Test','x','super_admin',true) returning id",
    [`pir_identity_${suffix}`],
  )).rows[0]!;
  const patient = (await pool.query<{ id: number }>(
    "insert into patients(mrn,national_id,arabic_full_name,english_full_name,normalized_arabic_name,age_years,estimated_date_of_birth,sex,phone_1,identifier_type,identifier_value,created_by_user_id) values($1,$2,'اختبار','PIR Identity Patient','اختبار',40,'1980-01-01','M',$3,'other',$4,$5) returning id",
    [mrn, nationalId, `09${suffix.slice(-8)}`, legacyId, user.id],
  )).rows[0]!;
  try {
    const identifierTypeId = (await pool.query<{ id: number }>("select id from patient_identifier_types order by id limit 1")).rows[0]!.id;
    await pool.query(
      "insert into patient_identifiers(patient_id,identifier_type_id,value,normalized_value,is_primary,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,true,$5,$5)",
      [patient.id, identifierTypeId, "PRIMARY-DICOM-ID", `primary-dicom-id-${suffix}`, user.id],
    );
    const resolved = await __patientIdentityReconciliationTestables.patient({ patient_id: patient.id } as any);
    assert.equal(resolved.patientId, "PRIMARY-DICOM-ID");
    assert.notEqual(resolved.patientId, legacyId);
    assert.notEqual(resolved.patientId, nationalId);
    assert.notEqual(resolved.patientId, mrn);

    await pool.query("delete from patient_identifiers where patient_id=$1", [patient.id]);
    await pool.query("update patients set identifier_value=null,national_id=null where id=$1", [patient.id]);
    await assert.rejects(
      () => __patientIdentityReconciliationTestables.patient({ patient_id: patient.id } as any),
      /no primary Patient ID/i,
    );
  } finally {
    await pool.query("delete from patient_identifiers where patient_id=$1", [patient.id]);
    await pool.query("delete from patients where id=$1", [patient.id]);
    await pool.query("delete from users where id=$1", [user.id]);
  }
});
