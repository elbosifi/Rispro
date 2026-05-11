import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMyDoctorAvailability,
  createMyDoctorLeave,
  createTeamDoctorAvailability,
  fetchMyDoctorAvailability,
  fetchMyDoctorLeave,
  fetchRosterDoctors,
  fetchTeamDoctorAvailability,
  fetchTeamDoctorLeave,
  updateDoctorLeaveStatus,
} from "@/lib/api-hooks";
import type { AvailabilityStatus, DoctorMe, LeaveType } from "@/types/api";

const AVAILABILITY_STATUSES: Array<{ value: AvailabilityStatus; label: string }> = [
  { value: "available", label: "Available" },
  { value: "unavailable", label: "Unavailable" },
  { value: "preferred", label: "Preferred" },
  { value: "not_preferred", label: "Not preferred" },
  { value: "leave", label: "Leave" },
  { value: "conference", label: "Conference" },
  { value: "admin", label: "Admin" },
  { value: "teaching", label: "Teaching" },
  { value: "on_call", label: "On call" },
];

const LEAVE_TYPES: Array<{ value: LeaveType; label: string }> = [
  { value: "annual_leave", label: "Annual leave" },
  { value: "sick_leave", label: "Sick leave" },
  { value: "conference", label: "Conference" },
  { value: "study_leave", label: "Study leave" },
  { value: "admin_leave", label: "Admin leave" },
  { value: "emergency_absence", label: "Emergency absence" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function canManage(me: DoctorMe): boolean {
  return me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin");
}

export function DoctorAvailabilityPage({ me }: { me: DoctorMe }) {
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState(todayIso());
  const dateTo = useMemo(() => addDays(dateFrom, 13), [dateFrom]);
  const manager = canManage(me);
  const [availabilityForm, setAvailabilityForm] = useState({
    date: dateFrom,
    availabilityStatus: "unavailable" as AvailabilityStatus,
    startTime: "",
    endTime: "",
    note: "",
  });
  const [leaveForm, setLeaveForm] = useState({
    startDate: dateFrom,
    endDate: dateFrom,
    leaveType: "annual_leave" as LeaveType,
    reason: "",
  });
  const [teamAvailabilityForm, setTeamAvailabilityForm] = useState({
    doctorId: "",
    date: dateFrom,
    availabilityStatus: "unavailable" as AvailabilityStatus,
    note: "",
  });

  const myAvailabilityQuery = useQuery({
    queryKey: ["doctor", "availability", "my", dateFrom, dateTo],
    queryFn: () => fetchMyDoctorAvailability(dateFrom, dateTo),
  });
  const teamAvailabilityQuery = useQuery({
    queryKey: ["doctor", "availability", "team", dateFrom, dateTo],
    queryFn: () => fetchTeamDoctorAvailability(dateFrom, dateTo),
    enabled: manager,
  });
  const myLeaveQuery = useQuery({
    queryKey: ["doctor", "leave", "my", dateFrom, dateTo],
    queryFn: () => fetchMyDoctorLeave(dateFrom, dateTo),
  });
  const teamLeaveQuery = useQuery({
    queryKey: ["doctor", "leave", "team", dateFrom, dateTo],
    queryFn: () => fetchTeamDoctorLeave(dateFrom, dateTo),
    enabled: manager,
  });
  const doctorsQuery = useQuery({
    queryKey: ["doctor", "roster", "doctors"],
    queryFn: fetchRosterDoctors,
    enabled: manager,
  });

  const invalidateAvailability = async () => {
    await queryClient.invalidateQueries({ queryKey: ["doctor", "availability"] });
    await queryClient.invalidateQueries({ queryKey: ["doctor", "leave"] });
  };

  const availabilityMutation = useMutation({
    mutationFn: createMyDoctorAvailability,
    onSuccess: invalidateAvailability,
  });
  const leaveMutation = useMutation({
    mutationFn: createMyDoctorLeave,
    onSuccess: invalidateAvailability,
  });
  const teamAvailabilityMutation = useMutation({
    mutationFn: createTeamDoctorAvailability,
    onSuccess: invalidateAvailability,
  });
  const leaveStatusMutation = useMutation({
    mutationFn: (payload: { leaveId: number; status: "approved" | "rejected" | "cancelled" }) => updateDoctorLeaveStatus(payload.leaveId, payload.status),
    onSuccess: invalidateAvailability,
  });

  const teamAvailability = teamAvailabilityQuery.data ?? [];
  const myAvailability = myAvailabilityQuery.data ?? [];
  const teamLeave = teamLeaveQuery.data ?? [];
  const myLeave = myLeaveQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
            Availability
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">Doctor availability and leave</h2>
        </div>
        <label className="text-sm font-medium">
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setDateFrom(event.target.value);
              setAvailabilityForm((current) => ({ ...current, date: event.target.value }));
              setTeamAvailabilityForm((current) => ({ ...current, date: event.target.value }));
              setLeaveForm((current) => ({ ...current, startDate: event.target.value, endDate: event.target.value }));
            }}
            className="mt-1 block rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
          />
        </label>
      </div>

      <section className="grid gap-4 rounded-lg border p-4 lg:grid-cols-2" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            availabilityMutation.mutate({
              date: availabilityForm.date,
              availabilityStatus: availabilityForm.availabilityStatus,
              startTime: availabilityForm.startTime || null,
              endTime: availabilityForm.endTime || null,
              note: availabilityForm.note || null,
            });
          }}
        >
          <h3 className="font-semibold">Add availability</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <input type="date" value={availabilityForm.date} onChange={(e) => setAvailabilityForm((c) => ({ ...c, date: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
            <select value={availabilityForm.availabilityStatus} onChange={(e) => setAvailabilityForm((c) => ({ ...c, availabilityStatus: e.target.value as AvailabilityStatus }))} className="rounded-lg border px-3 py-2 text-sm">
              {AVAILABILITY_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
            <input type="time" value={availabilityForm.startTime} onChange={(e) => setAvailabilityForm((c) => ({ ...c, startTime: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
            <input type="time" value={availabilityForm.endTime} onChange={(e) => setAvailabilityForm((c) => ({ ...c, endTime: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
            <input placeholder="Note" value={availabilityForm.note} onChange={(e) => setAvailabilityForm((c) => ({ ...c, note: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm sm:col-span-2" />
          </div>
          <button type="submit" className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Add unavailable day</button>
        </form>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            leaveMutation.mutate({
              startDate: leaveForm.startDate,
              endDate: leaveForm.endDate,
              leaveType: leaveForm.leaveType,
              reason: leaveForm.reason || null,
            });
          }}
        >
          <h3 className="font-semibold">Request leave</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <input type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm((c) => ({ ...c, startDate: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
            <input type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm((c) => ({ ...c, endDate: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
            <select value={leaveForm.leaveType} onChange={(e) => setLeaveForm((c) => ({ ...c, leaveType: e.target.value as LeaveType }))} className="rounded-lg border px-3 py-2 text-sm">
              {LEAVE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <input placeholder="Reason" value={leaveForm.reason} onChange={(e) => setLeaveForm((c) => ({ ...c, reason: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
          </div>
          <button type="submit" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Submit leave</button>
        </form>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="font-semibold">My availability</h3>
          <div className="mt-3 space-y-2 text-sm">
            {myAvailability.length === 0 ? <p style={{ color: "var(--text-muted)" }}>No availability entries.</p> : myAvailability.map((row) => (
              <p key={row.id}>{row.date} · {row.availabilityStatus.replaceAll("_", " ")} · {row.note || "No note"}</p>
            ))}
          </div>
        </div>
        <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="font-semibold">My leave</h3>
          <div className="mt-3 space-y-2 text-sm">
            {myLeave.length === 0 ? <p style={{ color: "var(--text-muted)" }}>No leave requests.</p> : myLeave.map((row) => (
              <p key={row.id}>{row.startDate} to {row.endDate} · {row.leaveType.replaceAll("_", " ")} · {row.status}</p>
            ))}
          </div>
        </div>
      </section>

      {manager && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="font-semibold">Team availability</h3>
            <form
              className="mt-3 grid gap-2 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!teamAvailabilityForm.doctorId) return;
                teamAvailabilityMutation.mutate({
                  doctorId: Number(teamAvailabilityForm.doctorId),
                  date: teamAvailabilityForm.date,
                  startTime: null,
                  endTime: null,
                  availabilityStatus: teamAvailabilityForm.availabilityStatus,
                  note: teamAvailabilityForm.note || null,
                });
              }}
            >
              <select value={teamAvailabilityForm.doctorId} onChange={(e) => setTeamAvailabilityForm((c) => ({ ...c, doctorId: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">Doctor</option>
                {(doctorsQuery.data ?? []).map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>)}
              </select>
              <input type="date" value={teamAvailabilityForm.date} onChange={(e) => setTeamAvailabilityForm((c) => ({ ...c, date: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <select value={teamAvailabilityForm.availabilityStatus} onChange={(e) => setTeamAvailabilityForm((c) => ({ ...c, availabilityStatus: e.target.value as AvailabilityStatus }))} className="rounded-lg border px-3 py-2 text-sm">
                {AVAILABILITY_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </select>
              <input placeholder="Note" value={teamAvailabilityForm.note} onChange={(e) => setTeamAvailabilityForm((c) => ({ ...c, note: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <button type="submit" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Add team availability</button>
            </form>
            <div className="mt-3 space-y-2 text-sm">
              {teamAvailability.length === 0 ? <p style={{ color: "var(--text-muted)" }}>No team availability entries.</p> : teamAvailability.map((row) => (
                <p key={row.id}>{row.doctorName ?? "Doctor"} · {row.date} · {row.availabilityStatus.replaceAll("_", " ")}</p>
              ))}
            </div>
          </div>
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="font-semibold">Team leave</h3>
            <div className="mt-3 space-y-2">
              {teamLeave.filter((row) => row.status === "pending").map((row) => (
                <div key={`actions-${row.id}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{row.doctorName ?? "Doctor"} leave action</span>
                  <button type="button" onClick={() => leaveStatusMutation.mutate({ leaveId: row.id, status: "approved" })} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>Approve</button>
                  <button type="button" onClick={() => leaveStatusMutation.mutate({ leaveId: row.id, status: "rejected" })} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>Reject</button>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-2 text-sm">
              {teamLeave.length === 0 ? <p style={{ color: "var(--text-muted)" }}>No team leave requests.</p> : teamLeave.map((row) => (
                <p key={row.id}>{row.doctorName ?? "Doctor"} · {row.startDate} to {row.endDate} · {row.status}</p>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

