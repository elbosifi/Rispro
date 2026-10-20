import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { pool } from "../db/pool.js";
import { invalidateCache } from "../utils/cache.js";
import { loadPatientNameDictionary } from "./patient-search-query.js";
import { applyNameDictionaryToPatients, createMissingNameDictionaryEntry, importNameDictionaryEntries, upsertNameDictionary } from "./name-dictionary-service.js";

const marker = crypto.randomUUID().replaceAll("-", "");
const key = (suffix: string) => `قاموس${marker}${suffix}`;
let userId: number;
const patientIds: number[] = [];

test.before(async () => {
  userId = Number((await pool.query("insert into users(username,full_name,password_hash,role,is_active) values($1,'Dictionary safety','test','supervisor',true) returning id", [`dictionary_${marker}`])).rows[0].id);
});
test.after(async () => {
  await pool.query("delete from audit_log where changed_by_user_id=$1", [userId]);
  await pool.query("delete from patients where id=any($1::bigint[])", [patientIds]);
  await pool.query("delete from name_dictionary where arabic_text like $1", [`%${marker}%`]);
  await pool.query("delete from users where id=$1", [userId]);
  invalidateCache("name_dictionary");
});

test("import validates every row before any changes, and duplicate keys use the last mapping", async () => {
  await assert.rejects(importNameDictionaryEntries([{ arabicText: key("invalid"), englishText: "First" }, { arabicText: key("bad"), englishText: "" }], userId), /CSV row 2/);
  assert.equal((await pool.query("select 1 from name_dictionary where arabic_text=$1", [key("invalid")])).rowCount, 0);
  const result = await importNameDictionaryEntries([{ arabicText: key("duplicate"), englishText: "First" }, { arabicText: key("duplicate"), englishText: "Last" }], userId);
  assert.equal(result.length, 1);
  assert.equal(result[0].english_text, "Last");
});

test("a later DB failure rolls back earlier changes and audit rows, preserving the cache", async () => {
  await upsertNameDictionary({ arabicText: key("rollback"), englishText: "Before" }, userId);
  const cached = await loadPatientNameDictionary();
  const beforeAudit = Number((await pool.query("select count(*) from audit_log where changed_by_user_id=$1", [userId])).rows[0].count);
  const constraint = `dictionary_${marker}`;
  await pool.query(`alter table name_dictionary add constraint ${constraint} check (arabic_text <> '${key("reject")}') not valid`);
  try {
    await assert.rejects(importNameDictionaryEntries([{ arabicText: key("rollback"), englishText: "Changed" }, { arabicText: key("reject"), englishText: "Rejected" }], userId));
    assert.equal((await pool.query("select english_text from name_dictionary where arabic_text=$1", [key("rollback")])).rows[0].english_text, "Before");
    assert.equal(Number((await pool.query("select count(*) from audit_log where changed_by_user_id=$1", [userId])).rows[0].count), beforeAudit);
    assert.equal(await loadPatientNameDictionary(), cached);
  } finally { await pool.query(`alter table name_dictionary drop constraint ${constraint}`); }
});

test("audit failure also rolls back dictionary writes", async () => {
  await assert.rejects(importNameDictionaryEntries([{ arabicText: key("auditfail"), englishText: "Never committed" }], -1));
  assert.equal((await pool.query("select 1 from name_dictionary where arabic_text=$1", [key("auditfail")])).rowCount, 0);
});

test("a failed cached dictionary load is not remembered and the next request recovers", async (t) => {
  invalidateCache("name_dictionary");
  const failedRead = t.mock.method(pool, "query", async () => { throw new Error("Temporary dictionary read failure"); });
  await assert.rejects(loadPatientNameDictionary(), /Temporary dictionary read failure/);
  failedRead.mock.restore();
  const before = await loadPatientNameDictionary();
  await importNameDictionaryEntries([{ arabicText: key("recovered"), englishText: "Recovered" }], userId);
  const after = await loadPatientNameDictionary();
  assert.notEqual(after, before);
  assert.equal(after.find((entry) => entry.arabic_text === key("recovered"))?.english_text, "Recovered");
});

test("registration additions cannot overwrite existing, inactive, normalized or concurrently inserted aliases", async () => {
  const arabicText = `عبد ${key("alias")}`;
  await upsertNameDictionary({ arabicText, englishText: "Protected", isActive: false }, userId);
  await assert.rejects(createMissingNameDictionaryEntry({ arabicText: arabicText.replace(" ", ""), englishText: "Override" }, userId), /already exists/);
  const payload = { arabicText: key("race"), englishText: "First" };
  const result = await Promise.allSettled([createMissingNameDictionaryEntry(payload, userId), createMissingNameDictionaryEntry({ ...payload, englishText: "Second" }, userId)]);
  assert.equal(result.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal((await pool.query("select count(*) from name_dictionary where arabic_text=$1", [payload.arabicText])).rows[0].count, "1");
});

test("import never changes patient names; Apply waits for concurrent correction and audits the current name", async () => {
  const patientId = Number((await pool.query(`insert into patients(mrn,arabic_full_name,english_full_name,normalized_arabic_name,age_years,sex,phone_1) values($1,$2,'Original',$2,30,'M','0912345678') returning id`, [`DICT-${marker}`, key("before")])).rows[0].id);
  patientIds.push(patientId);
  await importNameDictionaryEntries([{ arabicText: key("before"), englishText: "Stale" }, { arabicText: key("after"), englishText: "Current" }], userId);
  assert.equal((await pool.query("select english_full_name from patients where id=$1", [patientId])).rows[0].english_full_name, "Original");
  const blocker = await pool.connect();
  let apply: ReturnType<typeof applyNameDictionaryToPatients> | undefined;
  try {
    await blocker.query("begin");
    await blocker.query("update patients set arabic_full_name=$2 where id=$1", [patientId, key("after")]);
    apply = applyNameDictionaryToPatients(userId);
    // Wait until the real Apply transaction is blocked on the patient row.
    let blocked = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await pool.query("select 1 from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0 and query like '%order by id for update%'");
      if (result.rowCount) { blocked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(blocked, true);
    await blocker.query("commit");
    await apply;
    assert.equal((await pool.query("select english_full_name from patients where id=$1", [patientId])).rows[0].english_full_name, "Current");
    const audit = (await pool.query("select old_values,new_values from audit_log where entity_type='patient' and entity_id=$1 and action_type='name_dictionary_update'", [patientId])).rows[0];
    assert.equal(audit.old_values.englishFullName, "Original");
    assert.equal(audit.new_values.englishFullName, "Current");
  } finally {
    await blocker.query("rollback"); blocker.release();
    if (apply) await apply.catch(() => undefined);
  }
});

test("failed Apply rolls back patient name changes", async () => {
  const before = (await pool.query("select english_full_name from patients where id=$1", [patientIds[0]])).rows[0].english_full_name;
  await upsertNameDictionary({ arabicText: key("after"), englishText: "Never applied" }, userId);
  await assert.rejects(applyNameDictionaryToPatients(-1));
  assert.equal((await pool.query("select english_full_name from patients where id=$1", [patientIds[0]])).rows[0].english_full_name, before);
});
