import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import { logAuditEntry } from "./audit-service.js";

export const INCIDENT_TYPES = ["equipment", "clinical_workflow"] as const;
export const INCIDENT_STATUSES = [
  "submitted",
  "under_review",
  "action_required",
  "resolved",
  "closed",
] as const;
export const CLINICAL_CATEGORIES = [
  "wrong_patient",
  "wrong_exam",
  "wrong_protocol",
  "acquisition_quality",
  "contrast_event",
  "delay",
  "communication_failure",
  "reporting_issue",
  "other",
] as const;
const EQUIPMENT_CONDITIONS = [
  "operational",
  "degraded",
  "out_of_service",
] as const;
const HARM_LEVELS = ["near_miss", "no_harm", "harm"] as const;
type IncidentRow = Record<string, unknown>;
type IncidentInput = {
  incidentType?: unknown;
  occurredAt?: unknown;
  equipmentId?: unknown;
  patientId?: unknown;
  equipmentCondition?: unknown;
  clinicalCategory?: unknown;
  harmLevel?: unknown;
  description?: unknown;
  immediateAction?: unknown;
  vendorContacted?: unknown;
  vendorContactPerson?: unknown;
  vendorReference?: unknown;
};

const text = (value: unknown) => String(value ?? "").trim() || null;
const incidentNumber = (
  row: IncidentRow,
): IncidentRow & { incidentNumber: string } => ({
  ...row,
  incidentNumber: `INC-${String(row.id).padStart(6, "0")}`,
});
function allowed<T extends readonly string[]>(
  value: unknown,
  values: T,
  name: string,
  required = false,
): T[number] | null {
  const normalized = String(value ?? "").trim();
  if (!normalized && !required) return null;
  if (!values.includes(normalized))
    throw new HttpError(400, `Invalid ${name}.`);
  return normalized as T[number];
}
const contacted = (value: unknown) =>
  value === true || value === "true" || value === 1 || value === "1";
const incidentSelect = `select i.*, e.name equipment_name, e.equipment_type, e.location, p.arabic_full_name patient_arabic_name, p.english_full_name patient_english_name, p.mrn, u.full_name reporter_name, u.username reporter_username, ru.full_name reviewer_name from department_incidents i left join equipment e on e.id=i.equipment_id left join patients p on p.id=i.patient_id left join users u on u.id=i.reported_by_user_id left join users ru on ru.id=i.reviewed_by_user_id`;

export async function listIncidents(
  filters: { incidentType?: unknown; status?: unknown } = {},
) {
  const incidentType = allowed(
    filters.incidentType,
    INCIDENT_TYPES,
    "incident type",
  );
  const status = allowed(filters.status, INCIDENT_STATUSES, "status");
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (incidentType) {
    values.push(incidentType);
    clauses.push(`i.incident_type=$${values.length}`);
  }
  if (status) {
    values.push(status);
    clauses.push(`i.status=$${values.length}`);
  }
  const { rows } = await pool.query<IncidentRow>(
    `${incidentSelect}${clauses.length ? ` where ${clauses.join(" and ")}` : ""} order by i.occurred_at desc, i.id desc limit 200`,
    values,
  );
  return rows.map(incidentNumber);
}

export async function getIncident(id: unknown) {
  const incidentId = normalizePositiveInteger(id, "incidentId")!;
  const { rows } = await pool.query<IncidentRow>(
    `${incidentSelect} where i.id=$1`,
    [incidentId],
  );
  if (!rows[0]) throw new HttpError(404, "Incident not found.");
  return incidentNumber(rows[0]);
}

