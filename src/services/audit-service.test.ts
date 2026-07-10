import test from "node:test";
import assert from "node:assert/strict";

test("Audit Log changedByUserId is optional but remains strictly validated when supplied", async () => {
  process.env.DATABASE_URL ||= "postgresql://example/example";
  process.env.JWT_SECRET ||= "test-secret";
  const { buildAuditFilterQuery } = await import("./audit-service.js");
  assert.doesNotThrow(() => buildAuditFilterQuery({ limit: 50 }));
  assert.doesNotThrow(() => buildAuditFilterQuery({ limit: 50, changedByUserId: undefined }));
  const filtered = buildAuditFilterQuery({ limit: 50, changedByUserId: "7" });
  assert.match(filtered.whereClause, /changed_by_user_id/);
  for (const value of ["", "0", "-1", "1.5", "nope"]) {
    if (value === "") assert.doesNotThrow(() => buildAuditFilterQuery({ limit: 50, changedByUserId: value }));
    else assert.throws(() => buildAuditFilterQuery({ limit: 50, changedByUserId: value }));
  }
});
