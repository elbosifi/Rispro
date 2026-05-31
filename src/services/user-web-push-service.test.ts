import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("user web push service", () => {
  it("stores staff subscriptions outside patient and reporting-board tables", async () => {
    const migration = await readFile("src/db/migrations/093_user_web_push_subscriptions.sql", "utf-8");

    assert.match(migration, /create table if not exists user_web_push_subscriptions/);
    assert.match(migration, /user_id bigint not null references users\(id\)/);
    assert.match(migration, /unique \(user_id, subscription_hash\)/);
    assert.doesNotMatch(migration, /patient_web_push_subscriptions/);
    assert.doesNotMatch(migration, /reporting_board_web_push_subscriptions/);
  });

  it("uses the existing shared Web Push config path", async () => {
    const source = await readFile("src/services/user-web-push-service.ts", "utf-8");

    assert.match(source, /getPatientWebPushSharedConfig/);
    assert.match(source, /ensurePatientWebPushConfig/);
    assert.match(source, /configurePatientWebPushVapid/);
    assert.match(source, /hashPushSubscription/);
  });

  it("keeps override push payloads generic and routes users to existing override UI", async () => {
    const source = await readFile("src/services/user-web-push-service.ts", "utf-8");

    assert.match(source, /title: "New override request"/);
    assert.match(source, /body: "A scheduling override request needs review\."/);
    assert.match(source, /title: "Override request approved"/);
    assert.match(source, /title: "Override request rejected"/);
    assert.match(source, /title: "Override request failed"/);
    assert.match(source, /title: "Override request expired"/);
    assert.match(source, /title: "Override request cancelled"/);
    assert.match(source, /clickUrl: "\/scheduling\/override-requests"/);
    assert.doesNotMatch(source, /patientDisplayName|patientIdentifier|accession|StudyInstanceUID|diagnosis|report text/i);
  });

  it("uses existing approval RBAC, supports multiple devices, and disables dead subscriptions", async () => {
    const source = await readFile("src/services/user-web-push-service.ts", "utf-8");

    assert.match(source, /request\.overrideType === "total_capacity_override"\s*\?\s*\["super_admin"\]/);
    assert.match(source, /\["supervisor", "super_admin"\]/);
    assert.match(source, /id <> \$2/);
    assert.match(source, /where user_id = \$1 and enabled = true/);
    assert.match(source, /statusCode === 404 \|\| statusCode === 410/);
    assert.match(source, /enabled = case when \$2 then false else enabled end/);
  });

  it("wires create approve and reject lifecycle hooks without awaiting delivery", async () => {
    const source = await readFile("src/modules/appointments-v2/scheduling-override-requests/services/scheduling-override-request.service.ts", "utf-8");

    assert.match(source, /safeNotifySchedulingOverrideCreated\(created\)/);
    assert.match(source, /safeNotifySchedulingOverrideApproved\(result\.request\)/);
    assert.match(source, /safeNotifySchedulingOverrideRejected\(rejected\)/);
    assert.match(source, /safeNotifySchedulingOverrideApprovalFailed\(result\.request, approverUserId\)/);
    assert.match(source, /safeNotifySchedulingOverrideExpired\(result\.request\)/);
    assert.match(source, /safeNotifySchedulingOverrideCancelled\(cancelled, userId\)/);
  });

  it("mounts drawer push routes without touching auth or active-session polling", async () => {
    const app = await readFile("src/app.ts", "utf-8");
    const frontend = await readFile("frontend/src/v2/appointments/components/SchedulingOverrideApprovalCenter.tsx", "utf-8");

    assert.match(app, /app\.use\("\/api\/user-notifications", userNotificationsRouter\)/);
    assert.doesNotMatch(frontend, /refetchInterval/);
    assert.doesNotMatch(frontend, /active[-_ ]session/i);
  });
});
