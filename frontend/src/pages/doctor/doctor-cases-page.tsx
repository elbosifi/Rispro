import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAppointmentLookups,
  fetchMyDoctorCases,
  fetchDoctorRosterWeek,
  fetchTeamDoctorCases,
  fetchUnassignedDoctorCases,
  reassignDoctorCase,
  runDoctorCaseAssignment,
} from "@/lib/api-hooks";
import type { DoctorCase, DoctorCaseAssignmentSummary, DoctorMe } from "@/types/api";

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

function CaseTable({
  cases,
  canManage,
  rosterAssignments,
  onReassign,
}: {
  cases: DoctorCase[];
  canManage: boolean;
  rosterAssignments: Array<{ id: number; label: string }>;
  onReassign: (appointmentId: number, rosterAssignmentId: number, reason: string) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [rosterAssignmentId, setRosterAssignmentId] = useState("");
  const [reason, setReason] = useState("");
  if (cases.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        No cases found for this filter.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
      <table className="min-w-full divide-y text-sm" style={{ borderColor: "var(--border)" }}>
        <thead style={{ backgroundColor: "var(--card)" }}>
          <tr>
            {["Patient", "Appointment", "Modality", "Exam", "Category", "Report", "Team", "Roster assignment", "Expected report", "Protocol", "Status", "Actions"].map((header) => (
              <th key={header} className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
          {cases.map((row) => (
            <tr key={`${row.appointmentId}-${row.assignmentType ?? "unassigned"}`}>
              <td className="px-3 py-2 font-medium text-foreground">{patientName(row)}</td>
              <td className="px-3 py-2">{row.appointmentDate} {row.appointmentTime ?? ""}</td>
              <td className="px-3 py-2">{row.modalityName ?? row.modalityCode ?? row.modalityId}</td>
              <td className="px-3 py-2">{row.examTypeName ?? "-"}</td>
              <td className="px-3 py-2">{row.caseCategory ?? "-"}</td>
              <td className="px-3 py-2">{row.requiresReport ? "Required" : "No report"}</td>
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
                        <option value="">Roster slot</option>
                        {rosterAssignments.map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.label}</option>)}
                      </select>
                      <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Correction reason" className="rounded-lg border px-2 py-1 text-xs" />
                      <div className="flex gap-2">
                        <button type="button" disabled={!rosterAssignmentId || !reason.trim()} onClick={() => {
                          onReassign(row.appointmentId, Number(rosterAssignmentId), reason);
                          setEditingId(null);
                          setRosterAssignmentId("");
                          setReason("");
                        }} className="rounded bg-teal-600 px-2 py-1 text-xs font-semibold text-white disabled:bg-teal-400">Save</button>
                        <button type="button" onClick={() => setEditingId(null)} className="rounded border px-2 py-1 text-xs">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => {
                      setEditingId(row.appointmentId);
                      setRosterAssignmentId(row.rosterAssignmentId ? String(row.rosterAssignmentId) : "");
                    }} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>
                      {row.rosterAssignmentId ? "Reassign" : "Assign"}
                    </button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssignmentSummary({ summary }: { summary: DoctorCaseAssignmentSummary | null }) {
  if (!summary) return null;
  return (
    <div className="grid gap-2 md:grid-cols-4">
      <SummaryTile label="Assigned" value={summary.assignedCount} />
      <SummaryTile label="Already assigned" value={summary.alreadyAssignedCount} />
      <SummaryTile label="No roster match" value={summary.unassignedNoRosterCount} />
      <SummaryTile label="Skipped cancelled" value={summary.skippedCancelledCount} />
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <p className="text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
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
  const [requiresReport, setRequiresReport] = useState("");
  const [caseCategory, setCaseCategory] = useState("");
  const [view, setView] = useState<"my" | "team" | "unassigned">("my");
  const [summary, setSummary] = useState<DoctorCaseAssignmentSummary | null>(null);
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

  const assignmentMutation = useMutation({
    mutationFn: () => runDoctorCaseAssignment({ dateFrom, dateTo, modalityId: modalityId ? Number(modalityId) : null }),
    onSuccess: async (result) => {
      setSummary(result);
      await queryClient.invalidateQueries({ queryKey: ["doctor", "cases"] });
    },
  });
  const reassignMutation = useMutation({
    mutationFn: (payload: { appointmentId: number; rosterAssignmentId: number; reason: string }) =>
      reassignDoctorCase(payload.appointmentId, { rosterAssignmentId: payload.rosterAssignmentId, reason: payload.reason }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["doctor", "cases"] });
    },
  });

  const cases = casesQuery.data ?? [];
  const rosterAssignments = (rosterQuery.data?.assignments ?? []).map((assignment) => ({
    id: assignment.id,
    label: `${assignment.date} · ${assignment.teamName} · ${assignment.modalityNameEn ?? "No modality"} · ${assignment.dutyType.replaceAll("_", " ")}`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
            {canManage ? "Team Cases" : "My Cases"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">Case basket</h2>
        </div>
        {canManage && (
          <button type="button" onClick={() => assignmentMutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
            Run assignment
          </button>
        )}
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
            <option value="false">No report</option>
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

      <AssignmentSummary summary={summary} />

      {casesQuery.isLoading ? (
        <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          Loading cases...
        </div>
      ) : (
        <CaseTable
          cases={cases}
          canManage={canManage}
          rosterAssignments={rosterAssignments}
          onReassign={(appointmentId, targetRosterAssignmentId, correctionReason) =>
            reassignMutation.mutate({ appointmentId, rosterAssignmentId: targetRosterAssignmentId, reason: correctionReason })}
        />
      )}
    </div>
  );
}