export async function createIncident(input: IncidentInput, actorId: unknown) {
  const incidentType = allowed(
    input.incidentType,
    INCIDENT_TYPES,
    "incident type",
    true,
  )!;
  const occurredAt = text(input.occurredAt);
  const description = text(input.description);
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt)))
    throw new HttpError(400, "occurredAt is required.");
  if (!description) throw new HttpError(400, "description is required.");
  const equipmentId = normalizePositiveInteger(
    input.equipmentId,
    "equipmentId",
    { required: false },
  );
  const patientId = normalizePositiveInteger(input.patientId, "patientId", {
    required: false,
  });
  const equipmentCondition = allowed(
    input.equipmentCondition,
    EQUIPMENT_CONDITIONS,
    "equipment condition",
  );
  const clinicalCategory = allowed(
    input.clinicalCategory,
    CLINICAL_CATEGORIES,
    "clinical category",
  );
  const harmLevel = allowed(input.harmLevel, HARM_LEVELS, "harm level");
  if (incidentType === "equipment" && (!equipmentId || !equipmentCondition))
    throw new HttpError(400, "Equipment and equipment condition are required.");
  if (incidentType === "clinical_workflow" && (!clinicalCategory || !harmLevel))
    throw new HttpError(400, "Clinical category and harm level are required.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (
      equipmentId &&
      !(
        await client.query("select 1 from equipment where id=$1", [equipmentId])
      ).rowCount
    )
      throw new HttpError(404, "Equipment not found.");
    if (
      patientId &&
      !(await client.query("select 1 from patients where id=$1", [patientId]))
        .rowCount
    )
      throw new HttpError(404, "Patient not found.");
    const vendorContacted =
      incidentType === "equipment" && contacted(input.vendorContacted);
    const { rows } = await client.query<{ id: number }>(
      "insert into department_incidents(incident_type,occurred_at,equipment_id,patient_id,equipment_condition,clinical_category,harm_level,description,immediate_action,vendor_contacted,vendor_contact_person,vendor_reference,reported_by_user_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id",
      [
        incidentType,
        occurredAt,
        incidentType === "equipment" ? equipmentId : null,
        incidentType === "clinical_workflow" ? patientId : null,
        incidentType === "equipment" ? equipmentCondition : null,
        incidentType === "clinical_workflow" ? clinicalCategory : null,
        incidentType === "clinical_workflow" ? harmLevel : null,
        description,
        text(input.immediateAction),
        vendorContacted,
        vendorContacted ? text(input.vendorContactPerson) : null,
        vendorContacted ? text(input.vendorReference) : null,
        actorId,
      ],
    );
    const incident = incidentNumber(
      (
        await client.query<IncidentRow>(
          "select * from department_incidents where id=$1",
          [rows[0]!.id],
        )
      ).rows[0]!,
    );
    await logAuditEntry(
      {
        entityType: "incident",
        entityId: rows[0]!.id,
        actionType: "create",
        newValues: incident,
        changedByUserId: actorId as never,
      },
      client,
    );
    await client.query("commit");
    return incident;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewIncident(
  id: unknown,
  input: { status?: unknown; reviewNotes?: unknown },
  actorId: unknown,
) {
  const incidentId = normalizePositiveInteger(id, "incidentId")!;
  const before = await getIncident(incidentId);
  const status = allowed(input.status, INCIDENT_STATUSES, "status", true)!;
  const reviewNotes = text(input.reviewNotes);
  if (["resolved", "closed"].includes(status) && !reviewNotes)
    throw new HttpError(
      400,
      "Review notes are required when resolving or closing an incident.",
    );
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "update department_incidents set status=$2,review_notes=$3,reviewed_by_user_id=$4,updated_at=now() where id=$1",
      [incidentId, status, reviewNotes, actorId],
    );
    const after = incidentNumber(
      (
        await client.query<IncidentRow>(
          "select * from department_incidents where id=$1",
          [incidentId],
        )
      ).rows[0]!,
    );
    await logAuditEntry(
      {
        entityType: "incident",
        entityId: incidentId,
        actionType: "review",
        oldValues: before,
        newValues: after,
        changedByUserId: actorId as never,
      },
      client,
    );
    await client.query("commit");
    return getIncident(incidentId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listIncidentEquipment() {
  return (
    await pool.query(
      "select id,name,equipment_type,location from equipment where is_active=true order by name asc",
    )
  ).rows;
}
