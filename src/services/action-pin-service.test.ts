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

interface VerificationRow {
  id: number;
  user_id: number;
  action_key: string | null;
  reason: string | null;
  verification_token_hash: string;
  expires_at: string;
  consumed_at: string | null;
}

type TestExecutor = DbExecutor & {
  readonly row: PinRow | null;
  readonly verifications: VerificationRow[];
};

function makeExecutor(initial?: PinRow): TestExecutor {
  let row = initial ?? null;
  const verifications: VerificationRow[] = [];
  return {
    get row() {
      return row;
    },
    get verifications() {
      return verifications;
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
      if (sql.includes("pin_expires_at = now()")) {
        if (!row) return result([]);
        row = { ...row, pin_expires_at: new Date().toISOString() };
        return result([row]);
      }
      if (sql.includes("delete from user_action_pins")) {
        const deleted = row;
        row = null;
        return result(deleted ? [deleted] : []);
      }
      if (sql.includes("insert into action_pin_verifications")) {
        const created: VerificationRow = {
          id: verifications.length + 1,
          user_id: Number(params[0]),
          action_key: params[1] == null ? null : String(params[1]),
          reason: params[2] == null ? null : String(params[2]),
          verification_token_hash: String(params[3]),
          expires_at: String(params[4]),
          consumed_at: null,
        };
        verifications.push(created);
        return result([created]);
      }
      if (sql.includes("update action_pin_verifications")) {
        const userId = Number(params[0]);
        const tokenHash = String(params[1]);
        const actionKey = params[2] == null ? null : String(params[2]);
        const requireActionScoped = params[3] === true;
        const row = verifications.find((item) =>
          item.user_id === userId &&
          item.verification_token_hash === tokenHash &&
          item.consumed_at == null &&
          new Date(item.expires_at).getTime() > Date.now() &&
          (
            requireActionScoped
              ? item.action_key === actionKey
              : actionKey == null || item.action_key == null || item.action_key === actionKey
          )
        );
        if (row) row.consumed_at = new Date().toISOString();
        return result(row ? [row] : []);
      }
      if (sql.includes("from action_pin_verifications")) {
        const userId = Number(params[0]);
        const tokenHash = String(params[1]);
        const actionKey = params[2] == null ? null : String(params[2]);
        const row = verifications.find((item) =>
          item.user_id === userId &&
          item.verification_token_hash === tokenHash &&
          item.consumed_at == null &&
          new Date(item.expires_at).getTime() > Date.now() &&
          (item.action_key == null || item.action_key === actionKey)
        );
        return result(row ? [row] : []);
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
  it("validates four to eight digits", async () => {
    const { validateActionPinFormat } = await import("./action-pin-service.js");
    assert.equal(validateActionPinFormat("1234"), true);
    assert.equal(validateActionPinFormat("12345678"), true);
    assert.equal(validateActionPinFormat("123"), false);
    assert.equal(validateActionPinFormat("123456789"), false);
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

  it("lists admin readiness rows without exposing secret fields", async () => {
    const { listActionPinAdminUsers } = await import("./action-pin-service.js");
    const executor: DbExecutor = {
      async query<T = Record<string, unknown>>(sql: string): Promise<DbQueryResult<T>> {
        assert.match(sql, /from users/s);
        assert.doesNotMatch(sql, /pin_hash/);
        assert.doesNotMatch(sql, /verification_token_hash/);
        return {
          rows: [{
            user_id: 10,
            username: "front",
            full_name: "Front Desk",
            role: "receptionist",
            is_active: true,
            has_action_pin: true,
            pin_rotated_at: "2026-01-01T00:00:00.000Z",
            pin_expires_at: null,
            failed_attempts: 1,
            locked_until: null,
            updated_at: "2026-01-02T00:00:00.000Z",
            updated_by_user_id: 1,
            updated_by_username: "admin",
            updated_by_full_name: "Admin User",
          }] as T[],
        };
      },
    };

    const rows = await listActionPinAdminUsers(1, executor);
    const serialized = JSON.stringify(rows);

    assert.equal(rows[0]?.hasActionPin, true);
    assert.equal(rows[0]?.updatedByUsername, "admin");
    assert.equal(serialized.includes("pin_hash"), false);
    assert.equal(serialized.includes("pinHash"), false);
    assert.equal(serialized.includes("verification_token_hash"), false);
    assert.equal(serialized.includes("token"), false);
  });

  it("admin unlock clears lockout state", async () => {
    const { unlockActionPinForUser } = await import("./action-pin-service.js");
    const hash = await bcrypt.hash("1234", 10);
    const executor = makeExecutor({
      user_id: 10,
      pin_hash: hash,
      failed_attempts: 5,
      locked_until: new Date(Date.now() + 60_000).toISOString(),
      pin_expires_at: null,
    });

    const result = await unlockActionPinForUser(10, 1, executor);

    assert.equal(result.hadPin, true);
    assert.equal(result.failedAttempts, 0);
    assert.equal(result.lockedUntil, null);
    assert.equal(executor.row?.failed_attempts, 0);
    assert.equal(executor.row?.locked_until, null);
  });

  it("admin expire marks an existing PIN expired", async () => {
    const { expireActionPinForUser } = await import("./action-pin-service.js");
    const hash = await bcrypt.hash("1234", 10);
    const executor = makeExecutor({
      user_id: 10,
      pin_hash: hash,
      failed_attempts: 0,
      locked_until: null,
      pin_expires_at: null,
    });

    const result = await expireActionPinForUser(10, 1, executor);

    assert.equal(result.hadPin, true);
    assert.ok(result.pinExpiresAt);
    assert.equal(new Date(result.pinExpiresAt!).getTime() <= Date.now(), true);
  });

  it("admin audit metadata does not include PIN secrets", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("src/services/action-pin-service.ts", "utf-8"));
    const adminAuditBlock = [
      source.slice(source.indexOf("action_pin_admin_list_viewed"), source.indexOf("export async function setActionPin")),
      source.slice(source.indexOf("action_pin_unlocked"), source.indexOf("async function incrementFailedAttempt")),
    ].join("\n");

    assert.doesNotMatch(adminAuditBlock, /pin_hash|pinHash|verification_token_hash|tokenHash|cookie/i);
  });

  it("required_after_inactivity can reuse verification within TTL", async () => {
    const { createActionPinVerification, validateActionPinVerification } = await import("./action-pin-service.js");
    const executor = makeExecutor();
    const created = await createActionPinVerification({
      userId: 10,
      actionKey: "patient_create",
      reason: null,
      ttlSeconds: 300,
      ipAddress: null,
      userAgent: null,
      executor,
    });

    const first = await validateActionPinVerification({
      userId: 10,
      token: created.token,
      actionKey: "patient_create",
      consume: false,
      executor,
    });
    const second = await validateActionPinVerification({
      userId: 10,
      token: created.token,
      actionKey: "patient_create",
      consume: false,
      executor,
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(executor.verifications[0]?.consumed_at, null);
  });

  it("required_every_time consumes verification after one use", async () => {
    const { createActionPinVerification, validateActionPinVerification } = await import("./action-pin-service.js");
    const executor = makeExecutor();
    const created = await createActionPinVerification({
      userId: 10,
      actionKey: "patient_create",
      reason: null,
      ttlSeconds: 300,
      ipAddress: null,
      userAgent: null,
      executor,
    });

    const first = await validateActionPinVerification({
      userId: 10,
      token: created.token,
      actionKey: "patient_create",
      consume: true,
      executor,
    });
    const second = await validateActionPinVerification({
      userId: 10,
      token: created.token,
      actionKey: "patient_create",
      consume: true,
      executor,
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.reason, "not_found");
    assert.ok(executor.verifications[0]?.consumed_at);
  });

  it("consumes every-time verification with a single predicate-checked update", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile("src/services/action-pin-service.ts", "utf-8"));

    assert.match(source, /update action_pin_verifications\s+set consumed_at = now\(\)\s+where user_id = \$1\s+and verification_token_hash = \$2\s+and consumed_at is null\s+and expires_at > now\(\)/s);
    assert.match(source, /\$4::boolean = true and action_key = \$3::text/s);
    assert.doesNotMatch(source, /where id = \(\s*select id/s);
    assert.doesNotMatch(source, /where id = \$1 and consumed_at is null/);
  });

  it("rejects expired, other-user, and other-action verifications", async () => {
    const { createActionPinVerification, validateActionPinVerification } = await import("./action-pin-service.js");
    const executor = makeExecutor();
    const created = await createActionPinVerification({
      userId: 10,
      actionKey: "patient_create",
      reason: "correcting identifier",
      ttlSeconds: 300,
      ipAddress: null,
      userAgent: null,
      executor,
    });

    assert.equal((await validateActionPinVerification({ userId: 11, token: created.token, actionKey: "patient_create", consume: false, executor })).ok, false);
    assert.equal((await validateActionPinVerification({ userId: 10, token: created.token, actionKey: "patient_update", consume: false, executor })).ok, false);

    executor.verifications[0]!.expires_at = "2000-01-01T00:00:00.000Z";
    const expired = await validateActionPinVerification({ userId: 10, token: created.token, actionKey: "patient_create", consume: false, executor });
    assert.equal(expired.ok, false);
    assert.equal(expired.reason, "not_found");
  });
});
