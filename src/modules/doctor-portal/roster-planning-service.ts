import { HttpError } from "../../utils/http-error.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { pool } from "../../db/pool.js";
import { requireRosterDoctor, requireRosterManager } from "./roster-service.js";
import { findRosterWeekById, listAssignmentsForWeek } from "./roster-repository.js";
import type { RosterAssignmentRow } from "./roster-types.js";
import {
  createRosterNotifications,
  generateDraftRoster,
  listRosterNotifications,
} from "./roster-planning-repository.js";
import type { GenerateDraftRosterInput, RosterExportFormat, RosterExportPayload } from "./roster-planning-types.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function rosterRows(assignments: RosterAssignmentRow[]) {
  return assignments.flatMap((assignment) => {
    if (assignment.members.length === 0) {
      return [{
        day: assignment.date,
        modality: assignment.modalityNameEn ?? assignment.modalityCode ?? "",
        dutyType: assignment.dutyType,
        session: assignment.sessionName ?? "",
        time: `${assignment.startTime ?? ""}-${assignment.endTime ?? ""}`,
        team: assignment.teamName,
        member: "",
        role: "",
      }];
    }
    return assignment.members.map((member) => ({
      day: assignment.date,
      modality: assignment.modalityNameEn ?? assignment.modalityCode ?? "",
      dutyType: assignment.dutyType,
      session: assignment.sessionName ?? "",
      time: `${assignment.startTime ?? ""}-${assignment.endTime ?? ""}`,
      team: assignment.teamName,
      member: member.displayName,
      role: member.teamRole,
    }));
  });
}

function buildCsv(assignments: RosterAssignmentRow[]): string {
  const headers = ["day", "modality", "duty_type", "session", "time", "team", "member", "role"];
  const rows = rosterRows(assignments);
  return [headers.join(","), ...rows.map((row) => [
    row.day,
    row.modality,
    row.dutyType,
    row.session,
    row.time,
    row.team,
    row.member,
    row.role,
  ].map(escapeCsv).join(","))].join("\n");
}

function buildHtml(assignments: RosterAssignmentRow[]): string {
  const rows = rosterRows(assignments).map((row) => `
    <tr>
      <td>${escapeHtml(row.day)}</td>
      <td>${escapeHtml(row.modality)}</td>
      <td>${escapeHtml(row.dutyType)}</td>
      <td>${escapeHtml(row.session)}</td>
      <td>${escapeHtml(row.time)}</td>
      <td>${escapeHtml(row.team)}</td>
      <td>${escapeHtml(row.member)}</td>
      <td>${escapeHtml(row.role)}</td>
    </tr>`).join("");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Doctor roster export</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; font-size: 13px; }
    th { background: #f3f4f6; }
  </style>
</head>
<body>
  <h1>Doctor roster</h1>
  <p>Generated ${escapeHtml(new Date().toISOString())}</p>
  <table>
    <thead><tr><th>Day</th><th>Modality</th><th>Duty</th><th>Session</th><th>Time</th><th>Team</th><th>Member</th><th>Role</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

async function assignmentsForExport(actor: Actor, weekId: number, scope: "my" | "full") {
  const me = await requireRosterDoctor(actor);
  const isManager = me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin");
  if (scope === "full" && !isManager) throw new HttpError(403, "Doctor supervisor access is required for full roster export.");
  const week = await findRosterWeekById(pool, weekId);
  if (!week) throw new HttpError(404, "Roster week not found.");
  let assignments = await listAssignmentsForWeek(pool, weekId);
  if (scope === "my" || !isManager) {
    const doctorId = me.profile!.id;
    assignments = assignments
      .filter((assignment) => assignment.members.some((member) => member.doctorId === doctorId))
      .map((assignment) => ({ ...assignment, members: assignment.members.filter((member) => member.doctorId === doctorId) }));
  }
  return { week, assignments };
}

export async function generateRosterDraftForManager(actor: Actor, input: GenerateDraftRosterInput) {
  const me = await requireRosterManager(actor);
  try {
    return await generateDraftRoster(input, { userId: actor.userId, doctorId: me.profile!.id });
  } catch (error) {
    if (error instanceof Error && error.message === "target_week_not_draft") {
      throw new HttpError(409, "Generator can only use a draft roster week.");
    }
    if (error instanceof Error && error.message === "template_not_found") {
      throw new HttpError(404, "Roster template not found.");
    }
    throw error;
  }
}

export async function exportRosterWeek(actor: Actor, weekId: number, format: RosterExportFormat, scope: "my" | "full"): Promise<RosterExportPayload> {
  const { week, assignments } = await assignmentsForExport(actor, weekId, scope);
  const suffix = `${week.weekStartDate}_${scope}`;
  if (format === "csv") {
    return { contentType: "text/csv; charset=utf-8", filename: `doctor-roster-${suffix}.csv`, body: buildCsv(assignments) };
  }
  return { contentType: "text/html; charset=utf-8", filename: `doctor-roster-${suffix}.html`, body: buildHtml(assignments) };
}

export async function notifyRosterWeekForManager(actor: Actor, weekId: number) {
  const me = await requireRosterManager(actor);
  try {
    return await createRosterNotifications(weekId, { userId: actor.userId, doctorId: me.profile!.id });
  } catch (error) {
    if (error instanceof Error && error.message === "week_not_found") throw new HttpError(404, "Roster week not found.");
    if (error instanceof Error && error.message === "week_not_published") throw new HttpError(409, "Only published roster weeks can be notified.");
    throw error;
  }
}

export async function getRosterWeekNotificationsForManager(actor: Actor, weekId: number) {
  await requireRosterManager(actor);
  return listRosterNotifications(weekId);
}
