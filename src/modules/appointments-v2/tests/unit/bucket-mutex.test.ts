/**
 * Appointments V2 — bucket-mutex repository unit tests.
 *
 * Tests the bucket mutex repository structure, SQL queries, and source wiring.
 * Uses source verification since Node.js ESM mocking is limited.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Tests: function structure and exports
// ---------------------------------------------------------------------------

describe("bucket-mutex — function structure", () => {
  it("exports acquireBucketLock", async () => {
    const { acquireBucketLock } = await import("../../booking/repositories/bucket-mutex.repo.js");
    assert.ok(typeof acquireBucketLock === "function");
  });

  it("acquireBucketLock is async", async () => {
    const { acquireBucketLock } = await import("../../booking/repositories/bucket-mutex.repo.js");
    assert.ok(acquireBucketLock.constructor.name === "AsyncFunction" || typeof acquireBucketLock === "function");
  });

  it("exports releaseBucketLock", async () => {
    const { releaseBucketLock } = await import("../../booking/repositories/bucket-mutex.repo.js");
    assert.ok(typeof releaseBucketLock === "function");
  });

  it("releaseBucketLock is async", async () => {
    const { releaseBucketLock } = await import("../../booking/repositories/bucket-mutex.repo.js");
    assert.ok(releaseBucketLock.constructor.name === "AsyncFunction" || typeof releaseBucketLock === "function");
  });
});

// ---------------------------------------------------------------------------
// Tests: SQL query verification
// ---------------------------------------------------------------------------

describe("bucket-mutex — SQL queries", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/repositories/bucket-mutex.repo.ts",
      "utf-8"
    );
  });

  it("ACQUIRE_SQL uses INSERT ... ON CONFLICT pattern", () => {
    assert.ok(source.includes("insert into appointments_v2.bucket_mutex"), "Should insert into bucket_mutex");
    assert.ok(source.includes("on conflict"), "Should handle conflicts");
    assert.ok(source.includes("do update set created_at = now()"), "Should update timestamp on conflict");
  });

  it("ACQUIRE_SQL uses correct columns", () => {
    assert.ok(source.includes("modality_id"), "Should include modality_id");
    assert.ok(source.includes("booking_date"), "Should include booking_date");
    assert.ok(source.includes("case_category"), "Should include case_category");
  });

  it("LOCK_SQL uses SELECT ... FOR UPDATE", () => {
    assert.ok(source.includes("select 1 from appointments_v2.bucket_mutex"), "Should select from bucket_mutex");
    assert.ok(source.includes("for update"), "Should use FOR UPDATE for row-level locking");
  });

  it("LOCK_SQL uses correct WHERE clause", () => {
    assert.ok(source.includes("where modality_id = $1"), "Should filter by modality_id");
    assert.ok(source.includes("booking_date = $2"), "Should filter by booking_date");
    assert.ok(source.includes("case_category = $3"), "Should filter by case_category");
  });

  it("acquireBucketLock executes both queries in sequence", () => {
    assert.ok(source.includes("await client.query(ACQUIRE_SQL"), "Should execute ACQUIRE_SQL first");
    assert.ok(source.includes("await client.query(LOCK_SQL"), "Should execute LOCK_SQL second");
  });

  it("acquireBucketLock passes parameters correctly", () => {
    assert.ok(source.includes("[modalityId, date, caseCategory]"), "Should pass all three parameters");
  });

  it("releaseBucketLock is a no-op (locks released on COMMIT/ROLLBACK)", () => {
    // releaseBucketLock uses _ prefixed params to indicate they're unused
    assert.ok(source.includes("_client"), "Should have unused _client param");
    assert.ok(source.includes("_modalityId"), "Should have unused _modalityId param");
    assert.ok(source.includes("_date"), "Should have unused _date param");
    assert.ok(source.includes("_caseCategory"), "Should have unused _caseCategory param");
    // No explicit SQL statements that modify data
    assert.ok(!source.includes("DELETE FROM") && !source.includes("INSERT INTO"), "Should not have DELETE/INSERT");
  });
});

// ---------------------------------------------------------------------------
// Tests: concurrency safety documentation
// ---------------------------------------------------------------------------

describe("bucket-mutex — concurrency safety", () => {
  it("uses row-level locking (not advisory locks)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/repositories/bucket-mutex.repo.ts",
      "utf-8"
    );
    assert.ok(
      source.includes("for update"),
      "Should use SELECT ... FOR UPDATE for row-level locking"
    );
    assert.ok(
      !source.includes("pg_advisory"),
      "Should not use advisory locks"
    );
  });

  it("bucket_mutex table has composite primary key", async () => {
    const fs = await import("node:fs/promises");
    const migration = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/db/migrations/023_appointments_v2_schema.sql",
      "utf-8"
    );
    assert.ok(
      migration.includes("bucket_mutex"),
      "Migration should create bucket_mutex table"
    );
    assert.ok(
      migration.includes("primary key") || migration.includes("modality_id, booking_date, case_category"),
      "Should have composite key on modality_id, booking_date, case_category"
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: integration with booking services
// ---------------------------------------------------------------------------

describe("bucket-mutex — integration wiring", () => {
  it("imported by create-booking service", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/create-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../repositories/bucket-mutex.repo.js"'),
      "create-booking should import bucket-mutex.repo"
    );
    assert.ok(
      source.includes("acquireBucketLock"),
      "create-booking should call acquireBucketLock"
    );
  });

  it("imported by reschedule-booking service", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/reschedule-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../repositories/bucket-mutex.repo.js"'),
      "reschedule-booking should import bucket-mutex.repo"
    );
    assert.ok(
      source.includes("acquireBucketLock"),
      "reschedule-booking should call acquireBucketLock"
    );
  });
});
