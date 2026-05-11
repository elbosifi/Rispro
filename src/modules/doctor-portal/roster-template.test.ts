import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("Doctor Portal roster templates", () => {
  it("adds bounded roster template tables", () => {
    const migration = readFileSync(join(rootDir, "src", "db", "migrations", "070_doctor_portal_roster_templates.sql"), "utf8");
    assert.match(migration, /doctor_portal\.roster_templates/);
    assert.match(migration, /doctor_portal\.roster_template_assignments/);
    assert.match(migration, /doctor_portal\.roster_template_members/);
    assert.match(migration, /template_type in \('ct_weekly', 'mri_weekly', 'ultrasound_weekly', 'mammography_weekly', 'mixed_weekly', 'custom'\)/);
    assert.match(migration, /duty_type in \(/);
    assert.match(migration, /team_role text not null check/);
  });

  it("mounts template endpoints under roster only", () => {
    const routes = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-routes.ts"), "utf8");
    const templateRoutes = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-template-routes.ts"), "utf8");
    assert.match(routes, /router\.use\("\/templates", doctorRosterTemplateRouter\)/);
    assert.match(templateRoutes, /"\/:id\/apply"/);
    assert.doesNotMatch(templateRoutes, /appointment|capacity|booking|payroll|salary|rvu/i);
  });

  it("enforces admin writes and supervisor apply", () => {
    const service = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-template-service.ts"), "utf8");
    assert.match(service, /requireRosterAdmin/);
    assert.match(service, /createRosterTemplateForAdmin/);
    assert.match(service, /updateRosterTemplateForAdmin/);
    assert.match(service, /deactivateRosterTemplateForAdmin/);
    assert.match(service, /requireRosterManager\(actor\)/);
    assert.match(service, /applyRosterTemplateForManager/);
  });

  it("applies templates to draft weeks with copy modes, idempotency, conflict validation, and audit", () => {
    const repo = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-template-repository.ts"), "utf8");
    assert.match(repo, /structure_with_named_doctors/);
    assert.match(repo, /structure_only/);
    assert.match(repo, /target_week_not_draft/);
    assert.match(repo, /skippedCount/);
    assert.match(repo, /overwriteExisting/);
    assert.match(repo, /validateRosterWeekConflicts/);
    assert.match(repo, /roster_template_applied/);
    assert.match(repo, /roster_template_apply_conflicts/);
  });
});

