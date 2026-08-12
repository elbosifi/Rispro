import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import {
  cancelScanSession,
  createScanSession,
  getScanSessionContextByToken,
  markScanSessionOpened,
  uploadScanSessionDocument,
} from "./scan-session-service.js";

let userId = 0;
let patientId = 0;
let appointmentId = 0;
let modalityId = 0;
let policySetId = 0;
let policyVersionId = 0;
let v2BookingId = 0;

function tokenFromLaunchUrl(launchUrl: string): string {
  const url = new URL(launchUrl);
  return url.searchParams.get("token") || "";
}

before(async () => {
  const suffix = String(Date.now()).slice(-8);
  const user = await pool.query(
    `
      insert into users (username, full_name, password_hash, role)
      values ($1, 'Scanner Test User', 'test', 'supervisor')
      returning id
    `,
    [`scanner_test_${suffix}`]
  );
  userId = Number(user.rows[0].id);

  const patient = await pool.query(
    `
      insert into patients (
        mrn,
        national_id,
        arabic_full_name,
        english_full_name,
        normalized_arabic_name,
        age_years,
        sex,
        phone_1,
        created_by_user_id
      )
      values ($1, $2, 'اختبار ماسح', 'Scanner Test', 'اختبار ماسح', 40, 'M', '0910000000', $3)
      returning id
    `,
    [`MRN-${suffix}`, `9${suffix.padStart(11, "0").slice(0, 11)}`, userId]
  );
  patientId = Number(patient.rows[0].id);

  const modality = await pool.query(
    `
      insert into modalities (code, name_ar, name_en, daily_capacity)
      values ($1, 'اختبار', 'Scanner Test Modality', 10)
      returning id
    `,
    [`SCT${suffix}`]
  );
  modalityId = Number(modality.rows[0].id);

  const policySet = await pool.query(
    `
      insert into appointments_v2.policy_sets (key, name, created_by_user_id)
      values ($1, 'Scanner Test Policy', $2)
      returning id
    `,
    [`scanner_test_${suffix}`, userId]
  );
  policySetId = Number(policySet.rows[0].id);

  const policyVersion = await pool.query(
    `
      insert into appointments_v2.policy_versions (
        policy_set_id, version_no, status, config_hash, created_by_user_id
      )
      values ($1, 1, 'published', $2, $3)
      returning id
    `,
    [policySetId, `scanner-test-${suffix}`, userId]
  );
  policyVersionId = Number(policyVersion.rows[0].id);

  const v2Booking = await pool.query(
    `
      insert into appointments_v2.bookings (
        patient_id, modality_id, booking_date, case_category, status,
        policy_version_id, created_by_user_id
      )
      values ($1, $2, current_date, 'non_oncology', 'scheduled', $3, $4)
      returning id
    `,
    [patientId, modalityId, policyVersionId, userId]
  );
  v2BookingId = Number(v2Booking.rows[0].id);

  const legacySlotNumber = 9000 + (Number(suffix) % 900);

  const appointment = await pool.query(
    `
      insert into appointments (
        patient_id,
        modality_id,
        accession_number,
        appointment_date,
        daily_sequence,
        modality_slot_number,
        created_by_user_id
      )
      values ($1, $2, $3, current_date, $4, $4, $5)
      returning id
    `,
    [patientId, modalityId, `SCAN-${suffix}`, legacySlotNumber, userId]
  );
  appointmentId = Number(appointment.rows[0].id);
});

after(async () => {
  await pool.query("delete from documents where patient_id = $1", [patientId]);
  await pool.query("delete from scan_sessions where patient_id = $1", [patientId]);
  await pool.query("delete from appointments_v2.bookings where id = $1", [v2BookingId]);
  await pool.query("delete from appointments where id = $1", [appointmentId]);
  await pool.query("delete from appointments_v2.policy_versions where id = $1", [policyVersionId]);
  await pool.query("delete from appointments_v2.policy_sets where id = $1", [policySetId]);
  await pool.query("delete from modalities where id = $1", [modalityId]);
  await pool.query("delete from patients where id = $1", [patientId]);
  await pool.query("delete from audit_log where changed_by_user_id = $1", [userId]);
  await pool.query("delete from users where id = $1", [userId]);
  await pool.end();
});

