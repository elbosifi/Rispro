import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { listAuditEntries, logAuditEntry } from "./audit-service.js";

test("audit entries retain Arabic and English actor names across later user renames", async (t) => {
  try {
    await pool.query("select 1");
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return;
  }

  const marker = `identity_snapshot_${randomUUID().replaceAll("-", "")}`;
  const userId = Number((await pool.query<{ id: number }>(
    "insert into users(username,full_name,english_name,password_hash,role,is_active) values($1,$2,$3,'x','supervisor',true) returning id",
    [`${marker}_user`, `${marker} Arabic`, `${marker} English`]
  )).rows[0]!.id);

  try {
    const first = await logAuditEntry({ entityType: marker, actionType: "created", changedByUserId: userId });
    assert.equal(first?.changed_by_name_ar, `${marker} Arabic`);
    assert.equal(first?.changed_by_name_en, `${marker} English`);

    await pool.query("update users set full_name=$2, english_name=$3 where id=$1", [userId, `${marker} Arabic Renamed`, `${marker} English Renamed`]);
    const historical = await listAuditEntries({ entityType: marker, limit: 10 });
    assert.equal(historical[0]?.changed_by_name_ar, `${marker} Arabic`);
    assert.equal(historical[0]?.changed_by_name_en, `${marker} English`);
    assert.equal(historical[0]?.changed_by_username, `${marker}_user`);

    const second = await logAuditEntry({ entityType: marker, actionType: "renamed", changedByUserId: userId });
    assert.equal(second?.changed_by_name_ar, `${marker} Arabic Renamed`);
    assert.equal(second?.changed_by_name_en, `${marker} English Renamed`);
  } finally {
    await pool.query("delete from audit_log where entity_type=$1", [marker]);
    await pool.query("delete from users where id=$1", [userId]);
  }
});
