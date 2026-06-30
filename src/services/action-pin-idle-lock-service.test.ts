import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DbExecutor, DbQueryResult } from "../types/db.js";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

function makeExecutor(): DbExecutor {
  let lockedAt: string | null = null;
  return {
    async query<T = Record<string, unknown>>(sql: string, _params?: unknown[]): Promise<DbQueryResult<T>> {
      let rows: unknown[];
      if (sql.includes("insert into action_pin_idle_locks")) {
        lockedAt = "2026-06-30T10:00:00.000Z";
        rows = [{ locked_at: lockedAt }];
      } else if (sql.includes("update action_pin_idle_locks")) {
        lockedAt = null;
        rows = [{ unlocked_at: "2026-06-30T10:05:00.000Z" }];
      } else if (sql.includes("from action_pin_idle_locks")) {
        rows = lockedAt ? [{ locked_at: lockedAt }] : [];
      } else {
        throw new Error(`Unexpected SQL: ${sql}`);
      }
      return { rows: rows as T[] };
    },
  };
}

describe("action PIN idle lock service", () => {
  it("persists and clears idle lock state for a user", async () => {
    const { clearActionPinIdleLock, getActionPinIdleLockStatus, lockActionPinIdleSession } = await import("./action-pin-service.js");
    const executor = makeExecutor();

    assert.deepEqual(await getActionPinIdleLockStatus(7, executor), { active: false, lockedAt: null });

    const locked = await lockActionPinIdleSession(7, executor);
    assert.deepEqual(locked, { active: true, lockedAt: "2026-06-30T10:00:00.000Z" });
    assert.deepEqual(await getActionPinIdleLockStatus(7, executor), { active: true, lockedAt: "2026-06-30T10:00:00.000Z" });

    const cleared = await clearActionPinIdleLock(7, executor);
    assert.deepEqual(cleared, { active: false, lockedAt: null });
    assert.deepEqual(await getActionPinIdleLockStatus(7, executor), { active: false, lockedAt: null });
  });
});
