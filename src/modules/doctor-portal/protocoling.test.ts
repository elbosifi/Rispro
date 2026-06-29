import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const root = process.cwd();

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

    assert.match(repo, /appointments_v2\.bookings/);
    assert.match(repo, /appointment_protocol_assignments/);
    assert.match(repo, /upper\(m\.code\) in \('CT', 'MRI'\)/);
    assert.match(repo, /protocol_name/);
    assert.match(repo, /version_number/);
    assert.match(repo, /scanner_name/);
    assert.match(repo, /coalesce\(apa\.status, 'NOT_PROTOCOLLED'\)/);
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
  });

  it("returns assigned protocol CT phases and MRI sequences for read-only assignment detail", () => {
    const repo = readFileSync(`${root}/src/modules/doctor-portal/protocoling-repository.ts`, "utf8");

    assert.match(repo, /protocol_ct_phases/);
    assert.match(repo, /protocol_mri_sequences/);
    assert.match(repo, /ct_phase_preset_name/);
    assert.match(repo, /mri_sequence_preset_name/);
  });
});
