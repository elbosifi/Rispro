import { pool } from "../../db/pool.js";
import { findRosterWeekById, listAssignmentsForWeek } from "./roster-repository.js";
import type { RosterAssignmentRow, RosterConflict, RosterDutyType, RosterMemberRow } from "./roster-types.js";

export interface DoctorRosterFacts {
  doctorId: number;
  displayName: string;
  doctorRole: string;
  modalityIds: Set<number>;
  unavailableDates: Map<string, string>;
  leaveDates: Map<string, string>;
}

function isSpecialistRole(role: string): boolean {
  return role === "consultant" || role === "specialist";
}

function timeValue(value: string | null, fallback: string): string {
  return value || fallback;
}

function overlaps(a: RosterAssignmentRow, b: RosterAssignmentRow): boolean {
  if (a.date !== b.date) return false;
  return timeValue(a.startTime, "00:00") < timeValue(b.endTime, "23:59:59") && timeValue(b.startTime, "00:00") < timeValue(a.endTime, "23:59:59");
}

function requiresSpecialist(dutyType: RosterDutyType): boolean {
  return dutyType === "ct_protocol_day" ||
    dutyType === "mri_supervision_reporting" ||
    dutyType === "ultrasound_term_1" ||
    dutyType === "ultrasound_term_2" ||
    dutyType === "ultrasound_term_3" ||
    dutyType === "mammography_session";
}

function requiredSpecialistMessage(dutyType: RosterDutyType): string {
  if (dutyType === "ct_protocol_day") return "CT protocol day requires a specialist.";
  if (dutyType === "mri_supervision_reporting") return "MRI supervision/reporting requires a specialist.";
  if (dutyType.startsWith("ultrasound_term")) return "Ultrasound term requires a supervising specialist.";
  if (dutyType === "mammography_session") return "Mammography session requires a breast-capable specialist.";
  return "Team requires a specialist.";
}

export function evaluateRosterConflicts(
  assignments: RosterAssignmentRow[],
  doctors: Map<number, DoctorRosterFacts>
): RosterConflict[] {
  const conflicts: RosterConflict[] = [];
  const memberAssignments = new Map<number, RosterAssignmentRow[]>();

  for (const assignment of assignments.filter((row) => row.status === "active")) {
    if (assignment.members.length === 0 && requiresSpecialist(assignment.dutyType)) {
      conflicts.push({
        assignmentId: assignment.id,
        memberId: null,
        doctorId: null,
        severity: "error",
        code: "required_team_empty",
        message: "Published roster has an empty required team slot.",
      });
    }

    const hasLead = assignment.members.some((member) => member.teamRole === "lead");
    const hasSpecialist = assignment.members.some((member) => {
      const doctor = doctors.get(Number(member.doctorId));
      return member.teamRole === "specialist" || member.teamRole === "supervisor" || Boolean(doctor && isSpecialistRole(doctor.doctorRole));
    });

    if (assignment.members.length > 0 && !hasLead) {
      conflicts.push({
        assignmentId: assignment.id,
        memberId: null,
        doctorId: null,
        severity: "error",
        code: "team_missing_lead",
        message: "Team has no lead.",
      });
    }
    if (assignment.members.length > 0 && !hasSpecialist) {
      conflicts.push({
        assignmentId: assignment.id,
        memberId: null,
        doctorId: null,
        severity: "error",
        code: "team_missing_specialist",
        message: "Team has no specialist.",
      });
    }
    if (requiresSpecialist(assignment.dutyType) && !hasSpecialist) {
      conflicts.push({
        assignmentId: assignment.id,
        memberId: null,
        doctorId: null,
        severity: "error",
        code: "duty_missing_specialist",
        message: requiredSpecialistMessage(assignment.dutyType),
      });
    }

    for (const member of assignment.members) {
      const doctorId = Number(member.doctorId);
      const doctor = doctors.get(doctorId);
      if (!doctor) continue;
      const doctorRows = memberAssignments.get(doctorId) ?? [];
      doctorRows.push(assignment);
      memberAssignments.set(doctorId, doctorRows);

      const unavailable = doctor.unavailableDates.get(assignment.date);
      if (unavailable) {
        conflicts.push({
          assignmentId: assignment.id,
          memberId: member.id,
          doctorId,
          severity: "error",
          code: "doctor_unavailable",
          message: `${doctor.displayName} is ${unavailable} on ${assignment.date}.`,
        });
      }
      const leave = doctor.leaveDates.get(assignment.date);
      if (leave) {
        conflicts.push({
          assignmentId: assignment.id,
          memberId: member.id,
          doctorId,
          severity: "error",
          code: "doctor_on_leave",
          message: `${doctor.displayName} has ${leave} on ${assignment.date}.`,
        });
      }
      if (assignment.modalityId && !doctor.modalityIds.has(Number(assignment.modalityId))) {
        conflicts.push({
          assignmentId: assignment.id,
          memberId: member.id,
          doctorId,
          severity: "error",
          code: "missing_modality_permission",
          message: `${doctor.displayName} lacks modality permission for this duty.`,
        });
      }
      if (member.teamRole === "lead" && (doctor.doctorRole === "senior_house_officer" || doctor.doctorRole === "resident")) {
        conflicts.push({
          assignmentId: assignment.id,
          memberId: member.id,
          doctorId,
          severity: "error",
          code: "junior_lead",
          message: "SHO/resident cannot be assigned as lead.",
        });
      }
    }
  }

  for (const [doctorId, rows] of memberAssignments) {
    const doctor = doctors.get(doctorId);
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        if (overlaps(rows[i], rows[j])) {
          conflicts.push({
            assignmentId: rows[j].id,
            memberId: null,
            doctorId,
            severity: "error",
            code: "overlapping_assignment",
            message: `${doctor?.displayName ?? "Doctor"} already has an overlapping assignment.`,
          });
        }
      }
    }
  }

  return conflicts;
}

