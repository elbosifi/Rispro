import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("action PIN route guardrails", () => {
  it("mounts the action PIN router without protecting patient routes yet", async () => {
    const app = await readFile("src/app.ts", "utf-8");

    assert.match(app, /app\.use\("\/api", blockForcedPasswordChange\);\s+app\.use\("\/api\/action-pin", actionPinRouter\);/);
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

  it("protects admin user PIN management routes with supervisor reauth and super_admin checks", async () => {
    const routes = await readFile("src/routes/action-pin.ts", "utf-8");

    assert.match(routes, /"\/admin\/users",\s*requireSupervisor,\s*requireRecentSupervisorReauth,\s*asyncRoute/s);
    assert.match(routes, /"\/admin\/users\/:userId\/reset",\s*requireSupervisor,\s*requireRecentSupervisorReauth,\s*asyncRoute/s);
    assert.match(routes, /"\/admin\/users\/:userId\/unlock",\s*requireSupervisor,\s*requireRecentSupervisorReauth,\s*asyncRoute/s);
    assert.match(routes, /"\/admin\/users\/:userId\/expire",\s*requireSupervisor,\s*requireRecentSupervisorReauth,\s*asyncRoute/s);
    assert.match(routes, /request\.user\.role !== "super_admin"/);
  });

  it("requires current password, not Action PIN verification, for every self-service PIN management route", async () => {
    const routes = await readFile("src/routes/action-pin.ts", "utf-8");

    assert.match(routes, /"\/set"/);
    assert.match(routes, /"\/disable"/);
    assert.match(routes, /actionPinManagementPasswordRateLimiter/);
    assert.match(routes, /"\/set",\s*actionPinManagementPasswordRateLimiter,\s*asyncRoute/s);
    assert.match(routes, /"\/disable",\s*actionPinManagementPasswordRateLimiter,\s*asyncRoute/s);
    assert.match(routes, /Current account password is required\./);
    assert.match(routes, /await verifyCurrentAccountPassword\(request, body\)/);
    assert.doesNotMatch(routes, /Recent Action PIN verification/);
  });

  it("audits wrong account-password attempts without storing password or PIN", async () => {
    const routes = await readFile("src/routes/action-pin.ts", "utf-8");

    assert.match(routes, /actionType:\s*"security_pin_password_failed_attempt"/);
    assert.doesNotMatch(routes, /newValues:\s*\{[^}]*currentPassword/s);
    assert.doesNotMatch(routes, /newValues:\s*\{[^}]*pin/s);
  });

  it("accepts Security Action PIN formats from four to eight digits", async () => {
    const service = await readFile("src/services/action-pin-service.ts", "utf-8");

    assert.match(service, /\\d\{4,8\}/);
    assert.doesNotMatch(service, /exactly 4 digits/);
  });

  it("clears idle screen lock only after successful session unlock verification", async () => {
    const routes = await readFile("src/routes/action-pin.ts", "utf-8");
    const verifyRoute = routes.slice(routes.indexOf('"/verify"'), routes.indexOf('"/set"'));

    assert.match(verifyRoute, /if \(!result\.ok\) \{/);
    assert.match(verifyRoute, /return;\s*\}\s*const reason =/s);
    assert.match(verifyRoute, /if \(actionKey === "session_unlock"\) \{\s*await clearActionPinIdleLock\(request\.user\.sub\);\s*\}/s);
  });
});

describe("action PIN route enforcement wiring", () => {
  it("protects selected patient mutations with their action keys before handlers", async () => {
    const patients = await readFile("src/routes/patients.ts", "utf-8");

    assert.match(patients, /patientsRouter\.post\(\s*"\/merge",\s*requireActionPin\("patient_merge"\),\s*asyncRoute/s);
    assert.match(patients, /patientsRouter\.post\(\s*"\/",\s*requireActionPin\("patient_create"\),\s*asyncRoute/s);
    assert.match(patients, /patientsRouter\.put\(\s*"\/:patientId",\s*requireActionPin\("patient_update"\),\s*asyncRoute/s);
    assert.match(patients, /patientsRouter\.delete\(\s*"\/:patientId",\s*requireAnyRole\(\["super_admin"\]\),\s*requireActionPin\("patient_delete"\),\s*asyncRoute/s);
  });

  it("protects selected Appointments V2 mutations with their action keys before handlers", async () => {
    const appointments = await readFile("src/modules/appointments-v2/api/routes/appointments-v2-routes.ts", "utf-8");

    assert.match(appointments, /router\.post\(\s*"\/",\s*requireActionPin\("appointment_create"\),\s*asyncRoute/s);
    assert.match(appointments, /router\.put\(\s*"\/:id",\s*requireActionPin\("appointment_reschedule"\),\s*asyncRoute/s);
    assert.match(appointments, /router\.post\(\s*"\/:id\/cancel",\s*requireActionPin\("appointment_cancel"\),\s*asyncRoute/s);
    assert.match(appointments, /router\.post\(\s*"\/:id\/void",\s*requireActionPin\("appointment_void"\),\s*asyncRoute/s);
    assert.ok(appointments.includes("body.override"), "supervisor override payload remains handled by appointment services after Action PIN middleware");
  });

  it("protects selected queue mutations and leaves scan unprotected", async () => {
    const queue = await readFile("src/routes/queue.ts", "utf-8");
    const readV2 = await readFile("src/modules/appointments-v2/api/routes/read-v2-routes.ts", "utf-8");

    assert.match(queue, /queueRouter\.post\(\s*"\/walk-in",\s*requireActionPin\("queue_walk_in"\),\s*asyncRoute/s);
    assert.match(queue, /queueRouter\.post\(\s*"\/confirm-no-show",\s*requireActionPin\("queue_confirm_no_show"\),\s*asyncRoute/s);
    assert.match(readV2, /router\.post\(\s*"\/queue\/walk-in",\s*requirePageAccess\("queue"\),\s*requireActionPin\("queue_walk_in"\),\s*asyncRoute/s);
    assert.match(readV2, /router\.post\(\s*"\/appointments\/:id\/no-show",\s*requireActionPin\("queue_confirm_no_show"\),\s*asyncRoute/s);
    assert.doesNotMatch(queue, /"\/scan",\s*requireActionPin/s);
  });

  it("does not protect explicitly deferred mutation areas", async () => {
    const settings = await readFile("src/routes/settings.ts", "utf-8");
    const readV2 = await readFile("src/modules/appointments-v2/api/routes/read-v2-routes.ts", "utf-8");
    const publicCancel = await readFile("src/modules/appointments-v2/api/routes/public-appointments-cancel-routes.ts", "utf-8");

    assert.equal(settings.includes('requireActionPin("patient_import_confirm")'), false);
    assert.equal(settings.includes('requireActionPin("duplicate_patient_merge")'), false);
    assert.equal(settings.includes('requireActionPin("duplicate_patient_safe_delete")'), false);
    assert.equal(readV2.includes('requireActionPin("appointment_complete")'), false);
    assert.equal(readV2.includes('requireActionPin("queue_scan")'), false);
    assert.equal(publicCancel.includes("requireActionPin("), false);
  });
});
