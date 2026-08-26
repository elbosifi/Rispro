import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/shared";
import {
  createIncident,
  fetchIncident,
  fetchIncidentEquipment,
  fetchIncidents,
  listIncidentAttachments,
  reviewIncident,
  uploadIncidentAttachment,
  type ClinicalCategory,
  type Incident,
  type IncidentStatus,
  type IncidentType,
} from "@/lib/api/incidents";
import { searchPatients } from "@/lib/api/patients";
import { printIncidentReport } from "@/lib/incident-printing";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";

const statuses: IncidentStatus[] = [
  "submitted",
  "under_review",
  "action_required",
  "resolved",
  "closed",
];
const categories: ClinicalCategory[] = [
  "wrong_patient",
  "wrong_exam",
  "wrong_protocol",
  "acquisition_quality",
  "contrast_event",
  "delay",
  "communication_failure",
  "reporting_issue",
  "other",
];
const now = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const formatLocalDateTime = (value: string, language: "en" | "ar") => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(language === "ar" ? "ar-LY" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};
const fileBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

function DetailRow({
  label,
  value,
  ltr = false,
}: {
  label: string;
  value: unknown;
  ltr?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-3 border-b py-2">
      <strong>{label}</strong>
      <span
        dir={ltr ? "ltr" : undefined}
        className={ltr ? "text-left" : undefined}
      >
        {value == null || value === "" ? "-" : String(value)}
      </span>
    </div>
  );
}
function patientName(incident: Incident, language: "en" | "ar") {
  return language === "ar"
    ? incident.patient_arabic_name || incident.patient_english_name
    : incident.patient_english_name || incident.patient_arabic_name;
}
function incidentContext(incident: Incident, language: "en" | "ar") {
  if (incident.incident_type === "equipment") {
    return { value: incident.equipment_name || "-", ltr: true };
  }
  return { value: patientName(incident, language) || "", ltr: false };
}