async function loadDoctorFacts(assignments: RosterAssignmentRow[]): Promise<Map<number, DoctorRosterFacts>> {
  const doctorIds = [...new Set(assignments.flatMap((assignment) => assignment.members.map((member: RosterMemberRow) => member.doctorId)))];
  const facts = new Map<number, DoctorRosterFacts>();
  if (doctorIds.length === 0) return facts;

  const profileRows = await pool.query<{ id: number; display_name: string; doctor_role: string }>(
    `
      select id, display_name, doctor_role
      from doctor_portal.doctor_profiles
      where id = any($1::bigint[])
    `,
    [doctorIds]
  );
  for (const row of profileRows.rows) {
    facts.set(Number(row.id), {
      doctorId: Number(row.id),
      displayName: row.display_name,
      doctorRole: row.doctor_role,
      modalityIds: new Set<number>(),
      unavailableDates: new Map<string, string>(),
      leaveDates: new Map<string, string>(),
    });
  }

  const permissionRows = await pool.query<{ doctor_id: number; modality_id: number }>(
    `
      select doctor_id, modality_id
      from doctor_portal.doctor_modality_permissions
      where doctor_id = any($1::bigint[])
        and active = true
    `,
    [doctorIds]
  );
  for (const row of permissionRows.rows) {
    facts.get(Number(row.doctor_id))?.modalityIds.add(Number(row.modality_id));
  }

  const dates = assignments.map((assignment) => assignment.date);
  const dateFrom = dates.sort()[0];
  const dateTo = dates.sort()[dates.length - 1];
  if (!dateFrom || !dateTo) return facts;

  const availabilityRows = await pool.query<{ doctor_id: number; date: string; availability_status: string }>(
    `
      select doctor_id, date::text as date, availability_status
      from doctor_portal.doctor_availability
      where doctor_id = any($1::bigint[])
        and date between $2::date and $3::date
        and availability_status in ('unavailable', 'leave', 'conference', 'admin', 'teaching')
    `,
    [doctorIds, dateFrom, dateTo]
  );
  for (const row of availabilityRows.rows) {
    facts.get(Number(row.doctor_id))?.unavailableDates.set(row.date, row.availability_status);
  }

  const leaveRows = await pool.query<{ doctor_id: number; day: string; leave_type: string }>(
    `
      select dl.doctor_id, day::date::text as day, dl.leave_type
      from doctor_portal.doctor_leave_requests dl
      cross join lateral generate_series(dl.start_date, dl.end_date, interval '1 day') day
      where dl.doctor_id = any($1::bigint[])
        and dl.status in ('pending', 'approved')
        and dl.start_date <= $3::date
        and dl.end_date >= $2::date
    `,
    [doctorIds, dateFrom, dateTo]
  );
  for (const row of leaveRows.rows) {
    facts.get(Number(row.doctor_id))?.leaveDates.set(row.day, row.leave_type);
  }

  return facts;
}

export async function validateRosterWeekConflicts(weekId: number): Promise<RosterConflict[]> {
  const week = await findRosterWeekById(pool, weekId);
  if (!week) return [];
  const assignments = await listAssignmentsForWeek(pool, weekId);
  return evaluateRosterConflicts(assignments, await loadDoctorFacts(assignments));
}

export async function validateRosterAssignmentConflicts(assignmentId: number): Promise<RosterConflict[]> {
  const result = await pool.query<{ roster_week_id: number }>(
    `select roster_week_id from doctor_portal.doctor_roster_assignments where id = $1 limit 1`,
    [assignmentId]
  );
  const weekId = result.rows[0]?.roster_week_id;
  if (!weekId) return [];
  const conflicts = await validateRosterWeekConflicts(Number(weekId));
  return conflicts.filter((conflict) => conflict.assignmentId === assignmentId);
}
