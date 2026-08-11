import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const root = process.cwd();

describe("comparison request workflow source contract", () => {
  it("links comparison requests to canonical RISpro document storage without duplicating binary columns", () => {
    const migration = readFileSync(`${root}/src/db/migrations/103_comparison_requests.sql`, "utf8");
    const preparationMigration = readFileSync(`${root}/src/db/migrations/163_comparison_preparation_materials.sql`, "utf8");

    assert.match(migration, /create table if not exists comparison_requests/);
    assert.match(migration, /linked_previous_booking_id bigint not null references appointments_v2\.bookings/);
    assert.match(migration, /image_availability_confirmed boolean not null default false/);
    assert.match(migration, /documents_availability_confirmed boolean not null default false/);
    assert.match(migration, /selected_prior_confirmed boolean not null default false/);
    assert.match(migration, /doctor_portal\.comparison_case_assignments/);
    assert.doesNotMatch(migration, /filename|storage_path|mime_type|size_bytes|comparison_request_documents/i);
    assert.doesNotMatch(migration, /alter table doctor_portal\.case_team_assignments/i);
    assert.match(preparationMigration, /create table if not exists comparison_request_documents/);
    assert.match(preparationMigration, /document_id bigint not null references documents\(id\)/);
    assert.match(preparationMigration, /comparison_request_id bigint not null references comparison_requests\(id\) on delete restrict/);
    assert.doesNotMatch(preparationMigration, /filename|storage_path|mime_type|size_bytes|bytea/i);
  });

  it("wires authenticated comparison preparation APIs through canonical services", () => {
    const app = readFileSync(`${root}/src/app.ts`, "utf8");
    const routes = readFileSync(`${root}/src/routes/comparisons.ts`, "utf8");
    const service = readFileSync(`${root}/src/services/comparison-request-service.ts`, "utf8");

    assert.match(app, /app\.use\("\/api\/comparisons", comparisonsRouter\)/);
    assert.match(routes, /comparisonsRouter\.use\(requireAuth\)/);
    assert.match(routes, /"\/patients\/:patientId\/previous-studies"/);
    assert.match(routes, /"\/:comparisonRequestId\/confirm-materials"/);
    assert.match(routes, /"\/:comparisonRequestId\/documents"/);
    assert.match(routes, /uploadComparisonRequestDocument/);
    assert.match(service, /pending_upload_confirmation/);
    assert.match(service, /comparison_materials_confirmed/);
    assert.match(service, /comparison_released_to_reporting_pool/);
    assert.match(service, /comparison_materials_confirmation_denied/);
    assert.match(service, /uploadDocument/);
    assert.match(service, /comparison_request_documents/);
    assert.doesNotMatch(service, /writeFile|stored_path\s*=|fileContentBase64/i);
  });
});
