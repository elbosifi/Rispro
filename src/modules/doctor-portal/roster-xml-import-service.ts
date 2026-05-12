import { HttpError } from "../../utils/http-error.js";
import { pool } from "../../db/pool.js";
import type { Role } from "../../types/domain.js";
import type { UserId } from "../../types/http.js";
import { listDoctorProfiles } from "./profile-repository.js";
import type { DoctorRole } from "./profile-repository.js";
import { createDoctorWithUserForAdmin } from "./profile-service.js";
import { listRosterShiftImportMappings } from "./roster-config-repository.js";
import { insertDoctorAuditEvent } from "./profile-repository.js";
import { requireRosterManager } from "./roster-service.js";
import type { RosterTeamRole } from "./roster-types.js";

interface Actor {
  userId: UserId;
  appRole: Role;
}

interface ParsedDoctor {
  displayName: string;
}

interface ParsedShift {
  doctorName: string | null;
  date: string | null;
  shiftName: string | null;
  shiftType: string | null;
  abbreviation: string | null;
}

function decodeXml(fileContentBase64: string): string {
  const xml = Buffer.from(fileContentBase64, "base64").toString("utf8");
  if (!xml.trim().startsWith("<")) throw new HttpError(400, "Uploaded file is not valid XML.");
  return xml;
}

function textBetween(source: string, names: string[]): string | null {
  for (const name of names) {
    const match = source.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match?.[1]) return match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
  }
  return null;
}

