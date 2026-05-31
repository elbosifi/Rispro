import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("user web push service", () => {
  it("stores staff subscriptions outside patient and reporting-board tables", async () => {
    const migration = await readFile("src/db/migrations/093_user_web_push_subscriptions.sql", "utf-8");

    assert.match(migration, /create table if not exists user_web_push_subscriptions/);
    assert.match(migration, /user_id bigint not null references users\(id\)/);
    assert.match(migration, /unique \(user_id, subscription_hash\)/);
    assert.match(migration, /last_seen_at timestamptz/);
    assert.doesNotMatch(migration, /patient_web_push_subscriptions/);
    assert.doesNotMatch(migration, /reporting_board_web_push_subscriptions/);
  });

  it("keeps override push payloads generic and routes users to existing override UI", async () => {
    const source = await readFile("src/services/user-web-push-service.ts", "utf-8");

    assert.match(source, /title: "New override request"/);
    assert.match(source, /body: "A scheduling override request needs review\."/);
    assert.match(source, /title: "Override request approved"/);
    assert.match(source, /title: "Override request rejected"/);
    assert.match(source, /clickUrl: "\/scheduling\/override-requests"/);
    assert.doesNotMatch(source, /patientDisplayName|patientIdentifier|accession|StudyInstanceUID|diagnosis|report text/i);
  });

  it("uses existing approval RBAC and disables dead subscriptions", async () => {
    const source = await readFile("src/services/user-web-push-service.ts", "utf-8");

    assert.match(source, /request\.overrideType === "total_capacity_override"\s*\?\s*\["super_admin"\]/);
    assert.match(source, /\["supervisor", "super_admin"\]/);
    assert.match(source, /id <> \$2/);
    assert.match(source, /statusCode === 404 \|\| statusCode === 410/);
    assert.match(source, /enabled = case when \$2 then false else enabled end/);
    assert.match(source, /last_seen_at = now\(\)/);
    assert.match(source, /coalesce\(last_seen_at, updated_at, created_at\) >= now\(\) - \(\$2::text \|\| ' hours'\)::interval/);
  });

  it("wires create approve and reject lifecycle hooks without awaiting delivery", async () => {
    const source = await readFile("src/modules/appointments-v2/scheduling-override-requests/services/scheduling-override-request.service.ts", "utf-8");

    assert.match(source, /safeNotifySchedulingOverrideCreated\(created\)/);
    assert.match(source, /safeNotifySchedulingOverrideApproved\(result\.request\)/);
    assert.match(source, /safeNotifySchedulingOverrideRejected\(rejected\)/);
  });
});
