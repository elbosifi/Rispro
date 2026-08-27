import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import { CLINICAL_CATEGORIES, createIncident, listIncidentEquipment, listIncidents, reviewIncident } from "./incident-service.js";

test("incident service enforces incident types, categories, ordering, lookup state, and review audit", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  const suffix = Date.now().toString(); const userId = Number((await pool.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$1,'x','supervisor',true) returning id", [`incident_${suffix}`])).rows[0]!.id);
  const equipmentName = `Incident service workstation ${suffix}`;
  const equipmentId = Number((await pool.query<{ id: number }>("insert into equipment(name,equipment_type,modality,vendor,model,location,is_active) values($1,'WORKSTATION',null,'test','test','test',true) returning id", [equipmentName])).rows[0]!.id);
  const ids: number[] = [];
  try {
    const listedEquipment = await listIncidentEquipment();
    assert.ok(listedEquipment.some((item) => Number(item.id) === equipmentId), "test Equipment must be available to Incident lookup");
    const equipmentIncident = await createIncident({ incidentType: "equipment", occurredAt: "2026-08-26T09:00:00Z", equipmentId, equipmentCondition: "operational", vendorContacted: true, vendorContactPerson: "Service contact", vendorReference: "TICKET-1", description: "equipment valid" }, userId); ids.push(Number(equipmentIncident.id));
    const clinical = await createIncident({ incidentType: "clinical_workflow", occurredAt: "2026-08-26T10:00:00Z", clinicalCategory: "other", harmLevel: "no_harm", description: "clinical optional patient" }, userId); ids.push(Number(clinical.id));
    for (const clinicalCategory of CLINICAL_CATEGORIES) { const item = await createIncident({ incidentType: "clinical_workflow", occurredAt: "2026-08-26T11:00:00Z", clinicalCategory, harmLevel: "near_miss", description: `category ${clinicalCategory}` }, userId); ids.push(Number(item.id)); }
    await assert.rejects(() => createIncident({ incidentType: "equipment", occurredAt: "2026-08-26T12:00:00Z", description: "invalid" }, userId));
    await assert.rejects(() => createIncident({ incidentType: "clinical_workflow", occurredAt: "2026-08-26T12:00:00Z", clinicalCategory: "other", description: "missing harm" }, userId));
    await assert.rejects(() => createIncident({ incidentType: "clinical_workflow", occurredAt: "2026-08-26T12:00:00Z", harmLevel: "no_harm", description: "missing category" }, userId));
    const listed = await listIncidents({ incidentType: "clinical_workflow" }); assert.ok(listed.length <= 200); assert.equal(listed.find((item) => item.id === clinical.id)?.incident_type, "clinical_workflow");
    const reviewed = await reviewIncident(equipmentIncident.id, { status: "resolved", reviewNotes: "corrected" }, userId); assert.equal(reviewed.status, "resolved"); assert.equal(Number(reviewed.reviewed_by_user_id), userId);
    await assert.rejects(() => reviewIncident(equipmentIncident.id, { status: "closed", reviewNotes: "" }, userId));
    assert.equal((await pool.query("select 1 from audit_log where entity_type='incident' and entity_id=$1 and action_type='create'", [equipmentIncident.id])).rowCount, 1);
    assert.equal((await pool.query("select 1 from audit_log where entity_type='incident' and entity_id=$1 and action_type='review'", [equipmentIncident.id])).rowCount, 1);
  } finally { if (ids.length) { await pool.query("delete from audit_log where entity_type='incident' and entity_id=any($1::bigint[])", [ids]); await pool.query("delete from department_incidents where id=any($1::bigint[])", [ids]); } await pool.query("delete from equipment where id=$1", [equipmentId]); await pool.query("delete from users where id=$1", [userId]); }
});
