import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CirclePlus, ExternalLink, FileText, Paperclip, Printer, Search, ShieldAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState, Input, LoadingState } from "@/components/shared";
import { createIncident, fetchIncident, fetchIncidentEquipment, fetchIncidents, listIncidentAttachments, reviewIncident, uploadIncidentAttachment, type ClinicalCategory, type Incident, type IncidentStatus, type IncidentType } from "@/lib/api/incidents";
import { searchPatients } from "@/lib/api/patients";
import { printIncidentReport } from "@/lib/incident-printing";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";

const statuses: IncidentStatus[] = ["submitted", "under_review", "action_required", "resolved", "closed"];
const categories: ClinicalCategory[] = ["wrong_patient", "wrong_exam", "wrong_protocol", "acquisition_quality", "contrast_event", "delay", "communication_failure", "reporting_issue", "other"];
const conditions = ["operational", "degraded", "out_of_service"] as const;
type PatientResult = Awaited<ReturnType<typeof searchPatients>>[number];
const now = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const formatDateTime = (value: string, language: "en" | "ar") => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat(language === "ar" ? "ar-LY" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
};
const fileBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
});
const statusVariant = (status: IncidentStatus) => status === "under_review" ? "info" as const : status === "action_required" ? "warning" as const : status === "resolved" ? "success" as const : "neutral" as const;
const conditionKey = (value: string) => `condition_${value}`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "";
const incidentPatientName = (incident: Incident, language: "en" | "ar") => language === "ar" ? incident.patient_arabic_name || incident.patient_english_name : incident.patient_english_name || incident.patient_arabic_name;
const resultName = (patient: PatientResult, language: "en" | "ar") => language === "ar" ? patient.arabicFullName || patient.englishFullName : patient.englishFullName || patient.arabicFullName;
const otherResultName = (patient: PatientResult, language: "en" | "ar") => language === "ar" ? patient.englishFullName : patient.arabicFullName;

function DetailRow({ label, value, ltr = false }: { label: string; value: React.ReactNode; ltr?: boolean }) {
  return <div className="grid grid-cols-1 gap-1 border-b border-border py-2 last:border-b-0 sm:grid-cols-[minmax(10rem,auto)_1fr] sm:gap-3">
    <strong className="text-sm font-medium text-muted-foreground">{label}</strong>
    <span dir={ltr ? "ltr" : undefined} className={ltr ? "text-left [unicode-bidi:isolate]" : undefined}>{value == null || value === "" ? "-" : value}</span>
  </div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-border bg-muted/20 p-4"><h3 className="font-semibold">{title}</h3><div className="mt-3">{children}</div></section>;
}

