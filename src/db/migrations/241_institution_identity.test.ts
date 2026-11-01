import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { pool } from "../pool.js";
import { readInstitutionIdentity } from "../../services/institution-identity-service.js";

after(() => pool.end());
test("institution migration preserves wrapped/unwrapped legacy config, URL and QR-specific settings and is repeatable", async () => {
  const db = await pool.connect();
  try {
    await db.query("begin");
    const migration = await readFile(new URL("./241_institution_identity.sql",import.meta.url),"utf8");
    for (const wrapped of [true,false]) {
      await db.query("delete from system_settings where category='deployment_identity' and setting_key='institution'");
      const slip = {hospitalNameEn:"Existing Hospital",hospitalNameAr:"مستشفى قائم",departmentNameEn:"Existing Department",departmentNameAr:"قسم قائم",paperMode:"preprinted"};
      const qr = {location:{centerNameEn:"Retained alternative center name",addressEn:"Existing address",parkingNoteEn:"Gate 3",arrivalInstructionsEn:"Arrive early"},contact:{primaryPhone:"12345",whatsapp:"67890"},allowCancellation:false};
      for (const [category,value] of [["appointment_slip",slip],["patient_qr_self_service",qr]] as const) await db.query("insert into system_settings(category,setting_key,setting_value) values($1,'config',$2) on conflict(category,setting_key) do update set setting_value=excluded.setting_value",[category,JSON.stringify(wrapped?{value}:value)]);
      const before = (await db.query("select * from system_settings where category in ('appointment_slip','patient_qr_self_service') or category='deployment_identity' and setting_key='public_app_base_url' order by id")).rows;
      await db.query(migration);
      const identity = await readInstitutionIdentity(db);
      assert.equal(identity.hospitalNameEn,"Existing Hospital");assert.equal(identity.hospitalNameAr,"مستشفى قائم");assert.equal(identity.departmentNameEn,"Existing Department");assert.equal(identity.addressEn,"Existing address");assert.equal(identity.primaryPhone,"12345");
      assert.deepEqual((await db.query("select * from system_settings where category in ('appointment_slip','patient_qr_self_service') or category='deployment_identity' and setting_key='public_app_base_url' order by id")).rows,before);
      await db.query("update system_settings set setting_value=jsonb_set(setting_value,'{value,hospitalNameEn}','\"Updated Hospital\"') where category='deployment_identity' and setting_key='institution'");
      await db.query(migration);assert.equal((await readInstitutionIdentity(db)).hospitalNameEn,"Updated Hospital");
    }
  } finally { await db.query("rollback");db.release(); }
});
