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

test("Audit Log pagination and filters reject unsafe query values before database access", async () => {
  process.env.DATABASE_URL ||= "postgresql://example/example";
  process.env.JWT_SECRET ||= "test-secret";
  const { buildAuditFilterQuery, listAuditPage } = await import("./audit-service.js");
  const filtered = buildAuditFilterQuery({ category: "security", outcome: "failed", search: "  login  ", dateFrom: "2026-07-01", dateTo: "2026-07-10" });
  assert.match(filtered.whereClause, /category|report_status|security/);
  assert.match(filtered.whereClause, /outcome|status|failed/);
  assert.match(filtered.whereClause, /ilike/);
  await assert.rejects(() => listAuditPage({ page: "0" }), /page must be a positive whole number/);
  await assert.rejects(() => listAuditPage({ page: "1.5" }), /page must be a positive whole number/);
  await assert.rejects(() => listAuditPage({ pageSize: "30" }), /pageSize must be one of 25, 50, or 100/);
  await assert.rejects(() => listAuditPage({ pageSize: "101" }), /must not exceed 100/);
  await assert.rejects(() => listAuditPage({ dateFrom: "not-a-date" }), /dateFrom must be in YYYY-MM-DD format/);
});
