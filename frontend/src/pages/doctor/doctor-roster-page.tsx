import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDoctorRosterMember,
  copyPreviousDoctorRosterWeek,
  createDoctorRosterAssignment,
  createDoctorRosterWeek,
  deleteDoctorRosterAssignment,
  deleteDoctorRosterMember,
  fetchAppointmentLookups,
  fetchDoctorRosterWeek,
  fetchMyDoctorRoster,
  fetchRosterDoctors,
  publishDoctorRosterWeek,
} from "@/lib/api-hooks";
import type { DoctorMe, DoctorRosterAssignment, RosterDutyType, RosterTeamRole } from "@/types/api";

const DUTY_TYPES: Array<{ value: RosterDutyType; label: string }> = [
  { value: "ct_protocol_day", label: "CT protocol day" },
  { value: "ct_reporting_day", label: "CT reporting day" },
  { value: "mri_supervision_reporting", label: "MRI supervision/reporting" },
  { value: "ultrasound_term_1", label: "US term 1" },
  { value: "ultrasound_term_2", label: "US term 2" },
  { value: "ultrasound_term_3", label: "US term 3" },
  { value: "mammography_session", label: "Mammography session" },
  { value: "general_reporting", label: "General reporting" },
  { value: "on_call", label: "On call" },
  { value: "leave", label: "Leave" },
  { value: "admin", label: "Admin" },
  { value: "teaching", label: "Teaching" },
];

const TEAM_ROLES: Array<{ value: RosterTeamRole; label: string }> = [
  { value: "lead", label: "Lead" },
  { value: "specialist", label: "Specialist" },
  { value: "sho", label: "SHO" },
  { value: "supervisor", label: "Supervisor" },
  { value: "observer", label: "Observer" },
];

