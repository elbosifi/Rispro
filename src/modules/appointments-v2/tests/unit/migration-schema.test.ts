/**
 * Appointments V2 — Migration schema validation test.
 *
 * Verifies that the V2 migration file exists, is well-formed,
 * and contains all expected tables and constraints.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATION_FILE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "db",
  "migrations",
  "023_appointments_v2_schema.sql"
);

describe("V2 DB migration file (023_appointments_v2_schema)", () => {
  let sql: string;

  it("should exist", () => {
    assert.ok(existsSync(MIGRATION_FILE), `Migration file not found at ${MIGRATION_FILE}`);
  });

  it("should be non-empty", () => {
    sql = readFileSync(MIGRATION_FILE, "utf8");
    assert.ok(sql.trim().length > 100, "Migration file is suspiciously short");
  });

  it("should create the appointments_v2 schema", () => {
    assert.match(sql, /create\s+schema\s+if\s+not\s+exists\s+appointments_v2/i);
  });

  it("should create policy_sets table", () => {
    assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+appointments_v2\.policy_sets/i);
  });

  it("should create policy_versions table with unique key on (policy_set_id, version_no)", () => {
    assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+appointments_v2\.policy_versions/i);
    assert.match(sql, /unique\s*\(\s*policy_set_id\s*,\s*version_no\s*\)/i);
  });

  it("should create partial unique index for one published version per set", () => {
    assert.match(sql, /policy_versions_one_published_per_set/i);
    assert.match(sql, /where\s+status\s*=\s*'published'/i);
  });

  it("should create category_daily_limits table", () => {
    assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+appointments_v2\.category_daily_limits/i);
  });

  it("should create modality_blocked_rules table with v2 lookup index", () => {
    assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+appointments_v2\.modality_blocked_rules/i);
    assert.match(sql, /v2_modality_blocked_lookup/i);
  });

  it("should create exam_type_rules table", () => {
    assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+appointments_v2\.exam_type_rules/i);
  });

  it("should create exam_type_rule_items table", () => {
    assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+appointments_v2\.exam_type_rule_items/i);
  });

  it("should create exam_type_special_quotas table", () => {
    assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+appointments_v2\.exam_type_special_quotas/i);
  });

  it("should create special_reason_codes table", () => {
    assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+appointments_v2\.special_reason_codes/i);
  });

  it("should seed default special reason codes", () => {
    assert.match(sql, /urgent_oncology/i);
    assert.match(sql, /medical_priority/i);
    assert.match(sql, /equipment_window/i);
  });

  it("should create bookings table with policy_version_id FK", () => {
    assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+appointments_v2\.bookings/i);
    assert.match(sql, /policy_version_id\s+bigint\s+not\s+null\s+references\s+appointments_v2\.policy_versions/i);
  });

  it("should create bookings bucket index for efficient capacity queries", () => {
    assert.match(sql, /v2_bookings_bucket_idx/i);
    assert.match(sql, /where\s+status\s*<>\s*'cancelled'/i);
  });

  it("should create override_audit_events table", () => {
    assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+appointments_v2\.override_audit_events/i);
  });

  it("should create bucket_mutex table with composite PK", () => {
    assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+appointments_v2\.bucket_mutex/i);
    assert.match(sql, /primary\s+key\s*\(\s*modality_id\s*,\s*booking_date\s*,\s*case_category\s*\)/i);
  });

  it("should seed the default policy set", () => {
    assert.match(sql, /insert\s+into\s+appointments_v2\.policy_sets/i);
    assert.match(sql, /'default'/i);
  });

  it("should not reference any legacy scheduling tables", () => {
    const legacyTables = [
      "modality_blocked_rules",       // legacy (without schema prefix)
      "exam_type_schedule_rules",
      "appointment_quota_consumptions",
      "scheduling_override_audit_events",
    ];
    // Check that any reference to these is within the appointments_v2 schema
    const nonSchemaRefs = sql.match(
      new RegExp(`(?<!appointments_v2\\.)\\b(${legacyTables.join("|")})\\b`, "gi")
    );
    // Allow references in comments — filter out lines starting with --
    const actualRefs = nonSchemaRefs?.filter((ref) => {
      const line = sql.split("\n").find((l) => l.includes(ref));
      return line && !line.trim().startsWith("--");
    });
    assert.equal(
      actualRefs?.length ?? 0,
      0,
      `Found legacy table references outside appointments_v2 schema: ${actualRefs?.join(", ")}`
    );
  });
});
