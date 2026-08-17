import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { mock } from "node:test";

const root = process.cwd();

function protocolingAppointmentRow(overrides: Record<string, unknown> = {}) {
  return {
    appointment_id: 101,
    accession_number: "V2-000101",
    patient_id: 1,
    patient_mrn: "MRN-1",
    patient_national_id: null,
    patient_arabic_name: null,
    patient_english_name: "MRI Patient",
    age_years: 44,
    sex: "F",
    appointment_date: "2026-07-03",
    appointment_time: "09:00:00",
    requires_report: true,
    modality_id: 2,
    modality_code: "MR",
    modality_name: "MR",
    modality_safety_workflow_type: "mri_primary_implant_screening",
    mri_primary_screening_result: "no_known_implant_reported",
    exam_type_id: 3,
    exam_type_name: "MRI Brain",
    case_category: null,
    clinical_notes: null,
    appointment_status: "scheduled",
    protocol_status: "NOT_PROTOCOLLED",
    assignment_id: null,
    ...overrides,
  };
}

describe("Doctor Portal protocoling worklist backend", () => {
  it("mounts Library-backed protocoling endpoints separately from legacy protocol text routes", () => {
    const portalRouter = readFileSync(`${root}/src/modules/doctor-portal/index.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/protocoling-routes.ts`, "utf8");

    assert.match(portalRouter, /router\.use\("\/protocoling", doctorProtocolingRouter\)/);
    assert.match(routes, /"\/appointments"/);
    assert.match(routes, /"\/appointments\/:appointmentId"/);
    assert.match(routes, /"\/appointments\/:appointmentId\/assignment"/);
    assert.match(routes, /router\.patch/);
    assert.match(routes, /router\.delete/);
    assert.doesNotMatch(routes, /doctor_portal\.appointment_protocols/);
  });

  it("lists CT and MRI appointments with assignment state from protocol library tables", () => {
    const repo = readFileSync(`${root}/src/modules/doctor-portal/protocoling-repository.ts`, "utf8");
    const modalityPolicy = readFileSync(`${root}/src/services/protocoling-modality.ts`, "utf8");

    assert.match(repo, /appointments_v2\.bookings/);
    assert.match(repo, /appointment_protocol_assignments/);
    assert.match(repo, /protocolingModalityAppliesSql\("protocoling_modality\.modality_code"\)/);
    assert.match(modalityPolicy, /in \('CT', 'MRI'\)/);
    assert.match(modalityPolicy, /upper\(m\.code\) in \('MRI', 'MR'\)/);
    assert.match(repo, /protocol_name/);
    assert.match(repo, /version_number/);
    assert.match(repo, /scanner_name/);
    assert.match(repo, /as accession_number/);
    assert.match(repo, /coalesce\(apa\.status, 'NOT_PROTOCOLLED'\)/);
    assert.match(repo, /b\.requires_report/);
    assert.match(repo, /requiresReport: Boolean\(row\.requires_report\)/);
    assert.match(repo, /appointments_v2\.mri_primary_screenings screening/);
  });

  it("normalizes MR modality rows to MRI in the protocoling worklist", async () => {
    process.env.DATABASE_URL ??= "postgresql://example@example/protocoling_test";
    process.env.JWT_SECRET ??= "protocoling-test-secret";
    const poolModule = await import("../../db/pool.js");
    const queryMock = mock.method(poolModule.pool, "query", async (sql: string) => String(sql).includes("system_settings")
      ? { rows: [] }
      : { rows: [protocolingAppointmentRow()] });

    try {
      const { listProtocolingAppointments } = await import("./protocoling-repository.js");
      const rows = await listProtocolingAppointments({ dateFrom: "2026-07-03", dateTo: "2026-07-03" });

      assert.equal(rows[0].modalityCode, "MRI");
      assert.equal(rows[0].requiresReport, true);
      assert.equal(rows[0].modalitySafetyWorkflowType, "mri_primary_implant_screening");
      assert.equal(rows[0].mriPrimaryScreeningResult, "no_known_implant_reported");
    } finally {
      queryMock.mock.restore();
    }
  });

  it("uses normalized modality filtering for CT, MRI, and non-CT/MRI exclusion", async () => {
    process.env.DATABASE_URL ??= "postgresql://example@example/protocoling_test";
    process.env.JWT_SECRET ??= "protocoling-test-secret";
    const poolModule = await import("../../db/pool.js");
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const queryMock = mock.method(poolModule.pool, "query", async (sql: string, params?: unknown[]) => {
      if (String(sql).includes("system_settings")) return { rows: [] };
      queries.push({ sql, params: params ?? [] });
      return { rows: [protocolingAppointmentRow({ modality_code: "MRI" })] };
    });

    try {
      const { listProtocolingAppointments } = await import("./protocoling-repository.js");
      await listProtocolingAppointments({ dateFrom: "2026-07-03", dateTo: "2026-07-03", modality: "MRI" });
      await listProtocolingAppointments({ dateFrom: "2026-07-03", dateTo: "2026-07-03", modality: "CT" });

      const combinedSql = queries.map((query) => query.sql).join("\n");
      assert.match(combinedSql, /protocoling_modality/i);
      assert.doesNotMatch(combinedSql, /upper\(m\.code\) in \('CT', 'MRI'\)/i);
      assert.doesNotMatch(combinedSql, /and upper\(m\.code\) = \$3/i);
      assert.deepEqual(queries.map((query) => query.params[2]), ["MRI", "CT"]);
    } finally {
      queryMock.mock.restore();
    }
  });

  it("includes generated accession number in protocoling search", () => {
    const repo = readFileSync(`${root}/src/modules/doctor-portal/protocoling-repository.ts`, "utf8");

    assert.match(repo, /\('V2-' \|\| lpad\(b\.id::text, 6, '0'\)\) as accession_number/);
    assert.match(repo, /\('V2-' \|\| lpad\(b\.id::text, 6, '0'\)\) ilike/);
  });

  it("validates active protocol version, appointment modality, scanner modality, and single active assignment", () => {
    const repo = readFileSync(`${root}/src/modules/doctor-portal/protocoling-repository.ts`, "utf8");

    assert.match(repo, /Protocol version must be ACTIVE/);
    assert.match(repo, /Protocol modality must match appointment modality/);
    assert.match(repo, /Scanner modality must match appointment modality/);
    assert.match(repo, /status <> 'CANCELLED'/);
    assert.match(repo, /update appointment_protocol_assignments/);
    assert.match(repo, /insert into appointment_protocol_assignments/);
    assert.match(repo, /assigned_at = now\(\)/);
    assert.match(repo, /assertRequestDocumentProtocolEligibility\(appointmentId\)/);
    assert.match(repo, /scheduleBookingWorklistSync\(appointmentId\)/);
  });

  it("adds a booking-scoped request-document predicate without changing MWL behavior", () => {
    const repo = readFileSync(`${root}/src/modules/doctor-portal/protocoling-repository.ts`, "utf8");
    const policy = readFileSync(`${root}/src/services/request-document-protocol-policy.ts`, "utf8");
    const migration = readFileSync(`${root}/src/db/migrations/164_require_request_document_for_protocol_queue.sql`, "utf8");

    assert.match(repo, /qualifyingRequestDocumentExistsSql\("b\.id"\)/);
    assert.match(policy, /document_type = '\$\{QUALIFYING_REQUEST_DOCUMENT_TYPE\}'/);
    assert.match(policy, /request_document\.v2_booking_id = \$\{bookingIdSql\}/);
    assert.match(policy, /document_appointment_links/);
    assert.match(policy, /A request document must be attached before this appointment can be protocolled\./);
    assert.match(migration, /require_request_document_for_protocol_queue/);
    assert.match(migration, /"disabled"/);
    assert.doesNotMatch(repo, /sante|mwl/i);
  });

  it("returns assigned protocol CT phases and MRI sequences for read-only assignment detail", () => {
    const repo = readFileSync(`${root}/src/modules/doctor-portal/protocoling-repository.ts`, "utf8");

    assert.match(repo, /protocol_ct_phases/);
    assert.match(repo, /protocol_mri_sequences/);
    assert.match(repo, /ct_phase_preset_name/);
    assert.match(repo, /mri_sequence_preset_name/);
  });

  it("supports nullable saved-protocol references with persisted free text and document annotations", () => {
    const migration = readFileSync(`${root}/src/db/migrations/155_doctor_protocol_free_text_annotations.sql`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/protocoling-routes.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/protocoling-repository.ts`, "utf8");
    assert.match(migration, /alter column protocol_id drop not null/);
    assert.match(migration, /free_text_protocol text/);
    assert.match(migration, /doctor_protocol_document_annotations/);
    assert.match(migration, /geometry jsonb/);
    assert.match(routes, /documents\/:documentId\/annotations/);
    assert.match(routes, /freeTextProtocol/);
    assert.match(repo, /Select a saved protocol or enter a free-text protocol/);
    assert.match(repo, /getProtocolingPatientHistory/);
  });

  it("keeps old PACS PatientID lookup authenticated and sends the exact identifier in a POST body", () => {
    const routes = readFileSync(`${root}/src/modules/doctor-portal/protocoling-routes.ts`, "utf8");
    const client = readFileSync(`${root}/frontend/src/lib/api/doctor-portal-reporting.ts`, "utf8");
    assert.match(routes, /router\.post\(\s*"\/appointments\/:appointmentId\/history\/old-patient-id"[\s\S]*?requireProtocolingAccess\(req\)[\s\S]*?asUnknownRecord\(req\.body\)\.patientId/);
    assert.doesNotMatch(routes, /old-patient-id[\s\S]{0,400}req\.query\.patientId/);
    assert.match(client, /history\/old-patient-id`, \{\s*method: "POST",\s*body: JSON\.stringify\(\{ patientId: patientId\.trim\(\) \}\)/);
  });

  it("keeps fast history and fuzzy historical candidates on independently authorized GET routes", () => {
    const routes = readFileSync(`${root}/src/modules/doctor-portal/protocoling-routes.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/protocoling-repository.ts`, "utf8");
    assert.match(routes, /router\.get\(\s*"\/appointments\/:appointmentId\/history"[\s\S]*?requireProtocolingAccess\(req\)[\s\S]*?getProtocolingPatientHistory/);
    assert.match(routes, /router\.get\(\s*"\/appointments\/:appointmentId\/history\/historical-candidates"[\s\S]*?requireProtocolingAccess\(req\)[\s\S]*?getProtocolingHistoricalPacsCandidates/);
    assert.match(repo, /getProtocolingPatientHistory[\s\S]*?getHistoricalPacsReconciliationForPatient/);
    assert.match(repo, /getProtocolingHistoricalPacsCandidates[\s\S]*?discoverHistoricalPacsCandidatesForPatient/);
  });
});
