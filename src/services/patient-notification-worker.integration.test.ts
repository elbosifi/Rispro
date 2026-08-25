import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { selectReadyReportBookings } from "./patient-notification-worker.js";

test.after(async () => {
  await pool.end();
});

test("report-ready candidate query deduplicates subscriptions and orders by booking date then id", async () => {
  const suffix = randomUUID().replace(/-/g, "");
  const created = { patientId: 0, modalityId: 0, policySetId: 0, bookingIds: [] as number[], subscriptionIds: [] as number[] };
  try {
    created.modalityId = Number((await pool.query<{ id: string }>(
      "insert into modalities(code,name_ar,name_en,daily_capacity,is_active) values($1,'اختبار','Notification SQL test',1,true) returning id::text id",
      [`PN${suffix.slice(0, 8)}`]
    )).rows[0]!.id);
    created.policySetId = Number((await pool.query<{ id: string }>(
      "insert into appointments_v2.policy_sets(key,name) values($1,'Notification SQL test') returning id::text id",
      [`patient_notification_${suffix}`]
    )).rows[0]!.id);
    const policyVersionId = Number((await pool.query<{ id: string }>(
      "insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash) values($1,1,'published',$2) returning id::text id",
      [created.policySetId, `hash-${suffix}`]
    )).rows[0]!.id);
    created.patientId = Number((await pool.query<{ id: string }>(
      `insert into patients(mrn,identifier_type,identifier_value,arabic_full_name,english_full_name,normalized_arabic_name,age_years,sex,phone_1)
       values($1,'other',$2,'مريض اختبار','Notification Patient','مريض اختبار',40,'O',$3) returning id::text id`,
      [`PN-${suffix}`, `PN-${suffix}`, `09${suffix.slice(0, 8)}`]
    )).rows[0]!.id);

    for (const daysAgo of [2, 0, 0]) {
      const bookingId = Number((await pool.query<{ id: string }>(
        `insert into appointments_v2.bookings(patient_id,modality_id,booking_date,case_category,status,policy_version_id,requires_report)
         values($1,$2,current_date - $3::int,'non_oncology','completed',$4,true) returning id::text id`,
        [created.patientId, created.modalityId, daysAgo, policyVersionId]
      )).rows[0]!.id);
      created.bookingIds.push(bookingId);
    }

    for (let index = 0; index < 2; index += 1) {
      const subscriptionId = Number((await pool.query<{ id: string }>(
        `insert into patient_web_push_subscriptions(endpoint,p256dh,auth,subscription_hash,enabled)
         values($1,$2,$3,$4,true) returning id::text id`,
        [`https://push.invalid/${suffix}/${index}`, `key-${index}`, `auth-${index}`, `hash-${suffix}-${index}`]
      )).rows[0]!.id);
      created.subscriptionIds.push(subscriptionId);
    }
    for (const bookingId of created.bookingIds) {
      await pool.query(`insert into patient_web_push_booking_subscriptions(subscription_id,booking_id,patient_id,report_ready,enabled)
        values($1,$2,$3,true,true)`, [created.subscriptionIds[0], bookingId, created.patientId]);
    }
    await pool.query(`insert into patient_web_push_booking_subscriptions(subscription_id,booking_id,patient_id,report_ready,enabled)
      values($1,$2,$3,true,true)`, [created.subscriptionIds[1], created.bookingIds[2], created.patientId]);

    const rows = await selectReadyReportBookings(30, 10);
    const fixtureRows = rows.filter((row) => created.bookingIds.includes(Number(row.booking_id)));
    assert.deepEqual(fixtureRows.map((row) => Number(row.booking_id)), [created.bookingIds[2], created.bookingIds[1], created.bookingIds[0]]);
    assert.equal(fixtureRows.filter((row) => Number(row.booking_id) === created.bookingIds[2]).length, 1);
  } finally {
    if (created.bookingIds.length) await pool.query("delete from appointments_v2.bookings where id = any($1::bigint[])", [created.bookingIds]);
    if (created.subscriptionIds.length) await pool.query("delete from patient_web_push_subscriptions where id = any($1::bigint[])", [created.subscriptionIds]);
    if (created.patientId) await pool.query("delete from patients where id = $1", [created.patientId]);
    if (created.policySetId) await pool.query("delete from appointments_v2.policy_sets where id = $1", [created.policySetId]);
    if (created.modalityId) await pool.query("delete from modalities where id = $1", [created.modalityId]);
  }
});
