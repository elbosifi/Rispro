import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignDoctorCase,
  fetchAppointmentLookups,
  fetchMyDoctorCases,
  fetchDoctorRosterWeek,
  fetchRosterDoctors,
  fetchTeamDoctorCases,
  fetchUnassignedDoctorCases,
  reassignDoctorCase,
} from "@/lib/api-hooks";
import type { DoctorCase, DoctorMe, DoctorProfile } from "@/types/api";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isManager(me: DoctorMe): boolean {
  return me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin");
}

function patientName(row: DoctorCase): string {
  return row.patientEnglishName || row.patientArabicName || row.patientMrn || `Patient ${row.patientId}`;
}

function weekStartIso(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function RosterDropTarget({ assignment }: { assignment: { id: number; label: string } }) {
  const droppable = useDroppable({ id: `case-roster-${assignment.id}`, data: { rosterAssignmentId: assignment.id } });
  return (
    <div
      ref={droppable.setNodeRef}
      className="rounded-lg border p-3 text-sm"
      style={{
        borderColor: droppable.isOver ? "var(--accent)" : "var(--border)",
        backgroundColor: droppable.isOver ? "var(--accent-soft)" : "var(--card)",
      }}
    >
      <p className="font-semibold text-foreground">Roster target #{assignment.id}</p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{assignment.label}</p>
    </div>
  );
}

function DraggableCaseRow({
  row,
  canManage,
  children,
}: {
  row: DoctorCase;
  canManage: boolean;
  children: ReactNode;
}) {
  const draggable = useDraggable({
    id: `case-${row.appointmentId}`,
    disabled: !canManage,
    data: { appointmentId: row.appointmentId },
  });
  return (
    <tr
      ref={draggable.setNodeRef}
      style={{ opacity: draggable.isDragging ? 0.55 : 1 }}
      {...(canManage ? draggable.listeners : {})}
      {...(canManage ? draggable.attributes : {})}
    >
      {children}
    </tr>
  );
}

function CaseTable({
  cases,
  canManage,
  doctors,
  rosterAssignments,
  onAssignDoctor,
}: {
  cases: DoctorCase[];
  canManage: boolean;
  doctors: DoctorProfile[];
  rosterAssignments: Array<{ id: number; label: string }>;
  onAssignDoctor: (appointmentId: number, doctorId: number, rosterAssignmentId: number | null, reason: string) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [rosterAssignmentId, setRosterAssignmentId] = useState("");
  const [reason, setReason] = useState("");
  if (cases.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        No report-required cases match these filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
      <table className="min-w-full divide-y text-sm" style={{ borderColor: "var(--border)" }}>
        <thead style={{ backgroundColor: "var(--card)" }}>
          <tr>
            {["Patient", "Appointment", "Modality", "Exam", "Category", "Report", "Points", "Doctor", "Team", "Roster assignment", "Expected report", "Protocol", "Status", "Actions"].map((header) => (
              <th key={header} className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
          {cases.map((row) => (
            <DraggableCaseRow key={`${row.appointmentId}-${row.assignmentType ?? "unassigned"}`} row={row} canManage={canManage}>
              <td className="px-3 py-2 font-medium text-foreground">{patientName(row)}</td>
              <td className="px-3 py-2">{row.appointmentDate} {row.appointmentTime ?? ""}</td>
              <td className="px-3 py-2">{row.modalityName ?? row.modalityCode ?? row.modalityId}</td>
              <td className="px-3 py-2">{row.examTypeName ?? "-"}</td>
              <td className="px-3 py-2">{row.caseCategory ?? "-"}</td>
              <td className="px-3 py-2">{row.requiresReport ? "Required" : "No report"}</td>
              <td className="px-3 py-2">{row.workloadPoints ?? "No rule"}</td>
              <td className="px-3 py-2">{row.assignedDoctorName ?? "Unassigned"}</td>
              <td className="px-3 py-2">{row.teamName ?? "Unassigned"}</td>
              <td className="px-3 py-2">{row.rosterAssignmentId ?? "-"}</td>
              <td className="px-3 py-2">{row.expectedReportingDate ?? "-"}</td>
              <td className="px-3 py-2">{row.protocolStatus ?? "-"}</td>
              <td className="px-3 py-2">{row.appointmentStatus}</td>
              <td className="px-3 py-2">
                {canManage && (
                  editingId === row.appointmentId ? (
                    <div className="flex min-w-72 flex-col gap-2">
                      <select value={rosterAssignmentId} onChange={(event) => setRosterAssignmentId(event.target.value)} className="rounded-lg border px-2 py-1 text-xs">
                        <option value="">No roster slot</option>
                        {rosterAssignments.map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.label}</option>)}
                      </select>
                      <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} className="rounded-lg border px-2 py-1 text-xs">
                        <option value="">Doctor</option>
                        {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>)}
                      </select>
                      <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={row.assignedDoctorId ? "Reassignment reason" : "Assignment reason"} className="rounded-lg border px-2 py-1 text-xs" />
                      <div className="flex gap-2">
                        <button type="button" disabled={!doctorId || (Boolean(row.assignedDoctorId) && !reason.trim())} onClick={() => {
                          onAssignDoctor(row.appointmentId, Number(doctorId), rosterAssignmentId ? Number(rosterAssignmentId) : null, reason);
                          setEditingId(null);
                          setDoctorId("");
                          setRosterAssignmentId("");
                          setReason("");
                        }} className="rounded bg-teal-600 px-2 py-1 text-xs font-semibold text-white disabled:bg-teal-400">Assign to doctor</button>
                        <button type="button" onClick={() => setEditingId(null)} className="rounded border px-2 py-1 text-xs">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => {
                      setEditingId(row.appointmentId);
                      setDoctorId(row.assignedDoctorId ? String(row.assignedDoctorId) : "");
                      setRosterAssignmentId(row.rosterAssignmentId ? String(row.rosterAssignmentId) : "");
                    }} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>
                      {row.assignedDoctorId ? "Reassign" : "Assign"}
                    </button>
                  )
                )}
              </td>
            </DraggableCaseRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DoctorCasesPage({ me }: { me: DoctorMe }) {
  const canManage = isManager(me);
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(addDays(todayIso(), 7));
  const [modalityId, setModalityId] = useState("");
  const [status, setStatus] = useState("");
  const [requiresReport, setRequiresReport] = useState("true");
  const [caseCategory, setCaseCategory] = useState("");
  const [view, setView] = useState<"my" | "team" | "unassigned">(canManage ? "unassigned" : "my");
  const [dropTarget, setDropTarget] = useState<{ appointmentId: number; rosterAssignmentId: number } | null>(null);
  const [dropReason, setDropReason] = useState("");
  const [dropError, setDropError] = useState("");
  const rosterWeekStart = useMemo(() => weekStartIso(dateFrom), [dateFrom]);

  const filters = useMemo(() => ({
    dateFrom,
    dateTo,
    modalityId: modalityId ? Number(modalityId) : null,
    status: status || null,
    requiresReport: requiresReport === "" ? null : requiresReport === "true",
    caseCategory: caseCategory || null,
  }), [caseCategory, dateFrom, dateTo, modalityId, requiresReport, status]);

  const casesQuery = useQuery({
    queryKey: ["doctor", "cases", view, filters],
    queryFn: () => {
      if (canManage && view === "team") return fetchTeamDoctorCases(filters);
      if (canManage && view === "unassigned") return fetchUnassignedDoctorCases(filters);
      return fetchMyDoctorCases(filters);
    },
  });

  const lookupsQuery = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
  });
  const rosterQuery = useQuery({
    queryKey: ["doctor", "roster", "week", rosterWeekStart],
    queryFn: () => fetchDoctorRosterWeek(rosterWeekStart),
    enabled: canManage,
  });
  const doctorsQuery = useQuery({
    queryKey: ["doctor", "roster", "doctors"],
    queryFn: fetchRosterDoctors,
    enabled: canManage,
  });

  const assignDoctorMutation = useMutation({
    mutationFn: (payload: { appointmentId: number; doctorId: number; rosterAssignmentId: number | null; reason: string }) =>
      assignDoctorCase(payload.appointmentId, {
        doctorId: payload.doctorId,
        rosterAssignmentId: payload.rosterAssignmentId,
        reason: payload.reason,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["doctor", "cases"] });
    },
    onError: (error) => setDropError(error instanceof Error ? error.message : "Assignment failed."),
  });
  const reassignMutation = useMutation({
    mutationFn: (payload: { appointmentId: number; rosterAssignmentId: number; reason: string }) =>
      reassignDoctorCase(payload.appointmentId, { rosterAssignmentId: payload.rosterAssignmentId, reason: payload.reason }),
    onSuccess: async () => {
      setDropTarget(null);
      setDropReason("");
      setDropError("");
      await queryClient.invalidateQueries({ queryKey: ["doctor", "cases"] });
    },
    onError: (error) => setDropError(error instanceof Error ? error.message : "Reassignment failed."),
  });

  const cases = casesQuery.data ?? [];
  const rosterAssignments = (rosterQuery.data?.assignments ?? []).map((assignment) => ({
    id: assignment.id,
    label: `${assignment.date} · ${assignment.teamName} · ${assignment.modalityNameEn ?? "No modality"} · ${assignment.dutyType.replaceAll("_", " ")}`,
  }));

  const handleDragEnd = (event: DragEndEvent) => {
    const appointmentId = Number(event.active.data.current?.appointmentId);
    const rosterAssignmentId = Number(event.over?.data.current?.rosterAssignmentId);
    if (!appointmentId || !rosterAssignmentId) return;
    setDropTarget({ appointmentId, rosterAssignmentId });
    setDropReason("");
    setDropError("");
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
            {canManage ? "Team Cases" : "My Cases"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">Report Worklist</h2>
        </div>
      </div>

      <section className="grid gap-3 rounded-lg border p-4 md:grid-cols-3 lg:grid-cols-6" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <label className="text-sm font-medium">
          From
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
        </label>
        <label className="text-sm font-medium">
          To
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
        </label>
        <label className="text-sm font-medium">
          Modality
          <select value={modalityId} onChange={(event) => setModalityId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>
            <option value="">All</option>
            {(lookupsQuery.data?.modalities ?? []).map((modality) => (
              <option key={modality.id} value={modality.id}>{modality.nameEn}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Assignment
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Report
          <select value={requiresReport} onChange={(event) => setRequiresReport(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>
            <option value="">All</option>
            <option value="true">Required</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Category
          <select value={caseCategory} onChange={(event) => setCaseCategory(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>
            <option value="">All</option>
            <option value="oncology">Oncology</option>
            <option value="non_oncology">Non-oncology</option>
          </select>
        </label>
      </section>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setView("my")} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: view === "my" ? "var(--accent)" : "var(--border)" }}>My cases</button>
          <button type="button" onClick={() => setView("team")} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: view === "team" ? "var(--accent)" : "var(--border)" }}>Team cases</button>
          <button type="button" onClick={() => setView("unassigned")} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: view === "unassigned" ? "var(--accent)" : "var(--border)" }}>Unassigned cases</button>
        </div>
      )}

      {canManage && (
        <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="font-semibold">Roster assignment targets</h3>
          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            {rosterAssignments.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>No published roster assignments for the selected week.</p>
            ) : (
              rosterAssignments.map((assignment) => <RosterDropTarget key={assignment.id} assignment={assignment} />)
            )}
          </div>
        </section>
      )}

      {dropTarget && (
        <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="font-semibold">Reassignment reason</h3>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Case {dropTarget.appointmentId} will be assigned to roster target {dropTarget.rosterAssignmentId}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={dropReason} onChange={(event) => setDropReason(event.target.value)} placeholder="Correction reason" className="min-w-80 rounded-lg border px-3 py-2 text-sm" />
            <button
              type="button"
              disabled={!dropReason.trim() || reassignMutation.isPending}
              onClick={() => reassignMutation.mutate({ ...dropTarget, reason: dropReason })}
              className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400"
            >
              Submit reassignment
            </button>
            <button type="button" onClick={() => setDropTarget(null)} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Cancel</button>
          </div>
          {dropError && <p className="mt-2 text-sm text-red-600">{dropError}</p>}
        </section>
      )}

      {casesQuery.isLoading ? (
        <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          Loading cases...
        </div>
      ) : (
        <CaseTable
          cases={cases}
          canManage={canManage}
          doctors={doctorsQuery.data ?? []}
          rosterAssignments={rosterAssignments}
          onAssignDoctor={(appointmentId, doctorId, targetRosterAssignmentId, reason) =>
            assignDoctorMutation.mutate({ appointmentId, doctorId, rosterAssignmentId: targetRosterAssignmentId, reason })}
        />
      )}
      </div>
    </DndContext>
  );
}
