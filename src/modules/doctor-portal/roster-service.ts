import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { getDoctorMe } from "./profile-service.js";
import { listDoctorProfiles, type DoctorProfileRow } from "./profile-repository.js";
import {
  addMember,
  archiveWeek,
  copyPreviousWeek,
  createRosterWeek,
  deleteAssignment,
  findRosterWeekById,
  getRosterWeekDetails,
  insertAssignment,
  listMyRoster,
  publishWeek,
  removeMember,
  updateRosterWeekDates,
  updateAssignment,
  type AssignmentInput,
} from "./roster-repository.js";
import type { RosterTeamRole } from "./roster-types.js";
import { pool } from "../../db/pool.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import { validateRosterAssignmentConflicts, validateRosterWeekConflicts } from "./roster-conflicts.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

export async function requireRosterDoctor(actor: Actor) {
  const me = await getDoctorMe(actor.userId, actor.appRole);
  if (!me.hasActiveDoctorProfile || !me.profile) {
    throw new HttpError(403, "Active doctor profile is required.");
  }
  return me;
}

export async function requireRosterManager(actor: Actor) {
  const me = await requireRosterDoctor(actor);
  if (
    !me.moduleCapabilities.includes("doctor_supervisor") &&
    !me.moduleCapabilities.includes("doctor_admin")
  ) {
    throw new HttpError(403, "Doctor supervisor access is required.");
  }
  return me;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function assertDraftFutureRosterWeek(weekId: number): Promise<void> {
  const week = await findRosterWeekById(pool, weekId);
  if (!week) throw new HttpError(404, "Roster week not found.");
  if (week.status !== "draft") {
    throw new HttpError(409, "Only draft roster weeks can be edited in Phase 2.");
  }
  if (week.weekEndDate < todayIso()) {
    throw new HttpError(409, "Past roster edits are blocked in Phase 2.");
  }
}

async function rosterWeekIdForAssignment(assignmentId: number): Promise<number> {
  const result = await pool.query<{ roster_week_id: number }>(
    `select roster_week_id from doctor_portal.doctor_roster_assignments where id = $1 limit 1`,
    [assignmentId]
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "Roster assignment not found.");
  return Number(row.roster_week_id);
}

export async function getRosterWeekForManager(actor: Actor, weekStart: string) {
  await requireRosterManager(actor);
  return getRosterWeekDetails(weekStart);
}

export async function getMyRosterForDoctor(actor: Actor, weekStart: string | null) {
  const me = await requireRosterDoctor(actor);
  return listMyRoster(me.profile!.id, weekStart);
}

export async function listRosterDoctors(actor: Actor): Promise<DoctorProfileRow[]> {
  await requireRosterManager(actor);
  return (await listDoctorProfiles()).filter((profile) => profile.active);
}

export async function createDraftRosterWeek(actor: Actor, input: { weekStartDate: string; weekEndDate: string }) {
  const me = await requireRosterManager(actor);
  return createRosterWeek({
    weekStartDate: input.weekStartDate,
    weekEndDate: input.weekEndDate,
    actorUserId: actor.userId,
    actorDoctorId: me.profile!.id,
  });
}

export async function updateDraftRosterWeek(actor: Actor, weekId: number, input: { weekStartDate: string; weekEndDate: string }) {
  const me = await requireRosterManager(actor);
  await assertDraftFutureRosterWeek(weekId);
  const week = await updateRosterWeekDates(weekId, input, { userId: actor.userId, doctorId: me.profile!.id });
  if (!week) throw new HttpError(404, "Roster week not found.");
  return week;
}

export async function addRosterAssignment(actor: Actor, input: AssignmentInput) {
  const me = await requireRosterManager(actor);
  await assertDraftFutureRosterWeek(input.rosterWeekId);
  return insertAssignment(input, { userId: actor.userId, doctorId: me.profile!.id });
}

export async function patchRosterAssignment(
  actor: Actor,
  assignmentId: number,
  input: Partial<AssignmentInput>
) {
  const me = await requireRosterManager(actor);
  const weekId = await rosterWeekIdForAssignment(assignmentId);
  await assertDraftFutureRosterWeek(weekId);
  const updated = await updateAssignment(assignmentId, input, { userId: actor.userId, doctorId: me.profile!.id });
  if (!updated) throw new HttpError(404, "Roster assignment not found.");
  return updated;
}

export async function removeRosterAssignment(actor: Actor, assignmentId: number) {
  const me = await requireRosterManager(actor);
  const weekId = await rosterWeekIdForAssignment(assignmentId);
  await assertDraftFutureRosterWeek(weekId);
  const removed = await deleteAssignment(assignmentId, { userId: actor.userId, doctorId: me.profile!.id });
  if (!removed) throw new HttpError(404, "Roster assignment not found.");
}

export async function addRosterMember(actor: Actor, assignmentId: number, doctorId: number, teamRole: RosterTeamRole) {
  const me = await requireRosterManager(actor);
  const weekId = await rosterWeekIdForAssignment(assignmentId);
  await assertDraftFutureRosterWeek(weekId);
  return addMember(assignmentId, doctorId, teamRole, { userId: actor.userId, doctorId: me.profile!.id });
}

export async function removeRosterMember(actor: Actor, assignmentId: number, memberId: number) {
  const me = await requireRosterManager(actor);
  const weekId = await rosterWeekIdForAssignment(assignmentId);
  await assertDraftFutureRosterWeek(weekId);
  const removed = await removeMember(memberId, { userId: actor.userId, doctorId: me.profile!.id });
  if (!removed) throw new HttpError(404, "Roster member not found.");
}

export async function publishRosterWeek(actor: Actor, weekId: number) {
  const me = await requireRosterManager(actor);
  await assertDraftFutureRosterWeek(weekId);
  const conflicts = await validateRosterWeekConflicts(weekId);
  const errors = conflicts.filter((conflict) => conflict.severity === "error");
  if (errors.length > 0) {
    await insertDoctorAuditEvent(pool, {
      actorUserId: actor.userId,
      actorDoctorId: me.profile!.id,
      eventType: "roster_publish_blocked",
      targetType: "doctor_roster_week",
      targetId: weekId,
      metadata: { errorCount: errors.length, conflicts: errors },
      reason: null,
    });
    throw new HttpError(409, "Roster has publish-blocking conflicts.", { conflicts: errors });
  }
  const week = await publishWeek(weekId, { userId: actor.userId, doctorId: me.profile!.id });
  if (!week) throw new HttpError(409, "Roster week could not be published.");
  return week;
}

export async function getRosterWeekConflicts(actor: Actor, weekId: number) {
  await requireRosterManager(actor);
  return validateRosterWeekConflicts(weekId);
}

export async function validateRosterAssignment(actor: Actor, assignmentId: number) {
  await requireRosterManager(actor);
  return validateRosterAssignmentConflicts(assignmentId);
}

export async function archiveRosterWeek(actor: Actor, weekId: number) {
  const me = await requireRosterManager(actor);
  const week = await archiveWeek(weekId, { userId: actor.userId, doctorId: me.profile!.id });
  if (!week) throw new HttpError(409, "Only published roster weeks can be archived.");
  return week;
}

export async function copyPreviousRosterWeek(actor: Actor, weekId: number) {
  const me = await requireRosterManager(actor);
  await assertDraftFutureRosterWeek(weekId);
  try {
    return await copyPreviousWeek(weekId, { userId: actor.userId, doctorId: me.profile!.id });
  } catch (error) {
    if (error instanceof Error && error.message === "previous_not_found") {
      throw new HttpError(404, "No previous roster week was found.");
    }
    if (error instanceof Error && error.message === "target_not_found") {
      throw new HttpError(404, "Roster week not found.");
    }
    throw error;
  }
}
