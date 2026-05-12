import { pool } from "../../db/pool.js";
import type { UserId } from "../../types/http.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import { defaultWorkloadUnits } from "./workload-rules.js";
import type { TeamWorkloadSummaryRow, WorkloadCalculationSummary, WorkloadCatalogRule } from "./workload-types.js";

interface WorkloadCaseRow {
  caseTeamAssignmentId: number;
  appointmentId: number;
  rosterAssignmentId: number;
  modalityId: number;
  modalityCode: string | null;
  modalityName: string | null;
  examTypeId: number | null;
  examTypeName: string | null;
  caseCategory: string | null;
  assignmentType: "imaging" | "protocol" | "reporting" | "ultrasound_operator" | "mammography_episode";
  requiresReport: boolean;
  appointmentStatus: string;
}

interface WorkloadActor {
  userId: UserId;
  doctorId: number;
}

async function listWorkloadCases(input: { startDate: string; endDate: string; modalityId: number | null }): Promise<WorkloadCaseRow[]> {
  const values: unknown[] = [input.startDate, input.endDate];
  const modalityFilter = input.modalityId ? "and b.modality_id = $3" : "";
  if (input.modalityId) values.push(input.modalityId);
  const result = await pool.query<WorkloadCaseRow>(
    `
      select
        cta.id as "caseTeamAssignmentId",
        cta.appointment_id as "appointmentId",
        cta.roster_assignment_id as "rosterAssignmentId",
        b.modality_id as "modalityId",
        m.code as "modalityCode",
        m.name_en as "modalityName",
        b.exam_type_id as "examTypeId",
        et.name_en as "examTypeName",
        b.case_category as "caseCategory",
        cta.assignment_type as "assignmentType",
        b.requires_report as "requiresReport",
        b.status as "appointmentStatus"
      from doctor_portal.case_team_assignments cta
      join appointments_v2.bookings b on b.id = cta.appointment_id
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      where cta.status = 'active'
        and b.booking_date >= $1::date
        and b.booking_date <= $2::date
        ${modalityFilter}
      order by b.booking_date asc, b.id asc
    `,
    values
  );
  return result.rows;
}

async function findCatalogRule(row: WorkloadCaseRow): Promise<WorkloadCatalogRule | null> {
  const result = await pool.query<WorkloadCatalogRule>(
    `
      select
        id,
        modality_id as "modalityId",
        exam_type_id as "examTypeId",
        case_category as "caseCategory",
        assignment_type as "assignmentType",
        base_units::float as "baseUnits",
        report_required_multiplier::float as "reportRequiredMultiplier",
        no_report_units::float as "noReportUnits",
        active,
        effective_from::text as "effectiveFrom",
        effective_to::text as "effectiveTo"
      from doctor_portal.workload_unit_catalog
      where active = true
        and modality_id = $1
        and assignment_type = $2
        and (exam_type_id = $3 or exam_type_id is null)
        and (case_category = $4 or case_category is null)
        and effective_from <= current_date
        and (effective_to is null or effective_to >= current_date)
      order by
        case when exam_type_id = $3 then 0 else 1 end,
        case when case_category = $4 then 0 else 1 end,
        id desc
      limit 1
    `,
    [row.modalityId, row.assignmentType, row.examTypeId, row.caseCategory]
  );
  return result.rows[0] ?? null;
}

async function activeWorkloadCurrent(row: WorkloadCaseRow, units: number): Promise<boolean> {
  const result = await pool.query(
    `
      select 1
      from doctor_portal.case_workload_units
      where case_team_assignment_id = $1
        and assignment_type = $2
        and status = 'active'
        and workload_units = $3
      limit 1
    `,
    [row.caseTeamAssignmentId, row.assignmentType, units]
  );
  return Boolean(result.rows[0]);
}

