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
    assert.match(routes, /protocol_assignment\.version_number as protocol_version_number/);
    assert.match(routes, /protocol_assignment\.scanner_name as protocol_scanner_name/);
    assert.match(routes, /protocol_assignment\.protocol_notes as assigned_protocol_notes/);
    assert.match(routes, /protocol_assignment\.contrast_notes as assigned_contrast_notes/);
    assert.match(routes, /select \*\s+from filtered/i);
    assert.match(routes, /where b\.id = \$1/);
  });

  it("only exposes the active non-cancelled CT/MRI assignment summary", () => {
    const routes = readFileSync(`${root}/src/modules/appointments-v2/api/routes/read-v2-routes.ts`, "utf8");

    assert.match(routes, /from appointment_protocol_assignments assignment/);
    assert.match(routes, /assignment\.appointment_id = b\.id/);
    assert.match(routes, /assignment\.status <> 'CANCELLED'/);
    assert.match(routes, /upper\(protocol\.modality\) in \('CT', 'MRI'\)/);
    assert.match(routes, /order by assignment\.updated_at desc, assignment\.id desc/);
    assert.match(routes, /limit 1/);
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
});
