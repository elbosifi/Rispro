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
import { t, type Language } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
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

function patientName(task: ProtocolTask, language: Language): string {
  return task.patientEnglishName || task.patientArabicName || task.patientMrn || t(language, "doctor.protocols.patientFallback", { id: task.patientId });
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
  const { language } = useLanguage();
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
        <div><span className="font-semibold">{t(language, "doctor.protocols.patient")}:</span> {patientName(details.appointment, language)}</div>
        <div><span className="font-semibold">{t(language, "doctor.protocols.appointment")}:</span> {details.appointment.appointmentDate} {details.appointment.appointmentTime ?? ""}</div>
        <div><span className="font-semibold">{t(language, "doctor.protocols.modality")}:</span> {details.appointment.modalityName ?? details.appointment.modalityCode}</div>
        <div><span className="font-semibold">{t(language, "doctor.protocols.exam")}:</span> {details.appointment.examTypeName ?? "-"}</div>
        <div><span className="font-semibold">{t(language, "doctor.protocols.category")}:</span> {details.appointment.caseCategory ?? "-"}</div>
        <div><span className="font-semibold">{t(language, "doctor.protocols.report")}:</span> {details.appointment.requiresReport ? t(language, "doctor.protocols.required") : t(language, "doctor.protocols.noReport")}</div>
        <div className="md:col-span-3"><span className="font-semibold">{t(language, "doctor.protocols.clinicalIndication")}:</span> {details.appointment.clinicalIndication ?? "-"}</div>
        <div className="md:col-span-3"><span className="font-semibold">{t(language, "doctor.protocols.team")}:</span> {details.appointment.teamName ?? t(language, "doctor.protocols.unassigned")}</div>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="text-sm font-medium">
          {t(language, "doctor.protocols.protocolText")}
          <textarea value={protocolText} onChange={(event) => setProtocolText(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium">
            {t(language, "doctor.protocols.contrast")}
            <select value={contrastRequired} onChange={(event) => setContrastRequired(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>
              <option value="">{t(language, "doctor.protocols.notSpecified")}</option>
              <option value="true">{t(language, "doctor.protocols.required")}</option>
              <option value="false">{t(language, "doctor.protocols.notRequired")}</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            {t(language, "doctor.protocols.phaseProtocol")}
            <input value={contrastPhaseOrProtocol} onChange={(event) => setContrastPhaseOrProtocol(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
          </label>
        </div>
        <label className="text-sm font-medium">
          {t(language, "doctor.protocols.specialPreparation")}
          <input value={specialPreparation} onChange={(event) => setSpecialPreparation(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
        </label>
        <label className="text-sm font-medium">
          {t(language, "doctor.protocols.technologistNotes")}
          <textarea value={technologistNotes} onChange={(event) => setTechnologistNotes(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
        </label>
        <label className="text-sm font-medium">
          {t(language, "doctor.protocols.clarificationNote")}
          <input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => onSubmit(payload())} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
          {t(language, "doctor.protocols.saveDraft")}
        </button>
        <button type="button" onClick={() => onAssign(payload())} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
          {t(language, "doctor.protocols.assignProtocol")}
        </button>
        <button type="button" onClick={() => reason.trim() && onClarification(payload())} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
          {t(language, "doctor.protocols.clarificationNeeded")}
        </button>
      </div>
      {!reason.trim() && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {t(language, "doctor.protocols.clarificationRequiresNote")}
        </p>
      )}
      <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <h3 className="font-semibold">{t(language, "doctor.protocols.history")}</h3>
        {audit.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>{t(language, "doctor.protocols.noHistory")}</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {audit.map((event, index) => (
              <li key={`${event.createdAt}-${index}`} className="border-l-2 pl-3" style={{ borderColor: "var(--accent)" }}>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-sm font-semibold">{event.eventType.replaceAll("_", " ")}</span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{new Date(event.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                  {event.changedByDoctorName ?? t(language, "doctor.protocols.unknownDoctor")} · {event.protocolStatus ?? t(language, "doctor.protocols.statusUnknown")}{event.version ? ` · v${event.version}` : ""}
                </p>
                {event.reason && <p className="mt-1 text-sm">{t(language, "doctor.protocols.reason")}: {event.reason}</p>}
                {(event.oldSummary || event.newSummary) && (
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {event.oldSummary ? `${t(language, "doctor.protocols.from")} ${event.oldSummary}. ` : ""}{event.newSummary ? `${t(language, "doctor.protocols.to")} ${event.newSummary}.` : ""}
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
  const { language } = useLanguage();
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
          {canManage ? t(language, "doctor.protocols.teamProtocols") : t(language, "doctor.protocols.protocols")}
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-foreground">{t(language, "doctor.protocols.tasks")}</h2>
      </div>

      <section className="grid gap-3 rounded-lg border p-4 md:grid-cols-3 lg:grid-cols-6" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <label className="text-sm font-medium">{t(language, "doctor.protocols.from")}<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></label>
        <label className="text-sm font-medium">{t(language, "doctor.protocols.to")}<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></label>
        <label className="text-sm font-medium">{t(language, "doctor.protocols.modality")}<select value={modalityId} onChange={(event) => setModalityId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">{t(language, "doctor.all")}</option>{(lookupsQuery.data?.modalities ?? []).map((modality) => <option key={modality.id} value={modality.id}>{modality.nameEn}</option>)}</select></label>
        <label className="text-sm font-medium">{t(language, "doctor.protocols.status")}<select value={protocolStatus} onChange={(event) => setProtocolStatus(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">{t(language, "doctor.all")}</option><option value="draft">{t(language, "doctor.protocols.draft")}</option><option value="assigned">{t(language, "doctor.protocols.assigned")}</option><option value="clarification_needed">{t(language, "doctor.protocols.clarification")}</option><option value="unprotocolled">{t(language, "doctor.protocols.unprotocolled")}</option></select></label>
        <label className="text-sm font-medium">{t(language, "doctor.protocols.report")}<select value={requiresReport} onChange={(event) => setRequiresReport(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">{t(language, "doctor.all")}</option><option value="true">{t(language, "doctor.protocols.required")}</option><option value="false">{t(language, "doctor.protocols.noReport")}</option></select></label>
        <label className="text-sm font-medium">{t(language, "doctor.protocols.category")}<select value={caseCategory} onChange={(event) => setCaseCategory(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">{t(language, "doctor.all")}</option><option value="oncology">{t(language, "appointments.create.oncology")}</option><option value="non_oncology">{t(language, "appointments.create.nonOncology")}</option></select></label>
        <label className="flex items-center gap-2 text-sm font-medium md:col-span-3">
          <input type="checkbox" checked={unprotocolledOnly} onChange={(event) => setUnprotocolledOnly(event.target.checked)} />
          {t(language, "doctor.protocols.unprotocolledOnly")}
        </label>
        {canManage && <p className="text-sm md:col-span-3" style={{ color: "var(--text-muted)" }}>{t(language, "doctor.protocols.managerHint")}</p>}
      </section>

      {tasks.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          {t(language, "doctor.protocols.noTasks")}
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <button key={task.appointmentId} type="button" onClick={() => setSelectedAppointmentId(task.appointmentId)} className="block w-full rounded-lg border p-4 text-left" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{patientName(task, language)}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{task.protocolStatus ?? t(language, "doctor.protocols.unprotocolled")}</span>
              </div>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{task.appointmentDate} {task.appointmentTime ?? ""} · {task.modalityName ?? task.modalityCode} · {task.examTypeName ?? "-"}</p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{t(language, "doctor.protocols.team")}: {task.teamName ?? t(language, "doctor.protocols.unassigned")}</p>
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