function attr(source: string, names: string[]): string | null {
  for (const name of names) {
    const match = source.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function collectBlocks(xml: string, names: string[]): string[] {
  const blocks: string[] = [];
  for (const name of names) {
    const pattern = new RegExp(`<${name}\\b[\\s\\S]*?<\\/${name}>`, "gi");
    for (const match of xml.matchAll(pattern)) blocks.push(match[0]);
  }
  return blocks;
}

function parseDoctors(xml: string): ParsedDoctor[] {
  const names = new Set<string>();
  for (const block of collectBlocks(xml, ["Employee", "Doctor", "Person", "Resource"])) {
    const displayName = textBetween(block, ["DisplayName", "FullName", "Name"]) ?? attr(block, ["DisplayName", "FullName", "Name"]);
    const firstName = textBetween(block, ["FirstName", "GivenName"]) ?? attr(block, ["FirstName", "GivenName"]);
    const lastName = textBetween(block, ["LastName", "Surname", "FamilyName"]) ?? attr(block, ["LastName", "Surname", "FamilyName"]);
    const name = displayName ?? [firstName, lastName].filter(Boolean).join(" ");
    if (name.trim()) names.add(name.trim());
  }
  return [...names].map((displayName) => ({ displayName }));
}

function parseShifts(xml: string): ParsedShift[] {
  return collectBlocks(xml, ["Assignment", "ShiftAssignment", "Shift", "Duty"]).map((block) => ({
    doctorName: textBetween(block, ["Employee", "Doctor", "Person", "Resource", "Name"]) ?? attr(block, ["Employee", "Doctor", "Person", "Resource", "Name"]),
    date: textBetween(block, ["Date", "Day", "StartDate"]) ?? attr(block, ["Date", "Day", "StartDate"]),
    shiftName: textBetween(block, ["ShiftName", "Name"]) ?? attr(block, ["ShiftName", "Name"]),
    shiftType: textBetween(block, ["ShiftType", "Type"]) ?? attr(block, ["ShiftType", "Type"]),
    abbreviation: textBetween(block, ["Abbreviation", "ShortName", "Code"]) ?? attr(block, ["Abbreviation", "ShortName", "Code"]),
  }));
}

function mappingKey(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function isoDate(value: string | null): string | null {
  const match = value?.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function weekStartIso(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function previewRosterXmlImportForManager(actor: Actor, input: { fileContentBase64: string }) {
  await requireRosterManager(actor);
  const xml = decodeXml(input.fileContentBase64);
  const doctors = parseDoctors(xml);
  const shifts = parseShifts(xml);
  const profiles = await listDoctorProfiles();
  const profileByName = new Map(profiles.map((profile) => [normalizeName(profile.displayName), profile]));
  const mappings = await listRosterShiftImportMappings(false);

  const doctorsMatched = doctors.filter((doctor) => profileByName.has(normalizeName(doctor.displayName))).map((doctor) => doctor.displayName);
  const doctorsToCreate = doctors.filter((doctor) => !profileByName.has(normalizeName(doctor.displayName))).map((doctor) => doctor.displayName);
  const dutySlotsToCreate = shifts.map((shift) => {
    const mapping = mappings.find((candidate) =>
      mappingKey(candidate.sourceShiftName) === mappingKey(shift.shiftName) ||
      mappingKey(candidate.sourceShiftType) === mappingKey(shift.shiftType) ||
      mappingKey(candidate.sourceShiftAbbreviation) === mappingKey(shift.abbreviation)
    );
    return { ...shift, dutyTypeCode: mapping?.dutyTypeCode ?? null, modalityId: mapping?.modalityId ?? null, teamName: mapping?.teamName ?? null };
  });
  const unmappedShiftTypes = [...new Set(dutySlotsToCreate.filter((slot) => !slot.dutyTypeCode).map((slot) => slot.shiftName ?? slot.shiftType ?? slot.abbreviation ?? "Unnamed shift"))];

  return {
    doctorsMatched,
    doctorsToCreate,
    dutySlotsToCreate,
    unmappedShiftTypes,
    warnings: unmappedShiftTypes.length > 0 ? ["Some shifts have no configured ABC mapping. Configure mappings before confirming import."] : [],
    canConfirm: unmappedShiftTypes.length === 0,
  };
}

export async function confirmRosterXmlImportForManager(
  actor: Actor,
  input: { fileContentBase64: string; createMissingDoctors: boolean; temporaryPassword: string; defaultDoctorRole: DoctorRole; defaultCoreRole: "doctor" | "supervisor"; defaultTeamRole: RosterTeamRole }
) {
  const preview = await previewRosterXmlImportForManager(actor, input);
  if (preview.unmappedShiftTypes.length > 0) throw new HttpError(400, "Configure all shift mappings before confirming import.");
  const createdDoctors = [];
  if (input.createMissingDoctors) {
    if (!input.temporaryPassword.trim()) throw new HttpError(400, "temporaryPassword is required to create imported doctor users.");
    for (const displayName of preview.doctorsToCreate) {
      const username = displayName.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
      const created = await createDoctorWithUserForAdmin(actor.userId, actor.appRole, {
        username,
        fullName: displayName,
        temporaryPassword: input.temporaryPassword,
        coreRole: input.defaultCoreRole,
        userActive: true,
        doctorDisplayName: displayName,
        doctorRole: input.defaultDoctorRole,
        doctorProfileActive: true,
        canFinalizeReports: false,
        canAssignProtocols: false,
        canSupervise: input.defaultCoreRole === "supervisor",
        modalityPermissions: [],
      });
      createdDoctors.push(created.profile.displayName);
    }
  }
  const profiles = await listDoctorProfiles();
  const profileByName = new Map(profiles.map((profile) => [normalizeName(profile.displayName), profile]));
  const client = await pool.connect();
  let createdDutySlotCount = 0;
  let assignedMemberCount = 0;
  try {
    await client.query("begin");
    for (const slot of preview.dutySlotsToCreate) {
      const date = isoDate(slot.date);
      if (!date || !slot.dutyTypeCode) continue;
      const weekStart = weekStartIso(date);
      const weekEnd = addDays(weekStart, 6);
      const week = await client.query<{ id: number }>(
        `
          insert into doctor_portal.doctor_roster_weeks (week_start_date, week_end_date, status, created_by)
          values ($1::date, $2::date, 'draft', $3)
          on conflict (week_start_date) do update set updated_at = doctor_portal.doctor_roster_weeks.updated_at
          returning id
        `,
        [weekStart, weekEnd, actor.userId]
      );
      const existing = await client.query<{ id: number }>(
        `
          select id
          from doctor_portal.doctor_roster_assignments
          where roster_week_id = $1
            and date = $2::date
            and duty_type = $3
            and coalesce(modality_id, 0) = coalesce($4::bigint, 0)
            and coalesce(team_name, '') = coalesce($5, '')
            and status = 'active'
          limit 1
        `,
        [week.rows[0].id, date, slot.dutyTypeCode, slot.modalityId, slot.teamName ?? "Imported roster"]
      );
      const assignmentId = existing.rows[0]?.id ?? (await client.query<{ id: number }>(
        `
          insert into doctor_portal.doctor_roster_assignments (
            roster_week_id, date, modality_id, duty_type, session_name, team_name, status
          )
          values ($1, $2::date, $3, $4, $5, $6, 'active')
          returning id
        `,
        [week.rows[0].id, date, slot.modalityId, slot.dutyTypeCode, slot.shiftName ?? slot.shiftType ?? slot.abbreviation, slot.teamName ?? "Imported roster"]
      )).rows[0].id;
      if (!existing.rows[0]) createdDutySlotCount += 1;

      const profile = slot.doctorName ? profileByName.get(normalizeName(slot.doctorName)) : null;
      if (profile) {
        await client.query(
          `
            insert into doctor_portal.doctor_roster_members (roster_assignment_id, doctor_id, team_role)
            values ($1, $2, $3)
            on conflict (roster_assignment_id, doctor_id) do nothing
          `,
          [assignmentId, profile.id, input.defaultTeamRole]
        );
        assignedMemberCount += 1;
      }
    }
    await insertDoctorAuditEvent(client, {
      actorUserId: actor.userId,
      actorDoctorId: null,
      eventType: "abc_roster_import_confirmed",
      targetType: "doctor_roster_week",
      targetId: null,
      metadata: { createdDoctors, createdDutySlotCount, assignedMemberCount },
      reason: null,
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return {
    createdDoctors,
    importedDutySlotCount: createdDutySlotCount,
    message: `Imported ${createdDutySlotCount} roster duties and assigned ${assignedMemberCount} members from configured ABC mappings.`,
  };
}
