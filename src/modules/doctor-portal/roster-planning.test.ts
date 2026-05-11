import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("Doctor Portal roster planning", () => {
  it("adds roster notification records without patient data", () => {
    const migration = readFileSync(join(rootDir, "src", "db", "migrations", "071_doctor_portal_roster_notifications.sql"), "utf8");
    assert.match(migration, /doctor_portal\.doctor_roster_notifications/);
    assert.match(migration, /roster_week_id/);
    assert.match(migration, /doctor_id/);
    assert.doesNotMatch(migration, /appointment|patient|salary|rvu|revenue/i);
  });

  it("mounts generator, export, and notification routes under roster only", () => {
    const routes = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-routes.ts"), "utf8");
    assert.match(routes, /"\/generate-draft"/);
    assert.match(routes, /"\/weeks\/:id\/export"/);
    assert.match(routes, /"\/weeks\/:id\/notify"/);
    assert.doesNotMatch(routes, /createBooking|reschedule|capacity|payroll|salary|rvu/i);
  });

  it("keeps generated rosters draft-only and manager-gated", () => {
    const service = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-planning-service.ts"), "utf8");
    const repo = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-planning-repository.ts"), "utf8");
    assert.match(service, /requireRosterManager\(actor\)/);
    assert.match(repo, /status !== "draft"/);
    assert.doesNotMatch(repo, /publishWeek|status = 'published'/);
  });

  it("exports roster-only content and notification records only assigned doctors", () => {
    const service = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-planning-service.ts"), "utf8");
    const repo = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-planning-repository.ts"), "utf8");
    assert.match(service, /buildCsv/);
    assert.match(service, /buildHtml/);
    assert.match(repo, /select distinct rm\.doctor_id/);
    assert.doesNotMatch(`${service}\n${repo}`, /appointments_v2\.bookings|patients|individual productivity|salary|payment/i);
  });
});