export async function calculateWorkloadUnits(input: { startDate: string; endDate: string; modalityId: number | null }, actor: WorkloadActor): Promise<WorkloadCalculationSummary> {
  const summary: WorkloadCalculationSummary = {
    calculatedCount: 0,
    alreadyCurrentCount: 0,
    defaultedNoCatalogRuleCount: 0,
    skippedCount: 0,
    errors: [],
  };
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "workload_calculation_started",
    targetType: "case_workload_units",
    targetId: null,
    metadata: input,
    reason: null,
  });
  const rows = await listWorkloadCases(input);
  for (const row of rows) {
    if (["cancelled", "discontinued", "voided"].includes(row.appointmentStatus)) {
      summary.skippedCount += 1;
      continue;
    }
    try {
      const rule = await findCatalogRule(row);
      const units = rule
        ? row.requiresReport
          ? rule.baseUnits * rule.reportRequiredMultiplier
          : rule.noReportUnits
        : defaultWorkloadUnits(row);
      if (!rule) summary.defaultedNoCatalogRuleCount += 1;
      if (await activeWorkloadCurrent(row, units)) {
        summary.alreadyCurrentCount += 1;
        continue;
      }
      await pool.query(
        `
          update doctor_portal.case_workload_units
          set status = 'superseded', updated_at = now()
          where case_team_assignment_id = $1 and assignment_type = $2 and status = 'active'
        `,
        [row.caseTeamAssignmentId, row.assignmentType]
      );
      await pool.query(
        `
          insert into doctor_portal.case_workload_units (
            appointment_id, case_team_assignment_id, roster_assignment_id, modality_id, exam_type_id,
            case_category, assignment_type, requires_report, workload_units, source, status,
            catalog_rule_id, defaulted
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'auto', 'active', $10, $11)
        `,
        [
          row.appointmentId,
          row.caseTeamAssignmentId,
          row.rosterAssignmentId,
          row.modalityId,
          row.examTypeId,
          row.caseCategory,
          row.assignmentType,
          row.requiresReport,
          units,
          rule?.id ?? null,
          !rule,
        ]
      );
      summary.calculatedCount += 1;
    } catch (error) {
      summary.errors.push({ appointmentId: row.appointmentId, reason: error instanceof Error ? error.message : "workload_calculation_failed" });
    }
  }
  await insertDoctorAuditEvent(pool, {
    actorUserId: actor.userId,
    actorDoctorId: actor.doctorId,
    eventType: "workload_calculation_completed",
    targetType: "case_workload_units",
    targetId: null,
    metadata: {
      calculatedCount: summary.calculatedCount,
      alreadyCurrentCount: summary.alreadyCurrentCount,
      defaultedNoCatalogRuleCount: summary.defaultedNoCatalogRuleCount,
      skippedCount: summary.skippedCount,
      errors: summary.errors,
    },
    reason: null,
  });
  return summary;
}

export async function listWorkloadSummary(
  doctorId: number,
  isManager: boolean,
  filters: { startDate: string; endDate: string; modalityId?: number | null; rosterAssignmentId?: number | null; teamName?: string | null; caseCategory?: string | null; requiresReport?: boolean | null }
): Promise<TeamWorkloadSummaryRow[]> {
  const values: unknown[] = [filters.startDate, filters.endDate];
  const where = ["b.booking_date >= $1::date", "b.booking_date <= $2::date", "cwu.status = 'active'"];
  if (filters.modalityId) {
    values.push(filters.modalityId);
    where.push(`cwu.modality_id = $${values.length}`);
  }
  if (filters.rosterAssignmentId) {
    values.push(filters.rosterAssignmentId);
    where.push(`cwu.roster_assignment_id = $${values.length}`);
  }
  if (filters.teamName) {
    values.push(filters.teamName);
    where.push(`dra.team_name = $${values.length}`);
  }
  if (filters.caseCategory) {
    values.push(filters.caseCategory);
    where.push(`cwu.case_category = $${values.length}`);
  }
  if (filters.requiresReport !== null && filters.requiresReport !== undefined) {
    values.push(filters.requiresReport);
    where.push(`cwu.requires_report = $${values.length}`);
  }
  if (!isManager) {
    values.push(doctorId);
    where.push(`exists (select 1 from doctor_portal.doctor_roster_members drm where drm.roster_assignment_id = cwu.roster_assignment_id and drm.doctor_id = $${values.length})`);
  }
  const result = await pool.query<TeamWorkloadSummaryRow>(
    `
      select
        cwu.roster_assignment_id as "rosterAssignmentId",
        dra.team_name as "teamName",
        dra.duty_type as "dutyType",
        dra.date::text as "date",
        cwu.modality_id as "modalityId",
        m.name_en as "modalityName",
        cwu.case_category as "caseCategory",
        count(*)::int as "caseCount",
        coalesce(sum(cwu.workload_units), 0)::float as "totalWorkloadUnits",
        count(*) filter (where cwu.requires_report)::int as "reportRequiredCount",
        count(*) filter (where not cwu.requires_report)::int as "noReportCount",
        count(*) filter (where cwu.requires_report and b.status <> 'completed')::int as "pendingCount",
        count(*) filter (where cwu.requires_report and b.status = 'completed')::int as "finalizedCount",
        count(*) filter (where cwu.requires_report and b.status <> 'completed' and cta.expected_reporting_date < current_date)::int as "overdueCount"
      from doctor_portal.case_workload_units cwu
      join appointments_v2.bookings b on b.id = cwu.appointment_id
      join doctor_portal.case_team_assignments cta on cta.id = cwu.case_team_assignment_id
      join doctor_portal.doctor_roster_assignments dra on dra.id = cwu.roster_assignment_id
      join modalities m on m.id = cwu.modality_id
      where ${where.join(" and ")}
      group by cwu.roster_assignment_id, dra.team_name, dra.duty_type, dra.date, cwu.modality_id, m.name_en, cwu.case_category
      order by dra.date asc, dra.team_name asc, m.name_en asc
    `,
    values
  );
  return result.rows;
}