export default function IncidentsPage() {
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [kind, setKind] = useState<IncidentType>("equipment");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [term, setTerm] = useState("");
  const [patientId, setPatientId] = useState<number>();
  const [files, setFiles] = useState<File[]>([]);
  const [warning, setWarning] = useState("");
  const [vendorContacted, setVendorContacted] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<IncidentStatus>("submitted");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewError, setReviewError] = useState("");
  const label = (value: string) => t(`incidents.${value}` as never);
  const reviewer =
    !!user &&
    ["administrative", "supervisor", "super_admin"].includes(user.role);
  const register = useQuery({
    queryKey: ["incidents", typeFilter, statusFilter],
    queryFn: () =>
      fetchIncidents({ incidentType: typeFilter, status: statusFilter }),
  });
  const equipment = useQuery({
    queryKey: ["incident-equipment"],
    queryFn: fetchIncidentEquipment,
  });
  const patients = useQuery({
    queryKey: ["incident-patients", term],
    queryFn: () => searchPatients(term),
    enabled: kind === "clinical_workflow" && term.trim().length >= 2,
  });
  const current = useQuery({
    queryKey: ["incident", detailId],
    queryFn: () => fetchIncident(detailId!),
    enabled: detailId != null,
  });
  const attachments = useQuery({
    queryKey: ["incident-attachments", detailId],
    queryFn: () => listIncidentAttachments(detailId!),
    enabled: detailId != null,
  });
  const create = useMutation({
    mutationFn: createIncident,
    onSuccess: async ({ incident }) => {
      let failed = false;
      for (const file of files)
        try {
          await uploadIncidentAttachment(incident.id, {
            originalFilename: file.name,
            mimeType: file.type,
            fileContentBase64: await fileBase64(file),
          });
        } catch {
          failed = true;
        }
      await queryClient.invalidateQueries({ queryKey: ["incidents"] });
      setWarning(failed ? label("attachmentWarning") : "");
      setFiles([]);
      setFormOpen(false);
    },
  });
  const review = useMutation({
    mutationFn: () =>
      reviewIncident(detailId!, { status: reviewStatus, reviewNotes }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["incident", detailId] });
      await queryClient.invalidateQueries({ queryKey: ["incidents"] });
      setReviewError("");
    },
  });
  const incident = current.data?.incident;

  return (
    <div className="space-y-4 p-4" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{label("title")}</h1>
        <Button onClick={() => setFormOpen(true)}>{label("new")}</Button>
      </div>
      {warning && (
        <div className="rounded border border-amber-400 bg-amber-50 p-3">
          {warning}
        </div>
      )}
      <div className="flex gap-2">
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="">{label("allTypes")}</option>
          <option value="equipment">{label("equipment")}</option>
          <option value="clinical_workflow">{label("clinical")}</option>
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">{label("allStatuses")}</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {label(status)}
            </option>
          ))}
        </select>
      </div>
      <Card className="p-4">
        <h2>{label("register")}</h2>
        {register.data?.incidents.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => {
              setDetailId(item.id);
              setReviewStatus(item.status);
              setReviewNotes(item.review_notes || "");
            }}
            className="grid w-full gap-1 border-b py-3 text-start sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <strong>{item.incidentNumber}</strong>
                <span>{formatLocalDateTime(item.occurred_at, language)}</span>
                <span>{label(item.incident_type === "clinical_workflow" ? "clinical" : "equipment")}</span>
              </div>
              <div
                dir={incidentContext(item, language).ltr ? "ltr" : undefined}
                className={incidentContext(item, language).ltr ? "text-left" : undefined}
              >
                {incidentContext(item, language).value || label("clinical")}
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
              <span className="text-xs text-muted-foreground">{label("reporter")}: {item.reporter_name || "-"}</span>
            </div>
            <span className="hidden">
              {item.incidentNumber} · {item.description}
            </span>
            <span>{label(item.status)}</span>
          </button>
        ))}
      </Card>
      <Dialog open={formOpen} onClose={() => setFormOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label("new")}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const localOccurredAt = String(data.get("occurredAt") ?? "");
              create.mutate({
                incidentType: kind,
                occurredAt: new Date(localOccurredAt).toISOString(),
                description: data.get("description"),
                immediateAction: data.get("immediateAction"),
                equipmentId: data.get("equipmentId"),
                equipmentCondition: data.get("equipmentCondition"),
                patientId,
                clinicalCategory: data.get("clinicalCategory"),
                harmLevel: data.get("harmLevel"),
                vendorContacted,
                vendorContactPerson: data.get("vendorContactPerson"),
                vendorReference: data.get("vendorReference"),
              });
            }}
          >
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as IncidentType);
                setPatientId(undefined);
                setVendorContacted(false);
              }}
            >
              <option value="equipment">{label("equipment")}</option>
              <option value="clinical_workflow">{label("clinical")}</option>
            </select>
            <Input
              name="occurredAt"
              type="datetime-local"
              defaultValue={now()}
            />
            {kind === "equipment" ? (
              <>
                <select name="equipmentId" required>
                  <option value="">{label("equipmentName")}</option>
                  {equipment.data?.equipment.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select name="equipmentCondition" required>
                  <option value="operational">{label("operational")}</option>
                  <option value="degraded">{label("degraded")}</option>
                  <option value="out_of_service">
                    {label("out_of_service")}
                  </option>
                </select>
                <fieldset>
                  <legend>{label("vendorContacted")}</legend>
                  <label>
                    <input
                      type="radio"
                      checked={vendorContacted}
                      onChange={() => setVendorContacted(true)}
                    />{" "}
                    {label("yes")}
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={!vendorContacted}
                      onChange={() => setVendorContacted(false)}
                    />{" "}
                    {label("no")}
                  </label>
                </fieldset>
                {vendorContacted && (
                  <>
                    <Input
                      name="vendorContactPerson"
                      placeholder={label("vendorContactPerson")}
                    />
                    <Input
                      name="vendorReference"
                      placeholder={label("vendorReference")}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <Input
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder={label("patientOptional")}
                />
                {patientId && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setPatientId(undefined)}
                  >
                    {label("clearPatient")}
                  </Button>
                )}
                {!patientId &&
                  patients.data?.map((patient) => (
                    <button
                      type="button"
                      className="block text-start"
                      key={patient.id}
                      onClick={() => setPatientId(patient.id)}
                    >
                      {language === "ar"
                        ? patient.arabicFullName || patient.englishFullName
                        : patient.englishFullName ||
                          patient.arabicFullName}{" "}
                      · {patient.mrn}
                    </button>
                  ))}
                <select name="clinicalCategory" required>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {label(category)}
                    </option>
                  ))}
                </select>
                <select name="harmLevel" required>
                  <option value="near_miss">{label("near_miss")}</option>
                  <option value="no_harm">{label("no_harm")}</option>
                  <option value="harm">{label("harm")}</option>
                </select>
              </>
            )}
            <textarea
              required
              name="description"
              placeholder={label("description")}
            />
            <textarea
              name="immediateAction"
              placeholder={label("immediateAction")}
            />
            <input
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) =>
                setFiles(Array.from(event.target.files || []).slice(0, 5))
              }
            />
            <Button type="submit">{label("submit")}</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={detailId != null} onClose={() => setDetailId(null)}>
        <DialogContent>
          {incident && (
            <>
              <DialogHeader>
                <DialogTitle>{incident.incidentNumber}</DialogTitle>
              </DialogHeader>
              <div className="space-y-1">
                <DetailRow
                  label={label("incidentNumber")}
                  value={incident.incidentNumber}
                />
                <DetailRow
                  label={label("status")}
                  value={label(incident.status)}
                />
                <DetailRow
                  label={label("type")}
                  value={label(incident.incident_type)}
                />
                <DetailRow
                  label={label("occurredAt")}
                  value={formatLocalDateTime(incident.occurred_at, language)}
                />
                <DetailRow
                  label={label("reporter")}
                  value={incident.reporter_name}
                />
                <DetailRow
                  label={label("createdAt")}
                  value={formatLocalDateTime(incident.created_at, language)}
                />
                <DetailRow
                  label={label("description")}
                  value={incident.description}
                />
                <DetailRow
                  label={label("immediateAction")}
                  value={incident.immediate_action}
                />
                <DetailRow
                  label={label("reviewNotes")}
                  value={incident.review_notes}
                />
                {incident.incident_type === "equipment" ? (
                  <>
                    <DetailRow
                      label={label("equipmentName")}
                      value={incident.equipment_name}
                      ltr
                    />
                    <DetailRow
                      label={label("equipmentType")}
                      value={incident.equipment_type}
                      ltr
                    />
                    <DetailRow
                      label={label("location")}
                      value={incident.location}
                      ltr
                    />
                    <DetailRow
                      label={label("equipmentCondition")}
                      value={
                        incident.equipment_condition &&
                        label(incident.equipment_condition)
                      }
                    />
                    <DetailRow
                      label={label("vendorContacted")}
                      value={label(incident.vendor_contacted ? "yes" : "no")}
                    />
                    <DetailRow
                      label={label("vendorContactPerson")}
                      value={incident.vendor_contact_person}
                    />
                    <DetailRow
                      label={label("vendorReference")}
                      value={incident.vendor_reference}
                    />
                  </>
                ) : (
                  <>
                    <DetailRow
                      label={label("patientName")}
                      value={patientName(incident, language)}
                    />
                    <DetailRow label={label("mrn")} value={incident.mrn} />
                    <DetailRow
                      label={label("clinicalCategory")}
                      value={
                        incident.clinical_category &&
                        label(incident.clinical_category)
                      }
                    />
                    <DetailRow
                      label={label("harmLevel")}
                      value={incident.harm_level && label(incident.harm_level)}
                    />
                  </>
                )}
                <h3>{label("attachments")}</h3>
                {attachments.data?.documents.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={`/api/documents/${attachment.id}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                  >
                    {attachment.original_filename}
                  </a>
                ))}
                <Button
                  onClick={() =>
                    printIncidentReport(
                      incident,
                      attachments.data?.documents || [],
                      language,
                    )
                  }
                >
                  {label("print")}
                </Button>
                {reviewer && (
                  <div className="space-y-2">
                    <select
                      value={reviewStatus}
                      onChange={(event) =>
                        setReviewStatus(event.target.value as IncidentStatus)
                      }
                    >
                      {statuses.map((status) => (
                        <option key={status} value={status}>
                          {label(status)}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={reviewNotes}
                      onChange={(event) => setReviewNotes(event.target.value)}
                      placeholder={label("reviewNotes")}
                    />
                    {reviewError && (
                      <div className="text-red-600">{reviewError}</div>
                    )}
                    <Button
                      onClick={() => {
                        if (
                          ["resolved", "closed"].includes(reviewStatus) &&
                          !reviewNotes.trim()
                        ) {
                          setReviewError(label("reviewNotesRequired"));
                          return;
                        }
                        review.mutate();
                      }}
                    >
                      {label("saveReview")}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
