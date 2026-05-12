import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWorkloadCatalogRule,
  deactivateWorkloadCatalogRule,
  fetchAppointmentLookups,
  fetchTeamWorkloadSummary,
  fetchWorkloadCatalog,
  runWorkloadCalculation,
  updateWorkloadCatalogRule,
} from "@/lib/api-hooks";
import type { CaseAssignmentType, DoctorMe, TeamWorkloadSummaryRow, WorkloadCalculationSummary, WorkloadCatalogRule } from "@/types/api";

const ASSIGNMENT_TYPES: CaseAssignmentType[] = ["imaging", "protocol", "reporting", "ultrasound_operator", "mammography_episode"];

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

function CatalogManagement({
  rules,
  canEdit,
  modalities,
  examTypes,
  onCreate,
  onUpdate,
  onDeactivate,
}: {
  rules: WorkloadCatalogRule[];
  canEdit: boolean;
  modalities: Array<{ id: number; nameEn: string; code?: string }>;
  examTypes: Array<{ id: number; modalityId?: number | null; nameEn: string }>;
  onCreate: (payload: Omit<WorkloadCatalogRule, "id" | "active">) => void;
  onUpdate: (id: number, payload: Partial<Omit<WorkloadCatalogRule, "id">>) => void;
  onDeactivate: (id: number) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({
    modalityId: "",
    examTypeId: "",
    caseCategory: "",
    assignmentType: "reporting" as CaseAssignmentType,
    baseUnits: "",
    reportRequiredMultiplier: "1",
    noReportUnits: "0",
    effectiveFrom: todayIso(),
    effectiveTo: "",
  });
  const activeCount = rules.filter((rule) => rule.active).length;
  const selected = editingId ? rules.find((rule) => rule.id === editingId) : null;

  const loadRule = (rule: WorkloadCatalogRule) => {
    setEditingId(rule.id);
    setDraft({
      modalityId: String(rule.modalityId),
      examTypeId: rule.examTypeId ? String(rule.examTypeId) : "",
      caseCategory: rule.caseCategory ?? "",
      assignmentType: rule.assignmentType,
      baseUnits: String(rule.baseUnits),
      reportRequiredMultiplier: String(rule.reportRequiredMultiplier),
      noReportUnits: String(rule.noReportUnits),
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo ?? "",
    });
  };
  const reset = () => {
    setEditingId(null);
    setDraft({ modalityId: "", examTypeId: "", caseCategory: "", assignmentType: "reporting", baseUnits: "", reportRequiredMultiplier: "1", noReportUnits: "0", effectiveFrom: todayIso(), effectiveTo: "" });
  };
  const payload = () => ({
    modalityId: Number(draft.modalityId),
    examTypeId: draft.examTypeId ? Number(draft.examTypeId) : null,
    caseCategory: draft.caseCategory || null,
    assignmentType: draft.assignmentType,
    baseUnits: Number(draft.baseUnits),
    reportRequiredMultiplier: Number(draft.reportRequiredMultiplier),
    noReportUnits: Number(draft.noReportUnits),
    effectiveFrom: draft.effectiveFrom,
    effectiveTo: draft.effectiveTo || null,
  });

  return (
    <section className="space-y-3 rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Workload scoring rules</h3>
          {activeCount === 0 && <p className="mt-1 text-sm text-amber-700">No active scoring rule exists; report workload points will remain uncalculated until rules are configured.</p>}
        </div>
        {!canEdit && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Read-only for this Doctor Portal role.</p>}
      </div>

      {canEdit && (
        <div className="grid gap-2 md:grid-cols-4">
          <select value={draft.modalityId} onChange={(event) => setDraft((current) => ({ ...current, modalityId: event.target.value, examTypeId: "" }))} className="rounded-lg border px-3 py-2 text-sm">
            <option value="">Modality</option>
            {modalities.map((modality) => <option key={modality.id} value={modality.id}>{modality.nameEn || modality.code || modality.id}</option>)}
          </select>
          <select value={draft.examTypeId} onChange={(event) => setDraft((current) => ({ ...current, examTypeId: event.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
            <option value="">Any exam</option>
            {examTypes.filter((exam) => !draft.modalityId || exam.modalityId === Number(draft.modalityId)).map((exam) => <option key={exam.id} value={exam.id}>{exam.nameEn}</option>)}
          </select>
          <select value={draft.assignmentType} onChange={(event) => setDraft((current) => ({ ...current, assignmentType: event.target.value as CaseAssignmentType }))} className="rounded-lg border px-3 py-2 text-sm">
            {ASSIGNMENT_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
          </select>
          <input value={draft.caseCategory} onChange={(event) => setDraft((current) => ({ ...current, caseCategory: event.target.value }))} placeholder="Category or blank" className="rounded-lg border px-3 py-2 text-sm" />
          <input type="number" min="0" step="0.25" value={draft.baseUnits} onChange={(event) => setDraft((current) => ({ ...current, baseUnits: event.target.value }))} placeholder="Points" className="rounded-lg border px-3 py-2 text-sm" />
          <input type="number" min="0" step="0.1" value={draft.reportRequiredMultiplier} onChange={(event) => setDraft((current) => ({ ...current, reportRequiredMultiplier: event.target.value }))} placeholder="Report-required multiplier" className="rounded-lg border px-3 py-2 text-sm" />
          <input type="date" value={draft.effectiveFrom} onChange={(event) => setDraft((current) => ({ ...current, effectiveFrom: event.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
          <input type="date" value={draft.effectiveTo} onChange={(event) => setDraft((current) => ({ ...current, effectiveTo: event.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
          <div className="flex gap-2 md:col-span-3">
            <button type="button" disabled={!draft.modalityId || !draft.baseUnits || !draft.effectiveFrom} onClick={() => {
              if (selected) onUpdate(selected.id, payload());
              else onCreate(payload());
              reset();
            }} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400">
              {selected ? "Save rule" : "Create rule"}
            </button>
            {selected && <button type="button" onClick={reset} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Cancel edit</button>}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
        <table className="min-w-full divide-y text-sm" style={{ borderColor: "var(--border)" }}>
          <thead><tr>{["Status", "Modality", "Exam", "Category", "Work type", "Points", "Rule preview", "Effective", "Actions"].map((header) => <th key={header} className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{header}</th>)}</tr></thead>
          <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td className="px-3 py-2">{rule.active ? "Active" : "Inactive"}</td>
                <td className="px-3 py-2">{modalities.find((modality) => modality.id === rule.modalityId)?.nameEn ?? rule.modalityId}</td>
                <td className="px-3 py-2">{rule.examTypeId ? examTypes.find((exam) => exam.id === rule.examTypeId)?.nameEn ?? rule.examTypeId : "Any"}</td>
                <td className="px-3 py-2">{rule.caseCategory ?? "Any"}</td>
                <td className="px-3 py-2">{rule.assignmentType.replaceAll("_", " ")}</td>
                <td className="px-3 py-2">{rule.baseUnits * rule.reportRequiredMultiplier}</td>
                <td className="px-3 py-2">{modalities.find((modality) => modality.id === rule.modalityId)?.nameEn ?? "Selected modality"} {rule.examTypeId ? examTypes.find((exam) => exam.id === rule.examTypeId)?.nameEn ?? "selected exam" : "report"} cases count as {rule.baseUnits * rule.reportRequiredMultiplier} points.</td>
                <td className="px-3 py-2">{rule.effectiveFrom} to {rule.effectiveTo ?? "open"}</td>
                <td className="px-3 py-2">
                  {canEdit && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => loadRule(rule)} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>Edit</button>
                      {rule.active && <button type="button" onClick={() => onDeactivate(rule.id)} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>Deactivate</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
  const canEditCatalog = me.moduleCapabilities.includes("doctor_admin");

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
  const catalogQuery = useQuery({ queryKey: ["doctor", "workload", "catalog"], queryFn: fetchWorkloadCatalog, enabled: canManage });
  const calculateMutation = useMutation({
    mutationFn: () => runWorkloadCalculation({ startDate, endDate, modalityId: modalityId ? Number(modalityId) : null }),
    onSuccess: async (result) => {
      setSummary(result);
      await queryClient.invalidateQueries({ queryKey: ["doctor", "workload"] });
    },
  });
  const createCatalogMutation = useMutation({
    mutationFn: createWorkloadCatalogRule,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["doctor", "workload", "catalog"] }),
  });
  const updateCatalogMutation = useMutation({
    mutationFn: (input: { id: number; payload: Partial<Omit<WorkloadCatalogRule, "id">> }) => updateWorkloadCatalogRule(input.id, input.payload),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["doctor", "workload", "catalog"] }),
  });
  const deactivateCatalogMutation = useMutation({
    mutationFn: deactivateWorkloadCatalogRule,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["doctor", "workload", "catalog"] }),
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
      {canManage && (
        <CatalogManagement
          rules={catalogQuery.data ?? []}
          canEdit={canEditCatalog}
          modalities={lookupsQuery.data?.modalities ?? []}
          examTypes={lookupsQuery.data?.examTypes ?? []}
          onCreate={(payload) => createCatalogMutation.mutate(payload)}
          onUpdate={(id, payload) => updateCatalogMutation.mutate({ id, payload })}
          onDeactivate={(id) => deactivateCatalogMutation.mutate(id)}
        />
      )}
    </div>
  );
}
