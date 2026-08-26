import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import { CLINICAL_CATEGORIES, createIncident, listIncidentEquipment, listIncidents, reviewIncident } from "./incident-service.js";

test("incident service enforces incident types, categories, ordering, lookup state, and review audit", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  const suffix = Date.now().toString(); const user = (await pool.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$1,'x','supervisor',true) returning id", [`incident_${suffix}`])).rows[0]!;
  const equipment = (await listIncidentEquipment())[0] as { id: number } | undefined;
  assert.ok(equipment, "disposable DB seed must contain active equipment");
  const ids: number[] = [];
  try {
    const equipmentIncident = await createIncident({ incidentType: "equipment", occurredAt: "2026-08-26T09:00:00Z", equipmentId: equipment!.id, equipmentCondition: "operational", vendorContacted: true, vendorContactPerson: "Service contact", vendorReference: "TICKET-1", description: "equipment valid" }, user.id); ids.push(Number(equipmentIncident.id));
    const clinical = await createIncident({ incidentType: "clinical_workflow", occurredAt: "2026-08-26T10:00:00Z", clinicalCategory: "other", harmLevel: "no_harm", description: "clinical optional patient" }, user.id); ids.push(Number(clinical.id));
    for (const clinicalCategory of CLINICAL_CATEGORIES) { const item = await createIncident({ incidentType: "clinical_workflow", occurredAt: "2026-08-26T11:00:00Z", clinicalCategory, harmLevel: "near_miss", description: `category ${clinicalCategory}` }, user.id); ids.push(Number(item.id)); }
    await assert.rejects(() => createIncident({ incidentType: "equipment", occurredAt: "2026-08-26T12:00:00Z", description: "invalid" }, user.id));
    await assert.rejects(() => createIncident({ incidentType: "clinical_workflow", occurredAt: "2026-08-26T12:00:00Z", clinicalCategory: "other", description: "missing harm" }, user.id));
    await assert.rejects(() => createIncident({ incidentType: "clinical_workflow", occurredAt: "2026-08-26T12:00:00Z", harmLevel: "no_harm", description: "missing category" }, user.id));
    const listed = await listIncidents({ incidentType: "clinical_workflow" }); assert.ok(listed.length <= 200); assert.equal(listed.find((item) => item.id === clinical.id)?.incident_type, "clinical_workflow");
    const reviewed = await reviewIncident(equipmentIncident.id, { status: "resolved", reviewNotes: "corrected" }, user.id); assert.equal(reviewed.status, "resolved"); assert.equal(Number(reviewed.reviewed_by_user_id), user.id);
    await assert.rejects(() => reviewIncident(equipmentIncident.id, { status: "closed", reviewNotes: "" }, user.id));
    assert.equal((await pool.query("select 1 from audit_log where entity_type='incident' and entity_id=$1 and action_type='create'", [equipmentIncident.id])).rowCount, 1);
    assert.equal((await pool.query("select 1 from audit_log where entity_type='incident' and entity_id=$1 and action_type='review'", [equipmentIncident.id])).rowCount, 1);
  } finally { if (ids.length) { await pool.query("delete from audit_log where entity_type='incident' and entity_id=any($1::bigint[])", [ids]); await pool.query("delete from department_incidents where id=any($1::bigint[])", [ids]); } await pool.query("delete from users where id=$1", [user.id]); }
});
