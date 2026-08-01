import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { getModalityProtocolAssignment } from "../../modality/protocol-assignment.service.js";

type QueryCall = { sql: string; values?: unknown[] };

function executor(rowsByCall: Array<Array<Record<string, unknown>>>) {
  const calls: QueryCall[] = [];
  return {
    calls,
    async query<T = Record<string, unknown>>(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: (rowsByCall[calls.length - 1] ?? []) as T[] };
    },
  };
}

test("modality protocol assignment returns CT assignment with CT phases", async () => {
  const db = executor([
    [{
      assignment_id: 11,
      appointment_id: 101,
      protocol_id: 21,
      protocol_version_id: 31,
      protocol_name: "CT Abdomen",
      version_number: "1.2",
      modality: "CT",
      scanner_id: 41,
      scanner_name: "GE Revolution",
      scanner_vendor: "GE",
      protocol_notes: "Renal protocol",
      contrast_notes: "IV contrast",
      assigned_by: "Dr. Protocol",
      assigned_at: "2026-06-29T08:00:00Z",
      status: "ASSIGNED",
    }],
    [{
      order_index: 1,
      phase_preset_name: "Portal venous",
      custom_phase_name: null,
      contrast_status: "POST_CONTRAST",
      timing_type: "FIXED_DELAY",
      delay_seconds: 70,
      timing_override: null,
      coverage: "abdomen",
      coverage_override: "Liver to symphysis",
      reconstruction_notes: "Soft tissue",
      reconstruction_override: null,
      instructions: "Breath hold",
      instructions_override: null,
      is_required: true,
    }],
    [],
  ]);

  const assignment = await getModalityProtocolAssignment(101, db);

  assert.equal(assignment?.assignment_id, 11);
  assert.equal(assignment?.modality, "CT");
  assert.equal(assignment?.scanner_vendor, "GE");
  assert.equal(assignment?.ct_phases.length, 1);
  assert.equal(assignment?.ct_phases[0].coverage_override, "Liver to symphysis");
  assert.deepEqual(db.calls.map((call) => call.values), [[101], [31]]);
});

test("modality protocol assignment returns MRI assignment with MRI sequences", async () => {
  const db = executor([
    [{
      assignment_id: 12,
      appointment_id: 102,
      protocol_id: 22,
      protocol_version_id: 32,
      protocol_name: "MRI Rectum Primary Staging",
      version_number: "1.2",
      modality: "MRI",
      scanner_id: 42,
      scanner_name: "Philips Ingenia Elition 3T",
      scanner_vendor: "Philips",
      protocol_notes: "Rectum protocol",
      contrast_notes: "Buscopan if allowed",
      assigned_by: "Dr. Protocol",
      assigned_at: "2026-06-29T08:05:00Z",
      status: "MODIFIED",
    }],
    [{
      order_index: 1,
      scanner_id: 42,
      scanner_name: "Philips Ingenia Elition 3T",
      sequence_preset_name: "T2 TSE",
      vendor_sequence_name: "T2W TSE",
      generic_family: "TSE",
      weighting: "T2",
      default_plane: "axial",
      plane_override: "oblique axial",
      default_coverage: "pelvis",
      coverage_override: "rectum-centered",
      default_b_values: "0, 800",
      b_values_override: null,
      default_dynamic_timing: null,
      timing_override: "pre-contrast",
      notes: "Small FOV",
      notes_override: null,
      is_required: true,
    }],
  ]);

  const assignment = await getModalityProtocolAssignment(102, db);

  assert.equal(assignment?.modality, "MRI");
  assert.equal(assignment?.mri_sequences.length, 1);
  assert.equal(assignment?.mri_sequences[0].plane_override, "oblique axial");
  assert.equal(assignment?.mri_sequences[0].vendor_sequence_name, "T2W TSE");
});

