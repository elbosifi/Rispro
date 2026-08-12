import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { pool } from "../../db/pool.js";
import { HttpError } from "../../utils/http-error.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { settingsRouter } from "../../routes/settings.js";
import { documentsRouter } from "../../routes/documents.js";
import { upsertSettings } from "../../services/settings-service.js";
import {
  REQUEST_DOCUMENT_PROTOCOL_SETTING_CATEGORY,
  REQUEST_DOCUMENT_PROTOCOL_SETTING_KEY,
  isRequestDocumentRequiredForProtocolQueue,
  type RequestDocumentProtocolPolicy,
} from "../../services/request-document-protocol-policy.js";
import { listProtocolingAppointments, saveProtocolAssignment } from "./protocoling-repository.js";
import {
  canReachDatabase,
  createTestAuthCookie,
  createTestSupervisorReauthCookie,
  fetchJson,
} from "../appointments-v2/tests/integration/helpers.js";

const TEST_DATE = "2041-06-15";
const OTHER_DATE = "2041-06-16";

type Fixture = {
  userId: number;
  patientId: number;
  otherPatientId: number;
  modalityIds: { ct: number; mri: number; us: number; mammo: number };
  examTypeIds: { ct: number; mri: number; us: number; mammo: number };
  policySetId: number;
  policyVersionId: number;
  bookingIds: number[];
  documentIds: number[];
};

let fixture: Fixture | null = null;
let app: { baseUrl: string; close: () => Promise<void> } | null = null;
let previousSetting: { setting_value: unknown; updated_by_user_id: number | null } | null = null;

async function setRequirement(enabled: boolean): Promise<void> {
  await upsertSettings(
    REQUEST_DOCUMENT_PROTOCOL_SETTING_CATEGORY,
    [{ key: REQUEST_DOCUMENT_PROTOCOL_SETTING_KEY, value: enabled ? "enabled" : "disabled" }],
    fixture!.userId
  );
}

async function createPatient(label: string): Promise<number> {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 11);
  const nationalId = `7${suffix.replace(/\D/g, "7").padEnd(11, "7").slice(0, 11)}`;
  const result = await pool.query<{ id: number }>(
    `insert into patients (
       arabic_full_name, english_full_name, national_id, normalized_arabic_name,
       sex, age_years, phone_1, identifier_type, identifier_value
     ) values ($1, $2, $3::varchar, $1, 'F', 40, '0912345678', 'national_id', $3::text)
     returning id`,
    [`Protocol Request ${label}`, `Protocol Request ${label}`, nationalId]
  );
  return Number(result.rows[0]!.id);
}

async function createBooking(input: {
  patientId?: number;
  modality: keyof Fixture["modalityIds"];
  date?: string;
  status?: string;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `insert into appointments_v2.bookings (
       patient_id, modality_id, exam_type_id, booking_date, booking_time,
       case_category, requires_report, status, policy_version_id,
       capacity_resolution_mode, uses_special_quota, is_walk_in, created_by_user_id
     ) values ($1, $2, $3, $4::date, '09:00', 'non_oncology', true, $5, $6, 'standard', false, false, $7)
     returning id`,
    [
      input.patientId ?? fixture!.patientId,
      fixture!.modalityIds[input.modality],
      fixture!.examTypeIds[input.modality],
      input.date ?? TEST_DATE,
      input.status ?? "scheduled",
      fixture!.policyVersionId,
      fixture!.userId,
    ]
  );
  const id = Number(result.rows[0]!.id);
  fixture!.bookingIds.push(id);
  return id;
}

async function createSettingsTestApp(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const http = await import("node:http");
  const testApp = express();
  testApp.use(express.json());
  testApp.use(cookieParser());
  testApp.use("/api/settings", settingsRouter);
  testApp.use("/api/documents", documentsRouter);
  testApp.use(errorHandler);
  const server = http.createServer(testApp);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function createDocument(input: {
  patientId?: number;
  bookingId?: number | null;
  documentType?: string;
  linkBookingId?: number;
}): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `insert into documents (
       patient_id, v2_booking_id, document_type, original_filename, stored_path,
       mime_type, file_size, storage_location_type, source, uploaded_by_user_id
     ) values ($1, $2, $3, $4, $4, 'application/pdf', 10, 'local_fallback', 'manual_upload', $5)
     returning id`,
    [input.patientId ?? fixture!.patientId, input.bookingId ?? null, input.documentType ?? "appointment_request", `protocol-request-${randomUUID()}.pdf`, fixture!.userId]
  );
  const id = Number(result.rows[0]!.id);
  fixture!.documentIds.push(id);
  if (input.linkBookingId) {
    await pool.query("insert into document_appointment_links(document_id, appointment_id) values ($1, $2)", [id, input.linkBookingId]);
  }
  return id;
}

