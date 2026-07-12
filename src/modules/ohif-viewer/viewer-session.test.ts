import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DbExecutor } from "../../types/db.js";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret";

const { consumeViewerLaunchToken, findAuthorizedViewerSession } = await import("./repository.js");

type SessionRow = Record<string, unknown>;

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 1, user_id: 10, appointment_id: 42, study_instance_uid: "1.2.840.42", permitted_study_uids: ["1.2.840.42"],
    source_pacs_node_id: 3, access_strategy: "native_dicomweb", expires_at: new Date(Date.now() + 60_000).toISOString(),
    used_at: null, revoked_at: null, token_hash: "launch-hash", viewer_session_token_hash: null, ...overrides,
  };
}

function memoryExecutor(row: SessionRow): DbExecutor {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const [tokenHash, userId, viewerSessionHash] = params as [string, number, string?];
      const valid = Number(row.user_id) === Number(userId) && row.revoked_at == null && Date.parse(String(row.expires_at)) > Date.now();
      if (sql.includes("set used_at=now()")) {
        if (!valid || row.used_at != null || row.token_hash !== tokenHash) return { rows: [] as T[] };
        row.used_at = new Date().toISOString();
        row.viewer_session_token_hash = viewerSessionHash || null;
        return { rows: [row as T] };
      }
      if (!valid || row.used_at == null || row.viewer_session_token_hash !== tokenHash) return { rows: [] as T[] };
      return { rows: [row as T] };
    },
  };
}

describe("OHIF viewer launch/session tokens", () => {
  it("exchanges a launch token once and leaves the separate viewer session usable", async () => {
    const row = session();
    const db = memoryExecutor(row);
    assert.ok(await consumeViewerLaunchToken("launch-hash", 10, "viewer-hash", db));
    assert.equal(await consumeViewerLaunchToken("launch-hash", 10, "second-viewer-hash", db), null);
    assert.ok(await findAuthorizedViewerSession("viewer-hash", 10, db));
  });

  it("rejects expired, wrong-user, and revoked session access", async () => {
    const expired = memoryExecutor(session({ expires_at: new Date(Date.now() - 1_000).toISOString() }));
    assert.equal(await consumeViewerLaunchToken("launch-hash", 10, "viewer-hash", expired), null);

    const wrongUser = memoryExecutor(session());
    assert.equal(await consumeViewerLaunchToken("launch-hash", 11, "viewer-hash", wrongUser), null);

    const revoked = memoryExecutor(session({ used_at: new Date().toISOString(), viewer_session_token_hash: "viewer-hash", revoked_at: new Date().toISOString() }));
    assert.equal(await findAuthorizedViewerSession("viewer-hash", 10, revoked), null);
  });
});
