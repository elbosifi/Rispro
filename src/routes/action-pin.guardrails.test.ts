import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("action PIN route guardrails", () => {
  it("mounts the action PIN router without protecting patient routes yet", async () => {
    const app = await readFile("src/app.ts", "utf-8");
    const patients = await readFile("src/routes/patients.ts", "utf-8");
    const appointments = await readFile("src/modules/appointments-v2/api/routes/appointments-v2-routes.ts", "utf-8");
    const queue = await readFile("src/routes/queue.ts", "utf-8");

    assert.match(app, /app\.use\("\/api", blockForcedPasswordChange\);\s+app\.use\("\/api\/action-pin", actionPinRouter\);/);
    assert.equal(patients.includes("requireActionPin("), false);
    assert.equal(appointments.includes("requireActionPin("), false);
    assert.equal(queue.includes("requireActionPin("), false);
  });

  it("protects policy updates with supervisor reauth and super_admin check", async () => {
    const settings = await readFile("src/routes/settings.ts", "utf-8");

    assert.match(settings, /settingsRouter\.use\(requireAuth, requireSupervisor, requireRecentSupervisorReauth\);/);
    assert.ok(settings.includes('"/users-and-roles/action-pin-policy"'));
    assert.ok(settings.includes('request.user.role !== "super_admin"'));
    assert.ok(settings.includes("saveActionPinPolicy"));
  });

  it("does not write PIN or hash into audit metadata", async () => {
    const service = await readFile("src/services/action-pin-service.ts", "utf-8");
    assert.doesNotMatch(service, /newValues:\s*\{[^}]*pinHash/s);
    assert.doesNotMatch(service, /newValues:\s*\{[^}]*pin_hash/s);
    assert.doesNotMatch(service, /oldValues:\s*\{[^}]*pinHash/s);
    assert.doesNotMatch(service, /oldValues:\s*\{[^}]*pin_hash/s);
  });
});
