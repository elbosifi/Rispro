import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../../db/pool.js";

test("migration 181 applies incident lifecycle constraints on the disposable database", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  assert.equal((await pool.query("select 1 from schema_migrations where filename='181_department_incidents.sql'")).rowCount, 1);
  assert.equal((await pool.query("select 1 from information_schema.tables where table_name='department_incidents'")).rowCount, 1);
  assert.equal((await pool.query("select 1 from information_schema.columns where table_name='documents' and column_name='incident_id'")).rowCount, 1);
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const equipment = await pool.query<{ id: number }>("insert into equipment(name,equipment_type,modality,vendor,model,location,is_active) values($1,'WORKSTATION',null,'test','test','test',true) returning id", [`Incident lifecycle workstation ${suffix}`]);
  const created = await pool.query<{ id: number }>("insert into department_incidents(incident_type,occurred_at,equipment_id,equipment_condition,description) values('equipment',now(),$1,'operational',$2) returning id", [equipment.rows[0]!.id, `migration lifecycle ${suffix}`]);
  const incidentIds = [created.rows[0]!.id];
  try {
    await assert.rejects(() => pool.query("insert into department_incidents(incident_type,occurred_at,description) values('equipment',now(),'missing equipment')"));
    await assert.rejects(() => pool.query("insert into department_incidents(incident_type,occurred_at,equipment_id,description) values('equipment',now(),$1,'missing condition')", [equipment.rows[0]!.id]));
    const clinical = await pool.query<{ id: number }>("insert into department_incidents(incident_type,occurred_at,clinical_category,harm_level,description) values('clinical_workflow',now(),'other','no_harm',$1) returning id", [`patient optional ${suffix}`]);
    incidentIds.push(clinical.rows[0]!.id);
    await assert.rejects(() => pool.query("insert into department_incidents(incident_type,occurred_at,equipment_id,equipment_condition,status,description) values('equipment',now(),$1,'operational','invalid','bad status')", [equipment.rows[0]!.id]));
    const document = await pool.query<{ id: number }>("insert into documents(document_type,original_filename,stored_path,mime_type,file_size,incident_id) values('incident_attachment','lifecycle.txt','lifecycle.txt','text/plain',1,$1) returning id", [incidentIds[0]]);
    await assert.rejects(() => pool.query("delete from department_incidents where id=$1", [incidentIds[0]]));
    await pool.query("delete from documents where id=$1", [document.rows[0]!.id]);
  } finally {
    await pool.query("delete from documents where incident_id=any($1::bigint[])", [incidentIds]);
    await pool.query("delete from department_incidents where id=any($1::bigint[])", [incidentIds]);
    await pool.query("delete from equipment where id=$1", [equipment.rows[0]!.id]);
  }
});
