import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import type { DbExecutor, DbQueryResult } from "../types/db.js";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

type ActionPinPolicyLimits = {
  maxFailedAttempts: number;
  lockoutMinutes: number;
};

interface PinRow {
  user_id: number;
  pin_hash: string;
  failed_attempts: number;
  locked_until: string | null;
  pin_expires_at: string | null;
}

type TestExecutor = DbExecutor & { readonly row: PinRow | null };

function makeExecutor(initial?: PinRow): TestExecutor {
  let row = initial ?? null;
  return {
    get row() {
      return row;
    },
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<DbQueryResult<T>> {
      const result = (rows: unknown[]): DbQueryResult<T> => ({ rows: rows as T[] });
      if (sql.includes("select") && sql.includes("from user_action_pins")) {
        return result(row && Number(params[0]) === row.user_id ? [row] : []);
      }
      if (sql.includes("insert into user_action_pins")) {
        row = {
          user_id: Number(params[0]),
          pin_hash: String(params[1]),
          pin_expires_at: (params[2] as string | null) ?? null,
          failed_attempts: 0,
          locked_until: null,
        };
        return result([row]);
      }
      if (sql.includes("failed_attempts = failed_attempts + 1")) {
        if (!row) return result([]);
        row = {
          ...row,
          failed_attempts: row.failed_attempts + 1,
          locked_until: (params[1] as string | null) ?? row.locked_until,
        };
        return result([row]);
      }
      if (sql.includes("failed_attempts = 0")) {
        if (!row) return result([]);
        row = { ...row, failed_attempts: 0, locked_until: null };
        return result([row]);
      }
      if (sql.includes("delete from user_action_pins")) {
        const deleted = row;
        row = null;
        return result(deleted ? [deleted] : []);
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };
}

const limits: ActionPinPolicyLimits = {
  maxFailedAttempts: 2,
  lockoutMinutes: 15,
};

describe("action PIN service", () => {
  it("validates exactly four digits", async () => {
    const { validateActionPinFormat } = await import("./action-pin-service.js");
    assert.equal(validateActionPinFormat("1234"), true);
    assert.equal(validateActionPinFormat("123"), false);
    assert.equal(validateActionPinFormat("12345"), false);
    assert.equal(validateActionPinFormat("12a4"), false);
  });

  it("stores a bcrypt hash and verifies the PIN", async () => {
    const { setActionPin, verifyActionPin } = await import("./action-pin-service.js");
    const executor = makeExecutor();
    await setActionPin(10, "1234", 10, null, executor);

    assert.notEqual(executor.row?.pin_hash, "1234");
    assert.equal(await bcrypt.compare("1234", executor.row?.pin_hash ?? ""), true);

    const result = await verifyActionPin(10, "1234", limits, executor);
    assert.equal(result.ok, true);
    assert.equal(result.failedAttempts, 0);
  });

  it("rejects another user's PIN hash", async () => {
    const { setActionPin, verifyActionPin } = await import("./action-pin-service.js");
    const executor = makeExecutor();
    await setActionPin(10, "1234", 10, null, executor);

    const result = await verifyActionPin(11, "1234", limits, executor);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_set");
  });

  it("increments failed attempts and locks after max attempts", async () => {
    const { setActionPin, verifyActionPin } = await import("./action-pin-service.js");
    const executor = makeExecutor();
    await setActionPin(10, "1234", 10, null, executor);

    const first = await verifyActionPin(10, "0000", limits, executor);
    assert.equal(first.ok, false);
    assert.equal(first.failedAttempts, 1);

    const second = await verifyActionPin(10, "0000", limits, executor);
    assert.equal(second.ok, false);
    assert.equal(second.reason, "locked");
    assert.equal(second.failedAttempts, 2);
    assert.ok(second.lockedUntil);
  });

  it("success resets failed attempts", async () => {
    const { setActionPin, verifyActionPin } = await import("./action-pin-service.js");
    const executor = makeExecutor();
    await setActionPin(10, "1234", 10, null, executor);
    await verifyActionPin(10, "0000", limits, executor);

    const result = await verifyActionPin(10, "1234", limits, executor);
    assert.equal(result.ok, true);
    assert.equal(executor.row?.failed_attempts, 0);
    assert.equal(executor.row?.locked_until, null);
  });

  it("reports expired PIN metadata", async () => {
    const { verifyActionPin } = await import("./action-pin-service.js");
    const hash = await bcrypt.hash("1234", 10);
    const executor = makeExecutor({
      user_id: 10,
      pin_hash: hash,
      failed_attempts: 0,
      locked_until: null,
      pin_expires_at: "2000-01-01T00:00:00.000Z",
    });

    const result = await verifyActionPin(10, "1234", limits, executor);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "expired");
  });

  it("clears PIN without exposing the hash", async () => {
    const { clearActionPin, setActionPin } = await import("./action-pin-service.js");
    const executor = makeExecutor();
    await setActionPin(10, "1234", 10, null, executor);
    const result = await clearActionPin(10, 1, executor);

    assert.equal(result.hadPin, true);
    assert.equal(executor.row, null);
    assert.equal("pinHash" in result, false);
  });
});