test("modality protocol assignment prefers scanner-specific MRI sequence alias", async () => {
  const db = executor([
    [{
      assignment_id: 13,
      appointment_id: 104,
      protocol_id: 22,
      protocol_version_id: 32,
      protocol_name: "MRI Rectum Primary Staging",
      version_number: "1.2",
      modality: "MRI",
      scanner_id: 42,
      scanner_name: "Philips Ingenia Elition 3T",
      scanner_vendor: "Philips",
      protocol_notes: "Rectum protocol",
      contrast_notes: "Buscopan if allowed",
      assigned_by: "Dr. Protocol",
      assigned_at: "2026-06-29T08:05:00Z",
      status: "ASSIGNED",
    }],
    [{
      order_index: 1,
      scanner_id: 42,
      scanner_name: "Philips Ingenia Elition 3T",
      sequence_preset_name: "T2 TSE",
      vendor_sequence_name: "T2W_TSE_ALIAS",
      generic_family: "TSE",
      weighting: "T2",
      default_plane: "axial",
      plane_override: "oblique axial",
      default_coverage: "pelvis",
      coverage_override: "rectum-centered",
      default_b_values: null,
      b_values_override: null,
      default_dynamic_timing: null,
      timing_override: null,
      notes: "Small FOV",
      notes_override: null,
      is_required: true,
    }],
  ]);

  const assignment = await getModalityProtocolAssignment(104, db);

  assert.equal(assignment?.mri_sequences[0].vendor_sequence_name, "T2W_TSE_ALIAS");
  assert.match(db.calls[1].sql, /mri_sequence_scanner_aliases/i);
});

test("modality protocol assignment returns null when no active assignment exists", async () => {
  const db = executor([[]]);

  const assignment = await getModalityProtocolAssignment(103, db);

  assert.equal(assignment, null);
  assert.equal(db.calls.length, 1);
});

test("modality protocol assignment returns free-text CT without querying phase tables", async () => {
  const db = executor([[{
    assignment_id: 14, appointment_id: 105, protocol_id: null, protocol_version_id: null,
    protocol_name: null, version_number: null, free_text_protocol: "Non-contrast CT abdomen",
    modality: "CT", scanner_id: null, scanner_name: null, scanner_vendor: null,
    protocol_notes: "Patient specific", contrast_notes: null, assigned_by: "Dr. Protocol",
    assigned_at: "2026-06-29T08:00:00Z", status: "ASSIGNED",
  }]]);
  const assignment = await getModalityProtocolAssignment(105, db);
  assert.equal(assignment?.protocol_id, null);
  assert.equal(assignment?.protocol_version_id, null);
  assert.equal(assignment?.protocol_name, null);
  assert.equal(assignment?.version_number, null);
  assert.equal(assignment?.free_text_protocol, "Non-contrast CT abdomen");
  assert.deepEqual(assignment?.ct_phases, []);
  assert.deepEqual(assignment?.mri_sequences, []);
  assert.equal(db.calls.length, 1);
});

test("modality protocol assignment returns free-text MRI using booking modality", async () => {
  const db = executor([[{
    assignment_id: 15, appointment_id: 106, protocol_id: null, protocol_version_id: null,
    protocol_name: null, version_number: null, free_text_protocol: "MRI brain with contrast",
    modality: "MRI", scanner_id: null, scanner_name: null, scanner_vendor: null,
    protocol_notes: null, contrast_notes: "Check eGFR", assigned_by: null,
    assigned_at: null, status: "MODIFIED",
  }]]);
  const assignment = await getModalityProtocolAssignment(106, db);
  assert.equal(assignment?.modality, "MRI");
  assert.equal(assignment?.free_text_protocol, "MRI brain with contrast");
  assert.equal(db.calls.length, 1);
});

test("modality protocol assignment excludes cancelled assignments and appointments", () => {
  const source = readFileSync(join(process.cwd(), "src/modules/appointments-v2/modality/protocol-assignment.service.ts"), "utf8");

  assert.match(source, /assignment\.status <> 'CANCELLED'/);
  assert.match(source, /booking\.status not in \('cancelled', 'discontinued', 'voided'\)/);
});

test("modality protocol assignment route is read-only and modality guarded", () => {
  const source = readFileSync(join(process.cwd(), "src/modules/appointments-v2/api/routes/read-v2-routes.ts"), "utf8");
  const routeBlock = source.match(/router\.get\(\s*"\/modality\/appointments\/:appointmentId\/protocol-assignment"[\s\S]*?\n\);/)?.[0] ?? "";

  assert.match(routeBlock, /requirePageAccess\("modality"\)/);
  assert.doesNotMatch(routeBlock, /router\.(post|put|patch|delete)\(/);
  assert.match(routeBlock, /getModalityProtocolAssignment\(appointmentId\)/);
});
