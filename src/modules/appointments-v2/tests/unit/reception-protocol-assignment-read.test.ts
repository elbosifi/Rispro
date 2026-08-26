import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const root = process.cwd();

describe("Reception protocol assignment read summary", () => {
  it("enriches Reception appointment list and detail payloads with assigned protocol summary fields", () => {
    const routes = readFileSync(`${root}/src/modules/appointments-v2/api/routes/read-v2-routes.ts`, "utf8");

    assert.match(routes, /PROTOCOL_ASSIGNMENT_SELECT/);
    assert.match(routes, /protocol_assignment\.assignment_id as protocol_assignment_id/);
    assert.match(routes, /protocol_assignment\.protocol_id as assigned_protocol_id/);
    assert.match(routes, /free_text_protocol as assigned_free_text_protocol/);
    assert.match(routes, /protocol_assignment\.version_number as protocol_version_number/);
    assert.match(routes, /protocol_assignment\.scanner_name as protocol_scanner_name/);
    assert.match(routes, /protocol_assignment\.protocol_notes as assigned_protocol_notes/);
    assert.match(routes, /protocol_assignment\.contrast_notes as assigned_contrast_notes/);
    assert.match(routes, /select \*\s+from filtered/i);
    assert.match(routes, /where b\.id = \$1/);
  });

  it("includes complementary linkage fields in the single appointment detail read", () => {
    const routes = readFileSync(`${root}/src/modules/appointments-v2/api/routes/read-v2-routes.ts`, "utf8");
    const detailRoute = routes.match(/router\.get\(\s*"\/appointments\/:id"[\s\S]*?\n\);/)?.[0] ?? "";

    assert.match(detailRoute, /left join appointments_v2\.complementary_recall_requests complementary_return on complementary_return\.recall_appointment_id = b\.id/);
    assert.match(detailRoute, /left join appointments_v2\.bookings original_booking on original_booking\.id = complementary_return\.original_appointment_id/);
    assert.match(detailRoute, /left join exam_types original_exam on original_exam\.id = original_booking\.exam_type_id/);
    assert.match(detailRoute, /\(complementary_return\.id is not null\) as is_additional_imaging/);
    assert.match(detailRoute, /complementary_return\.original_appointment_id/);
    assert.match(detailRoute, /\('V2-' \|\| lpad\(complementary_return\.original_appointment_id::text, 6, '0'\)\) as original_accession/);
    assert.match(detailRoute, /original_exam\.name_en as original_exam/);
    assert.match(detailRoute, /original_exam\.name_ar as original_exam_ar/);
    assert.match(detailRoute, /original_exam\.name_en as original_exam_en/);
  });

  it("includes complementary linkage fields in the Registration appointment list read", () => {
    const routes = readFileSync(`${root}/src/modules/appointments-v2/api/routes/read-v2-routes.ts`, "utf8");
    const listRoute = routes.match(/router\.get\(\s*"\/appointments"[\s\S]*?\n\);/)?.[0] ?? "";

    assert.match(listRoute, /left join appointments_v2\.complementary_recall_requests complementary_return on complementary_return\.recall_appointment_id = b\.id/);
    assert.match(listRoute, /left join appointments_v2\.bookings original_booking on original_booking\.id = complementary_return\.original_appointment_id/);
    assert.match(listRoute, /left join exam_types original_exam on original_exam\.id = original_booking\.exam_type_id/);
    assert.match(listRoute, /\(complementary_return\.id is not null\) as is_additional_imaging/);
    assert.match(listRoute, /complementary_return\.original_appointment_id/);
    assert.match(listRoute, /\('V2-' \|\| lpad\(complementary_return\.original_appointment_id::text, 6, '0'\)\) as original_accession/);
    assert.match(listRoute, /original_exam\.name_en as original_exam/);
    assert.match(listRoute, /original_exam\.name_ar as original_exam_ar/);
    assert.match(listRoute, /original_exam\.name_en as original_exam_en/);
  });

  it("only exposes the active non-cancelled CT/MRI assignment summary", () => {
    const routes = readFileSync(`${root}/src/modules/appointments-v2/api/routes/read-v2-routes.ts`, "utf8");

    assert.match(routes, /from appointment_protocol_assignments assignment/);
    assert.match(routes, /assignment\.appointment_id = b\.id/);
    assert.match(routes, /assignment\.status <> 'CANCELLED'/);
    assert.match(routes, /left join protocols protocol/);
    assert.match(routes, /left join protocol_versions version/);
    assert.match(routes, /coalesce\(protocol\.modality/);
    assert.match(routes, /order by assignment\.updated_at desc, assignment\.id desc/);
    assert.match(routes, /limit 1/);
  });

  it("exposes only a read-only, Registration-guarded full assignment endpoint", () => {
    const routes = readFileSync(`${root}/src/modules/appointments-v2/api/routes/read-v2-routes.ts`, "utf8");
    const routeBlock = routes.match(/router\.get\(\s*"\/registrations\/appointments\/:appointmentId\/protocol-assignment"[\s\S]*?\n\);/)?.[0] ?? "";
    assert.match(routeBlock, /requirePageAccess\("registrations"\)/);
    assert.match(routeBlock, /getModalityProtocolAssignment\(appointmentId\)/);
    assert.match(routeBlock, /Invalid appointment ID/);
    assert.doesNotMatch(routeBlock, /router\.(post|put|patch|delete)\(/);
  });

  it("keeps protocol assignment writes behind Doctor Protocoling access", () => {
    const receptionRoutes = readFileSync(`${root}/src/modules/appointments-v2/api/routes/read-v2-routes.ts`, "utf8");
    const doctorRoutes = readFileSync(`${root}/src/modules/doctor-portal/protocoling-routes.ts`, "utf8");

    assert.doesNotMatch(receptionRoutes, /saveProtocolAssignment/);
    assert.doesNotMatch(receptionRoutes, /cancelProtocolAssignment/);
    assert.match(doctorRoutes, /requireProtocolingAccess\(req\)/);
    assert.match(doctorRoutes, /router\.post\(\s*"\/appointments\/:appointmentId\/assignment"/);
    assert.match(doctorRoutes, /router\.patch\(\s*"\/appointments\/:appointmentId\/assignment"/);
    assert.match(doctorRoutes, /router\.delete\(\s*"\/appointments\/:appointmentId\/assignment"/);
  });

  it("includes request-document protocol eligibility in the single registrations list query", () => {
    const routes = readFileSync(`${root}/src/modules/appointments-v2/api/routes/read-v2-routes.ts`, "utf8");

    assert.match(routes, /isRequestDocumentRequiredForProtocolQueue/);
    assert.match(routes, /qualifyingRequestDocumentExistsSql\("b\.id"\)/);
    assert.match(routes, /protocolingModalityAppliesSql\(`\(\$\{PROTOCOLING_MODALITY_SQL\}\)`\)/);
    assert.match(routes, /require_request_document_for_protocol_queue/);
    assert.match(routes, /protocol_queue_applies_to_appointment/);
    assert.match(routes, /has_qualifying_request_document/);
    assert.doesNotMatch(routes, /rowsWithNotes\.map\(async \(row\)[\s\S]*getRequestDocumentProtocolPolicy/);
  });
});
