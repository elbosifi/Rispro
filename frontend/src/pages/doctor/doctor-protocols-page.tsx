import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignProtocol,
  fetchAppointmentLookups,
  fetchProtocolAudit,
  fetchProtocolDetails,
  fetchProtocolTasks,
  requestProtocolClarification,
  saveProtocolDraft,
} from "@/lib/api-hooks";
import type { DoctorMe, ProtocolAuditTimelineEvent, ProtocolDetails, ProtocolPayload, ProtocolTask } from "@/types/api";

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

function patientName(task: ProtocolTask): string {
  return task.patientEnglishName || task.patientArabicName || task.patientMrn || `Patient ${task.patientId}`;
}

function ProtocolForm({
  details,
  audit,
  onSubmit,
  onAssign,
  onClarification,
}: {
  details: ProtocolDetails;
  audit: ProtocolAuditTimelineEvent[];
  onSubmit: (payload: ProtocolPayload) => void;
  onAssign: (payload: ProtocolPayload) => void;
  onClarification: (payload: ProtocolPayload) => void;
}) {
  const [protocolText, setProtocolText] = useState(details.protocol?.protocolText ?? "");
  const [contrastRequired, setContrastRequired] = useState(
    details.protocol?.contrastRequired === null || details.protocol?.contrastRequired === undefined ? "" : String(details.protocol.contrastRequired)
  );
  const [contrastPhaseOrProtocol, setContrastPhaseOrProtocol] = useState(details.protocol?.contrastPhaseOrProtocol ?? "");
  const [specialPreparation, setSpecialPreparation] = useState(details.protocol?.specialPreparation ?? "");
  const [technologistNotes, setTechnologistNotes] = useState(details.protocol?.technologistNotes ?? "");
  const [reason, setReason] = useState("");

  const payload = (): ProtocolPayload => ({
    protocolText: protocolText || null,
    contrastRequired: contrastRequired === "" ? null : contrastRequired === "true",
    contrastPhaseOrProtocol: contrastPhaseOrProtocol || null,
    specialPreparation: specialPreparation || null,
    technologistNotes: technologistNotes || null,
    reason: reason || null,
  });

  return (
    <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <div className="grid gap-2 text-sm md:grid-cols-3">
        <div><span className="font-semibold">Patient:</span> {patientName(details.appointment)}</div>
        <div><span className="font-semibold">Appointment:</span> {details.appointment.appointmentDate} {details.appointment.appointmentTime ?? ""}</div>
        <div><span className="font-semibold">Modality:</span> {details.appointment.modalityName ?? details.appointment.modalityCode}</div>
        <div><span className="font-semibold">Exam:</span> {details.appointment.examTypeName ?? "-"}</div>
        <div><span className="font-semibold">Category:</span> {details.appointment.caseCategory ?? "-"}</div>
        <div><span className="font-semibold">Report:</span> {details.appointment.requiresReport ? "Required" : "No report"}</div>
        <div className="md:col-span-3"><span className="font-semibold">Clinical indication:</span> {details.appointment.clinicalIndication ?? "-"}</div>
        <div className="md:col-span-3"><span className="font-semibold">Team:</span> {details.appointment.teamName ?? "Unassigned"}</div>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="text-sm font-medium">
          Protocol text
          <textarea value={protocolText} onChange={(event) => setProtocolText(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium">
            Contrast
            <select value={contrastRequired} onChange={(event) => setContrastRequired(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>
              <option value="">Not specified</option>
              <option value="true">Required</option>
              <option value="false">Not required</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Phase/protocol
            <input value={contrastPhaseOrProtocol} onChange={(event) => setContrastPhaseOrProtocol(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
          </label>
        </div>
        <label className="text-sm font-medium">
          Special preparation
          <input value={specialPreparation} onChange={(event) => setSpecialPreparation(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
        </label>
        <label className="text-sm font-medium">
          Technologist notes
          <textarea value={technologistNotes} onChange={(event) => setTechnologistNotes(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
        </label>
        <label className="text-sm font-medium">
          Clarification/correction note
          <input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => onSubmit(payload())} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
          Save draft
        </button>
        <button type="button" onClick={() => onAssign(payload())} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
          Assign protocol
        </button>
        <button type="button" onClick={() => reason.trim() && onClarification(payload())} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
          Clarification needed
        </button>
      </div>
      {!reason.trim() && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Clarification requires a note.
        </p>
      )}
      <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <h3 className="font-semibold">Protocol history</h3>
        {audit.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>No protocol history yet.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {audit.map((event, index) => (
              <li key={`${event.createdAt}-${index}`} className="border-l-2 pl-3" style={{ borderColor: "var(--accent)" }}>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-sm font-semibold">{event.eventType.replaceAll("_", " ")}</span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{new Date(event.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                  {event.changedByDoctorName ?? "Unknown doctor"} · {event.protocolStatus ?? "status unknown"}{event.version ? ` · v${event.version}` : ""}
                </p>
                {event.reason && <p className="mt-1 text-sm">Reason: {event.reason}</p>}
                {(event.oldSummary || event.newSummary) && (
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {event.oldSummary ? `From ${event.oldSummary}. ` : ""}{event.newSummary ? `To ${event.newSummary}.` : ""}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export function DoctorProtocolsPage({ me }: { me: DoctorMe }) {
  const canManage = isManager(me);
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(addDays(todayIso(), 7));
  const [modalityId, setModalityId] = useState("");
  const [protocolStatus, setProtocolStatus] = useState("");
  const [unprotocolledOnly, setUnprotocolledOnly] = useState(false);
  const [requiresReport, setRequiresReport] = useState("");
  const [caseCategory, setCaseCategory] = useState("");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);

  const filters = useMemo(() => ({
    dateFrom,
    dateTo,
    modalityId: modalityId ? Number(modalityId) : null,
    protocolStatus: protocolStatus || null,
    unprotocolledOnly,
    requiresReport: requiresReport === "" ? null : requiresReport === "true",
    caseCategory: caseCategory || null,
  }), [caseCategory, dateFrom, dateTo, modalityId, protocolStatus, requiresReport, unprotocolledOnly]);

  const tasksQuery = useQuery({
    queryKey: ["doctor", "protocols", "tasks", filters],
    queryFn: () => fetchProtocolTasks(filters),
  });
  const detailsQuery = useQuery({
    queryKey: ["doctor", "protocols", selectedAppointmentId],
    queryFn: () => fetchProtocolDetails(selectedAppointmentId!),
    enabled: selectedAppointmentId !== null,
  });
  const auditQuery = useQuery({
    queryKey: ["doctor", "protocols", selectedAppointmentId, "audit"],
    queryFn: () => fetchProtocolAudit(selectedAppointmentId!),
    enabled: selectedAppointmentId !== null,
  });
  const lookupsQuery = useQuery({ queryKey: ["lookups"], queryFn: fetchAppointmentLookups, staleTime: 1000 * 60 * 5 });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["doctor", "protocols"] });
  };
  const saveMutation = useMutation({
    mutationFn: (payload: ProtocolPayload) => saveProtocolDraft(selectedAppointmentId!, payload),
    onSuccess: invalidate,
  });
  const assignMutation = useMutation({
    mutationFn: (payload: ProtocolPayload) => assignProtocol(selectedAppointmentId!, payload),
    onSuccess: invalidate,
  });
  const clarificationMutation = useMutation({
    mutationFn: (payload: ProtocolPayload) => requestProtocolClarification(selectedAppointmentId!, payload),
    onSuccess: invalidate,
  });

  const tasks = tasksQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
          {canManage ? "Team Protocols" : "Protocols"}
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-foreground">Protocol tasks</h2>
      </div>

      <section className="grid gap-3 rounded-lg border p-4 md:grid-cols-3 lg:grid-cols-6" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <label className="text-sm font-medium">From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></label>
        <label className="text-sm font-medium">To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></label>
        <label className="text-sm font-medium">Modality<select value={modalityId} onChange={(event) => setModalityId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">All</option>{(lookupsQuery.data?.modalities ?? []).map((modality) => <option key={modality.id} value={modality.id}>{modality.nameEn}</option>)}</select></label>
        <label className="text-sm font-medium">Status<select value={protocolStatus} onChange={(event) => setProtocolStatus(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">All</option><option value="draft">Draft</option><option value="assigned">Assigned</option><option value="clarification_needed">Clarification</option><option value="unprotocolled">Unprotocolled</option></select></label>
        <label className="text-sm font-medium">Report<select value={requiresReport} onChange={(event) => setRequiresReport(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">All</option><option value="true">Required</option><option value="false">No report</option></select></label>
        <label className="text-sm font-medium">Category<select value={caseCategory} onChange={(event) => setCaseCategory(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">All</option><option value="oncology">Oncology</option><option value="non_oncology">Non-oncology</option></select></label>
        <label className="flex items-center gap-2 text-sm font-medium md:col-span-3">
          <input type="checkbox" checked={unprotocolledOnly} onChange={(event) => setUnprotocolledOnly(event.target.checked)} />
          Unprotocolled only
        </label>
        {canManage && <p className="text-sm md:col-span-3" style={{ color: "var(--text-muted)" }}>Supervisor/admin team and unassigned protocol tasks are visible here.</p>}
      </section>

      {tasks.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          No protocol tasks found.
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <button key={task.appointmentId} type="button" onClick={() => setSelectedAppointmentId(task.appointmentId)} className="block w-full rounded-lg border p-4 text-left" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{patientName(task)}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{task.protocolStatus ?? "unprotocolled"}</span>
              </div>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{task.appointmentDate} {task.appointmentTime ?? ""} · {task.modalityName ?? task.modalityCode} · {task.examTypeName ?? "-"}</p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>Team: {task.teamName ?? "Unassigned"}</p>
            </button>
          ))}
        </div>
      )}

      {detailsQuery.data && (
        <ProtocolForm
          details={detailsQuery.data}
          audit={auditQuery.data ?? []}
          onSubmit={(payload) => saveMutation.mutate(payload)}
          onAssign={(payload) => assignMutation.mutate(payload)}
          onClarification={(payload) => clarificationMutation.mutate(payload)}
        />
      )}
    </div>
  );
}