describe("scan session service", () => {
  it("creates HMAC-backed launch sessions and uploads scanner app documents", async () => {
    const created = await createScanSession({
      appointmentId,
      appointmentRefType: "legacy_appointment",
      patientId,
      documentType: "appointment_request",
      currentUserId: userId,
    });

    assert.equal(Object.hasOwn(created, "token"), false);
    assert.match(created.launchUrl, /^rispro-scanner:\/\/scan\?token=/);

    const token = tokenFromLaunchUrl(created.launchUrl);
    assert.ok(token.length > 20);

    const stored = await pool.query("select token_hash from scan_sessions where patient_id = $1 order by id desc limit 1", [patientId]);
    assert.notEqual(stored.rows[0].token_hash, token);

    const context = await getScanSessionContextByToken(token);
    assert.equal(context.patient.id, patientId);
    assert.equal(context.appointment.id, appointmentId);

    await markScanSessionOpened(token, { workstationName: "TEST-PC", appVersion: "0.1.0-test" });
    const upload = await uploadScanSessionDocument(token, {
      fileBuffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
      originalFilename: "scan.pdf",
      mimeType: "application/pdf",
      pageCount: 1,
      scannerName: "Test Scanner",
      workstationName: "TEST-PC",
      appVersion: "0.1.0-test",
    });

    assert.equal(Number(upload.document.patient_id), patientId);
    assert.equal(Number(upload.document.appointment_id), appointmentId);
    assert.equal(upload.document.source, "scanner_app");
    assert.equal(upload.document.page_count, 1);

    await assert.rejects(
      () => uploadScanSessionDocument(token, {
        fileBuffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
        originalFilename: "again.pdf",
        mimeType: "application/pdf",
      }),
      (error: unknown) => error instanceof HttpError && error.statusCode === 409
    );
  });

  it("cancels sessions and rejects later context", async () => {
    const created = await createScanSession({
      appointmentId,
      appointmentRefType: "legacy_appointment",
      patientId,
      documentType: "appointment_request",
      currentUserId: userId,
    });
    const token = tokenFromLaunchUrl(created.launchUrl);
    await cancelScanSession(token, { lastError: "User cancelled." });

    await assert.rejects(
      () => getScanSessionContextByToken(token),
      (error: unknown) => error instanceof HttpError && error.statusCode === 409
    );
  });

  it("uses the authoritative V2 scan-session document type despite conflicting upload fields", async () => {
    const clinicalSession = await createScanSession({
      appointmentId: v2BookingId,
      appointmentRefType: "v2_booking",
      patientId,
      documentType: "clinical_document",
      currentUserId: userId,
    });
    const clinicalToken = tokenFromLaunchUrl(clinicalSession.launchUrl);
    const clinicalContext = await getScanSessionContextByToken(clinicalToken);
    assert.equal(clinicalContext.documentType, "clinical_document");

    const conflictingClinicalUpload = {
      fileBuffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
      originalFilename: "clinical-scan.pdf",
      mimeType: "application/pdf",
      documentType: "appointment_request",
    };
    const clinicalUpload = await uploadScanSessionDocument(clinicalToken, conflictingClinicalUpload);
    assert.equal(clinicalUpload.document.document_type, "clinical_document");
    assert.equal(clinicalUpload.document.source, "scanner_app");
    assert.equal(Number(clinicalUpload.document.v2_booking_id), v2BookingId);
    assert.equal(clinicalUpload.document.appointment_id, null);

    const requestSession = await createScanSession({
      appointmentId: v2BookingId,
      appointmentRefType: "v2_booking",
      patientId,
      documentType: "appointment_request",
      currentUserId: userId,
    });
    const requestToken = tokenFromLaunchUrl(requestSession.launchUrl);
    const requestContext = await getScanSessionContextByToken(requestToken);
    assert.equal(requestContext.documentType, "appointment_request");

    const conflictingRequestUpload = {
      fileBuffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
      originalFilename: "request-scan.pdf",
      mimeType: "application/pdf",
      documentType: "clinical_document",
    };
    const requestUpload = await uploadScanSessionDocument(requestToken, conflictingRequestUpload);
    assert.equal(requestUpload.document.document_type, "appointment_request");
    assert.equal(requestUpload.document.source, "scanner_app");
    assert.equal(Number(requestUpload.document.v2_booking_id), v2BookingId);
    assert.equal(requestUpload.document.appointment_id, null);
  });
});