function weekStartIso(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isManager(me: DoctorMe): boolean {
  return me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin");
}

function dutyLabel(value: string): string {
  return DUTY_TYPES.find((item) => item.value === value)?.label ?? value;
}

function AssignmentList({
  assignments,
  canManage,
  onDeleteAssignment,
  onRemoveMember,
}: {
  assignments: DoctorRosterAssignment[];
  canManage: boolean;
  onDeleteAssignment?: (assignmentId: number) => void;
  onRemoveMember?: (assignmentId: number, memberId: number) => void;
}) {
  if (assignments.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        No roster assignments for this week.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {assignments.map((assignment) => (
        <article key={assignment.id} className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{assignment.teamName}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {assignment.date} · {assignment.modalityNameEn ?? "No modality"} · {dutyLabel(assignment.dutyType)}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {assignment.sessionName || "No session"} · {assignment.startTime || "--"}-{assignment.endTime || "--"}
              </p>
            </div>
            {canManage && onDeleteAssignment && (
              <button
                type="button"
                onClick={() => onDeleteAssignment(assignment.id)}
                className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--border)" }}
              >
                Delete
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {assignment.members.length === 0 ? (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>No team members</span>
            ) : (
              assignment.members.map((member) => (
                <span key={member.id} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--border)" }}>
                  {member.displayName} · {member.teamRole}
                  {canManage && onRemoveMember && (
                    <button type="button" onClick={() => onRemoveMember(assignment.id, member.id)} aria-label={`Remove ${member.displayName}`}>
                      ×
                    </button>
                  )}
                </span>
              ))
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

export function DoctorRosterPage({ me, management = false }: { me: DoctorMe; management?: boolean }) {
  const queryClient = useQueryClient();
  const canManage = management && isManager(me);
  const [weekStart, setWeekStart] = useState(weekStartIso());
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const rosterQueryKey = canManage ? ["doctor", "roster", "week", weekStart] : ["doctor", "roster", "my", weekStart];

  const rosterQuery = useQuery({
    queryKey: rosterQueryKey,
    queryFn: () => (canManage ? fetchDoctorRosterWeek(weekStart) : fetchMyDoctorRoster(weekStart)),
  });

  const lookupsQuery = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    enabled: canManage,
    staleTime: 1000 * 60 * 5,
  });

  const doctorsQuery = useQuery({
    queryKey: ["doctor", "roster", "doctors"],
    queryFn: fetchRosterDoctors,
    enabled: canManage,
  });

  const invalidateRoster = async () => {
    await queryClient.invalidateQueries({ queryKey: ["doctor", "roster"] });
  };

  const createWeekMutation = useMutation({
    mutationFn: () => createDoctorRosterWeek({ weekStartDate: weekStart, weekEndDate: weekEnd }),
    onSuccess: invalidateRoster,
  });
  const copyMutation = useMutation({
    mutationFn: (weekId: number) => copyPreviousDoctorRosterWeek(weekId),
    onSuccess: invalidateRoster,
  });
  const publishMutation = useMutation({
    mutationFn: (weekId: number) => publishDoctorRosterWeek(weekId),
    onSuccess: invalidateRoster,
  });
  const assignmentMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createDoctorRosterAssignment>[0]) => createDoctorRosterAssignment(payload),
    onSuccess: invalidateRoster,
  });
  const deleteAssignmentMutation = useMutation({
    mutationFn: deleteDoctorRosterAssignment,
    onSuccess: invalidateRoster,
  });
  const addMemberMutation = useMutation({
    mutationFn: (payload: { assignmentId: number; doctorId: number; teamRole: RosterTeamRole }) =>
      addDoctorRosterMember(payload.assignmentId, { doctorId: payload.doctorId, teamRole: payload.teamRole }),
    onSuccess: invalidateRoster,
  });
  const removeMemberMutation = useMutation({
    mutationFn: (payload: { assignmentId: number; memberId: number }) =>
      deleteDoctorRosterMember(payload.assignmentId, payload.memberId),
    onSuccess: invalidateRoster,
  });

  const [assignmentForm, setAssignmentForm] = useState({
    date: weekStart,
    modalityId: "",
    dutyType: "ct_protocol_day" as RosterDutyType,
    sessionName: "",
    startTime: "08:00",
    endTime: "14:00",
    teamName: "",
  });
  const [memberForm, setMemberForm] = useState({ assignmentId: "", doctorId: "", teamRole: "specialist" as RosterTeamRole });

  const roster = rosterQuery.data;
  const editable = canManage && roster?.week?.status === "draft";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
            {canManage ? "Roster Management" : "My Roster"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">{weekStart} to {weekEnd}</h2>
        </div>
        <label className="text-sm font-medium">
          Week start
          <input
            type="date"
            value={weekStart}
            onChange={(event) => {
              setWeekStart(event.target.value);
              setAssignmentForm((current) => ({ ...current, date: event.target.value }));
            }}
            className="mt-1 block rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
          />
        </label>
      </div>

      {canManage && (
        <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center gap-2">
            {!roster?.week && (
              <button type="button" onClick={() => createWeekMutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
                Create draft week
              </button>
            )}
            {roster?.week && (
              <>
                <span className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--border)" }}>
                  {roster.week.status}
                </span>
                {editable && (
                  <>
                    <button type="button" onClick={() => copyMutation.mutate(roster.week!.id)} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
                      Copy previous week
                    </button>
                    <button type="button" onClick={() => publishMutation.mutate(roster.week!.id)} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
                      Publish week
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {canManage && editable && (
        <section className="grid gap-4 rounded-lg border p-4 lg:grid-cols-2" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!roster?.week) return;
              assignmentMutation.mutate({
                rosterWeekId: roster.week.id,
                date: assignmentForm.date,
                modalityId: assignmentForm.modalityId ? Number(assignmentForm.modalityId) : null,
                dutyType: assignmentForm.dutyType,
                sessionName: assignmentForm.sessionName || null,
                startTime: assignmentForm.startTime || null,
                endTime: assignmentForm.endTime || null,
                teamName: assignmentForm.teamName || "Rostered team",
              });
            }}
          >
            <h3 className="font-semibold">Add assignment</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input type="date" value={assignmentForm.date} onChange={(e) => setAssignmentForm((c) => ({ ...c, date: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <select value={assignmentForm.modalityId} onChange={(e) => setAssignmentForm((c) => ({ ...c, modalityId: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">No modality</option>
                {(lookupsQuery.data?.modalities ?? []).map((modality) => (
                  <option key={modality.id} value={modality.id}>{modality.nameEn}</option>
                ))}
              </select>
              <select value={assignmentForm.dutyType} onChange={(e) => setAssignmentForm((c) => ({ ...c, dutyType: e.target.value as RosterDutyType }))} className="rounded-lg border px-3 py-2 text-sm">
                {DUTY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
              <input placeholder="Team name" value={assignmentForm.teamName} onChange={(e) => setAssignmentForm((c) => ({ ...c, teamName: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <input placeholder="Session" value={assignmentForm.sessionName} onChange={(e) => setAssignmentForm((c) => ({ ...c, sessionName: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input type="time" value={assignmentForm.startTime} onChange={(e) => setAssignmentForm((c) => ({ ...c, startTime: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
                <input type="time" value={assignmentForm.endTime} onChange={(e) => setAssignmentForm((c) => ({ ...c, endTime: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              </div>
            </div>
            <button type="submit" className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Add assignment</button>
          </form>

          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!memberForm.assignmentId || !memberForm.doctorId) return;
              addMemberMutation.mutate({
                assignmentId: Number(memberForm.assignmentId),
                doctorId: Number(memberForm.doctorId),
                teamRole: memberForm.teamRole,
              });
            }}
          >
            <h3 className="font-semibold">Add team member</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <select value={memberForm.assignmentId} onChange={(e) => setMemberForm((c) => ({ ...c, assignmentId: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">Assignment</option>
                {(roster.assignments ?? []).map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>{assignment.teamName} · {assignment.date}</option>
                ))}
              </select>
              <select value={memberForm.doctorId} onChange={(e) => setMemberForm((c) => ({ ...c, doctorId: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">Doctor</option>
                {(doctorsQuery.data ?? []).map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>
                ))}
              </select>
              <select value={memberForm.teamRole} onChange={(e) => setMemberForm((c) => ({ ...c, teamRole: e.target.value as RosterTeamRole }))} className="rounded-lg border px-3 py-2 text-sm">
                {TEAM_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
            </div>
            <button type="submit" className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Add member</button>
          </form>
        </section>
      )}

      {rosterQuery.isLoading ? (
        <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)" }}>Loading roster...</div>
      ) : (
        <AssignmentList
          assignments={roster?.assignments ?? []}
          canManage={Boolean(editable)}
          onDeleteAssignment={(assignmentId) => deleteAssignmentMutation.mutate(assignmentId)}
          onRemoveMember={(assignmentId, memberId) => removeMemberMutation.mutate({ assignmentId, memberId })}
        />
      )}
    </div>
  );
}
