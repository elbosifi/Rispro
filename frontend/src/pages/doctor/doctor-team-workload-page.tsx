import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAppointmentLookups, fetchTeamWorkloadSummary, runWorkloadCalculation } from "@/lib/api-hooks";
import type { DoctorMe, TeamWorkloadSummaryRow, WorkloadCalculationSummary } from "@/types/api";

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

function SummaryTable({ rows }: { rows: TeamWorkloadSummaryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        No workload summary for this filter.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
      <table className="min-w-full divide-y text-sm" style={{ borderColor: "var(--border)" }}>
        <thead style={{ backgroundColor: "var(--card)" }}>
          <tr>
            {["Team", "Date", "Modality", "Category", "Cases", "Units", "Report", "No report", "Pending", "Finalized", "Overdue"].map((header) => (
              <th key={header} className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
          {rows.map((row) => (
            <tr key={`${row.rosterAssignmentId}-${row.modalityId}-${row.caseCategory ?? "all"}`}>
              <td className="px-3 py-2 font-medium text-foreground">{row.teamName}</td>
              <td className="px-3 py-2">{row.date}</td>
              <td className="px-3 py-2">{row.modalityName ?? row.modalityId}</td>
              <td className="px-3 py-2">{row.caseCategory ?? "-"}</td>
              <td className="px-3 py-2">{row.caseCount}</td>
              <td className="px-3 py-2">{row.totalWorkloadUnits}</td>
              <td className="px-3 py-2">{row.reportRequiredCount}</td>
              <td className="px-3 py-2">{row.noReportCount}</td>
              <td className="px-3 py-2">{row.pendingCount}</td>
              <td className="px-3 py-2">{row.finalizedCount}</td>
              <td className="px-3 py-2">{row.overdueCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalculationSummary({ summary }: { summary: WorkloadCalculationSummary | null }) {
  if (!summary) return null;
  return (
    <div className="grid gap-2 md:grid-cols-4">
      <Tile label="Calculated" value={summary.calculatedCount} />
      <Tile label="Already current" value={summary.alreadyCurrentCount} />
      <Tile label="Defaulted" value={summary.defaultedNoCatalogRuleCount} />
      <Tile label="Skipped" value={summary.skippedCount} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <p className="text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function DoctorTeamWorkloadPage({ me }: { me: DoctorMe }) {
  const canManage = isManager(me);
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(addDays(todayIso(), 7));
  const [modalityId, setModalityId] = useState("");
  const [requiresReport, setRequiresReport] = useState("");
  const [caseCategory, setCaseCategory] = useState("");
  const [summary, setSummary] = useState<WorkloadCalculationSummary | null>(null);

  const filters = useMemo(() => ({
    startDate,
    endDate,
    modalityId: modalityId ? Number(modalityId) : null,
    requiresReport: requiresReport === "" ? null : requiresReport === "true",
    caseCategory: caseCategory || null,
  }), [caseCategory, endDate, modalityId, requiresReport, startDate]);

  const workloadQuery = useQuery({
    queryKey: ["doctor", "workload", "summary", filters],
    queryFn: () => fetchTeamWorkloadSummary(filters),
  });
  const lookupsQuery = useQuery({ queryKey: ["lookups"], queryFn: fetchAppointmentLookups, staleTime: 1000 * 60 * 5 });
  const calculateMutation = useMutation({
    mutationFn: () => runWorkloadCalculation({ startDate, endDate, modalityId: modalityId ? Number(modalityId) : null }),
    onSuccess: async (result) => {
      setSummary(result);
      await queryClient.invalidateQueries({ queryKey: ["doctor", "workload"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
            Team Workload
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">{canManage ? "Department team workload" : "My team workload"}</h2>
        </div>
        {canManage && (
          <button type="button" onClick={() => calculateMutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
            Calculate workload
          </button>
        )}
      </div>

      <section className="grid gap-3 rounded-lg border p-4 md:grid-cols-3 lg:grid-cols-5" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <label className="text-sm font-medium">From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></label>
        <label className="text-sm font-medium">To<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></label>
        <label className="text-sm font-medium">Modality<select value={modalityId} onChange={(event) => setModalityId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">All</option>{(lookupsQuery.data?.modalities ?? []).map((modality) => <option key={modality.id} value={modality.id}>{modality.nameEn}</option>)}</select></label>
        <label className="text-sm font-medium">Report<select value={requiresReport} onChange={(event) => setRequiresReport(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">All</option><option value="true">Required</option><option value="false">No report</option></select></label>
        <label className="text-sm font-medium">Category<select value={caseCategory} onChange={(event) => setCaseCategory(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">All</option><option value="oncology">Oncology</option><option value="non_oncology">Non-oncology</option></select></label>
      </section>

      <CalculationSummary summary={summary} />
      <SummaryTable rows={workloadQuery.data ?? []} />
    </div>
  );
}