export default function IncidentsPage() {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [kind, setKind] = useState<IncidentType>("equipment");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);
  const [equipmentId, setEquipmentId] = useState("");
  const [condition, setCondition] = useState<(typeof conditions)[number]>("operational");
  const [vendorContacted, setVendorContacted] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileWarning, setFileWarning] = useState("");
  const [attachmentWarning, setAttachmentWarning] = useState("");
  const [occurredError, setOccurredError] = useState("");
  const [reviewStatus, setReviewStatus] = useState<IncidentStatus>("submitted");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewError, setReviewError] = useState("");
  const label = (key: string) => t(`incidents.${key}` as never);
  const typeLabel = (value: IncidentType) => label(value === "equipment" ? "equipmentTypeShort" : "clinicalTypeShort");
  const reviewer = !!user && ["administrative", "supervisor", "super_admin"].includes(user.role);

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedTerm(term.trim()), 275); return () => window.clearTimeout(timer); }, [term]);
  const register = useQuery({ queryKey: ["incidents", typeFilter, statusFilter], queryFn: () => fetchIncidents({ incidentType: typeFilter, status: statusFilter }) });
  const equipment = useQuery({ queryKey: ["incident-equipment"], queryFn: fetchIncidentEquipment });
  const patients = useQuery({ queryKey: ["incident-patients", debouncedTerm], queryFn: () => searchPatients(debouncedTerm), enabled: kind === "clinical_workflow" && debouncedTerm.length >= 2 && !selectedPatient, retry: false });
  const current = useQuery({ queryKey: ["incident", detailId], queryFn: () => fetchIncident(detailId!), enabled: detailId != null });
  const attachments = useQuery({ queryKey: ["incident-attachments", detailId], queryFn: () => listIncidentAttachments(detailId!), enabled: detailId != null });
  const incident = current.data?.incident;
  const selectedEquipment = equipment.data?.equipment.find((item) => String(item.id) === equipmentId);
  useEffect(() => { if (incident) { setReviewStatus(incident.status); setReviewNotes(incident.review_notes || ""); } }, [incident]);

  const create = useMutation({
    mutationFn: createIncident,
    onSuccess: async ({ incident: created }) => {
      let failed = false;
      for (const file of files) try {
        await uploadIncidentAttachment(created.id, { originalFilename: file.name, mimeType: file.type, fileContentBase64: await fileBase64(file) });
      } catch { failed = true; }
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["incidents"] }), queryClient.invalidateQueries({ queryKey: ["incident-attachments", created.id] })]);
      resetCreateForm(); setAttachmentWarning(failed ? label("attachmentWarning") : ""); setFormOpen(false); setDetailId(created.id);
    },
  });
  const review = useMutation({
    mutationFn: () => reviewIncident(detailId!, { status: reviewStatus, reviewNotes }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["incident", detailId] }), queryClient.invalidateQueries({ queryKey: ["incidents"] })]); setReviewError(""); },
  });
  function resetCreateForm() {
    setKind("equipment"); setTerm(""); setDebouncedTerm(""); setSelectedPatient(null); setEquipmentId(""); setCondition("operational"); setVendorContacted(false); setFiles([]); setFileWarning(""); setAttachmentWarning(""); setOccurredError(""); setFormKey((value) => value + 1); create.reset();
  }
  const closeCreate = () => { if (!create.isPending) { resetCreateForm(); setFormOpen(false); } };
  const changeKind = (next: IncidentType) => {
    if (next === "clinical_workflow") setVendorContacted(false);
    else { setSelectedPatient(null); setTerm(""); setDebouncedTerm(""); }
    setKind(next);
  };
  const closeDetail = () => { setDetailId(null); setAttachmentWarning(""); setReviewError(""); review.reset(); };

  return <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6" dir={language === "ar" ? "rtl" : "ltr"}>
    <header className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div>
        <div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-muted-foreground" aria-hidden="true" /><h1 className="text-xl font-semibold sm:text-2xl">{label("title")}</h1></div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{label("subtitle")}</p>
      </div><Button type="button" className="shrink-0" onClick={() => { resetCreateForm(); setFormOpen(true); }}><CirclePlus className="h-4 w-4" />{label("new")}</Button></div>
    </header>

    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm" aria-labelledby="incident-filter-heading">
      <h2 id="incident-filter-heading" className="text-sm font-semibold">{label("filterTitle")}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div><label htmlFor="incident-type-filter" className="mb-1 block text-sm font-medium">{label("type")}</label><select id="incident-type-filter" className="input-premium w-full" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">{label("allTypes")}</option><option value="equipment">{label("equipmentTypeShort")}</option><option value="clinical_workflow">{label("clinicalTypeShort")}</option></select></div>
        <div><label htmlFor="incident-status-filter" className="mb-1 block text-sm font-medium">{label("status")}</label><select id="incident-status-filter" className="input-premium w-full" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">{label("allStatuses")}</option>{statuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></div>
        {(typeFilter || statusFilter) && <Button type="button" variant="ghost" onClick={() => { setTypeFilter(""); setStatusFilter(""); }}>{label("resetFilters")}</Button>}
      </div>
    </section>

    <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="incident-register-heading">
      <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5"><h2 id="incident-register-heading" className="font-semibold">{label("register")}</h2>{register.data && <Badge variant="neutral" aria-label={label("loadedCount")}><span dir="ltr" className="[unicode-bidi:isolate]">{register.data.incidents.length}</span></Badge>}</div>
      {register.isLoading ? <LoadingState message={label("registerLoading")} /> : register.isError ? <div className="pb-5 text-center"><ErrorState message={label("registerError")} /><Button type="button" variant="secondary" size="sm" onClick={() => void register.refetch()}>{label("retry")}</Button></div> : !register.data?.incidents.length ? <EmptyState message={label("registerEmpty")} /> : register.data.incidents.map((item) => {
        const context = item.incident_type === "equipment" ? item.equipment_name || "-" : incidentPatientName(item, language) || label("clinicalNoPatient");
        return <button type="button" key={item.id} onClick={() => { setDetailId(item.id); setReviewStatus(item.status); setReviewNotes(item.review_notes || ""); }} className="grid w-full gap-3 border-b border-border p-4 text-start transition-colors last:border-b-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5">
          <span className="flex flex-wrap items-center gap-2"><strong dir="ltr" className="font-mono-data [unicode-bidi:isolate]">{item.incidentNumber}</strong><Badge variant="secondary" size="sm">{typeLabel(item.incident_type)}</Badge><Badge variant={statusVariant(item.status)} size="sm">{label(item.status)}</Badge></span>
          <span className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4"><span dir={item.incident_type === "equipment" ? "ltr" : undefined} className={item.incident_type === "equipment" ? "truncate text-left font-medium [unicode-bidi:isolate]" : "truncate font-medium"}>{context}</span><span className="text-muted-foreground">{formatDateTime(item.occurred_at, language)}</span></span>
          <span className="line-clamp-2 text-sm leading-6 text-muted-foreground">{item.description}</span><span className="text-xs text-muted-foreground">{label("reporter")}: {item.reporter_name || "-"}</span>
        </button>;
      })}
    </section>

    <Dialog open={formOpen} onClose={closeCreate}><DialogContent maxWidth="760px"><DialogHeader closeLabel={label("close")}><DialogTitle>{label("new")}</DialogTitle><DialogDescription>{label("createDescription")}</DialogDescription></DialogHeader>
      <form key={formKey} className="space-y-4" onSubmit={(event) => {
        event.preventDefault(); const data = new FormData(event.currentTarget); const localValue = String(data.get("occurredAt") ?? "").trim(); const occurredAt = new Date(localValue);
        if (!localValue || Number.isNaN(occurredAt.getTime())) { setOccurredError(label("occurredAtInvalid")); return; }
        setOccurredError(""); create.mutate({ incidentType: kind, occurredAt: occurredAt.toISOString(), description: data.get("description"), immediateAction: data.get("immediateAction"), equipmentId: data.get("equipmentId"), equipmentCondition: data.get("equipmentCondition"), patientId: selectedPatient?.id, clinicalCategory: data.get("clinicalCategory"), harmLevel: data.get("harmLevel"), vendorContacted, vendorContactPerson: data.get("vendorContactPerson"), vendorReference: data.get("vendorReference") });
      }}>
        <Panel title={label("sectionIncidentType")}><fieldset className="grid gap-2 sm:grid-cols-2"><legend className="sr-only">{label("type")}</legend>{(["equipment", "clinical_workflow"] as IncidentType[]).map((value) => <label key={value} className={`cursor-pointer rounded-xl border p-3 text-sm ${kind === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card"}`}><input type="radio" name="incidentType" required checked={kind === value} onChange={() => changeKind(value)} className="me-2" /><span className="font-medium">{label(value === "equipment" ? "equipment" : "clinical")}</span></label>)}</fieldset></Panel>
        <Panel title={label("sectionIncidentInformation")}><label htmlFor="incident-occurred-at" className="mb-1 block text-sm font-medium">{label("occurredAtField")} <span aria-hidden="true">*</span></label><Input id="incident-occurred-at" name="occurredAt" type="datetime-local" defaultValue={now()} required aria-invalid={!!occurredError} onChange={() => setOccurredError("")} />{occurredError && <p role="alert" className="mt-1 text-sm text-red-700">{occurredError}</p>}</Panel>
        {kind === "equipment" ? <Panel title={label("equipmentDetails")}><div className="space-y-4">
          <div><label htmlFor="incident-equipment" className="mb-1 block text-sm font-medium">{label("equipmentName")} <span aria-hidden="true">*</span></label><select id="incident-equipment" name="equipmentId" required dir="ltr" className="input-premium w-full text-left [unicode-bidi:isolate]" value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)}><option value="">{label("selectEquipment")}</option>{equipment.data?.equipment.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          {selectedEquipment && <div data-testid="selected-equipment-summary" className="rounded-lg border border-border bg-card p-3"><p dir="ltr" className="font-medium text-left [unicode-bidi:isolate]">{selectedEquipment.name}</p><div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2"><p>{label("equipmentType")}: <span dir="ltr" className="[unicode-bidi:isolate]">{selectedEquipment.equipment_type || "-"}</span></p><p>{label("location")}: <span dir="ltr" className="[unicode-bidi:isolate]">{selectedEquipment.location || "-"}</span></p></div></div>}
          <fieldset><legend className="text-sm font-medium">{label("equipmentCondition")} <span aria-hidden="true">*</span></legend><div className="mt-2 grid gap-2 sm:grid-cols-3">{conditions.map((value) => <label key={value} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${condition === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"}`}><input type="radio" name="equipmentCondition" value={value} required checked={condition === value} onChange={() => setCondition(value)} className="me-2" />{label(conditionKey(value))}</label>)}</div></fieldset>
          <fieldset className="border-t border-border pt-4"><legend className="text-sm font-medium">{label("vendorContactedQuestion")}</legend><div className="mt-2 flex gap-2">{[true, false].map((value) => <label key={String(value)} className={`cursor-pointer rounded-lg border px-4 py-2 text-sm ${vendorContacted === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"}`}><input type="radio" name="vendorContacted" checked={vendorContacted === value} onChange={() => setVendorContacted(value)} className="me-2" />{label(value ? "yes" : "no")}</label>)}</div></fieldset>
          {vendorContacted && <div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="vendor-person" className="mb-1 block text-sm font-medium">{label("vendorContactPerson")}</label><Input id="vendor-person" name="vendorContactPerson" /></div><div><label htmlFor="vendor-reference" className="mb-1 block text-sm font-medium">{label("vendorReference")}</label><Input id="vendor-reference" name="vendorReference" dir="ltr" /></div></div>}
        </div></Panel> : <Panel title={label("clinicalDetails")}><div className="space-y-4">
          <div><label htmlFor="patient-search" className="mb-1 block text-sm font-medium">{label("patientOptional")}</label>{selectedPatient ? <div data-testid="selected-patient-summary" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{resultName(selectedPatient, language)}</p><p className="text-sm text-muted-foreground">{label("mrn")}: <span dir="ltr" className="[unicode-bidi:isolate]">{selectedPatient.mrn || "-"}</span></p></div><Button type="button" variant="ghost" size="sm" onClick={() => { setSelectedPatient(null); setTerm(""); setDebouncedTerm(""); }}>{label("changePatient")}</Button></div> : <div className="relative"><Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="patient-search" className="ps-9" value={term} onChange={(event) => setTerm(event.target.value)} placeholder={label("patientSearchPlaceholder")} />{term.trim().length >= 2 && <div role="listbox" className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-lg">{patients.isLoading || debouncedTerm !== term.trim() ? <p className="px-3 py-4 text-sm text-muted-foreground">{label("patientSearchLoading")}</p> : patients.isError ? <p role="alert" className="px-3 py-4 text-sm text-red-700">{label("patientSearchError")}</p> : !patients.data?.length ? <p className="px-3 py-4 text-sm text-muted-foreground">{label("patientSearchEmpty")}</p> : patients.data.slice(0, 5).map((patient) => <button key={patient.id} type="button" role="option" aria-selected="false" className="block w-full rounded-lg px-3 py-2 text-start hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedPatient(patient)}><span className="block font-medium">{resultName(patient, language)}</span>{otherResultName(patient, language) && <span className="block text-xs text-muted-foreground">{otherResultName(patient, language)}</span>}<span className="block text-xs text-muted-foreground">{label("mrn")}: <span dir="ltr" className="[unicode-bidi:isolate]">{patient.mrn || "-"}</span></span></button>)}</div>}</div>}</div>
          <div className="grid gap-3 sm:grid-cols-2"><div><label htmlFor="clinical-category" className="mb-1 block text-sm font-medium">{label("clinicalCategory")} <span aria-hidden="true">*</span></label><select id="clinical-category" name="clinicalCategory" required className="input-premium w-full">{categories.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></div><div><label htmlFor="harm-level" className="mb-1 block text-sm font-medium">{label("harmLevel")} <span aria-hidden="true">*</span></label><select id="harm-level" name="harmLevel" required className="input-premium w-full"><option value="near_miss">{label("near_miss")}</option><option value="no_harm">{label("no_harm")}</option><option value="harm">{label("harm")}</option></select></div></div>
        </div></Panel>}
        <Panel title={label("sectionDescription")}><div className="space-y-3"><div><label htmlFor="description" className="mb-1 block text-sm font-medium">{label("description")} <span aria-hidden="true">*</span></label><textarea id="description" name="description" required className="input-premium min-h-[120px] w-full resize-y" /></div><div><label htmlFor="immediate-action" className="mb-1 block text-sm font-medium">{label("immediateAction")}</label><textarea id="immediate-action" name="immediateAction" className="input-premium min-h-[90px] w-full resize-y" /></div></div></Panel>
        <Panel title={label("attachmentsOptional")}><p className="text-sm text-muted-foreground">{label("attachmentsHelper")}</p><input ref={fileInput} type="file" className="sr-only" multiple accept="application/pdf,image/jpeg,image/png" onChange={(event) => { const selected = Array.from(event.target.files || []); setFiles(selected.slice(0, 5)); setFileWarning(selected.length > 5 ? label("maximumFilesWarning") : ""); event.target.value = ""; }} /><Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => fileInput.current?.click()}><Paperclip className="h-4 w-4" />{label("chooseFiles")}</Button>{fileWarning && <Alert variant="warning" className="mt-3"><AlertDescription>{fileWarning}</AlertDescription></Alert>}{files.length > 0 && <ul className="mt-3 space-y-2">{files.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"><FileText className="h-4 w-4" /><span dir="ltr" className="min-w-0 flex-1 truncate text-left [unicode-bidi:isolate]">{file.name}</span><Button type="button" variant="ghost" size="icon" aria-label={`${label("removeFile")} ${file.name}`} onClick={() => setFiles((currentFiles) => currentFiles.filter((_, fileIndex) => fileIndex !== index))}><X className="h-4 w-4" /></Button></li>)}</ul>}</Panel>
        {create.isError && <Alert variant="error" role="alert"><AlertTitle>{label("createError")}</AlertTitle>{errorMessage(create.error) && <AlertDescription>{errorMessage(create.error)}</AlertDescription>}</Alert>}
        <DialogFooter><Button type="button" variant="secondary" disabled={create.isPending} onClick={closeCreate}>{label("cancel")}</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? label("submitting") : label("submit")}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>

    <Dialog open={detailId != null} onClose={closeDetail}><DialogContent maxWidth="820px">
      {current.isLoading ? <LoadingState message={label("detailLoading")} /> : current.isError ? <div className="pb-5 text-center"><ErrorState message={label("detailError")} /><Button type="button" variant="secondary" size="sm" onClick={() => void current.refetch()}>{label("retry")}</Button></div> : incident ? <>
        <DialogHeader closeLabel={label("close")}><div className="flex flex-wrap items-center gap-2"><DialogTitle dir="ltr" className="font-mono-data [unicode-bidi:isolate]">{incident.incidentNumber}</DialogTitle><Badge variant="secondary">{typeLabel(incident.incident_type)}</Badge><Badge variant={statusVariant(incident.status)}>{label(incident.status)}</Badge></div><DialogDescription>{label("occurredAt")}: {formatDateTime(incident.occurred_at, language)} · {label("reporter")}: {incident.reporter_name || "-"}</DialogDescription></DialogHeader>
        <div className="space-y-4">{attachmentWarning && <Alert variant="warning"><AlertDescription>{attachmentWarning}</AlertDescription></Alert>}
          <Panel title={label("incidentDetails")}><DetailRow label={label("description")} value={<span className="whitespace-pre-wrap">{incident.description}</span>} /><DetailRow label={label("immediateAction")} value={<span className="whitespace-pre-wrap">{incident.immediate_action || "-"}</span>} />{incident.review_notes && <DetailRow label={label("reviewNotes")} value={<span className="whitespace-pre-wrap">{incident.review_notes}</span>} />}</Panel>
          {incident.incident_type === "equipment" ? <Panel title={label("equipmentDetails")}><DetailRow label={label("equipmentName")} value={incident.equipment_name} ltr /><DetailRow label={label("equipmentType")} value={incident.equipment_type} ltr /><DetailRow label={label("location")} value={incident.location} ltr /><DetailRow label={label("equipmentCondition")} value={incident.equipment_condition && label(conditionKey(incident.equipment_condition))} /><DetailRow label={label("vendorContacted")} value={label(incident.vendor_contacted ? "yes" : "no")} />{incident.vendor_contact_person && <DetailRow label={label("vendorContactPerson")} value={incident.vendor_contact_person} />}{incident.vendor_reference && <DetailRow label={label("vendorReference")} value={incident.vendor_reference} ltr />}</Panel> : <Panel title={label("clinicalDetails")}><DetailRow label={label("patientName")} value={incidentPatientName(incident, language)} /><DetailRow label={label("mrn")} value={incident.mrn} ltr /><DetailRow label={label("clinicalCategory")} value={incident.clinical_category && label(incident.clinical_category)} /><DetailRow label={label("harmLevel")} value={incident.harm_level && label(incident.harm_level)} /></Panel>}
          <Panel title={label("attachments")}>{attachments.isLoading ? <p className="text-sm text-muted-foreground">{label("attachmentsLoading")}</p> : attachments.data?.documents.length ? <div className="space-y-2">{attachments.data.documents.map((attachment) => <div key={attachment.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"><Paperclip className="h-4 w-4" /><span dir="ltr" className="min-w-0 flex-1 truncate text-left [unicode-bidi:isolate]">{attachment.original_filename}</span><a href={`/api/documents/${attachment.id}/view`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">{label("openAttachment")}<ExternalLink className="h-3.5 w-3.5" /></a></div>)}</div> : <p className="text-sm text-muted-foreground">{label("noAttachments")}</p>}</Panel>
          {reviewer && <Panel title={label("reviewSection")}><div className="space-y-3"><div><label htmlFor="review-status" className="mb-1 block text-sm font-medium">{label("status")}</label><select id="review-status" className="input-premium w-full" value={reviewStatus} onChange={(event) => { setReviewStatus(event.target.value as IncidentStatus); setReviewError(""); }}>{statuses.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></div><div><label htmlFor="review-notes" className="mb-1 block text-sm font-medium">{label("reviewNotes")}</label><textarea id="review-notes" className="input-premium min-h-[100px] w-full resize-y" value={reviewNotes} onChange={(event) => { setReviewNotes(event.target.value); setReviewError(""); }} /></div>{reviewError && <Alert variant="error" role="alert"><AlertDescription>{reviewError}</AlertDescription></Alert>}{review.isError && <Alert variant="error" role="alert"><AlertTitle>{label("reviewSaveError")}</AlertTitle>{errorMessage(review.error) && <AlertDescription>{errorMessage(review.error)}</AlertDescription>}</Alert>}<Button type="button" disabled={review.isPending} onClick={() => { if (["resolved", "closed"].includes(reviewStatus) && !reviewNotes.trim()) { setReviewError(label("reviewNotesRequired")); return; } setReviewError(""); review.mutate(); }}>{review.isPending ? label("savingReview") : label("saveReview")}</Button></div></Panel>}
          <Panel title={label("metadata")}><DetailRow label={label("createdAt")} value={formatDateTime(incident.created_at, language)} /><DetailRow label={label("reporter")} value={incident.reporter_name} /></Panel>
        </div>
        <DialogFooter><Button type="button" variant="secondary" onClick={closeDetail}>{label("close")}</Button><Button type="button" onClick={() => printIncidentReport(incident, attachments.data?.documents || [], language)}><Printer className="h-4 w-4" />{label("printReport")}</Button></DialogFooter>
      </> : null}
    </DialogContent></Dialog>
  </div>;
}
