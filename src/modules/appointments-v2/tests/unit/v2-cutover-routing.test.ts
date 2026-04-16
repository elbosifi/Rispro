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
  it("/appointments maps to AppointmentsV3CreatePage when flag is enabled", async () => {
    const source = await readFile(appPath, "utf-8");
    assert.ok(source.includes("v3AppointmentsEnabled"));
    assert.ok(source.includes("? <AppointmentsV3CreatePage />"));
  });

  it("/v3/appointments/create redirects to /appointments to avoid duplicate URLs", async () => {
    const source = await readFile(appPath, "utf-8");
    assert.ok(source.includes('<Route path="/v3/appointments/create" element={<Navigate to="/appointments" replace />} />'));
  });

  it("/v2/appointments remains available only for supervisors", async () => {
    const source = await readFile(appPath, "utf-8");
    assert.ok(source.includes('path="/v2/appointments"'));
    assert.ok(source.includes('user.role === "supervisor" ? <AppointmentsV2Page /> : <Navigate to="/appointments" replace />'));
  });

  it("/appointments/legacy route exists and is guarded for supervisors", async () => {
    const source = await readFile(appPath, "utf-8");
    assert.ok(source.includes('path="/appointments/legacy"'));
    assert.ok(source.includes('user.role === "supervisor" ? <AppointmentsPage /> : <Navigate to="/appointments" replace />'));
  });
});

describe("V3 controlled cutover — navigation", () => {
  it("keeps a single primary appointments nav item for normal users", async () => {
    const source = await readFile(navPath, "utf-8");
    assert.ok(source.includes('route: "appointments"'));
    assert.ok(!source.includes('route: "v2.appointments",'));
    assert.ok(!source.includes('route: "v3.appointments.create",'));
  });

  it("has supervisor-only legacy appointments nav entry", async () => {
    const source = await readFile(navPath, "utf-8");
    assert.ok(source.includes('route: "appointments.legacy"'));
    assert.ok(source.includes('labelKey: "nav.appointmentsLegacy"'));
    assert.ok(source.includes('roles: ["supervisor"]'));
  });

  it("keeps supervisor V2 admin nav entry", async () => {
    const source = await readFile(navPath, "utf-8");
    assert.ok(source.includes('route: "v2.appointments.admin"'));
    assert.ok(source.includes('roles: ["supervisor"]'));
  });
});
