import { pool } from "../../db/pool.js";
import type { UserId } from "../../types/http.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";

export interface RosterDutyTypeConfigRow {
  code: string;
  label: string;
  active: boolean;
  requiresSpecialist: boolean;
  sortOrder: number;
}

export interface RosterShiftImportMappingRow {
  id: number;
  sourceSystem: string;
  sourceShiftName: string | null;
  sourceShiftType: string | null;
  sourceShiftAbbreviation: string | null;
  dutyTypeCode: string;
  modalityId: number | null;
  modalityName: string | null;
  teamName: string | null;
  active: boolean;
}

export async function listRosterDutyTypes(includeInactive = false): Promise<RosterDutyTypeConfigRow[]> {
  const result = await pool.query<RosterDutyTypeConfigRow>(
    `
      select code, label, active, requires_specialist as "requiresSpecialist", sort_order as "sortOrder"
      from doctor_portal.roster_duty_types
      where $1::boolean = true or active = true
      order by sort_order asc, label asc, code asc
    `,
    [includeInactive]
  );
  return result.rows;
}

export async function upsertRosterDutyType(
  input: { code: string; label: string; active: boolean; requiresSpecialist: boolean; sortOrder: number },
  actor: { userId: UserId; doctorId: number }
): Promise<RosterDutyTypeConfigRow> {
  const code = input.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!code || !input.label.trim()) throw new Error("invalid_roster_duty_type");
  const result = await pool.query<RosterDutyTypeConfigRow>(
    `
      insert into doctor_portal.roster_duty_types (code, label, active, requires_specialist, sort_order)
      values ($1, $2, $3, $4, $5)
      on conflict (code) do update set
        label = excluded.label,
        active = excluded.active,
        requires_specialist = excluded.requires_specialist,
        sort_order = excluded.sort_order,
        updated_at = now()
      returning code, label, active, requires_specialist as "requiresSpecialist", sort_order as "sortOrder"
    `,
    [code, input.label.trim(), input.active, input.requiresSpecialist, input.sortOrder]
  );
  const dutyType = result.rows[0];
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "roster_duty_type_saved",
    targetType: "roster_duty_type",
    targetId: null,
    metadata: { ...dutyType },
    reason: null,
  });
  return dutyType;
}

export async function listRosterShiftImportMappings(includeInactive = false): Promise<RosterShiftImportMappingRow[]> {
  const result = await pool.query<RosterShiftImportMappingRow>(
    `
      select
        rsm.id,
        rsm.source_system as "sourceSystem",
        rsm.source_shift_name as "sourceShiftName",
        rsm.source_shift_type as "sourceShiftType",
        rsm.source_shift_abbreviation as "sourceShiftAbbreviation",
        rsm.duty_type_code as "dutyTypeCode",
        rsm.modality_id as "modalityId",
        m.name_en as "modalityName",
        rsm.team_name as "teamName",
        rsm.active
      from doctor_portal.roster_shift_import_mappings rsm
      left join modalities m on m.id = rsm.modality_id
      where $1::boolean = true or rsm.active = true
      order by rsm.source_system asc, rsm.source_shift_type asc nulls last, rsm.source_shift_name asc nulls last, rsm.id asc
    `,
    [includeInactive]
  );
  return result.rows;
}

export async function upsertRosterShiftImportMapping(
  input: {
    id?: number | null;
    sourceSystem: string;
    sourceShiftName: string | null;
    sourceShiftType: string | null;
    sourceShiftAbbreviation: string | null;
    dutyTypeCode: string;
    modalityId: number | null;
    teamName: string | null;
    active: boolean;
  },
  actor: { userId: UserId; doctorId: number }
): Promise<RosterShiftImportMappingRow> {
  const values = [
    input.sourceSystem.trim() || "abc",
    input.sourceShiftName?.trim() ?? "",
    input.sourceShiftType?.trim() ?? "",
    input.sourceShiftAbbreviation?.trim() ?? "",
    input.dutyTypeCode,
    input.modalityId,
    input.teamName?.trim() ?? "",
    input.active,
    actor.userId,
  ];
  const result = input.id
    ? await pool.query<RosterShiftImportMappingRow>(
      `
        update doctor_portal.roster_shift_import_mappings
        set source_system = $1,
            source_shift_name = nullif($2, ''),
            source_shift_type = nullif($3, ''),
            source_shift_abbreviation = nullif($4, ''),
            duty_type_code = $5,
            modality_id = $6,
            team_name = nullif($7, ''),
            active = $8,
            updated_at = now()
        where id = $10
        returning id, source_system as "sourceSystem", source_shift_name as "sourceShiftName",
          source_shift_type as "sourceShiftType", source_shift_abbreviation as "sourceShiftAbbreviation",
          duty_type_code as "dutyTypeCode", modality_id as "modalityId",
          null::text as "modalityName", team_name as "teamName", active
      `,
      [...values, input.id]
    )
    : await pool.query<RosterShiftImportMappingRow>(
      `
        insert into doctor_portal.roster_shift_import_mappings (
          source_system, source_shift_name, source_shift_type, source_shift_abbreviation,
          duty_type_code, modality_id, team_name, active, created_by
        )
        values ($1, nullif($2, ''), nullif($3, ''), nullif($4, ''), $5, $6, nullif($7, ''), $8, $9)
        returning id, source_system as "sourceSystem", source_shift_name as "sourceShiftName",
          source_shift_type as "sourceShiftType", source_shift_abbreviation as "sourceShiftAbbreviation",
          duty_type_code as "dutyTypeCode", modality_id as "modalityId",
          null::text as "modalityName", team_name as "teamName", active
      `,
      values
  );
  const mapping = result.rows[0];
  if (!mapping) throw new Error("roster_shift_import_mapping_not_found");
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "roster_shift_import_mapping_saved",
    targetType: "roster_shift_import_mapping",
    targetId: mapping.id,
    metadata: { ...mapping },
    reason: null,
  });
  return mapping;
}
