/**
 * Appointments V3 — Controlled cutover routing tests.
 *
 * Lightweight source assertions for frontend route and navigation wiring.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/App.tsx";
const navPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/components/layout/navigation.tsx";

describe("V3 controlled cutover — App routes", () => {
  it("/appointments maps to AppointmentsV3CreatePage", async () => {
    const source = await readFile(appPath, "utf-8");
    assert.ok(source.includes('<Route path="/appointments" element={<AppointmentsV3CreatePage />} />'));
  });

  it("/v2/appointments is retired from normal use and redirects to /appointments", async () => {
    const source = await readFile(appPath, "utf-8");
    assert.ok(source.includes('<Route path="/v2/appointments" element={<Navigate to="/appointments" replace />} />'));
  });

  it("/appointments/legacy is retired from normal use and redirects to /appointments", async () => {
    const source = await readFile(appPath, "utf-8");
    assert.ok(source.includes('<Route path="/appointments/legacy" element={<Navigate to="/appointments" replace />} />'));
  });

  it("keeps /v2/appointments/admin as supervisor-only policy admin route", async () => {
    const source = await readFile(appPath, "utf-8");
    assert.ok(source.includes('path="/v2/appointments/admin"'));
    assert.ok(source.includes('user.role === "supervisor" ? <SchedulingAdminV2Page /> : <Navigate to="/appointments" replace />'));
  });
});

describe("V3 controlled cutover — navigation", () => {
  it("keeps a single primary appointments nav item for normal users", async () => {
    const source = await readFile(navPath, "utf-8");
    assert.ok(source.includes('route: "appointments"'));
    assert.ok(!source.includes('route: "v2.appointments",'));
    assert.ok(!source.includes('route: "v3.appointments.create",'));
  });

  it("does not include legacy appointments nav entry", async () => {
    const source = await readFile(navPath, "utf-8");
    assert.ok(!source.includes('route: "appointments.legacy"'));
  });

  it("keeps supervisor V2 admin nav entry", async () => {
    const source = await readFile(navPath, "utf-8");
    assert.ok(source.includes('route: "v2.appointments.admin"'));
    assert.ok(source.includes('roles: ["supervisor"]'));
  });
});