function assignmentInput(text: string) {
  return { protocolId: null, scannerId: null, protocolNotes: null, contrastNotes: null, freeTextProtocol: text, status: "ASSIGNED" as const };
}

describe("request-document protocol queue policy", () => {
  before(async () => {
    if (!await canReachDatabase()) return;
    const previous = await pool.query<{ setting_value: unknown; updated_by_user_id: number | null }>(
      `select setting_value, updated_by_user_id from system_settings
       where category=$1 and setting_key=$2`,
      [REQUEST_DOCUMENT_PROTOCOL_SETTING_CATEGORY, REQUEST_DOCUMENT_PROTOCOL_SETTING_KEY]
    );
    previousSetting = previous.rows[0] ?? null;
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const user = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, 'test-hash', $2, 'supervisor', true) returning id`,
      [`protocol_request_${suffix}`, `Protocol Request ${suffix}`]
    );
    const userId = Number(user.rows[0]!.id);
    const policySet = await pool.query<{ id: number }>(
      `insert into appointments_v2.policy_sets(key, name, created_by_user_id)
       values ($1, $2, $3) returning id`,
      [`protocol_request_${suffix}_policy`, `Protocol Request ${suffix} Policy`, userId]
    );
    const policySetId = Number(policySet.rows[0]!.id);
    const policyVersion = await pool.query<{ id: number }>(
      `insert into appointments_v2.policy_versions(
         policy_set_id, version_no, status, config_hash, created_by_user_id, published_at, published_by_user_id
       ) values ($1, 1, 'published', $2, $3, now(), $3) returning id`,
      [policySetId, `protocol_request_${suffix}_hash`, userId]
    );
    const modalityIds = {} as Fixture["modalityIds"];
    const examTypeIds = {} as Fixture["examTypeIds"];
    for (const [key, code] of [["ct", "CT"], ["mri", "MRI"], ["us", "US"], ["mammo", "MAMMO"]] as const) {
      const modality = await pool.query<{ id: number }>(
        `insert into modalities (code, name_ar, name_en, daily_capacity, is_active)
         values ($1, $2, $2, 20, true) returning id`,
        [`${code}${suffix}`, `${code} Protocol Request ${suffix}`]
      );
      modalityIds[key] = Number(modality.rows[0]!.id);
      const exam = await pool.query<{ id: number }>(
        `insert into exam_types (modality_id, code, name_ar, name_en, is_active)
         values ($1, $2, $3, $3, true) returning id`,
        [modalityIds[key], `${code}EX${suffix}`, `${code} Exam ${suffix}`]
      );
      examTypeIds[key] = Number(exam.rows[0]!.id);
    }
    fixture = {
      userId,
      patientId: await createPatient(`Primary ${suffix}`),
      otherPatientId: await createPatient(`Other ${suffix}`),
      modalityIds,
      examTypeIds,
      policySetId,
      policyVersionId: Number(policyVersion.rows[0]!.id),
      bookingIds: [],
      documentIds: [],
    };
    app = await createSettingsTestApp();
    await setRequirement(false);
  });

  after(async () => {
    if (!fixture) return;
    await app?.close();
    await pool.query("delete from appointment_protocol_assignments where appointment_id=any($1::bigint[])", [fixture.bookingIds]);
    await pool.query("delete from documents where id=any($1::bigint[])", [fixture.documentIds]);
    await pool.query("delete from appointments_v2.bookings where id=any($1::bigint[])", [fixture.bookingIds]);
    await pool.query("delete from appointments_v2.policy_versions where id=$1", [fixture.policyVersionId]);
    await pool.query("delete from appointments_v2.policy_sets where id=$1", [fixture.policySetId]);
    await pool.query("delete from exam_types where id=any($1::bigint[])", [Object.values(fixture.examTypeIds)]);
    await pool.query("delete from modalities where id=any($1::bigint[])", [Object.values(fixture.modalityIds)]);
    await pool.query("delete from patients where id=any($1::bigint[])", [[fixture.patientId, fixture.otherPatientId]]);
    await pool.query("delete from audit_log where changed_by_user_id=$1", [fixture.userId]);
    await pool.query(
      "delete from system_settings where category=$1 and setting_key=$2",
      [REQUEST_DOCUMENT_PROTOCOL_SETTING_CATEGORY, REQUEST_DOCUMENT_PROTOCOL_SETTING_KEY]
    );
    if (previousSetting) {
      await pool.query(
        `insert into system_settings(category, setting_key, setting_value, updated_by_user_id)
         values ($1, $2, $3::jsonb, $4)`,
        [REQUEST_DOCUMENT_PROTOCOL_SETTING_CATEGORY, REQUEST_DOCUMENT_PROTOCOL_SETTING_KEY, JSON.stringify(previousSetting.setting_value), previousSetting.updated_by_user_id]
      );
    }
    await pool.query("delete from users where id=$1", [fixture.userId]);
    await pool.end();
  });

  it("defaults to disabled and persists changes through the existing settings mechanism", async () => {
    if (!fixture) return;
    const migration = await import("node:fs/promises").then((fs) => fs.readFile("src/db/migrations/164_require_request_document_for_protocol_queue.sql", "utf8"));
    assert.match(migration, /"disabled"/);
    assert.equal(await isRequestDocumentRequiredForProtocolQueue(), false);
    const indexes = await pool.query<{ indexname: string }>(
      `select indexname from pg_indexes where indexname=any($1::text[])`,
      [["documents_v2_booking_id_idx", "document_appointment_links_appointment_idx"]]
    );
    assert.deepEqual(new Set(indexes.rows.map((row) => row.indexname)), new Set(["documents_v2_booking_id_idx", "document_appointment_links_appointment_idx"]));
    await setRequirement(true);
    assert.equal(await isRequestDocumentRequiredForProtocolQueue(), true);
    await setRequirement(false);
  });

  it("preserves current eligibility when disabled and dynamically requires a same-booking request when enabled", async () => {
    if (!fixture) return;
    const disabledBooking = await createBooking({ modality: "ct" });
    assert.ok((await listProtocolingAppointments({ dateFrom: TEST_DATE, dateTo: TEST_DATE })).some((row) => row.appointmentId === disabledBooking));

    await setRequirement(true);
    const missingBooking = await createBooking({ modality: "ct" });
    const unrelatedBooking = await createBooking({ modality: "ct" });
    const patientOnlyBooking = await createBooking({ modality: "ct" });
    const linkedBooking = await createBooking({ modality: "ct" });
    await createDocument({ bookingId: unrelatedBooking, documentType: "clinical_document" });
    await createDocument({ patientId: fixture.patientId });
    await createDocument({ bookingId: null, linkBookingId: linkedBooking });

    let ids = new Set((await listProtocolingAppointments({ dateFrom: TEST_DATE, dateTo: TEST_DATE })).map((row) => row.appointmentId));
    assert.equal(ids.has(missingBooking), false);
    assert.equal(ids.has(unrelatedBooking), false);
    assert.equal(ids.has(patientOnlyBooking), false);
    assert.equal(ids.has(linkedBooking), true);

    const lateRequestDocumentId = await createDocument({ bookingId: missingBooking });
    ids = new Set((await listProtocolingAppointments({ dateFrom: TEST_DATE, dateTo: TEST_DATE })).map((row) => row.appointmentId));
    assert.equal(ids.has(missingBooking), true, "late request attachment should qualify on the next query");
    await pool.query("delete from documents where id=$1", [lateRequestDocumentId]);
    ids = new Set((await listProtocolingAppointments({ dateFrom: TEST_DATE, dateTo: TEST_DATE })).map((row) => row.appointmentId));
    assert.equal(ids.has(missingBooking), false, "removing the only request should make an unprotocolled appointment ineligible again");
  });

  it("keeps status, date, modality, CT/MRI, and protocol-status filters intact", async () => {
    if (!fixture) return;
    await setRequirement(true);
    const ct = await createBooking({ modality: "ct" });
    const mri = await createBooking({ modality: "mri" });
    const us = await createBooking({ modality: "us" });
    const otherDate = await createBooking({ modality: "ct", date: OTHER_DATE });
    const cancelled = await createBooking({ modality: "ct", status: "cancelled" });
    const discontinued = await createBooking({ modality: "ct", status: "discontinued" });
    const voided = await createBooking({ modality: "ct", status: "voided" });
    for (const bookingId of [ct, mri, us, otherDate, cancelled, discontinued, voided]) await createDocument({ bookingId });

    const all = new Set((await listProtocolingAppointments({ dateFrom: TEST_DATE, dateTo: TEST_DATE, protocolStatus: "NOT_PROTOCOLLED" })).map((row) => row.appointmentId));
    assert.equal(all.has(ct), true);
    assert.equal(all.has(mri), true);
    for (const excluded of [us, otherDate, cancelled, discontinued, voided]) assert.equal(all.has(excluded), false);
    const ctOnly = await listProtocolingAppointments({ dateFrom: TEST_DATE, dateTo: TEST_DATE, modality: "CT" });
    assert.equal(ctOnly.some((row) => row.appointmentId === ct), true);
    assert.equal(ctOnly.some((row) => row.appointmentId === mri), false);

    await saveProtocolAssignment(ct, assignmentInput("Assigned CT protocol"), fixture.userId);
    const assigned = await listProtocolingAppointments({ dateFrom: TEST_DATE, dateTo: TEST_DATE, protocolStatus: "ASSIGNED" });
    assert.equal(assigned.some((row) => row.appointmentId === ct), true);
  });

  it("reports appointment-specific protocol applicability from the protocoling modality definition", async () => {
    if (!fixture || !app) return;
    await setRequirement(true);
    const auth = createTestAuthCookie(fixture.userId, "supervisor");
    const bookings = {
      ct: await createBooking({ modality: "ct" }),
      mri: await createBooking({ modality: "mri" }),
      us: await createBooking({ modality: "us" }),
      mammo: await createBooking({ modality: "mammo" }),
    };

    const globalPolicy = await fetchJson<RequestDocumentProtocolPolicy>(app.baseUrl, "/api/documents/protocol-eligibility-policy", { cookie: auth });
    assert.equal(globalPolicy.status, 200);
    assert.deepEqual(globalPolicy.data, {
      requireRequestDocumentForProtocolQueue: true,
      protocolQueueAppliesToAppointment: null,
      hasQualifyingRequestDocument: null,
    });

    for (const modality of ["ct", "mri"] as const) {
      const response: { status: number; data: RequestDocumentProtocolPolicy } = await fetchJson<RequestDocumentProtocolPolicy>(app.baseUrl, `/api/documents/protocol-eligibility-policy?appointmentId=${bookings[modality]}`, { cookie: auth });
      assert.equal(response.status, 200);
      assert.deepEqual(response.data, {
        requireRequestDocumentForProtocolQueue: true,
        protocolQueueAppliesToAppointment: true,
        hasQualifyingRequestDocument: false,
      });
    }

    for (const modality of ["us", "mammo"] as const) {
      const response: { status: number; data: RequestDocumentProtocolPolicy } = await fetchJson<RequestDocumentProtocolPolicy>(app.baseUrl, `/api/documents/protocol-eligibility-policy?appointmentId=${bookings[modality]}`, { cookie: auth });
      assert.equal(response.status, 200);
      assert.deepEqual(response.data, {
        requireRequestDocumentForProtocolQueue: true,
        protocolQueueAppliesToAppointment: false,
        hasQualifyingRequestDocument: false,
      });
    }
  });

  it("blocks direct assignment only when enabled and the request is missing", async () => {
    if (!fixture) return;
    await setRequirement(true);
    const missing = await createBooking({ modality: "ct" });
    await assert.rejects(
      saveProtocolAssignment(missing, assignmentInput("Blocked protocol"), fixture.userId),
      (error: unknown) => error instanceof HttpError && error.statusCode === 409 && /request document must be attached/i.test(error.message)
    );

    const qualified = await createBooking({ modality: "ct" });
    await createDocument({ bookingId: qualified });
    assert.equal((await saveProtocolAssignment(qualified, assignmentInput("Qualified protocol"), fixture.userId)).appointment.appointmentId, qualified);

    await setRequirement(false);
    const disabled = await createBooking({ modality: "ct" });
    assert.equal((await saveProtocolAssignment(disabled, assignmentInput("Disabled policy protocol"), fixture.userId)).appointment.appointmentId, disabled);
  });

  it("keeps generic settings writes behind supervisor role and recent re-authentication", async () => {
    if (!fixture || !app) return;
    const auth = createTestAuthCookie(fixture.userId, "supervisor");
    const body = { entries: [{ key: REQUEST_DOCUMENT_PROTOCOL_SETTING_KEY, value: "enabled" }] };
    const withoutReauth = await fetchJson(app.baseUrl, "/api/settings/documents_and_uploads", { method: "PUT", cookie: auth, body });
    assert.equal(withoutReauth.status, 403);
    const receptionist = await fetchJson(app.baseUrl, "/api/settings/documents_and_uploads", { method: "PUT", cookie: createTestAuthCookie(fixture.userId, "receptionist"), body });
    assert.equal(receptionist.status, 403);
    const withReauth = await fetchJson(app.baseUrl, "/api/settings/documents_and_uploads", {
      method: "PUT",
      cookie: `${auth}; ${createTestSupervisorReauthCookie(fixture.userId, "supervisor")}`,
      body,
    });
    assert.equal(withReauth.status, 200, JSON.stringify(withReauth.data));
    assert.equal(await isRequestDocumentRequiredForProtocolQueue(), true);
  });
});