export async function listCatalogRules(): Promise<WorkloadCatalogRule[]> {
  const result = await pool.query<WorkloadCatalogRule>(
    `
      select id, modality_id as "modalityId", exam_type_id as "examTypeId", case_category as "caseCategory",
        assignment_type as "assignmentType", base_units::float as "baseUnits",
        report_required_multiplier::float as "reportRequiredMultiplier", no_report_units::float as "noReportUnits",
        active, effective_from::text as "effectiveFrom", effective_to::text as "effectiveTo"
      from doctor_portal.workload_unit_catalog
      order by active desc, modality_id asc, assignment_type asc, id asc
    `
  );
  return result.rows;
}

export async function createCatalogRule(input: {
  modalityId: number;
  examTypeId: number | null;
  caseCategory: string | null;
  assignmentType: string;
  baseUnits: number;
  reportRequiredMultiplier: number;
  noReportUnits: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  actorUserId: UserId;
}): Promise<WorkloadCatalogRule> {
  const result = await pool.query<WorkloadCatalogRule>(
    `
      insert into doctor_portal.workload_unit_catalog (
        modality_id, exam_type_id, case_category, assignment_type, base_units,
        report_required_multiplier, no_report_units, effective_from, effective_to, created_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10)
      returning id, modality_id as "modalityId", exam_type_id as "examTypeId", case_category as "caseCategory",
        assignment_type as "assignmentType", base_units::float as "baseUnits",
        report_required_multiplier::float as "reportRequiredMultiplier", no_report_units::float as "noReportUnits",
        active, effective_from::text as "effectiveFrom", effective_to::text as "effectiveTo"
    `,
    [
      input.modalityId,
      input.examTypeId,
      input.caseCategory,
      input.assignmentType,
      input.baseUnits,
      input.reportRequiredMultiplier,
      input.noReportUnits,
      input.effectiveFrom,
      input.effectiveTo,
      input.actorUserId,
    ]
  );
  return result.rows[0];
}

export async function updateCatalogRule(input: {
  id: number;
  modalityId?: number;
  examTypeId?: number | null;
  caseCategory?: string | null;
  assignmentType?: string;
  baseUnits?: number;
  reportRequiredMultiplier?: number;
  noReportUnits?: number;
  active?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  actorUserId: UserId;
}): Promise<WorkloadCatalogRule | null> {
  const result = await pool.query<WorkloadCatalogRule>(
    `
      update doctor_portal.workload_unit_catalog
      set modality_id = case when $2::boolean then $3::bigint else modality_id end,
        exam_type_id = case when $4::boolean then $5::bigint else exam_type_id end,
        case_category = case when $6::boolean then $7::text else case_category end,
        assignment_type = case when $8::boolean then $9::text else assignment_type end,
        base_units = case when $10::boolean then $11::numeric else base_units end,
        report_required_multiplier = case when $12::boolean then $13::numeric else report_required_multiplier end,
        no_report_units = case when $14::boolean then $15::numeric else no_report_units end,
        active = case when $16::boolean then $17::boolean else active end,
        effective_from = case when $18::boolean then $19::date else effective_from end,
        effective_to = case when $20::boolean then $21::date else effective_to end,
        updated_at = now()
      where id = $1
      returning id, modality_id as "modalityId", exam_type_id as "examTypeId", case_category as "caseCategory",
        assignment_type as "assignmentType", base_units::float as "baseUnits",
        report_required_multiplier::float as "reportRequiredMultiplier", no_report_units::float as "noReportUnits",
        active, effective_from::text as "effectiveFrom", effective_to::text as "effectiveTo"
    `,
    [
      input.id,
      input.modalityId !== undefined,
      input.modalityId ?? null,
      input.examTypeId !== undefined,
      input.examTypeId ?? null,
      input.caseCategory !== undefined,
      input.caseCategory ?? null,
      input.assignmentType !== undefined,
      input.assignmentType ?? null,
      input.baseUnits !== undefined,
      input.baseUnits ?? null,
      input.reportRequiredMultiplier !== undefined,
      input.reportRequiredMultiplier ?? null,
      input.noReportUnits !== undefined,
      input.noReportUnits ?? null,
      input.active !== undefined,
      input.active ?? null,
      input.effectiveFrom !== undefined,
      input.effectiveFrom ?? null,
      input.effectiveTo !== undefined,
      input.effectiveTo ?? null,
    ]
  );
  const rule = result.rows[0] ?? null;
  if (rule) {
    await insertDoctorAuditEvent(pool, {
      actorUserId: input.actorUserId,
      actorDoctorId: null,
      eventType: "workload_catalog_rule_updated",
      targetType: "workload_unit_catalog",
      targetId: rule.id,
      metadata: { active: rule.active, assignmentType: rule.assignmentType, modalityId: rule.modalityId },
      reason: null,
    });
  }
  return rule;
}

export async function deactivateCatalogRule(id: number, actorUserId: UserId): Promise<WorkloadCatalogRule | null> {
  return updateCatalogRule({ id, active: false, actorUserId });
}
