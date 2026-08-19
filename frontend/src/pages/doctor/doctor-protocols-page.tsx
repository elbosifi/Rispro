import { Children, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MoreVertical, Pencil, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  activateProtocolLibraryVersion,
  cancelDoctorProtocolAssignment,
  createDoctorProtocolAssignment,
  createProtocolLibraryAnatomyRegion,
  createProtocolLibraryCtPhasePreset,
  createProtocolLibraryCtPhaseRow,
  createProtocolLibraryDraftFromActive,
  createProtocolLibraryMriSequencePreset,
  createProtocolLibraryMriSequenceRow,
  createProtocolLibraryProtocol,
  createProtocolLibraryScanner,
  deleteProtocolLibraryCtPhaseRow,
  deleteProtocolLibraryMriSequenceRow,
  confirmMriSequenceImport,
  downloadMriSequenceImportTemplate,
  exportMriSequencePresetsWorkbook,
  fetchDoctorProtocolingAppointmentDetail,
  fetchDoctorProtocolingAppointments,
  fetchRequestDocumentProtocolPolicy,
  fetchProtocolingHistoricalPacsCandidates,
  fetchProtocolingPatientHistory,
  requestProtocolingPatientIdentityReconciliation,
  searchProtocolingHistoricalPacsPatientId,
  fetchProtocolLibraryAnatomyRegions,
  fetchProtocolLibraryCtPhasePresets,
  fetchProtocolLibraryMriSequencePresets,
  fetchProtocolLibraryVersionDetail,
  fetchProtocolLibraryProtocols,
  fetchProtocolLibraryScanners,
  inspectMriSequenceImport,
  previewMriSequenceImport,
  reorderProtocolLibraryCtPhaseRows,
  reorderProtocolLibraryMriSequenceRows,
  updateProtocolLibraryCtPhaseRow,
  updateProtocolLibraryAnatomyRegion,
  updateProtocolLibraryCtPhasePreset,
  updateProtocolLibraryMriSequenceRow,
  updateProtocolLibraryMriSequencePreset,
  updateProtocolLibraryProtocol,
  updateProtocolLibraryScanner,
  updateProtocolLibraryVersion,
  updateDoctorProtocolAssignment,
  updateDoctorProtocolReportRequirement,
  type CtPhasePresetPayload,
  type ImagingScannerPayload,
  type MriSequencePresetPayload,
  type MriSequenceImportInspect,
  type MriSequenceImportPreview,
  type MriSequenceImportSummary,
  type ProtocolLibraryCtPhaseRowPayload,
  type ProtocolLibraryMriSequenceRowPayload,
  type ProtocolLibraryProtocolPayload,
  type ProtocolAnatomyRegionPayload,
} from "@/lib/api-hooks";
import type { CtPhasePreset, DoctorMe, DoctorProtocolingAppointment, DoctorProtocolingAppointmentDetail, HistoricalPacsCandidate, ImagingScanner, MriSequencePreset, PatientIdentityReconciliationSummary, ProtocolAnatomyRegion, ProtocolAssignmentPayload, ProtocolLibraryCtPhaseRow, ProtocolLibraryMriSequenceRow, ProtocolLibraryProtocol, ProtocolLibraryVersionDetail } from "@/types/api";
import { printProtocolSheet, type ProtocolPrintSheet } from "@/lib/protocol-printing";
import { pushToast } from "@/lib/toast";
import { formatDateLy } from "@/lib/date-format";
import { Badge, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@/components/shared";
import { MriPrimaryScreeningBadges } from "@/components/appointments/mri-primary-screening-badges";
import { rescheduleV2Booking, useV2ExamTypes } from "@/v2/appointments/api";
import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { ProtocolingAppointmentDetailsDrawer } from "@/components/doctor/protocoling-appointment-details-drawer";
import { buildRadiantPacsTagUrl } from "./doctor-reporting-board-page.helpers";
import { useLanguage } from "@/providers/language-provider";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function protocolingPatientName(appointment: DoctorProtocolingAppointment): string {
  return appointment.patientEnglishName || appointment.patientArabicName || appointment.patientMrn || `Patient ${appointment.patientId}`;
}

function historicalDicomDateToIso(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}

type PatientIdentityReconciliationTarget = {
  studyInstanceUid: string;
  accessionNumber: string | null;
  date: string | null;
  description: string | null;
  historicalPatientId: string | null;
  historicalPatientName: string | null;
  historicalPatientBirthDate: string | null;
  source: "history" | "automatic_candidate" | "manual_candidate";
  manualSearchPatientId?: string;
};

function patientIdentityReconciliationUiState(reconciliation: PatientIdentityReconciliationSummary | null | undefined) {
  if (!reconciliation) return { status: null, statusClassName: "", action: "Reconcile patient identity" as const };
  if (reconciliation.operationType === "reconcile") {
    if (reconciliation.status === "queued" || reconciliation.status === "processing") return { status: "Reconciliation pending", statusClassName: "text-amber-700", action: null };
    if (reconciliation.status === "completed") return { status: `Reconciled${reconciliation.oldPatientId ? ` · Previous ID: ${reconciliation.oldPatientId}` : ""}`, statusClassName: "text-emerald-700", action: null };
    if (reconciliation.status === "failed") return { status: "Reconciliation failed", statusClassName: "text-red-700", action: "Retry reconciliation" as const };
  }
  if (reconciliation.operationType === "reverse") {
    if (reconciliation.status === "queued" || reconciliation.status === "processing") return { status: "Reversal pending", statusClassName: "text-amber-700", action: null };
    if (reconciliation.status === "failed") return { status: "Reversal failed", statusClassName: "text-red-700", action: null };
    if (reconciliation.status === "completed") return { status: null, statusClassName: "", action: "Reconcile patient identity" as const };
  }
  return { status: null, statusClassName: "", action: null };
}

function hasActivePatientIdentityReconciliation(candidates: HistoricalPacsCandidate[] | undefined): boolean {
  return Boolean(candidates?.some((candidate) => candidate.studies.some((study) => study.reconciliation?.status === "queued" || study.reconciliation?.status === "processing")));
}

function shouldHideHistoricalCandidateStudy(study: HistoricalPacsCandidate["studies"][number]): boolean {
  const reconciliation = study.reconciliation;
  if (!reconciliation) return false;
  if (reconciliation.operationType === "reconcile" && reconciliation.status === "completed") return true;
  return reconciliation.operationType === "reverse" && ["queued", "processing", "failed"].includes(reconciliation.status);
}

function HistoricalPacsCandidates({ candidates, canReconcilePatientIdentity, currentPatientId, source, manualSearchPatientId, onReconcile }: { candidates: HistoricalPacsCandidate[]; canReconcilePatientIdentity: boolean; currentPatientId: string | null; source: "automatic_candidate" | "manual_candidate"; manualSearchPatientId?: string; onReconcile: (target: PatientIdentityReconciliationTarget) => void }) {
  const visibleCandidates = candidates.map((candidate) => ({ ...candidate, studies: candidate.studies.filter((study) => !shouldHideHistoricalCandidateStudy(study)) })).filter((candidate) => candidate.studies.length > 0);
  if (!visibleCandidates.length) return null;
  return <div className="space-y-2">{visibleCandidates.map((candidate) => {
    const classificationLabel = candidate.classification === "exact" ? "Exact Patient ID match" : candidate.classification === "strong_demographic" ? "Strong demographic match" : candidate.classification === "ambiguous" ? "Ambiguous candidate" : "Possible patient match";
    const hasHistoricalPatientId = Boolean(candidate.historicalPatientId.trim());
    return <section key={candidate.historicalPatientId} className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-950">
      <Badge variant={candidate.classification === "exact" ? "info" : "warning"} size="sm">{classificationLabel}</Badge>
      <p className="mt-1 text-sm font-semibold">{candidate.patientName || "Name unavailable"}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2"><p dir="ltr" className="font-semibold">Old Patient ID: {candidate.historicalPatientId}</p>{hasHistoricalPatientId ? <a href={buildRadiantPacsTagUrl("00100020", candidate.historicalPatientId)} className="rounded border border-amber-300 px-2 py-1 text-xs font-semibold" title="Open studies for this old Patient ID in RadiAnt. RadiAnt must be installed on this workstation.">Open old studies in RadiAnt</a> : null}</div>
      <div className="mt-2 space-y-1 text-amber-950/80">
        <p>{candidate.studies.length} possible {candidate.studies.length === 1 ? "study" : "studies"}</p>
        <p>DOB: {candidate.patientBirthDate || "Unavailable"} · Sex: {candidate.patientSex || "Unavailable"}</p>
        <details className="mt-2"><summary className="cursor-pointer font-semibold">Why this matched</summary><p className="mt-1">{candidate.reasons.join(", ").replaceAll("_", " ")}</p></details>
        <div className="mt-2 space-y-2 border-t border-amber-200 pt-2">{candidate.studies.map((study) => {
          const studyDate = historicalDicomDateToIso(study.studyDate);
          const reconciliationUi = patientIdentityReconciliationUiState(study.reconciliation);
          const studyInstanceUid = study.studyInstanceUid?.trim() || "";
          const historicalPatientId = study.patientId?.trim() || "";
          const canReconcile = Boolean(canReconcilePatientIdentity && studyInstanceUid && historicalPatientId && currentPatientId?.trim() && historicalPatientId !== currentPatientId.trim() && reconciliationUi.action);
          return <div key={study.orthancStudyId} className="rounded border border-amber-200 bg-white/70 p-2">
            <p className="text-sm font-semibold">{studyDate ? formatDateLy(studyDate) : "Unknown date"} · {study.studyDescription || "Study"}</p>
            <p className="mt-1 text-xs text-amber-950/80">{study.modalitiesInStudy.join(", ") || "Modality unavailable"}{study.accessionNumber ? ` · Accession ${study.accessionNumber}` : ""}</p>
            {studyInstanceUid ? <p className="mt-1 break-all text-[11px] text-muted-foreground">Study UID: {studyInstanceUid}</p> : null}
            <p className="mt-1 text-[11px] text-muted-foreground">{study.seriesCount} series · {study.instanceCount} {study.instanceCount === 1 ? "image" : "images"}</p>
            {study.attestation ? <p className="mt-1 text-[11px] font-semibold text-foreground">{study.attestation.status === "confirmed" ? "Patient confirmed" : "Patient denied ownership"} · {study.attestation.recordedByName || "Staff"} · {new Date(study.attestation.recordedAt).toLocaleString()}</p> : null}
            {reconciliationUi.status ? <p className={`mt-1 font-semibold ${reconciliationUi.statusClassName}`}>{reconciliationUi.status}</p> : null}
            {canReconcile ? <Button size="sm" variant="secondary" className="mt-2" onClick={() => onReconcile({ studyInstanceUid, accessionNumber: study.accessionNumber, date: studyDate, description: study.studyDescription, historicalPatientId: study.patientId, historicalPatientName: study.patientName, historicalPatientBirthDate: study.patientBirthDate, source, manualSearchPatientId })}>{reconciliationUi.action}</Button> : null}
          </div>;
        })}</div>
      </div>
    </section>;
  })}</div>;
}

type LibrarySection = "protocols" | "anatomy" | "scanners" | "ctPhases" | "mriSequences";

function SectionButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 shrink-0 items-center rounded-lg border px-3 text-sm font-semibold"
      style={{
        borderColor: active ? "var(--accent)" : "var(--border)",
        backgroundColor: active ? "color-mix(in srgb, var(--accent) 10%, var(--card))" : "var(--card)",
        color: active ? "var(--accent)" : "var(--foreground)",
      }}
    >
      {label}
    </button>
  );
}

const EMPTY_REGION: ProtocolAnatomyRegionPayload = { name: "", bodySystem: null, modalityScope: "BOTH", defaultCoverageNote: null, isActive: true };
const EMPTY_SCANNER: ImagingScannerPayload = { name: "", modality: "MRI", vendor: null, model: null, fieldStrength: null, ctSliceDetectorSpecification: null, location: null, notes: null, isActive: true };
const EMPTY_CT_PHASE: CtPhasePresetPayload = {
  name: "",
  contrastStatus: "NON_CONTRAST",
  timingType: "NONE",
  delaySeconds: null,
  bolusTrackingSite: null,
  triggerHu: null,
  defaultCoverage: null,
  reconstructionNotes: null,
  instructions: null,
  isActive: true,
};
const EMPTY_MRI_SEQUENCE: MriSequencePresetPayload = {
  scannerId: null,
  vendor: null,
  name: "",
  vendorSequenceName: null,
  genericFamily: null,
  weighting: "T2",
  defaultPlane: "Axial",
  fatSuppression: "None",
  acquisitionType: "Not specified",
  contrastRelation: "Non-contrast",
  defaultCoverage: null,
  defaultBValues: null,
  defaultDynamicTiming: null,
  estimatedScanTimeMinutes: null,
  notes: null,
  scannerAliases: [],
  isActive: true,
};
const EMPTY_PROTOCOL: ProtocolLibraryProtocolPayload = {
  name: "",
  modality: "CT",
  anatomyRegionId: null,
  category: "General",
  indication: null,
  contrastPolicy: "Non-contrast",
  oralContrastPolicy: null,
  bowelPreparation: null,
  preparationNotes: null,
  changeSummary: "Initial protocol version",
};
const PROTOCOL_CATEGORIES = ["General", "Oncology", "Non-oncology"] as const;
const IV_CONTRAST_POLICIES = ["Non-contrast", "With IV contrast", "Without and with IV contrast", "Dynamic contrast", "Conditional / radiologist decision"] as const;
const MRI_SEQUENCE_PLANES = ["Axial", "Sagittal", "Coronal", "Oblique axial", "Oblique coronal", "3D / isotropic", "Other"] as const;
const MRI_SEQUENCE_FAMILIES = ["T1", "T2", "PD", "FLAIR", "DWI / ADC", "SWI / T2*", "Perfusion", "Dynamic contrast", "MRCP", "MRA / TOF", "Localizer", "Other"] as const;
const MRI_FAT_SUPPRESSION = ["None", "Fat saturated", "Dixon", "STIR", "SPAIR / SPIR", "Other"] as const;
const MRI_ACQUISITION_TYPES = ["2D", "3D", "Not specified"] as const;
const MRI_CONTRAST_RELATIONS = ["Non-contrast", "Pre-contrast", "Post-contrast", "Dynamic", "Optional / depends on protocol"] as const;
const EMPTY_PROTOCOL_CT_PHASE: ProtocolLibraryCtPhaseRowPayload = {
  ctPhasePresetId: null,
  customPhaseName: null,
  timingOverride: null,
  coverageOverride: null,
  reconstructionOverride: null,
  instructionsOverride: null,
  isRequired: true,
};
const EMPTY_PROTOCOL_MRI_SEQUENCE: ProtocolLibraryMriSequenceRowPayload = {
  scannerId: null,
  mriSequencePresetId: null,
  planeOverride: null,
  coverageOverride: null,
  bValuesOverride: null,
  timingOverride: null,
  notesOverride: null,
  isRequired: true,
};

function textValue(value: string | null): string {
  return value ?? "";
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function editableText(value: string): string | null {
  return value === "" ? null : value;
}

function canManageProtocolLibrary(me: DoctorMe): boolean {
  return Boolean(me.isSuperAdmin || me.canAccessDoctorAdmin || me.canSupervise || me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin"));
}

function numberText(value: number | null): string {
  return value == null ? "" : String(value);
}

function nullableNumber(value: string, positive = false): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return positive ? (parsed > 0 ? parsed : null) : (parsed >= 0 ? parsed : null);
}

function mriFatLabel(value: string | null | undefined): string | null {
  if (!value || value === "None") return null;
  return value === "Fat saturated" ? "fat sat" : value;
}

function mriSequencePresetLabel(preset: Pick<MriSequencePreset, "name" | "defaultPlane" | "weighting" | "genericFamily" | "fatSuppression" | "acquisitionType" | "contrastRelation">): string {
  const clinical = [preset.defaultPlane, preset.weighting ?? preset.genericFamily, mriFatLabel(preset.fatSuppression)].filter(Boolean).join(" ");
  const details = [preset.acquisitionType, preset.contrastRelation].filter(Boolean).join(" · ");
  return [clinical || preset.name, details].filter(Boolean).join(" · ");
}

function mriSequenceRowLabel(row: ProtocolLibraryMriSequenceRow): string {
  const clinical = [row.planeOverride ?? row.presetDefaultPlane, row.presetWeighting ?? row.presetGenericFamily, mriFatLabel(row.presetFatSuppression)].filter(Boolean).join(" ");
  const details = [row.presetAcquisitionType, row.presetContrastRelation].filter(Boolean).join(" · ");
  return [clinical || row.mriSequencePresetName || "-", details].filter(Boolean).join(" · ");
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold"
      style={{ borderColor: "var(--border)", color: active ? "#047857" : "var(--text-muted)" }}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function ProtocolStatusBadge({ assigned }: { assigned: boolean }) {
  return (
    <span
      className="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold"
      style={{
        borderColor: assigned ? "#a7f3d0" : "var(--border)",
        backgroundColor: assigned ? "#ecfdf5" : "var(--card)",
        color: assigned ? "#047857" : "var(--text-muted)",
      }}
    >
      {assigned ? "Protocol assigned" : "Not protocolled"}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function inputClass() {
  return "mt-1 w-full rounded-lg border px-3 py-2 text-sm";
}

function ProtocolLibraryPanel() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<LibrarySection>("protocols");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [regionDraft, setRegionDraft] = useState<ProtocolAnatomyRegionPayload | null>(null);
  const [editingRegionId, setEditingRegionId] = useState<number | null>(null);
  const [scannerDraft, setScannerDraft] = useState<ImagingScannerPayload | null>(null);
  const [editingScannerId, setEditingScannerId] = useState<number | null>(null);
  const [ctPhaseDraft, setCtPhaseDraft] = useState<CtPhasePresetPayload | null>(null);
  const [editingCtPhaseId, setEditingCtPhaseId] = useState<number | null>(null);
  const [mriSequenceDraft, setMriSequenceDraft] = useState<MriSequencePresetPayload | null>(null);
  const [editingMriSequenceId, setEditingMriSequenceId] = useState<number | null>(null);
  const [protocolDraft, setProtocolDraft] = useState<ProtocolLibraryProtocolPayload | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [protocolFilter, setProtocolFilter] = useState<"all" | "CT" | "MRI" | "active" | "draft">("all");
  const [protocolSearch, setProtocolSearch] = useState("");
  const [ctRowDraft, setCtRowDraft] = useState<ProtocolLibraryCtPhaseRowPayload | null>(null);
  const [editingCtRowId, setEditingCtRowId] = useState<number | null>(null);
  const [mriRowDraft, setMriRowDraft] = useState<ProtocolLibraryMriSequenceRowPayload | null>(null);
  const [editingMriRowId, setEditingMriRowId] = useState<number | null>(null);
  const [mriImportFileBase64, setMriImportFileBase64] = useState("");
  const [mriImportFileName, setMriImportFileName] = useState("");
  const [mriImportInspect, setMriImportInspect] = useState<MriSequenceImportInspect | null>(null);
  const [mriImportPreview, setMriImportPreview] = useState<MriSequenceImportPreview | null>(null);
  const [mriImportSummary, setMriImportSummary] = useState<MriSequenceImportSummary | null>(null);

  const protocolsQuery = useQuery({ queryKey: ["doctor", "protocol-library", "protocols"], queryFn: fetchProtocolLibraryProtocols, enabled: section === "protocols" });
  const anatomyQuery = useQuery({ queryKey: ["doctor", "protocol-library", "anatomy-regions"], queryFn: fetchProtocolLibraryAnatomyRegions, enabled: section === "anatomy" || section === "protocols" });
  const scannersQuery = useQuery({ queryKey: ["doctor", "protocol-library", "scanners"], queryFn: fetchProtocolLibraryScanners, enabled: section === "scanners" || section === "mriSequences" || selectedVersionId !== null });
  const ctPhasesQuery = useQuery({ queryKey: ["doctor", "protocol-library", "ct-phase-presets"], queryFn: fetchProtocolLibraryCtPhasePresets, enabled: section === "ctPhases" || selectedVersionId !== null });
  const mriSequencesQuery = useQuery({ queryKey: ["doctor", "protocol-library", "mri-sequence-presets"], queryFn: fetchProtocolLibraryMriSequencePresets, enabled: section === "mriSequences" || selectedVersionId !== null });
  const versionQuery = useQuery({ queryKey: ["doctor", "protocol-library", "protocol-version", selectedVersionId], queryFn: () => fetchProtocolLibraryVersionDetail(selectedVersionId!), enabled: section === "protocols" && selectedVersionId !== null });

  const protocols = protocolsQuery.data ?? [];
  const anatomy = anatomyQuery.data ?? [];
  const scanners = scannersQuery.data ?? [];
  const ctPhases = ctPhasesQuery.data ?? [];
  const mriSequences = mriSequencesQuery.data ?? [];
  const selectedVersion = versionQuery.data ?? null;
  const filteredProtocols = protocols.filter((protocol) => {
    const matchesFilter =
      protocolFilter === "all" ||
      protocol.modality === protocolFilter ||
      (protocolFilter === "active" && protocol.activeVersionId !== null) ||
      (protocolFilter === "draft" && protocol.latestDraftVersionId !== null);
    const term = protocolSearch.trim().toLowerCase();
    return matchesFilter && (!term || protocol.name.toLowerCase().includes(term));
  });

  const invalidate = async (key: string) => queryClient.invalidateQueries({ queryKey: ["doctor", "protocol-library", key] });
  const onMutationError = (error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to save protocol setting." });
  const onMutationSuccess = async (key: string, text: string) => {
    setMessage({ tone: "success", text });
    await invalidate(key);
  };

  const createRegionMutation = useMutation({ mutationFn: createProtocolLibraryAnatomyRegion, onError: onMutationError, onSuccess: async () => { setRegionDraft(null); setEditingRegionId(null); await onMutationSuccess("anatomy-regions", "Region saved."); } });
  const updateRegionMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: Partial<ProtocolAnatomyRegionPayload> }) => updateProtocolLibraryAnatomyRegion(id, payload), onError: onMutationError, onSuccess: async () => { setRegionDraft(null); setEditingRegionId(null); await onMutationSuccess("anatomy-regions", "Region saved."); } });
  const createScannerMutation = useMutation({ mutationFn: createProtocolLibraryScanner, onError: onMutationError, onSuccess: async () => { setScannerDraft(null); setEditingScannerId(null); await onMutationSuccess("scanners", "Scanner saved."); } });
  const updateScannerMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: Partial<ImagingScannerPayload> }) => updateProtocolLibraryScanner(id, payload), onError: onMutationError, onSuccess: async () => { setScannerDraft(null); setEditingScannerId(null); await onMutationSuccess("scanners", "Scanner saved."); } });
  const createCtPhaseMutation = useMutation({ mutationFn: createProtocolLibraryCtPhasePreset, onError: onMutationError, onSuccess: async () => { setCtPhaseDraft(null); setEditingCtPhaseId(null); await onMutationSuccess("ct-phase-presets", "CT phase saved."); } });
  const updateCtPhaseMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: Partial<CtPhasePresetPayload> }) => updateProtocolLibraryCtPhasePreset(id, payload), onError: onMutationError, onSuccess: async () => { setCtPhaseDraft(null); setEditingCtPhaseId(null); await onMutationSuccess("ct-phase-presets", "CT phase saved."); } });
  const createMriSequenceMutation = useMutation({ mutationFn: createProtocolLibraryMriSequencePreset, onError: onMutationError, onSuccess: async () => { setMriSequenceDraft(null); setEditingMriSequenceId(null); await onMutationSuccess("mri-sequence-presets", "MRI sequence saved."); } });
  const updateMriSequenceMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: Partial<MriSequencePresetPayload> }) => updateProtocolLibraryMriSequencePreset(id, payload), onError: onMutationError, onSuccess: async () => { setMriSequenceDraft(null); setEditingMriSequenceId(null); await onMutationSuccess("mri-sequence-presets", "MRI sequence saved."); } });
  const downloadMriTemplateMutation = useMutation({ mutationFn: downloadMriSequenceImportTemplate, onError: onMutationError });
  const exportMriSequencesMutation = useMutation({ mutationFn: exportMriSequencePresetsWorkbook, onError: onMutationError });
  const inspectMriImportMutation = useMutation({ mutationFn: inspectMriSequenceImport, onError: onMutationError, onSuccess: (inspect) => { setMriImportInspect(inspect); setMriImportPreview(null); setMriImportSummary(null); } });
  const previewMriImportMutation = useMutation({ mutationFn: previewMriSequenceImport, onError: onMutationError, onSuccess: (preview) => { setMriImportPreview(preview); setMriImportSummary(null); } });
  const confirmMriImportMutation = useMutation({
    mutationFn: confirmMriSequenceImport,
    onError: onMutationError,
    onSuccess: async (summary) => {
      setMriImportSummary(summary);
      await onMutationSuccess("mri-sequence-presets", "MRI sequence import applied.");
    },
  });

  const readMriImportFile = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read MRI sequence import file."));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1] ?? "";
    setMriImportFileBase64(base64);
    setMriImportFileName(file.name);
    setMriImportInspect(null);
    setMriImportPreview(null);
    setMriImportSummary(null);
    inspectMriImportMutation.mutate({ fileContentBase64: base64, fileName: file.name });
  };
  const refreshBuilder = async () => {
    await queryClient.invalidateQueries({ queryKey: ["doctor", "protocol-library", "protocols"] });
    if (selectedVersionId) await queryClient.invalidateQueries({ queryKey: ["doctor", "protocol-library", "protocol-version", selectedVersionId] });
  };
  const createProtocolMutation = useMutation({
    mutationFn: createProtocolLibraryProtocol,
    onError: onMutationError,
    onSuccess: async (created) => {
      setProtocolDraft(null);
      setSelectedVersionId(created.version.id);
      setMessage({ tone: "success", text: "Protocol draft created." });
      await refreshBuilder();
    },
  });
  const updateProtocolMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof updateProtocolLibraryProtocol>[1] }) => updateProtocolLibraryProtocol(id, payload), onError: onMutationError, onSuccess: refreshBuilder });
  const updateVersionMutation = useMutation({ mutationFn: ({ versionId, changeSummary }: { versionId: number; changeSummary: string | null }) => updateProtocolLibraryVersion(versionId, { changeSummary }), onError: onMutationError, onSuccess: async () => { setMessage({ tone: "success", text: "Draft saved." }); await refreshBuilder(); } });
  const activateVersionMutation = useMutation({ mutationFn: activateProtocolLibraryVersion, onError: onMutationError, onSuccess: async () => { setMessage({ tone: "success", text: "Protocol version activated." }); await refreshBuilder(); } });
  const draftFromActiveMutation = useMutation({ mutationFn: createProtocolLibraryDraftFromActive, onError: onMutationError, onSuccess: async (detail) => { setSelectedVersionId(detail.version.id); setMessage({ tone: "success", text: "Draft version created." }); await refreshBuilder(); } });
  const createCtRowMutation = useMutation({ mutationFn: ({ versionId, payload }: { versionId: number; payload: ProtocolLibraryCtPhaseRowPayload }) => createProtocolLibraryCtPhaseRow(versionId, payload), onError: onMutationError, onSuccess: async () => { setCtRowDraft(null); setEditingCtRowId(null); await refreshBuilder(); } });
  const updateCtRowMutation = useMutation({ mutationFn: ({ versionId, rowId, payload }: { versionId: number; rowId: number; payload: Partial<ProtocolLibraryCtPhaseRowPayload> }) => updateProtocolLibraryCtPhaseRow(versionId, rowId, payload), onError: onMutationError, onSuccess: async () => { setCtRowDraft(null); setEditingCtRowId(null); await refreshBuilder(); } });
  const deleteCtRowMutation = useMutation({ mutationFn: ({ versionId, rowId }: { versionId: number; rowId: number }) => deleteProtocolLibraryCtPhaseRow(versionId, rowId), onError: onMutationError, onSuccess: refreshBuilder });
  const reorderCtRowsMutation = useMutation({ mutationFn: ({ versionId, rowIds }: { versionId: number; rowIds: number[] }) => reorderProtocolLibraryCtPhaseRows(versionId, rowIds), onError: onMutationError, onSuccess: refreshBuilder });
  const createMriRowMutation = useMutation({ mutationFn: ({ versionId, payload }: { versionId: number; payload: ProtocolLibraryMriSequenceRowPayload }) => createProtocolLibraryMriSequenceRow(versionId, payload), onError: onMutationError, onSuccess: async () => { setMriRowDraft(null); setEditingMriRowId(null); await refreshBuilder(); } });
  const updateMriRowMutation = useMutation({ mutationFn: ({ versionId, rowId, payload }: { versionId: number; rowId: number; payload: Partial<ProtocolLibraryMriSequenceRowPayload> }) => updateProtocolLibraryMriSequenceRow(versionId, rowId, payload), onError: onMutationError, onSuccess: async () => { setMriRowDraft(null); setEditingMriRowId(null); await refreshBuilder(); } });
  const deleteMriRowMutation = useMutation({ mutationFn: ({ versionId, rowId }: { versionId: number; rowId: number }) => deleteProtocolLibraryMriSequenceRow(versionId, rowId), onError: onMutationError, onSuccess: refreshBuilder });
  const reorderMriRowsMutation = useMutation({ mutationFn: ({ versionId, rowIds }: { versionId: number; rowIds: number[] }) => reorderProtocolLibraryMriSequenceRows(versionId, rowIds), onError: onMutationError, onSuccess: refreshBuilder });

  const startRegionEdit = (item: ProtocolAnatomyRegion) => { setEditingRegionId(item.id); setRegionDraft({ name: item.name, bodySystem: item.bodySystem, modalityScope: item.modalityScope, defaultCoverageNote: item.defaultCoverageNote, isActive: item.isActive }); };
  const startScannerEdit = (item: ImagingScanner) => { setEditingScannerId(item.id); setScannerDraft({ name: item.name, modality: item.modality, vendor: item.vendor, model: item.model, fieldStrength: item.fieldStrength, ctSliceDetectorSpecification: item.ctSliceDetectorSpecification, location: item.location, notes: item.notes, isActive: item.isActive }); };
  const startCtPhaseEdit = (item: CtPhasePreset) => { setEditingCtPhaseId(item.id); setCtPhaseDraft({ name: item.name, contrastStatus: item.contrastStatus, timingType: item.timingType, delaySeconds: item.delaySeconds, bolusTrackingSite: item.bolusTrackingSite, triggerHu: item.triggerHu, defaultCoverage: item.defaultCoverage, reconstructionNotes: item.reconstructionNotes, instructions: item.instructions, isActive: item.isActive }); };
  const startMriSequenceEdit = (item: MriSequencePreset) => { setEditingMriSequenceId(item.id); setMriSequenceDraft({ scannerId: item.scannerId, vendor: item.vendor, name: item.name, vendorSequenceName: item.vendorSequenceName, genericFamily: item.genericFamily, weighting: item.weighting, defaultPlane: item.defaultPlane, fatSuppression: item.fatSuppression ?? null, acquisitionType: item.acquisitionType ?? null, contrastRelation: item.contrastRelation, defaultCoverage: item.defaultCoverage, defaultBValues: item.defaultBValues, defaultDynamicTiming: item.defaultDynamicTiming, estimatedScanTimeMinutes: item.estimatedScanTimeMinutes, notes: item.notes, scannerAliases: (item.scannerAliases ?? []).map((alias) => ({ scannerId: alias.scannerId, vendorSequenceName: alias.vendorSequenceName, notes: alias.notes })), isActive: item.isActive }); };
  const startCtRowEdit = (item: ProtocolLibraryCtPhaseRow) => { setEditingCtRowId(item.id); setCtRowDraft({ ctPhasePresetId: item.ctPhasePresetId, customPhaseName: item.customPhaseName, timingOverride: item.timingOverride, coverageOverride: item.coverageOverride, reconstructionOverride: item.reconstructionOverride, instructionsOverride: item.instructionsOverride, isRequired: item.isRequired }); };
  const startMriRowEdit = (item: ProtocolLibraryMriSequenceRow) => { setEditingMriRowId(item.id); setMriRowDraft({ scannerId: item.scannerId, mriSequencePresetId: item.mriSequencePresetId, planeOverride: item.planeOverride, coverageOverride: item.coverageOverride, bValuesOverride: item.bValuesOverride, timingOverride: item.timingOverride, notesOverride: item.notesOverride, isRequired: item.isRequired }); };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Doctor Protocols</p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">Protocol Library</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: "var(--text-muted)" }}>
            Reusable CT/MRI protocol settings for anatomy regions, scanners, CT phases, and MRI sequences.
          </p>
        </div>
        {section === "protocols" && !selectedVersion && <AddButton label="Add protocol" onClick={() => setProtocolDraft(EMPTY_PROTOCOL)} />}
        {section === "anatomy" && <AddButton label="Add region" onClick={() => { setEditingRegionId(null); setRegionDraft(EMPTY_REGION); }} />}
        {section === "scanners" && <AddButton label="Add scanner" onClick={() => { setEditingScannerId(null); setScannerDraft(EMPTY_SCANNER); }} />}
        {section === "ctPhases" && <AddButton label="Add CT phase" onClick={() => { setEditingCtPhaseId(null); setCtPhaseDraft(EMPTY_CT_PHASE); }} />}
        {section === "mriSequences" && <AddButton label="Add MRI sequence" onClick={() => { setEditingMriSequenceId(null); setMriSequenceDraft(EMPTY_MRI_SEQUENCE); }} />}
      </div>

      {message && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${message.tone === "error" ? "text-red-700" : "text-emerald-700"}`} style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
          {message.text}
        </p>
      )}

      <div className="flex gap-2 overflow-x-auto">
        <SectionButton label="Protocol List" active={section === "protocols"} onClick={() => setSection("protocols")} />
        <SectionButton label="Anatomy / Regions" active={section === "anatomy"} onClick={() => setSection("anatomy")} />
        <SectionButton label="Scanners" active={section === "scanners"} onClick={() => setSection("scanners")} />
        <SectionButton label="CT Phase Presets" active={section === "ctPhases"} onClick={() => setSection("ctPhases")} />
        <SectionButton label="MRI Sequence Presets" active={section === "mriSequences"} onClick={() => setSection("mriSequences")} />
      </div>

      {section === "protocols" && selectedVersion && (
        <ProtocolBuilder
          key={selectedVersion.version.id}
          detail={selectedVersion}
          anatomy={anatomy}
          scanners={scanners}
          ctPhasePresets={ctPhases}
          mriSequencePresets={mriSequences}
          ctRowDraft={ctRowDraft}
          mriRowDraft={mriRowDraft}
          editingCtRowId={editingCtRowId}
          editingMriRowId={editingMriRowId}
          saving={updateVersionMutation.isPending || activateVersionMutation.isPending}
          setCtRowDraft={setCtRowDraft}
          setMriRowDraft={setMriRowDraft}
          onBack={() => { setSelectedVersionId(null); setCtRowDraft(null); setMriRowDraft(null); setEditingCtRowId(null); setEditingMriRowId(null); }}
          onSaveDraft={(changeSummary) => updateVersionMutation.mutate({ versionId: selectedVersion.version.id, changeSummary })}
          onActivate={() => activateVersionMutation.mutate(selectedVersion.version.id)}
          onDraftFromActive={() => draftFromActiveMutation.mutate(selectedVersion.protocol.id)}
          onAddCtRow={() => setCtRowDraft(EMPTY_PROTOCOL_CT_PHASE)}
          onEditCtRow={startCtRowEdit}
          onCancelCtRow={() => { setCtRowDraft(null); setEditingCtRowId(null); }}
          onSaveCtRow={(payload) => editingCtRowId ? updateCtRowMutation.mutate({ versionId: selectedVersion.version.id, rowId: editingCtRowId, payload }) : createCtRowMutation.mutate({ versionId: selectedVersion.version.id, payload })}
          onRemoveCtRow={(rowId) => deleteCtRowMutation.mutate({ versionId: selectedVersion.version.id, rowId })}
          onReorderCtRows={(rowIds) => reorderCtRowsMutation.mutate({ versionId: selectedVersion.version.id, rowIds })}
          onAddMriRow={() => setMriRowDraft(EMPTY_PROTOCOL_MRI_SEQUENCE)}
          onEditMriRow={startMriRowEdit}
          onCancelMriRow={() => { setMriRowDraft(null); setEditingMriRowId(null); }}
          onSaveMriRow={(payload) => editingMriRowId ? updateMriRowMutation.mutate({ versionId: selectedVersion.version.id, rowId: editingMriRowId, payload }) : createMriRowMutation.mutate({ versionId: selectedVersion.version.id, payload })}
          onRemoveMriRow={(rowId) => deleteMriRowMutation.mutate({ versionId: selectedVersion.version.id, rowId })}
          onReorderMriRows={(rowIds) => reorderMriRowsMutation.mutate({ versionId: selectedVersion.version.id, rowIds })}
        />
      )}
      {section === "protocols" && !selectedVersion && (
        <ProtocolList
          rows={filteredProtocols}
          filter={protocolFilter}
          search={protocolSearch}
          draft={protocolDraft}
          anatomy={anatomy}
          saving={createProtocolMutation.isPending}
          setFilter={setProtocolFilter}
          setSearch={setProtocolSearch}
          setDraft={setProtocolDraft}
          onManageAnatomy={() => setSection("anatomy")}
          onCreate={() => protocolDraft && createProtocolMutation.mutate(protocolDraft)}
          onOpen={(protocol) => {
            const versionId = protocol.latestDraftVersionId ?? protocol.activeVersionId;
            if (versionId) setSelectedVersionId(versionId);
          }}
          onToggle={(protocol) => updateProtocolMutation.mutate({ id: protocol.id, payload: { isActive: !protocol.isActive } })}
        />
      )}
      {section === "anatomy" && (
        <SettingsTable emptyText="No anatomy regions yet" headers={["Name", "Scope", "Body system", "Coverage", "Status", "Actions"]}>
          {regionDraft && <RegionForm draft={regionDraft} setDraft={setRegionDraft} saving={createRegionMutation.isPending || updateRegionMutation.isPending} onCancel={() => { setRegionDraft(null); setEditingRegionId(null); }} onSave={() => editingRegionId ? updateRegionMutation.mutate({ id: editingRegionId, payload: regionDraft }) : createRegionMutation.mutate(regionDraft)} />}
          {anatomy.map((item) => <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}><Cell>{item.name}</Cell><Cell>{item.modalityScope}</Cell><Cell>{item.bodySystem ?? "-"}</Cell><Cell>{item.defaultCoverageNote ?? "-"}</Cell><Cell><StatusBadge active={item.isActive} /></Cell><Cell><RowActions onEdit={() => startRegionEdit(item)} onToggle={() => updateRegionMutation.mutate({ id: item.id, payload: { isActive: !item.isActive } })} active={item.isActive} /></Cell></tr>)}
        </SettingsTable>
      )}
      {section === "scanners" && (
        <SettingsTable emptyText="No scanners yet" headers={["Display name", "Modality", "Vendor", "Details", "Status", "Actions"]}>
          {scannerDraft && <ScannerForm draft={scannerDraft} setDraft={setScannerDraft} saving={createScannerMutation.isPending || updateScannerMutation.isPending} onCancel={() => { setScannerDraft(null); setEditingScannerId(null); }} onSave={() => editingScannerId ? updateScannerMutation.mutate({ id: editingScannerId, payload: scannerDraft }) : createScannerMutation.mutate(scannerDraft)} />}
          {scanners.map((item) => <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}><Cell>{item.name}</Cell><Cell>{item.modality}</Cell><Cell>{item.vendor ?? "-"}</Cell><Cell>{item.modality === "MRI" ? item.fieldStrength ?? item.model ?? "-" : item.ctSliceDetectorSpecification ?? item.model ?? "-"}</Cell><Cell><StatusBadge active={item.isActive} /></Cell><Cell><RowActions onEdit={() => startScannerEdit(item)} onToggle={() => updateScannerMutation.mutate({ id: item.id, payload: { isActive: !item.isActive } })} active={item.isActive} /></Cell></tr>)}
        </SettingsTable>
      )}
      {section === "ctPhases" && (
        <SettingsTable emptyText="No CT phase presets yet" headers={["Name", "Contrast", "Timing", "Delay", "Coverage", "Status", "Actions"]}>
          {ctPhaseDraft && <CtPhaseForm draft={ctPhaseDraft} setDraft={setCtPhaseDraft} saving={createCtPhaseMutation.isPending || updateCtPhaseMutation.isPending} onCancel={() => { setCtPhaseDraft(null); setEditingCtPhaseId(null); }} onSave={() => editingCtPhaseId ? updateCtPhaseMutation.mutate({ id: editingCtPhaseId, payload: ctPhaseDraft }) : createCtPhaseMutation.mutate(ctPhaseDraft)} />}
          {ctPhases.map((item) => <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}><Cell>{item.name}</Cell><Cell>{item.contrastStatus}</Cell><Cell>{item.timingType}</Cell><Cell>{item.delaySeconds ?? "-"}</Cell><Cell>{item.defaultCoverage ?? "-"}</Cell><Cell><StatusBadge active={item.isActive} /></Cell><Cell><RowActions onEdit={() => startCtPhaseEdit(item)} onToggle={() => updateCtPhaseMutation.mutate({ id: item.id, payload: { isActive: !item.isActive } })} active={item.isActive} /></Cell></tr>)}
        </SettingsTable>
      )}
      {section === "mriSequences" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }} onClick={() => downloadMriTemplateMutation.mutate()} disabled={downloadMriTemplateMutation.isPending}>Download template</button>
            <button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }} onClick={() => exportMriSequencesMutation.mutate()} disabled={exportMriSequencesMutation.isPending}>Export current XLSX</button>
            <label className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
              Import XLSX
              <input className="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readMriImportFile(file); event.currentTarget.value = ""; }} />
            </label>
            {mriImportFileName && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{mriImportFileName}</span>}
          </div>
          {(mriImportInspect || mriImportPreview || mriImportSummary) && (
            <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
              {mriImportInspect && (
                <div className="space-y-1">
                  <p className="font-semibold">Workbook inspect</p>
                  {mriImportInspect.sheets.map((sheet) => (
                    <p key={sheet.sheetName} className={sheet.missingRequiredColumns.length ? "text-red-700" : ""}>
                      {sheet.sheetName}: {sheet.rowCount} rows, {sheet.columns.length} columns{sheet.missingRequiredColumns.length ? `, missing ${sheet.missingRequiredColumns.join(", ")}` : ""}
                    </p>
                  ))}
                </div>
              )}
              {mriImportFileBase64 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }} disabled={previewMriImportMutation.isPending} onClick={() => previewMriImportMutation.mutate({ fileContentBase64: mriImportFileBase64, fileName: mriImportFileName })}>Preview import</button>
                  <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }} disabled={!mriImportPreview?.canConfirm || confirmMriImportMutation.isPending} onClick={() => confirmMriImportMutation.mutate({ fileContentBase64: mriImportFileBase64, fileName: mriImportFileName })}>Confirm import</button>
                </div>
              )}
              {mriImportPreview && (
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <ImportPreviewList title="MRI Sequences" rows={mriImportPreview.sequenceRows.map((row) => ({ key: `${row.rowNumber}-${row.sequenceKey}`, label: `${row.rowNumber}: ${row.sequenceKey || "missing key"} - ${row.action}`, errors: row.errors }))} />
                  <ImportPreviewList title="Scanner Aliases" rows={mriImportPreview.aliasRows.map((row) => ({ key: `${row.rowNumber}-${row.sequenceKey}-${row.scannerDisplayName}`, label: `${row.rowNumber}: ${row.sequenceKey || "missing key"} / ${row.scannerDisplayName || "missing scanner"} - ${row.action}`, errors: row.errors }))} />
                </div>
              )}
              {mriImportSummary && (
                <p className="mt-2 text-emerald-700">Import complete: {mriImportSummary.createdSequences} sequences created, {mriImportSummary.updatedSequences} updated, {mriImportSummary.createdAliases} aliases created, {mriImportSummary.updatedAliases} updated.</p>
              )}
            </div>
          )}
          <SettingsTable emptyText="No MRI sequence presets yet" headers={["Name", "Clinical label", "Scanner-specific names", "Time", "Status", "Actions"]}>
            {mriSequenceDraft && <MriSequenceForm draft={mriSequenceDraft} scanners={scanners} setDraft={setMriSequenceDraft} saving={createMriSequenceMutation.isPending || updateMriSequenceMutation.isPending} onCancel={() => { setMriSequenceDraft(null); setEditingMriSequenceId(null); }} onSave={() => editingMriSequenceId ? updateMriSequenceMutation.mutate({ id: editingMriSequenceId, payload: mriSequenceDraft }) : createMriSequenceMutation.mutate(mriSequenceDraft)} />}
            {mriSequences.map((item) => <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}><Cell>{item.name}</Cell><Cell>{mriSequencePresetLabel(item)}</Cell><Cell>{item.scannerAliases?.length ? `${item.scannerAliases.length} scanner name${item.scannerAliases.length === 1 ? "" : "s"}` : "Generic"}</Cell><Cell>{item.estimatedScanTimeMinutes ?? "-"}</Cell><Cell><StatusBadge active={item.isActive} /></Cell><Cell><RowActions onEdit={() => startMriSequenceEdit(item)} onToggle={() => updateMriSequenceMutation.mutate({ id: item.id, payload: { isActive: !item.isActive } })} active={item.isActive} /></Cell></tr>)}
          </SettingsTable>
        </div>
      )}
    </section>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex h-9 items-center rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white">{label}</button>;
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 align-top text-foreground">{children}</td>;
}

function RowActions({ active, onEdit, onToggle }: { active: boolean; onEdit: () => void; onToggle: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={onEdit} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>Edit</button>
      <button type="button" onClick={onToggle} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>{active ? "Deactivate" : "Reactivate"}</button>
    </div>
  );
}

function SettingsTable({ headers, emptyText, children }: { headers: string[]; emptyText: string; children: ReactNode }) {
  const childArray = Children.toArray(children);
  const hasRows = childArray.length > 0;
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <table className="min-w-full text-sm">
        <thead><tr className="border-b" style={{ borderColor: "var(--border)" }}>{headers.map((header) => <th key={header} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>{header}</th>)}</tr></thead>
        <tbody>{hasRows ? childArray : <tr><td className="p-6 text-sm" colSpan={headers.length} style={{ color: "var(--text-muted)" }}>{emptyText}</td></tr>}</tbody>
      </table>
    </div>
  );
}

function ImportPreviewList({ title, rows }: { title: string; rows: Array<{ key: string; label: string; errors: string[] }> }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>{title}</p>
      <div className="mt-1 max-h-40 overflow-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
        {rows.length ? rows.slice(0, 20).map((row) => (
          <div key={row.key} className="border-b px-2 py-1 last:border-b-0" style={{ borderColor: "var(--border)" }}>
            <p>{row.label}</p>
            {row.errors.map((error) => <p key={error} className="text-xs text-red-700">{error}</p>)}
          </div>
        )) : <p className="px-2 py-1" style={{ color: "var(--text-muted)" }}>No rows</p>}
      </div>
    </div>
  );
}

function ProtocolList({
  rows,
  filter,
  search,
  draft,
  anatomy,
  saving,
  setFilter,
  setSearch,
  setDraft,
  onManageAnatomy,
  onCreate,
  onOpen,
  onToggle,
}: {
  rows: ProtocolLibraryProtocol[];
  filter: "all" | "CT" | "MRI" | "active" | "draft";
  search: string;
  draft: ProtocolLibraryProtocolPayload | null;
  anatomy: ProtocolAnatomyRegion[];
  saving: boolean;
  setFilter: (filter: "all" | "CT" | "MRI" | "active" | "draft") => void;
  setSearch: (search: string) => void;
  setDraft: (draft: ProtocolLibraryProtocolPayload | null) => void;
  onManageAnatomy: () => void;
  onCreate: () => void;
  onOpen: (protocol: ProtocolLibraryProtocol) => void;
  onToggle: (protocol: ProtocolLibraryProtocol) => void;
}) {
  const filterLabels: Array<{ value: typeof filter; label: string }> = [
    { value: "all", label: "All" },
    { value: "CT", label: "CT" },
    { value: "MRI", label: "MRI" },
    { value: "active", label: "Active" },
    { value: "draft", label: "Draft" },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {filterLabels.map((item) => <SectionButton key={item.value} label={item.label} active={filter === item.value} onClick={() => setFilter(item.value)} />)}
        <input aria-label="Search protocols" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name" className="h-9 min-w-52 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }} />
      </div>
      <SettingsTable emptyText="No protocols yet" headers={["Name", "Modality", "Region", "Category", "Indication", "Contrast policy", "Active version", "Status", "Actions"]}>
        {draft && <ProtocolCreateForm draft={draft} anatomy={anatomy} saving={saving} setDraft={setDraft} onManageAnatomy={onManageAnatomy} onCancel={() => setDraft(null)} onSave={onCreate} />}
        {rows.length === 0 && !draft ? <tr><td className="p-6 text-sm" colSpan={9} style={{ color: "var(--text-muted)" }}><p>No protocols yet</p><p>Create CT or MRI protocols from your saved phase and sequence presets.</p></td></tr> : null}
        {rows.map((item) => (
          <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}>
            <Cell>{item.name}</Cell>
            <Cell>{item.modality}</Cell>
            <Cell>{item.anatomyRegionName ?? "-"}</Cell>
            <Cell>{item.category ?? "-"}</Cell>
            <Cell>{item.indication ?? "-"}</Cell>
            <Cell>{item.contrastPolicy ?? "-"}</Cell>
            <Cell>{item.activeVersionNumber ?? "-"}</Cell>
            <Cell>{item.activeVersionId ? "Active" : item.latestDraftVersionId ? "Draft only" : "No active version"}</Cell>
            <Cell><div className="flex flex-wrap gap-2"><button type="button" onClick={() => onOpen(item)} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>View/Edit</button><button type="button" onClick={() => onToggle(item)} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>{item.isActive ? "Deactivate" : "Reactivate"}</button></div></Cell>
          </tr>
        ))}
      </SettingsTable>
    </div>
  );
}

function ProtocolCreateForm({ draft, anatomy, saving, setDraft, onManageAnatomy, onSave, onCancel }: { draft: ProtocolLibraryProtocolPayload; anatomy: ProtocolAnatomyRegion[]; saving: boolean; setDraft: (draft: ProtocolLibraryProtocolPayload | null) => void; onManageAnatomy: () => void; onSave: () => void; onCancel: () => void }) {
  const matchingAnatomy = anatomy.filter((item) => item.isActive && (item.modalityScope === "BOTH" || item.modalityScope === draft.modality));
  return (
    <tr><td colSpan={9} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Protocol name"><input aria-label="Protocol name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Protocol modality"><select aria-label="Protocol modality" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value as ProtocolLibraryProtocolPayload["modality"], anatomyRegionId: null })}><option value="CT">CT</option><option value="MRI">MRI</option></select></Field>
      <Field label="Anatomy / region"><select aria-label="Anatomy / region" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.anatomyRegionId ?? ""} onChange={(event) => setDraft({ ...draft, anatomyRegionId: event.target.value ? Number(event.target.value) : null })}><option value="">Not specified</option>{matchingAnatomy.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Category"><select aria-label="Category" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.category ?? ""} onChange={(event) => setDraft({ ...draft, category: event.target.value || null })}><option value="">Not specified</option>{PROTOCOL_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></Field>
      <Field label="Indication"><input aria-label="Indication" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.indication)} onChange={(event) => setDraft({ ...draft, indication: editableText(event.target.value) })} /></Field>
      <Field label="IV contrast policy"><select aria-label="IV contrast policy" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.contrastPolicy ?? ""} onChange={(event) => setDraft({ ...draft, contrastPolicy: event.target.value || null })}><option value="">Not specified</option>{IV_CONTRAST_POLICIES.map((policy) => <option key={policy} value={policy}>{policy}</option>)}</select></Field>
      <Field label="Oral contrast policy"><input aria-label="Oral contrast policy" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.oralContrastPolicy)} onChange={(event) => setDraft({ ...draft, oralContrastPolicy: editableText(event.target.value) })} /></Field>
      <Field label="Bowel preparation"><input aria-label="Bowel preparation" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.bowelPreparation)} onChange={(event) => setDraft({ ...draft, bowelPreparation: editableText(event.target.value) })} /></Field>
      <Field label="Preparation notes"><input aria-label="Preparation notes" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.preparationNotes)} onChange={(event) => setDraft({ ...draft, preparationNotes: editableText(event.target.value) })} /></Field>
      <Field label="Change summary"><input aria-label="Change summary" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.changeSummary ?? null)} onChange={(event) => setDraft({ ...draft, changeSummary: editableText(event.target.value) })} /></Field>
      <button type="button" onClick={onManageAnatomy} className="h-10 self-end rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Manage anatomy / regions</button>
      <FormActions saving={saving} saveLabel="Create protocol" canSave={Boolean(draft.name.trim())} onSave={onSave} onCancel={onCancel} />
    </div></td></tr>
  );
}

function VersionBadge({ status }: { status: string }) {
  return <span className="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold" style={{ borderColor: "var(--border)", color: status === "ACTIVE" ? "#047857" : "var(--text-muted)" }}>{status}</span>;
}

function ProtocolBuilder({
  detail,
  scanners,
  ctPhasePresets,
  mriSequencePresets,
  ctRowDraft,
  mriRowDraft,
  editingCtRowId,
  editingMriRowId,
  saving,
  setCtRowDraft,
  setMriRowDraft,
  onBack,
  onSaveDraft,
  onActivate,
  onDraftFromActive,
  onAddCtRow,
  onEditCtRow,
  onCancelCtRow,
  onSaveCtRow,
  onRemoveCtRow,
  onReorderCtRows,
  onAddMriRow,
  onEditMriRow,
  onCancelMriRow,
  onSaveMriRow,
  onRemoveMriRow,
  onReorderMriRows,
}: {
  detail: ProtocolLibraryVersionDetail;
  anatomy: ProtocolAnatomyRegion[];
  scanners: ImagingScanner[];
  ctPhasePresets: CtPhasePreset[];
  mriSequencePresets: MriSequencePreset[];
  ctRowDraft: ProtocolLibraryCtPhaseRowPayload | null;
  mriRowDraft: ProtocolLibraryMriSequenceRowPayload | null;
  editingCtRowId: number | null;
  editingMriRowId: number | null;
  saving: boolean;
  setCtRowDraft: (draft: ProtocolLibraryCtPhaseRowPayload | null) => void;
  setMriRowDraft: (draft: ProtocolLibraryMriSequenceRowPayload | null) => void;
  onBack: () => void;
  onSaveDraft: (changeSummary: string | null) => void;
  onActivate: () => void;
  onDraftFromActive: () => void;
  onAddCtRow: () => void;
  onEditCtRow: (row: ProtocolLibraryCtPhaseRow) => void;
  onCancelCtRow: () => void;
  onSaveCtRow: (payload: ProtocolLibraryCtPhaseRowPayload) => void;
  onRemoveCtRow: (rowId: number) => void;
  onReorderCtRows: (rowIds: number[]) => void;
  onAddMriRow: () => void;
  onEditMriRow: (row: ProtocolLibraryMriSequenceRow) => void;
  onCancelMriRow: () => void;
  onSaveMriRow: (payload: ProtocolLibraryMriSequenceRowPayload) => void;
  onRemoveMriRow: (rowId: number) => void;
  onReorderMriRows: (rowIds: number[]) => void;
}) {
  const [changeSummary, setChangeSummary] = useState(detail.version.changeSummary ?? "");
  const editable = detail.version.status === "DRAFT";
  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">{detail.protocol.name}</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{detail.protocol.modality} · {detail.protocol.anatomyRegionName ?? "No region"} · Version {detail.version.versionNumber} <VersionBadge status={detail.version.status} /></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onBack} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Back to list</button>
            {editable ? <button type="button" onClick={() => onSaveDraft(nullableText(changeSummary))} disabled={saving} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Save draft</button> : null}
            {editable ? <button type="button" onClick={onActivate} disabled={saving} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Activate version</button> : <button type="button" onClick={onDraftFromActive} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Create new draft version</button>}
          </div>
        </div>
        <Field label="Change summary"><input aria-label="Change summary" disabled={!editable} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} /></Field>
      </section>
      {detail.protocol.modality === "CT" ? (
        <CtProtocolRows detail={detail} presets={ctPhasePresets} draft={ctRowDraft} editingRowId={editingCtRowId} editable={editable} setDraft={setCtRowDraft} onAdd={onAddCtRow} onEdit={onEditCtRow} onCancel={onCancelCtRow} onSave={onSaveCtRow} onRemove={onRemoveCtRow} onReorder={onReorderCtRows} />
      ) : (
        <MriProtocolRows detail={detail} scanners={scanners} presets={mriSequencePresets} draft={mriRowDraft} editingRowId={editingMriRowId} editable={editable} setDraft={setMriRowDraft} onAdd={onAddMriRow} onEdit={onEditMriRow} onCancel={onCancelMriRow} onSave={onSaveMriRow} onRemove={onRemoveMriRow} onReorder={onReorderMriRows} />
      )}
    </div>
  );
}

function CtProtocolRows({ detail, presets, draft, editingRowId, editable, setDraft, onAdd, onEdit, onCancel, onSave, onRemove, onReorder }: { detail: ProtocolLibraryVersionDetail; presets: CtPhasePreset[]; draft: ProtocolLibraryCtPhaseRowPayload | null; editingRowId: number | null; editable: boolean; setDraft: (draft: ProtocolLibraryCtPhaseRowPayload | null) => void; onAdd: () => void; onEdit: (row: ProtocolLibraryCtPhaseRow) => void; onCancel: () => void; onSave: (payload: ProtocolLibraryCtPhaseRowPayload) => void; onRemove: (rowId: number) => void; onReorder: (rowIds: number[]) => void }) {
  const activePresets = presets.filter((preset) => preset.isActive);
  const move = (index: number, direction: -1 | 1) => {
    const rows = [...detail.ctPhases];
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    onReorder(rows.map((row) => row.id));
  };
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">CT phases</h3>
        {editable && <AddButton label="Add phase" onClick={onAdd} />}
      </div>
      <SettingsTable emptyText="No CT phases added yet" headers={["Order", "CT phase preset", "Custom phase name", "Timing override", "Coverage override", "Reconstruction override", "Instructions override", "Required", "Actions"]}>
        {draft && editable && <CtProtocolRowForm draft={draft} presets={activePresets} setDraft={setDraft} onCancel={onCancel} onSave={() => onSave(draft)} />}
        {detail.ctPhases.map((row, index) => (
          <tr key={row.id}>
            <Cell>{row.orderIndex}</Cell>
            <Cell>{row.ctPhasePresetName ?? "-"}</Cell>
            <Cell>{row.customPhaseName ?? "-"}</Cell>
            <Cell>{row.timingOverride ?? "-"}</Cell>
            <Cell>{row.coverageOverride ?? "-"}</Cell>
            <Cell>{row.reconstructionOverride ?? "-"}</Cell>
            <Cell>{row.instructionsOverride ?? "-"}</Cell>
            <Cell>{row.isRequired ? "Yes" : "No"}</Cell>
            <Cell>{editable ? <RowBuilderActions onEdit={() => onEdit(row)} onRemove={() => onRemove(row.id)} onMoveUp={() => move(index, -1)} onMoveDown={() => move(index, 1)} first={index === 0} last={index === detail.ctPhases.length - 1} editing={editingRowId === row.id} /> : "Read-only"}</Cell>
          </tr>
        ))}
      </SettingsTable>
    </section>
  );
}

function CtProtocolRowForm({ draft, presets, setDraft, onSave, onCancel }: { draft: ProtocolLibraryCtPhaseRowPayload; presets: CtPhasePreset[]; setDraft: (draft: ProtocolLibraryCtPhaseRowPayload | null) => void; onSave: () => void; onCancel: () => void }) {
  const selectedPreset = presets.find((preset) => preset.id === draft.ctPhasePresetId) ?? null;
  return (
    <tr><td colSpan={9} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="CT phase preset"><select aria-label="CT phase preset" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.ctPhasePresetId ?? ""} onChange={(event) => setDraft({ ...draft, ctPhasePresetId: event.target.value ? Number(event.target.value) : null })}><option value="">No preset</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></Field>
      <Field label="Custom phase name"><input aria-label="Custom phase name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.customPhaseName)} onChange={(event) => setDraft({ ...draft, customPhaseName: editableText(event.target.value) })} /></Field>
      <Field label="Timing override"><input aria-label="Timing override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.timingOverride)} onChange={(event) => setDraft({ ...draft, timingOverride: editableText(event.target.value) })} /></Field>
      <Field label="Coverage override"><input aria-label="Coverage override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.coverageOverride)} onChange={(event) => setDraft({ ...draft, coverageOverride: editableText(event.target.value) })} /></Field>
      <Field label="Reconstruction override"><input aria-label="Reconstruction override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.reconstructionOverride)} onChange={(event) => setDraft({ ...draft, reconstructionOverride: editableText(event.target.value) })} /></Field>
      <Field label="Instructions override"><input aria-label="Instructions override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.instructionsOverride)} onChange={(event) => setDraft({ ...draft, instructionsOverride: editableText(event.target.value) })} /></Field>
      <label className="flex items-end gap-2 text-sm font-medium"><input type="checkbox" checked={draft.isRequired} onChange={(event) => setDraft({ ...draft, isRequired: event.target.checked })} /> Required</label>
      <FormActions saving={false} saveLabel="Save phase" canSave={Boolean(draft.ctPhasePresetId || draft.customPhaseName?.trim())} onSave={onSave} onCancel={onCancel} />
      {selectedPreset && <p className="text-xs md:col-span-4" style={{ color: "var(--text-muted)" }}>Preset reference: {selectedPreset.contrastStatus} · {selectedPreset.timingType} · {selectedPreset.defaultCoverage ?? "No default coverage"}</p>}
    </div></td></tr>
  );
}

function MriProtocolRows({ detail, scanners, presets, draft, editingRowId, editable, setDraft, onAdd, onEdit, onCancel, onSave, onRemove, onReorder }: { detail: ProtocolLibraryVersionDetail; scanners: ImagingScanner[]; presets: MriSequencePreset[]; draft: ProtocolLibraryMriSequenceRowPayload | null; editingRowId: number | null; editable: boolean; setDraft: (draft: ProtocolLibraryMriSequenceRowPayload | null) => void; onAdd: () => void; onEdit: (row: ProtocolLibraryMriSequenceRow) => void; onCancel: () => void; onSave: (payload: ProtocolLibraryMriSequenceRowPayload) => void; onRemove: (rowId: number) => void; onReorder: (rowIds: number[]) => void }) {
  const activePresets = presets.filter((preset) => preset.isActive);
  const move = (index: number, direction: -1 | 1) => {
    const rows = [...detail.mriSequences];
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    onReorder(rows.map((row) => row.id));
  };
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">MRI sequences</h3>
        {editable && <AddButton label="Add sequence" onClick={onAdd} />}
      </div>
      <SettingsTable emptyText="No MRI sequences added yet" headers={["Order", "Scanner", "MRI sequence preset", "Plane override", "Coverage override", "b-values override", "Timing override", "Required", "Actions"]}>
        {draft && editable && <MriProtocolRowForm draft={draft} scanners={scanners.filter((scanner) => scanner.isActive && scanner.modality === "MRI")} presets={activePresets} setDraft={setDraft} onCancel={onCancel} onSave={() => onSave(draft)} />}
        {detail.mriSequences.map((row, index) => (
          <tr key={row.id}>
            <Cell>{row.orderIndex}</Cell>
            <Cell>{row.scannerName ?? "Generic"}</Cell>
            <Cell>
              {mriSequenceRowLabel(row)}
              {row.scannerName && row.scannerAliasVendorSequenceName ? <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>Vendor name on {row.scannerName}: {row.scannerAliasVendorSequenceName}</span> : null}
            </Cell>
            <Cell>{row.planeOverride ?? "-"}</Cell>
            <Cell>{row.coverageOverride ?? "-"}</Cell>
            <Cell>{row.bValuesOverride ?? "-"}</Cell>
            <Cell>{row.timingOverride ?? "-"}</Cell>
            <Cell>{row.isRequired ? "Yes" : "No"}</Cell>
            <Cell>{editable ? <RowBuilderActions onEdit={() => onEdit(row)} onRemove={() => onRemove(row.id)} onMoveUp={() => move(index, -1)} onMoveDown={() => move(index, 1)} first={index === 0} last={index === detail.mriSequences.length - 1} editing={editingRowId === row.id} /> : "Read-only"}</Cell>
          </tr>
        ))}
      </SettingsTable>
    </section>
  );
}

function MriProtocolRowForm({ draft, scanners, presets, setDraft, onSave, onCancel }: { draft: ProtocolLibraryMriSequenceRowPayload; scanners: ImagingScanner[]; presets: MriSequencePreset[]; setDraft: (draft: ProtocolLibraryMriSequenceRowPayload | null) => void; onSave: () => void; onCancel: () => void }) {
  const filteredPresets = presets.filter((preset) => !draft.scannerId || preset.scannerId === null || preset.scannerId === draft.scannerId || (preset.scannerAliases ?? []).some((alias) => alias.scannerId === draft.scannerId));
  const selectedPreset = presets.find((preset) => preset.id === draft.mriSequencePresetId) ?? null;
  const selectedAlias = selectedPreset?.scannerAliases?.find((alias) => alias.scannerId === draft.scannerId) ?? null;
  return (
    <tr><td colSpan={9} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Scanner"><select aria-label="Scanner" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.scannerId ?? ""} onChange={(event) => setDraft({ ...draft, scannerId: event.target.value ? Number(event.target.value) : null, mriSequencePresetId: null })}><option value="">Generic / not scanner-specific</option>{scanners.map((scanner) => <option key={scanner.id} value={scanner.id}>{scanner.name}</option>)}</select></Field>
      <Field label="MRI sequence preset"><select aria-label="MRI sequence preset" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.mriSequencePresetId ?? ""} onChange={(event) => setDraft({ ...draft, mriSequencePresetId: event.target.value ? Number(event.target.value) : null })}><option value="">No preset</option>{filteredPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} - {mriSequencePresetLabel(preset)}</option>)}</select></Field>
      <Field label="Plane override"><input aria-label="Plane override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.planeOverride)} onChange={(event) => setDraft({ ...draft, planeOverride: editableText(event.target.value) })} /></Field>
      <Field label="Coverage override"><input aria-label="Coverage override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.coverageOverride)} onChange={(event) => setDraft({ ...draft, coverageOverride: editableText(event.target.value) })} /></Field>
      <Field label="b-values override"><input aria-label="b-values override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.bValuesOverride)} onChange={(event) => setDraft({ ...draft, bValuesOverride: editableText(event.target.value) })} /></Field>
      <Field label="Timing override"><input aria-label="Timing override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.timingOverride)} onChange={(event) => setDraft({ ...draft, timingOverride: editableText(event.target.value) })} /></Field>
      <Field label="Notes override"><input aria-label="Notes override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.notesOverride)} onChange={(event) => setDraft({ ...draft, notesOverride: editableText(event.target.value) })} /></Field>
      <label className="flex items-end gap-2 text-sm font-medium"><input type="checkbox" checked={draft.isRequired} onChange={(event) => setDraft({ ...draft, isRequired: event.target.checked })} /> Required</label>
      <FormActions saving={false} saveLabel="Save sequence" canSave={Boolean(draft.mriSequencePresetId || draft.planeOverride?.trim() || draft.coverageOverride?.trim())} onSave={onSave} onCancel={onCancel} />
      {selectedPreset && <p className="text-xs md:col-span-4" style={{ color: "var(--text-muted)" }}>Preset reference: {mriSequencePresetLabel(selectedPreset)} · {selectedPreset.defaultCoverage ?? "No default coverage"} · {selectedPreset.defaultBValues ?? "No b-values"}</p>}
      {selectedAlias && <p className="text-xs md:col-span-4" style={{ color: "var(--text-muted)" }}>Vendor name on {selectedAlias.scannerName ?? "selected scanner"}: {selectedAlias.vendorSequenceName}</p>}
    </div></td></tr>
  );
}

function RowBuilderActions({ first, last, editing, onEdit, onRemove, onMoveUp, onMoveDown }: { first: boolean; last: boolean; editing: boolean; onEdit: () => void; onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={first} onClick={onMoveUp} className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)" }}>Up</button>
      <button type="button" disabled={last} onClick={onMoveDown} className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)" }}>Down</button>
      <button type="button" onClick={onEdit} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>{editing ? "Editing" : "Edit"}</button>
      <button type="button" onClick={onRemove} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>Remove</button>
    </div>
  );
}

function RegionForm({ draft, setDraft, saving, onSave, onCancel }: { draft: ProtocolAnatomyRegionPayload; setDraft: (draft: ProtocolAnatomyRegionPayload | null) => void; saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <tr><td colSpan={6} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Name"><input aria-label="Name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Body system"><input aria-label="Body system" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.bodySystem)} onChange={(event) => setDraft({ ...draft, bodySystem: editableText(event.target.value) })} /></Field>
      <Field label="Modality scope"><select aria-label="Modality scope" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.modalityScope} onChange={(event) => setDraft({ ...draft, modalityScope: event.target.value as ProtocolAnatomyRegionPayload["modalityScope"] })}><option value="CT">CT</option><option value="MRI">MRI</option><option value="BOTH">BOTH</option></select></Field>
      <Field label="Default coverage note"><input aria-label="Default coverage note" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.defaultCoverageNote)} onChange={(event) => setDraft({ ...draft, defaultCoverageNote: editableText(event.target.value) })} /></Field>
      <FormActions saving={saving} saveLabel="Save region" canSave={Boolean(draft.name.trim())} onSave={onSave} onCancel={onCancel} />
    </div></td></tr>
  );
}

function ScannerForm({ draft, setDraft, saving, onSave, onCancel }: { draft: ImagingScannerPayload; setDraft: (draft: ImagingScannerPayload | null) => void; saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <tr><td colSpan={6} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Display name"><input aria-label="Display name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Modality"><select aria-label="Modality" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value as ImagingScannerPayload["modality"], fieldStrength: event.target.value === "MRI" ? draft.fieldStrength : null, ctSliceDetectorSpecification: event.target.value === "CT" ? draft.ctSliceDetectorSpecification : null })}><option value="CT">CT</option><option value="MRI">MRI</option></select></Field>
      {(["vendor", "model"] as const).map((key) => <Field key={key} label={key[0].toUpperCase() + key.slice(1)}><input aria-label={key[0].toUpperCase() + key.slice(1)} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: editableText(event.target.value) })} /></Field>)}
      {draft.modality === "MRI" ? <Field label="Field strength"><input aria-label="Field strength" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.fieldStrength)} onChange={(event) => setDraft({ ...draft, fieldStrength: editableText(event.target.value) })} placeholder="1.5T, 3T" /></Field> : null}
      {draft.modality === "CT" ? <Field label="Slice / detector specification"><input aria-label="Slice / detector specification" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.ctSliceDetectorSpecification)} onChange={(event) => setDraft({ ...draft, ctSliceDetectorSpecification: editableText(event.target.value) })} /></Field> : null}
      <Field label="Location"><input aria-label="Location" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.location)} onChange={(event) => setDraft({ ...draft, location: editableText(event.target.value) })} /></Field>
      <Field label="Notes"><input aria-label="Notes" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.notes)} onChange={(event) => setDraft({ ...draft, notes: editableText(event.target.value) })} /></Field>
      <FormActions saving={saving} saveLabel="Save scanner" canSave={Boolean(draft.name.trim())} onSave={onSave} onCancel={onCancel} />
    </div></td></tr>
  );
}

function CtPhaseForm({ draft, setDraft, saving, onSave, onCancel }: { draft: CtPhasePresetPayload; setDraft: (draft: CtPhasePresetPayload | null) => void; saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <tr><td colSpan={7} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Name"><input aria-label="Name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Contrast status"><select aria-label="Contrast status" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.contrastStatus} onChange={(event) => setDraft({ ...draft, contrastStatus: event.target.value as CtPhasePresetPayload["contrastStatus"] })}><option value="NON_CONTRAST">NON_CONTRAST</option><option value="POST_CONTRAST">POST_CONTRAST</option><option value="DELAYED">DELAYED</option><option value="OTHER">OTHER</option></select></Field>
      <Field label="Timing type"><select aria-label="Timing type" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.timingType} onChange={(event) => setDraft({ ...draft, timingType: event.target.value as CtPhasePresetPayload["timingType"] })}><option value="NONE">NONE</option><option value="FIXED_DELAY">FIXED_DELAY</option><option value="BOLUS_TRACKING">BOLUS_TRACKING</option><option value="MANUAL">MANUAL</option></select></Field>
      <NumberField label="Delay seconds" value={draft.delaySeconds} onChange={(value) => setDraft({ ...draft, delaySeconds: nullableNumber(value) })} />
      <Field label="Bolus tracking site"><input aria-label="Bolus tracking site" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.bolusTrackingSite)} onChange={(event) => setDraft({ ...draft, bolusTrackingSite: editableText(event.target.value) })} /></Field>
      <NumberField label="Trigger HU" value={draft.triggerHu} onChange={(value) => setDraft({ ...draft, triggerHu: nullableNumber(value) })} />
      <Field label="Default coverage"><input aria-label="Default coverage" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.defaultCoverage)} onChange={(event) => setDraft({ ...draft, defaultCoverage: editableText(event.target.value) })} /></Field>
      <Field label="Reconstruction notes"><input aria-label="Reconstruction notes" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.reconstructionNotes)} onChange={(event) => setDraft({ ...draft, reconstructionNotes: editableText(event.target.value) })} /></Field>
      <Field label="Instructions"><input aria-label="Instructions" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.instructions)} onChange={(event) => setDraft({ ...draft, instructions: editableText(event.target.value) })} /></Field>
      <FormActions saving={saving} saveLabel="Save CT phase" canSave={Boolean(draft.name.trim())} onSave={onSave} onCancel={onCancel} />
    </div></td></tr>
  );
}

function MriSequenceForm({ draft, scanners, setDraft, saving, onSave, onCancel }: { draft: MriSequencePresetPayload; scanners: ImagingScanner[]; setDraft: (draft: MriSequencePresetPayload | null) => void; saving: boolean; onSave: () => void; onCancel: () => void }) {
  const [showAdvanced, setShowAdvanced] = useState(Boolean(draft.defaultCoverage || draft.defaultBValues || draft.defaultDynamicTiming || draft.estimatedScanTimeMinutes));
  const [showAliases, setShowAliases] = useState(Boolean(draft.scannerAliases?.length));
  const aliases = draft.scannerAliases ?? [];
  const mriScanners = scanners.filter((scanner) => scanner.modality === "MRI");
  const aliasesValid = aliases.every((alias) => alias.scannerId > 0 && alias.vendorSequenceName.trim());
  const updateAlias = (index: number, next: Partial<{ scannerId: number | null; vendorSequenceName: string | null; notes: string | null }>) => {
    setDraft({
      ...draft,
      scannerAliases: aliases.map((alias, aliasIndex) => aliasIndex === index ? {
        ...alias,
        ...next,
        scannerId: next.scannerId ?? alias.scannerId,
        vendorSequenceName: next.vendorSequenceName ?? alias.vendorSequenceName,
      } : alias),
    });
  };
  return (
    <tr><td colSpan={6} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Sequence name"><input aria-label="Sequence name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Plane"><select aria-label="Plane" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.defaultPlane ?? ""} onChange={(event) => setDraft({ ...draft, defaultPlane: editableText(event.target.value) })}><option value="">Not specified</option>{MRI_SEQUENCE_PLANES.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
      <Field label="Weighting / family"><select aria-label="Weighting / family" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.weighting ?? ""} onChange={(event) => setDraft({ ...draft, weighting: editableText(event.target.value), genericFamily: editableText(event.target.value) })}><option value="">Not specified</option>{MRI_SEQUENCE_FAMILIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
      <Field label="Fat suppression"><select aria-label="Fat suppression" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.fatSuppression ?? ""} onChange={(event) => setDraft({ ...draft, fatSuppression: editableText(event.target.value) })}><option value="">Not specified</option>{MRI_FAT_SUPPRESSION.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
      <Field label="Acquisition type"><select aria-label="Acquisition type" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.acquisitionType ?? ""} onChange={(event) => setDraft({ ...draft, acquisitionType: editableText(event.target.value) })}><option value="">Not specified</option>{MRI_ACQUISITION_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
      <Field label="Contrast relation"><select aria-label="Contrast relation" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.contrastRelation ?? ""} onChange={(event) => setDraft({ ...draft, contrastRelation: editableText(event.target.value) })}><option value="">Not specified</option>{MRI_CONTRAST_RELATIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
      <Field label="Notes"><input aria-label="Notes" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.notes)} onChange={(event) => setDraft({ ...draft, notes: editableText(event.target.value) })} /></Field>
      <div className="flex items-end gap-2">
        <button type="button" className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }} onClick={() => setShowAdvanced(!showAdvanced)}>Advanced details</button>
        <button type="button" className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }} onClick={() => setShowAliases(!showAliases)}>Scanner-specific names</button>
      </div>
      {showAdvanced && (
        <div className="grid gap-3 rounded-lg border p-3 md:col-span-4 md:grid-cols-4" style={{ borderColor: "var(--border)" }}>
          <Field label="Coverage"><input aria-label="Coverage" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.defaultCoverage)} onChange={(event) => setDraft({ ...draft, defaultCoverage: editableText(event.target.value) })} /></Field>
          <Field label="b-values"><input aria-label="b-values" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.defaultBValues)} onChange={(event) => setDraft({ ...draft, defaultBValues: editableText(event.target.value) })} /></Field>
          <Field label="Dynamic timing"><input aria-label="Dynamic timing" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.defaultDynamicTiming)} onChange={(event) => setDraft({ ...draft, defaultDynamicTiming: editableText(event.target.value) })} /></Field>
          <NumberField label="Estimated scan time minutes" value={draft.estimatedScanTimeMinutes} positive onChange={(value) => setDraft({ ...draft, estimatedScanTimeMinutes: nullableNumber(value, true) })} />
        </div>
      )}
      {showAliases && (
        <div className="grid gap-3 rounded-lg border p-3 md:col-span-4" style={{ borderColor: "var(--border)" }}>
          {aliases.map((alias, index) => (
            <div key={index} className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
              <Field label="Scanner"><select aria-label={`Scanner alias scanner ${index + 1}`} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={alias.scannerId} onChange={(event) => updateAlias(index, { scannerId: Number(event.target.value) })}>{mriScanners.map((scanner) => <option key={scanner.id} value={scanner.id}>{scanner.name}</option>)}</select></Field>
              <Field label="Vendor sequence name"><input aria-label={`Vendor sequence name ${index + 1}`} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={alias.vendorSequenceName} onChange={(event) => updateAlias(index, { vendorSequenceName: event.target.value })} /></Field>
              <Field label="Alias notes"><input aria-label={`Alias notes ${index + 1}`} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(alias.notes)} onChange={(event) => updateAlias(index, { notes: editableText(event.target.value) })} /></Field>
              <button type="button" className="mt-6 h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }} onClick={() => setDraft({ ...draft, scannerAliases: aliases.filter((_, aliasIndex) => aliasIndex !== index) })}>Remove</button>
            </div>
          ))}
          <button type="button" disabled={!mriScanners.length} className="h-10 w-fit rounded-lg border px-3 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }} onClick={() => setDraft({ ...draft, scannerAliases: [...aliases, { scannerId: mriScanners[0].id, vendorSequenceName: "", notes: null }] })}>Add scanner name</button>
        </div>
      )}
      <FormActions saving={saving} saveLabel="Save MRI sequence" canSave={Boolean(draft.name.trim()) && aliasesValid} onSave={onSave} onCancel={onCancel} />
    </div></td></tr>
  );
}

function NumberField({ label, value, positive = false, onChange }: { label: string; value: number | null; positive?: boolean; onChange: (value: string) => void }) {
  return <Field label={label}><input aria-label={label} type="number" min={positive ? 1 : 0} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={numberText(value)} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function FormActions({ saving, saveLabel, canSave, onSave, onCancel }: { saving: boolean; saveLabel: string; canSave: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-end gap-2">
      <button type="button" disabled={!canSave || saving} onClick={onSave} className="h-10 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : saveLabel}</button>
      <button type="button" onClick={onCancel} className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Cancel</button>
    </div>
  );
}

function ProtocolingWorklist({ canAssign }: { canAssign: boolean }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(addDays(todayIso(), 7));
  const [modality, setModality] = useState<"" | "CT" | "MRI">("");
  const [protocolStatus, setProtocolStatus] = useState<"NOT_PROTOCOLLED" | "ASSIGNED" | "ALL">("NOT_PROTOCOLLED");
  const [search, setSearch] = useState("");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const filters = useMemo(() => ({
    dateFrom,
    dateTo,
    modality: modality || null,
    protocolStatus,
    search: nullableText(search),
  }), [dateFrom, dateTo, modality, protocolStatus, search]);

  const appointmentsQuery = useQuery({
    queryKey: ["doctor", "protocoling", "appointments", filters],
    queryFn: () => fetchDoctorProtocolingAppointments(filters),
    enabled: canAssign,
  });
  const protocolPolicyQuery = useQuery({
    queryKey: ["documents", "protocol-eligibility-policy"],
    queryFn: () => fetchRequestDocumentProtocolPolicy(),
    enabled: canAssign,
    staleTime: 60_000,
  });
  const appointmentDetailQuery = useQuery({
    queryKey: ["doctor", "protocoling", "appointments", selectedAppointmentId],
    queryFn: () => fetchDoctorProtocolingAppointmentDetail(selectedAppointmentId!),
    enabled: selectedAppointmentId !== null,
  });
  const protocolsQuery = useQuery({ queryKey: ["doctor", "protocol-library", "protocols"], queryFn: fetchProtocolLibraryProtocols, enabled: canAssign });
  const scannersQuery = useQuery({ queryKey: ["doctor", "protocol-library", "scanners"], queryFn: fetchProtocolLibraryScanners, enabled: canAssign });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["doctor", "protocoling"] }),
      queryClient.invalidateQueries({ queryKey: ["registrations"] }),
      queryClient.invalidateQueries({ queryKey: ["modality-worklist"] }),
      queryClient.invalidateQueries({ queryKey: ["modality", "protocol-assignment"] }),
      queryClient.invalidateQueries({ queryKey: ["appointment-manage-modal"] }),
    ]);
  };
  const createAssignmentMutation = useMutation({
    mutationFn: ({ appointmentId, payload }: { appointmentId: number; payload: ProtocolAssignmentPayload }) => createDoctorProtocolAssignment(appointmentId, payload),
    onSuccess: invalidate,
  });
  const updateAssignmentMutation = useMutation({
    mutationFn: ({ appointmentId, payload }: { appointmentId: number; payload: ProtocolAssignmentPayload }) => updateDoctorProtocolAssignment(appointmentId, payload),
    onSuccess: invalidate,
  });
  const clearAssignmentMutation = useMutation({
    mutationFn: (appointmentId: number) => cancelDoctorProtocolAssignment(appointmentId),
    onSuccess: invalidate,
  });

  const appointments = appointmentsQuery.data ?? [];
  const selectedAppointment = appointmentDetailQuery.data?.appointment ?? appointments.find((appointment) => appointment.appointmentId === selectedAppointmentId) ?? null;
  const selectedDetail = appointmentDetailQuery.data ?? null;
  const assignmentBusy = createAssignmentMutation.isPending || updateAssignmentMutation.isPending || clearAssignmentMutation.isPending;
  const closeAssignmentModal = () => {
    if (assignmentBusy) return;
    setSelectedAppointmentId(null);
    setAssignmentError(null);
  };
  const openAssignmentModal = (appointmentId: number) => {
    setAssignmentError(null);
    setSelectedAppointmentId(appointmentId);
  };
  const navigateWorklist = (direction: -1 | 1) => {
    if (selectedAppointmentId === null) return;
    const currentIndex = appointments.findIndex((item) => item.appointmentId === selectedAppointmentId);
    const target = currentIndex >= 0 ? appointments[currentIndex + direction] : null;
    if (!target) return;
    setAssignmentError(null);
    setSelectedAppointmentId(target.appointmentId);
  };
  const handleAssignmentSuccess = async (message: string, currentAppointmentId: number, assignNext: boolean) => {
    const currentIndex = appointments.findIndex((item) => item.appointmentId === currentAppointmentId);
    const next = assignNext && currentIndex >= 0 ? appointments[currentIndex + 1] : null;
    await invalidate();
    if (assignNext && next) {
      setSelectedAppointmentId(next.appointmentId);
    } else if (assignNext) {
      setSelectedAppointmentId(currentAppointmentId);
    } else {
      setSelectedAppointmentId(null);
    }
    setAssignmentError(null);
    pushToast({ type: "success", title: assignNext && !next ? `${message} No more matching appointments.` : message });
  };
  const handleAssignmentError = (error: unknown) => {
    setAssignmentError(error instanceof Error ? error.message : "Unable to save protocol assignment.");
  };

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Doctor Protocoling</p>
        <h2 className="mt-1 text-2xl font-semibold text-foreground">Protocoling Worklist</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: "var(--text-muted)" }}>Assign active CT/MRI protocol library versions to scheduled appointments.</p>
      </div>

      {!canAssign ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          You do not have permission to assign protocols.
        </div>
      ) : null}

      {protocolPolicyQuery.data?.requireRequestDocumentForProtocolQueue ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900" data-testid="protocol-request-document-policy">
          {t("doctor.protocols.requestDocumentPolicyNotice")}
        </div>
      ) : null}

      {canAssign ? <section className="grid gap-3 rounded-lg border p-4 md:grid-cols-3 lg:grid-cols-6" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-end gap-2 md:col-span-3">
          <button type="button" onClick={() => { setDateFrom(todayIso()); setDateTo(todayIso()); }} className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Today</button>
          <button type="button" onClick={() => { const tomorrow = addDays(todayIso(), 1); setDateFrom(tomorrow); setDateTo(tomorrow); }} className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Tomorrow</button>
          <button type="button" onClick={() => { setDateFrom(todayIso()); setDateTo(addDays(todayIso(), 7)); }} className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Next 7 days</button>
        </div>
        <label className="text-sm font-medium">From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></label>
        <label className="text-sm font-medium">To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></label>
        <label className="text-sm font-medium">Modality<select value={modality} onChange={(event) => setModality(event.target.value as "" | "CT" | "MRI")} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">All</option><option value="CT">CT</option><option value="MRI">MRI</option></select></label>
        <label className="text-sm font-medium">Protocol status<select value={protocolStatus} onChange={(event) => setProtocolStatus(event.target.value as "NOT_PROTOCOLLED" | "ASSIGNED" | "ALL")} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="NOT_PROTOCOLLED">Not protocolled</option><option value="ASSIGNED">Protocol assigned</option><option value="ALL">All</option></select></label>
        <label className="text-sm font-medium md:col-span-2">Search<input aria-label="Search protocoling appointments" value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} placeholder="Patient, MRN, accession" /></label>
      </section> : null}

      {!canAssign ? null : appointmentsQuery.isLoading ? (
        <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          Loading protocoling appointments...
        </div>
      ) : appointmentsQuery.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {appointmentsQuery.error instanceof Error ? appointmentsQuery.error.message : "Unable to load protocoling appointments."}
        </div>
      ) : appointments.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          No appointments need protocol assignment.
        </div>
      ) : (
        <SettingsTable emptyText="No appointments need protocol assignment." headers={["Date/time", "Patient", "Age/sex", "Modality", "Exam", "Category", "Notes", "Protocol status", "Assigned protocol", "Actions"]}>
          {appointments.map((appointment) => (
            <tr key={appointment.appointmentId} onClick={() => openAssignmentModal(appointment.appointmentId)} className="cursor-pointer hover:bg-slate-50">
              <Cell>{appointment.appointmentDate} {appointment.appointmentTime ?? ""}</Cell>
              <Cell>{protocolingPatientName(appointment)}</Cell>
              <Cell>{appointment.ageYears ?? "-"} / {appointment.sex ?? "-"}</Cell>
              <Cell>{appointment.modalityName ?? appointment.modalityCode}</Cell>
              <Cell>{appointment.examTypeName ?? "-"}</Cell>
              <Cell>{appointment.caseCategory ?? "-"}</Cell>
              <Cell><span className="block max-w-[16rem] truncate" title={appointment.clinicalNotes ?? undefined}>{appointment.clinicalNotes ?? "-"}</span></Cell>
              <Cell><div className="flex flex-wrap items-center gap-1"><ProtocolStatusBadge assigned={appointment.assignment !== null} />{appointment.modalitySafetyWorkflowType === "mri_primary_implant_screening" ? <MriPrimaryScreeningBadges result={appointment.mriPrimaryScreeningResult} /> : null}</div></Cell>
              <Cell>{appointment.assignment ? (appointment.assignment.freeTextProtocol ? "Free-text protocol" : `${appointment.assignment.protocolName ?? "Saved protocol"} v${appointment.assignment.versionNumber ?? "-"}`) + (appointment.assignment.scannerName ? ` · ${appointment.assignment.scannerName}` : "") : "-"}</Cell>
              <Cell><button type="button" onClick={(event) => { event.stopPropagation(); openAssignmentModal(appointment.appointmentId); }} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>{appointment.assignment ? "Change" : "Assign"}</button></Cell>
            </tr>
          ))}
        </SettingsTable>
      )}

      {selectedAppointment && (
        <ProtocolAssignmentModal
          key={selectedAppointment.appointmentId}
          appointment={selectedAppointment}
          detail={selectedDetail}
          loading={appointmentDetailQuery.isLoading || !selectedDetail}
          error={assignmentError}
          protocols={protocolsQuery.data ?? []}
          scanners={scannersQuery.data ?? []}
          protocolsLoading={protocolsQuery.isLoading}
          saving={assignmentBusy}
          worklistPosition={appointments.findIndex((item) => item.appointmentId === selectedAppointment.appointmentId) + 1}
          worklistTotal={appointments.length}
          onNavigate={(direction) => navigateWorklist(direction)}
          onExamTypeUpdated={(examTypeId, examTypeName) => {
            queryClient.setQueryData<DoctorProtocolingAppointment[]>(["doctor", "protocoling", "appointments", filters], (current) => current?.map((item) => item.appointmentId === selectedAppointment.appointmentId ? { ...item, examTypeId, examTypeName } : item));
            queryClient.setQueryData<DoctorProtocolingAppointmentDetail>(["doctor", "protocoling", "appointments", selectedAppointment.appointmentId], (current) => current ? { ...current, appointment: { ...current.appointment, examTypeId, examTypeName } } : current);
          }}
           onRequiresReportUpdated={(requiresReport) => {
             queryClient.setQueryData<DoctorProtocolingAppointment[]>(["doctor", "protocoling", "appointments", filters], (current) => current?.map((item) => item.appointmentId === selectedAppointment.appointmentId ? { ...item, requiresReport } : item));
             queryClient.setQueryData<DoctorProtocolingAppointmentDetail>(["doctor", "protocoling", "appointments", selectedAppointment.appointmentId], (current) => current ? { ...current, appointment: { ...current.appointment, requiresReport } } : current);
           }}
          onClose={closeAssignmentModal}
          onSave={(payload, assignNext) => {
            const mutationPayload = { appointmentId: selectedAppointment.appointmentId, payload };
            setAssignmentError(null);
            const mutation = selectedAppointment.assignment ? updateAssignmentMutation : createAssignmentMutation;
            mutation.mutate(mutationPayload, {
              onSuccess: () => void handleAssignmentSuccess(selectedAppointment.assignment ? "Protocol assignment updated." : "Protocol assigned.", selectedAppointment.appointmentId, assignNext),
              onError: handleAssignmentError,
            });
          }}
          onClear={() => {
            if (!selectedAppointment.assignment) return;
            if (!window.confirm("Clear this protocol assignment?")) return;
            setAssignmentError(null);
            clearAssignmentMutation.mutate(selectedAppointment.appointmentId, {
              onSuccess: () => void handleAssignmentSuccess("Protocol assignment cleared.", selectedAppointment.appointmentId, false),
              onError: handleAssignmentError,
            });
          }}
        />
      )}
    </section>
  );
}

function ProtocolAssignmentModal({
  appointment,
  detail,
  loading,
  error,
  protocols,
  scanners,
  protocolsLoading,
  saving,
  worklistPosition,
  worklistTotal,
  onNavigate,
  onExamTypeUpdated,
  onRequiresReportUpdated,
  onSave,
  onClear,
  onClose,
}: {
  appointment: DoctorProtocolingAppointment;
  detail: DoctorProtocolingAppointmentDetail | null;
  loading: boolean;
  error: string | null;
  protocols: ProtocolLibraryProtocol[];
  scanners: ImagingScanner[];
  protocolsLoading: boolean;
  saving: boolean;
  worklistPosition: number;
  worklistTotal: number;
  onNavigate: (direction: -1 | 1) => void;
  onExamTypeUpdated: (examTypeId: number, examTypeName: string) => void;
  onRequiresReportUpdated: (requiresReport: boolean) => void;
  onSave: (payload: ProtocolAssignmentPayload, assignNext: boolean) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const existing = appointment.assignment;
  const activeProtocols = protocols.filter((protocol) => protocol.isActive && protocol.modality === appointment.modalityCode && protocol.activeVersionId && protocol.activeVersionStatus === "ACTIVE");
  const matchingScanners = scanners.filter((scanner) => scanner.isActive && scanner.modality === appointment.modalityCode);
  const [protocolId, setProtocolId] = useState(existing?.protocolId ? String(existing.protocolId) : "");
  const [scannerId, setScannerId] = useState(existing?.scannerId ? String(existing.scannerId) : "");
  const [protocolNotes, setProtocolNotes] = useState(existing?.protocolNotes ?? "");
  const [contrastNotes, setContrastNotes] = useState(existing?.contrastNotes ?? "");
  const [freeTextProtocol, setFreeTextProtocol] = useState(existing?.freeTextProtocol ?? "");
  const [protocolModeOverride, setProtocolModeOverride] = useState<"saved" | "free-text" | null>(existing ? (existing.freeTextProtocol ? "free-text" : "saved") : null);
  const [modeTouched, setModeTouched] = useState(false);
  const protocolMode = protocolModeOverride ?? (modeTouched ? "free-text" : activeProtocols.length > 0 ? "saved" : "free-text");
  const [protocolSearch, setProtocolSearch] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(5);
  const [selectedHistoryModalities, setSelectedHistoryModalities] = useState<string[]>([]);
  const [oldPacsPatientId, setOldPacsPatientId] = useState("");
  const [reconciliationStudy,setReconciliationStudy]=useState<PatientIdentityReconciliationTarget|null>(null);
  const [reconciliationConfirmed,setReconciliationConfirmed]=useState(false);
  const [annotationDirty, setAnnotationDirty] = useState(false);
  const [documentExpanded, setDocumentExpanded] = useState(false);
  const [additionalInstructionsOpen, setAdditionalInstructionsOpen] = useState(Boolean(existing?.scannerId || existing?.protocolNotes || existing?.contrastNotes));
  const [examEditorOpen, setExamEditorOpen] = useState(false);
  const [examTypeDraftId, setExamTypeDraftId] = useState(String(appointment.examTypeId ?? ""));
  const [examTypeSearch, setExamTypeSearch] = useState("");
  const [examTypeOverride, setExamTypeOverride] = useState<{ appointmentId: number; id: number; name: string } | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [reportEditorOpen, setReportEditorOpen] = useState(false);
  const [reportDraft, setReportDraft] = useState(appointment.requiresReport);
  const [reportOverride, setReportOverride] = useState<{ appointmentId: number; value: boolean } | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState({ right: 8, bottom: 56 });
  const actionMenuAnchorRef = useRef<HTMLDivElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const title = existing ? "Change assigned protocol" : "Assign protocol";
  const noActiveProtocolsMessage = `No active ${appointment.modalityCode} protocols are available. Enter a free-text protocol.`;
  const selectedProtocol = activeProtocols.find((protocol) => String(protocol.id) === protocolId) ?? null;
  const protocolOptionLabel = (protocol: ProtocolLibraryProtocol) => `${protocol.name} · ${protocol.modality} · v${protocol.activeVersionNumber}`;
  const selectedProtocolLabel = selectedProtocol ? protocolOptionLabel(selectedProtocol) : protocolSearch;
  const selectedScannerName = matchingScanners.find((scanner) => String(scanner.id) === scannerId)?.name ?? null;
  const selectedVersionId = selectedProtocol?.activeVersionId ?? null;
  const examTypesQuery = useV2ExamTypes(appointment.modalityId);
  const examTypeOptions = useMemo(() => {
    const search = examTypeSearch.trim().toLowerCase();
    return (examTypesQuery.data ?? []).filter((examType) => examType.isActive && Number(examType.modalityId) === Number(appointment.modalityId) && (!search || [examType.name, examType.nameEn, examType.nameAr, examType.code].filter(Boolean).some((value) => String(value).toLowerCase().includes(search))));
  }, [appointment.modalityId, examTypeSearch, examTypesQuery.data]);
  const selectedExamType = (examTypesQuery.data ?? []).find((examType) => String(examType.id) === examTypeDraftId) ?? null;
  const displayedExamTypeId = examTypeOverride?.appointmentId === appointment.appointmentId ? examTypeOverride.id : appointment.examTypeId;
  const displayedExamTypeName = examTypeOverride?.appointmentId === appointment.appointmentId ? examTypeOverride.name : appointment.examTypeName;
  const examTypeUpdateMutation = useMutation({
    mutationFn: () => rescheduleV2Booking(appointment.appointmentId, {
      bookingDate: appointment.appointmentDate,
      bookingTime: appointment.appointmentTime,
      examTypeId: Number(examTypeDraftId),
    }),
    onSuccess: async () => {
      const updatedExamType = selectedExamType;
      if (!updatedExamType) return;
      const updatedExamTypeName = updatedExamType.nameEn || updatedExamType.name;
      setExamTypeOverride({ appointmentId: appointment.appointmentId, id: updatedExamType.id, name: updatedExamTypeName });
      onExamTypeUpdated(updatedExamType.id, updatedExamTypeName);
      setExamEditorOpen(false);
      setExamTypeSearch("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["doctor", "protocoling"] }),
        queryClient.invalidateQueries({ queryKey: ["doctor", "protocoling", "appointment-details", appointment.appointmentId] }),
        queryClient.invalidateQueries({ queryKey: ["appointment-manage-modal", appointment.appointmentId] }),
        queryClient.invalidateQueries({ queryKey: ["doctor", "protocol-library", "protocols"] }),
        queryClient.invalidateQueries({ queryKey: ["modality-worklist"] }),
        queryClient.invalidateQueries({ queryKey: ["registrations"] }),
        queryClient.invalidateQueries({ queryKey: ["queue"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
      ]);
      pushToast({ type: "success", title: "Examination type updated.", message: "The appointment date and time were kept unchanged." });
    },
  });
  const reportUpdateMutation = useMutation({
    mutationFn: () => updateDoctorProtocolReportRequirement(appointment.appointmentId, reportDraft),
    onSuccess: async (result) => {
      const updatedRequiresReport = result.booking.requiresReport ?? reportDraft;
      setReportOverride({ appointmentId: appointment.appointmentId, value: updatedRequiresReport });
      onRequiresReportUpdated(updatedRequiresReport);
      setReportDraft(updatedRequiresReport);
      setReportEditorOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["doctor", "protocoling"] }),
        queryClient.invalidateQueries({ queryKey: ["doctor", "protocoling", "appointment-details", appointment.appointmentId] }),
        queryClient.invalidateQueries({ queryKey: ["appointment-manage-modal", appointment.appointmentId] }),
        queryClient.invalidateQueries({ queryKey: ["modality-worklist"] }),
        queryClient.invalidateQueries({ queryKey: ["registrations"] }),
        queryClient.invalidateQueries({ queryKey: ["queue"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
      ]);
      pushToast({ type: "success", title: "Report requirement updated." });
    },
  });
  const selectedVersionQuery = useQuery({
    queryKey: ["doctor", "protocol-library", "protocol-version-preview", selectedVersionId],
    queryFn: () => fetchProtocolLibraryVersionDetail(selectedVersionId!),
    enabled: selectedVersionId !== null && protocolMode === "saved",
  });
  const historyQuery = useQuery({
    queryKey: ["doctor", "protocoling", "history", appointment.patientId, appointment.appointmentId],
    queryFn: () => fetchProtocolingPatientHistory(appointment.appointmentId),
    enabled: historyOpen,
    refetchInterval: (query) => query.state.data?.items.some((item) => item.reconciliation?.status === "queued" || item.reconciliation?.status === "processing") ? 3_000 : false,
  });
  const historicalCandidatesQuery = useQuery({
    queryKey: ["doctor", "protocoling", "historical-pacs-candidates", appointment.patientId],
    queryFn: () => fetchProtocolingHistoricalPacsCandidates(appointment.appointmentId),
    enabled: historyOpen,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => hasActivePatientIdentityReconciliation(query.state.data?.historicalCandidates) ? 3_000 : false,
  });
  const oldPacsPatientIdMutation = useMutation({
    mutationFn: (patientId: string) => searchProtocolingHistoricalPacsPatientId(appointment.appointmentId, patientId),
  });
  const reconciliationMutation=useMutation({mutationFn:()=>requestProtocolingPatientIdentityReconciliation(appointment.appointmentId,reconciliationStudy!.studyInstanceUid,reconciliationStudy!.accessionNumber),onSuccess:async()=>{const manualSearchPatientId=reconciliationStudy?.source==="manual_candidate"?reconciliationStudy.manualSearchPatientId:undefined;setReconciliationStudy(null);setReconciliationConfirmed(false);await Promise.all([queryClient.invalidateQueries({queryKey:["doctor","protocoling","history",appointment.patientId,appointment.appointmentId]}),queryClient.invalidateQueries({queryKey:["doctor","protocoling","historical-pacs-candidates",appointment.patientId]})]);if(manualSearchPatientId)oldPacsPatientIdMutation.mutate(manualSearchPatientId);},});
  const historyItems = historyQuery.data?.items ?? [];
  const automaticHistoricalCandidates = historicalCandidatesQuery.data?.historicalCandidates ?? [];
  const hideAutomaticHistoricalCandidatesSection = automaticHistoricalCandidates.length > 0 && !automaticHistoricalCandidates.some((candidate) => candidate.studies.some((study) => !shouldHideHistoricalCandidateStudy(study)));
  const historicalPacsIndexStatus = historicalCandidatesQuery.data?.historicalPacsIndexStatus ?? historyQuery.data?.historicalPacsIndexStatus;
  const historyModalities = useMemo(() => [...new Set(historyItems.flatMap((item) => item.modalities))].sort(), [historyItems]);
  const filteredHistory = selectedHistoryModalities.length ? historyItems.filter((item) => item.modalities.some((modality) => selectedHistoryModalities.includes(modality))) : historyItems;
  const printableSheet = doctorAssignmentPrintSheet({
    appointment,
    detail,
    selectedProtocol,
    selectedVersionDetail: selectedVersionQuery.data ?? null,
    selectedScannerName,
    protocolNotes,
    contrastNotes,
    freeTextProtocol,
  });
  const formDirty = modeTouched || protocolId !== String(existing?.protocolId ?? "") || scannerId !== String(existing?.scannerId ?? "") || protocolNotes !== (existing?.protocolNotes ?? "") || contrastNotes !== (existing?.contrastNotes ?? "") || freeTextProtocol !== (existing?.freeTextProtocol ?? "");
  const hasUnsavedChanges = formDirty || annotationDirty;
  const requestClose = useCallback(() => { if (hasUnsavedChanges && !window.confirm("You have unsaved changes. Leave this appointment without saving?")) return; onClose(); }, [hasUnsavedChanges, onClose]);
  const requestNavigate = useCallback((direction: -1 | 1) => {
    if (hasUnsavedChanges && !window.confirm("You have unsaved changes. Leave this appointment without saving?")) return;
    onNavigate(direction);
  }, [hasUnsavedChanges, onNavigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && actionMenuOpen) { event.preventDefault(); setActionMenuOpen(false); return; }
      if (event.key === "Escape" && !saving) requestClose();
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName) && !(event.target as HTMLElement).isContentEditable) {
        if (event.key === "ArrowLeft" && worklistPosition > 1) { event.preventDefault(); requestNavigate(-1); }
        if (event.key === "ArrowRight" && worklistPosition > 0 && worklistPosition < worklistTotal) { event.preventDefault(); requestNavigate(1); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actionMenuOpen, requestClose, requestNavigate, saving, worklistPosition, worklistTotal]);

  useEffect(() => {
    if (!actionMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!actionMenuAnchorRef.current?.contains(target) && !actionMenuRef.current?.contains(target)) setActionMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [actionMenuOpen]);

  const payload = (): ProtocolAssignmentPayload => ({
    protocolId: protocolMode === "saved" && protocolId ? Number(protocolId) : null,
    scannerId: scannerId ? Number(scannerId) : null,
    protocolNotes: nullableText(protocolNotes),
    contrastNotes: nullableText(contrastNotes),
    freeTextProtocol: protocolMode === "free-text" ? nullableText(freeTextProtocol) : null,
    status: "ASSIGNED",
  });
  const hasMoreProtocolActions = Boolean(printableSheet || existing);
  const displayedRequiresReport = reportOverride?.appointmentId === appointment.appointmentId ? reportOverride.value : appointment.requiresReport;
  const toggleActionMenu = () => {
    if (actionMenuOpen) {
      setActionMenuOpen(false);
      return;
    }
    const rect = actionMenuAnchorRef.current?.getBoundingClientRect();
    if (rect) setActionMenuPosition({ right: Math.max(8, window.innerWidth - rect.right), bottom: Math.max(8, window.innerHeight - rect.top + 8) });
    setActionMenuOpen(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/45 p-2 sm:p-4" onClick={() => { if (!saving) requestClose(); }} role="presentation" data-testid="protocol-assignment-modal-backdrop">
      <section
        className="relative flex h-[94vh] w-[96vw] max-w-[1800px] min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-20 shrink-0 border-b bg-background px-3 py-2.5 sm:px-4" style={{ borderColor: "var(--border)" }}>
          <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-[minmax(220px,1.05fr)_minmax(0,1.65fr)_minmax(300px,1.45fr)] lg:items-center">
            <div className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <h3 className="truncate text-lg font-bold leading-tight text-foreground">{appointment.patientArabicName || appointment.patientEnglishName || `Patient ${appointment.patientId}`}</h3>
                {appointment.patientEnglishName && appointment.patientEnglishName !== appointment.patientArabicName ? <p className="truncate text-sm text-muted-foreground">{appointment.patientEnglishName}</p> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                <span><span className="font-semibold text-muted-foreground">Age / sex</span> <span className="font-semibold text-foreground">{appointment.ageYears ?? "—"} / {appointment.sex ?? "—"}</span></span>
                <span dir="ltr"><span className="font-semibold text-muted-foreground">Primary ID</span> <span className="font-semibold text-foreground">{appointment.patientDicomId || "—"}</span></span>
                <span dir="ltr"><span className="font-semibold text-muted-foreground">MRN</span> <span className="font-semibold text-foreground">{appointment.patientMrn || "—"}</span></span>
              </div>
              </div>
              <div className="relative flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span dir="ltr"><span className="font-semibold text-muted-foreground">Appointment</span> <span className="font-semibold text-foreground">{formatDateLy(appointment.appointmentDate)} · {appointment.appointmentTime?.slice(0, 5) || "—"}</span></span>
                <span><span className="font-semibold text-muted-foreground">Modality</span> <span className="font-semibold text-foreground">{appointment.modalityName || appointment.modalityCode}</span></span>
                <span className="inline-flex min-w-0 items-center gap-1"><span className="font-semibold text-muted-foreground">Examination</span> <span className="truncate font-semibold text-foreground">{displayedExamTypeName || "—"}</span><button type="button" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" onClick={() => { setExamTypeDraftId(String(displayedExamTypeId ?? "")); setExamTypeSearch(""); setExamEditorOpen((current) => !current); }} disabled={examTypesQuery.isLoading || examTypeUpdateMutation.isPending} aria-label="Edit examination type" title="Edit examination type"><Pencil size={13} aria-hidden="true" /></button></span>
                <span className="inline-flex items-center gap-1"><span className="font-semibold text-muted-foreground">Category</span><ProtocolCategoryBadge category={appointment.caseCategory} /></span>
              {appointment.modalitySafetyWorkflowType === "mri_primary_implant_screening" ? <MriPrimaryScreeningBadges result={appointment.mriPrimaryScreeningResult} /> : null}
              <span className="relative inline-flex items-center gap-1"><button type="button" className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${displayedRequiresReport ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-300 bg-slate-100 text-slate-700"}`} onClick={() => { setReportDraft(displayedRequiresReport); setReportEditorOpen((current) => !current); }} disabled={reportUpdateMutation.isPending} aria-label="Edit report requirement" aria-expanded={reportEditorOpen}>{displayedRequiresReport ? "Report required" : "No report required"}<Pencil size={11} aria-hidden="true" /></button>
                {reportEditorOpen ? <div className="absolute start-0 top-full z-40 mt-2 w-56 rounded-lg border bg-background p-3 shadow-xl" style={{ borderColor: "var(--border)" }} role="dialog" aria-label="Edit report requirement">
                  <p className="text-xs font-semibold">Report required</p>
                  <div className="mt-2 space-y-1 text-xs"><label className="flex items-center gap-2"><input type="radio" name={`requires-report-${appointment.appointmentId}`} checked={reportDraft} onChange={() => setReportDraft(true)} />Yes</label><label className="flex items-center gap-2"><input type="radio" name={`requires-report-${appointment.appointmentId}`} checked={!reportDraft} onChange={() => setReportDraft(false)} />No</label></div>
                  {reportUpdateMutation.isError ? <p className="mt-2 text-xs text-red-700" role="alert">{reportUpdateMutation.error instanceof Error ? reportUpdateMutation.error.message : "Unable to update report requirement."}</p> : null}
                  <div className="mt-3 flex justify-end gap-2"><button type="button" className="rounded-md border px-2.5 py-1.5 text-xs font-semibold" onClick={() => { setReportDraft(displayedRequiresReport); setReportEditorOpen(false); }} disabled={reportUpdateMutation.isPending}>Cancel</button><button type="button" className="rounded-md bg-teal-700 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50" onClick={() => reportUpdateMutation.mutate()} disabled={reportUpdateMutation.isPending || reportDraft === displayedRequiresReport}>{reportUpdateMutation.isPending ? "Updating..." : "Update"}</button></div>
                </div> : null}
              </span>
              {examEditorOpen ? <div className="absolute start-0 top-full z-40 mt-2 max-w-xl rounded-lg border bg-background p-3 shadow-lg" style={{ borderColor: "var(--border)" }} role="dialog" aria-label="Edit examination type">
                <label className="block text-xs font-semibold">Search examination types<input aria-label="Search examination types" value={examTypeSearch} onChange={(event) => setExamTypeSearch(event.target.value)} className={`${inputClass()} mt-1`} placeholder="Search active exam types" /></label>
                <label className="mt-2 block text-xs font-semibold">Examination type<select aria-label="Examination type" value={examTypeDraftId} onChange={(event) => setExamTypeDraftId(event.target.value)} className={inputClass()} disabled={examTypesQuery.isLoading}>
                  <option value="">Select examination type</option>
                  {examTypeOptions.map((examType) => <option key={examType.id} value={examType.id}>{examType.nameEn || examType.name}{examType.code ? ` (${examType.code})` : ""}</option>)}
                </select></label>
                {examTypesQuery.isError ? <p className="mt-2 text-xs text-red-700" role="alert">Unable to load examination types.</p> : null}
                {examTypeUpdateMutation.isError ? <p className="mt-2 text-xs text-red-700" role="alert">{examTypeUpdateMutation.error instanceof Error ? examTypeUpdateMutation.error.message : "Unable to update examination type."}</p> : null}
                <div className="mt-3 flex justify-end gap-2"><button type="button" className="rounded-md border px-2.5 py-1.5 text-xs font-semibold" onClick={() => setExamEditorOpen(false)} disabled={examTypeUpdateMutation.isPending}>Cancel</button><button type="button" className="rounded-md bg-teal-700 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50" onClick={() => examTypeUpdateMutation.mutate()} disabled={!selectedExamType || String(selectedExamType.id) === String(displayedExamTypeId ?? "") || examTypeUpdateMutation.isPending}>{examTypeUpdateMutation.isPending ? "Updating..." : "Update exam"}</button></div>
              </div> : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5 text-xs md:col-span-2 lg:col-span-1 lg:justify-end">
              <div className="flex items-center gap-1 rounded-md border px-1 py-0.5" style={{ borderColor: "var(--border)" }}>
                <button type="button" onClick={() => requestNavigate(-1)} disabled={saving || worklistPosition <= 1} className="inline-flex h-7 w-7 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous appointment" title="Previous appointment"><ChevronLeft size={15} aria-hidden="true" /></button>
                {worklistPosition > 0 ? <span className="whitespace-nowrap px-1 text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>{worklistPosition} of {worklistTotal}</span> : null}
                <button type="button" onClick={() => requestNavigate(1)} disabled={saving || worklistPosition <= 0 || worklistPosition >= worklistTotal} className="inline-flex h-7 w-7 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next appointment" title="Next appointment"><ChevronRight size={15} aria-hidden="true" /></button>
              </div>
              <button type="button" onClick={() => setHistoryOpen((current) => { const next = !current; if (next) { setSelectedHistoryModalities([]); setHistoryLimit(5); } return next; })} disabled={saving} className="rounded border px-2 py-1.5 font-semibold">Patient history</button>
              <button type="button" onClick={() => setDetailsOpen(true)} disabled={saving} className="rounded border px-2 py-1.5 font-semibold" aria-label="Open appointment and patient details">Details</button>
              <button type="button" onClick={requestClose} disabled={saving} className="rounded border p-1.5 font-semibold" aria-label="Close" title="Close"><X size={16} aria-hidden="true" /></button>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="mt-4 rounded-lg border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            Loading appointment protocol details...
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-1 sm:p-2">
            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-1 grid min-h-0 flex-1 gap-2 overflow-hidden lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
              <div className={`min-h-0 min-w-0 overflow-hidden ${documentExpanded ? "lg:col-span-2" : ""}`}>
                <RequestDocumentsPanel appointmentId={appointment.appointmentId} patientId={appointment.patientId} appointmentRefType="v2_booking" title="Appointment request documents" layout="workspace" expanded={documentExpanded} onExpandedChange={setDocumentExpanded} enableAnnotations onAnnotationDirtyChange={setAnnotationDirty} />
              </div>
               {!documentExpanded ? (historyOpen ? <aside className="min-h-0 overflow-y-auto rounded-xl border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
                <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">Patient history</h4><button type="button" className="text-xs font-semibold text-accent" onClick={() => setHistoryOpen(false)}>Back to protocol</button></div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <a href={`/api/doctor/protocoling/appointments/${appointment.appointmentId}/open-sonicdicom?scope=patient`} target="_blank" rel="noopener noreferrer" className={`rounded border px-2 py-1.5 text-xs font-semibold ${appointment.patientDicomId ? "" : "pointer-events-none opacity-40"}`} title={appointment.patientDicomId ? undefined : "Primary patient identifier is unavailable."} aria-disabled={!appointment.patientDicomId}>Patient studies</a>
                  <a href={appointment.patientDicomId ? buildRadiantPacsTagUrl("00100020", appointment.patientDicomId) : undefined} className={`rounded border px-2 py-1.5 text-xs font-semibold ${appointment.patientDicomId ? "" : "pointer-events-none opacity-40"}`} title={appointment.patientDicomId ? "RadiAnt must be installed on this workstation." : "Primary patient identifier is unavailable."} aria-disabled={!appointment.patientDicomId}>Patient studies in RadiAnt</a>
                </div>
                 {historyQuery.isLoading ? <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />Loading RISpro and PACS history…</div> : historyQuery.error ? <p className="mt-4 text-xs text-red-700">Unable to load patient history.</p> : <>
                  {historyQuery.data?.pacsStatus === "unavailable" ? <p className="mt-3 text-xs text-muted-foreground">PACS availability could not be checked. RISpro history is still shown.</p> : null}
                  {historyQuery.data?.pacsStatus === "patient_id_unavailable" ? <p className="mt-3 text-xs text-muted-foreground">PACS history could not be checked because Patient ID is unavailable.</p> : null}
                  <div className="mt-3 flex flex-wrap gap-1" aria-label="History modality filters"><button type="button" onClick={() => setSelectedHistoryModalities([])} aria-pressed={selectedHistoryModalities.length === 0} className={`rounded-full px-3 py-1.5 text-xs font-medium ${selectedHistoryModalities.length === 0 ? "border-accent/25 bg-accent/10 text-accent shadow-sm ring-1 ring-accent/15" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>All</button>{historyModalities.map((modality) => <button key={modality} type="button" onClick={() => setSelectedHistoryModalities((current) => current.includes(modality) ? current.filter((entry) => entry !== modality) : [...current, modality])} aria-pressed={selectedHistoryModalities.includes(modality)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${selectedHistoryModalities.includes(modality) ? "border-accent/25 bg-accent/10 text-accent shadow-sm ring-1 ring-accent/15" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>{modality}</button>)}</div>
                  <div className="mt-3 space-y-2">{filteredHistory.slice(0, historyLimit).map((history) => {
                    const firstModality = history.modalities[0];
                    const accent = firstModality === "CT" ? "border-l-sky-200" : firstModality === "MRI" ? "border-l-violet-200" : firstModality === "US" ? "border-l-emerald-200" : "border-l-slate-200";
                    const sourceClass = history.source === "rispro_pacs" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : history.source === "rispro_only" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-sky-200 bg-sky-50 text-sky-700";
                    const sourceLabel = history.source === "rispro_pacs" ? "PACS" : history.source === "rispro_only" ? "Not in PACS" : "PACS only";
                    const showSource = historyQuery.data?.pacsStatus === "available" || history.source !== "rispro_only";
                    const hasPacsStudy = history.source === "rispro_pacs" || history.source === "pacs_only";
                    const reconciliationUi = patientIdentityReconciliationUiState(history.reconciliation);
                    const canReconcile = Boolean(historyQuery.data?.canReconcilePatientIdentity && hasPacsStudy && history.studyInstanceUid?.trim() && history.historicalPatientId?.trim() && historyQuery.data.currentPatient?.patientId?.trim() && history.historicalPatientId.trim() !== historyQuery.data.currentPatient.patientId.trim() && reconciliationUi.action);
                    return <div key={`${history.appointmentId ?? "pacs"}-${history.orthancStudyId ?? history.accessionNumber}`} className={`rounded-lg border border-border border-l-2 p-2 text-xs ${accent}`}><p className="text-sm font-semibold">{history.date ? formatDateLy(history.date) : "Unknown date"} · {history.description ?? "Study"}</p>{history.accessionNumber ? <p className="mt-1 text-muted-foreground">Accession: {history.accessionNumber}</p> : null}{history.identityDiscrepancy === "patient_id_mismatch" ? <p className="mt-1 font-semibold text-amber-700">Study UID matches, but the PACS Patient ID differs from this RISpro patient.</p> : null}{reconciliationUi.status ? <p className={`mt-1 font-semibold ${reconciliationUi.statusClassName}`}>{reconciliationUi.status}</p> : null}<div className="mt-2 flex flex-wrap gap-1">{history.modalities.map((modality) => <span key={modality} className={`rounded-full border px-1.5 py-0.5 text-xs ${modality === "CT" ? "border-sky-200 bg-sky-50 text-sky-700" : modality === "MRI" ? "border-violet-200 bg-violet-50 text-violet-700" : modality === "US" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{modality}</span>)}{showSource ? <span className={`rounded-full border px-1.5 py-0.5 text-xs ${sourceClass}`}>{sourceLabel}</span> : null}</div><div className="mt-2 flex flex-wrap gap-1">{hasPacsStudy && history.accessionNumber ? <a href={history.appointmentId ? `/api/doctor/protocoling/appointments/${history.appointmentId}/open-sonicdicom?scope=study` : `/api/doctor/protocoling/history/open-sonicdicom?accession=${encodeURIComponent(history.accessionNumber)}`} target="_blank" rel="noopener noreferrer" className="rounded border px-1.5 py-1 text-xs font-semibold">SonicDICOM</a> : null}{hasPacsStudy && history.accessionNumber ? <a href={buildRadiantPacsTagUrl("00080050", history.accessionNumber)} className="rounded border px-1.5 py-1 text-xs font-semibold">RadiAnt</a> : null}{history.appointmentId && history.reportAvailable ? <a href={`/api/doctor/protocoling/appointments/${history.appointmentId}/open-report`} target="_blank" rel="noopener noreferrer" className="rounded border px-1.5 py-1 text-xs font-semibold">Open report</a> : null}{canReconcile ? <Button size="sm" variant="secondary" onClick={() => setReconciliationStudy({ studyInstanceUid: history.studyInstanceUid!.trim(), accessionNumber: history.accessionNumber, date: history.date, description: history.description, historicalPatientId: history.historicalPatientId ?? null, historicalPatientName: history.historicalPatientName ?? null, historicalPatientBirthDate: history.historicalPatientBirthDate ?? null, source: "history" })}>{reconciliationUi.action}</Button> : null}</div></div>;
                  })}</div>
                </>}
                 {filteredHistory.length > historyLimit ? <button type="button" className="mt-3 text-xs font-semibold text-accent" onClick={() => setHistoryLimit((current) => current + 10)}>Show more</button> : null}
                  {!hideAutomaticHistoricalCandidatesSection ? <section className="mt-4 border-t border-border pt-3" aria-label="Possible older PACS studies">
                    <div className="flex flex-wrap items-center gap-2"><h5 className="text-sm font-semibold">Possible older PACS studies</h5>{historicalCandidatesQuery.isFetching && historicalCandidatesQuery.data ? <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status"><span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />Refreshing old PACS records…</span> : null}</div>
                    <p className="mt-1 text-xs text-muted-foreground">Possible studies for this patient under an older Patient ID. Verify the patient before use.</p>
                   {historicalPacsIndexStatus === "stale" || historicalPacsIndexStatus === "unavailable" ? <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">The local PACS index is not current. Existing candidates are shown, but absence is not proof that a study is missing from PACS.</p> : null}
                    {historicalCandidatesQuery.isLoading && !historicalCandidatesQuery.data ? <div className="mt-3 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950" role="status" aria-live="polite"><div className="flex items-center gap-2 font-semibold"><span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />Searching old PACS records…</div><p className="mt-1 text-xs font-medium">Patient history above is already available.</p></div> : null}
                    {historicalCandidatesQuery.isError ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"><p className="font-semibold">Old PACS search unavailable.</p><p className="mt-1">Patient history above is still available.</p><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => historicalCandidatesQuery.refetch()}>Retry historical search</Button></div> : null}
                   {automaticHistoricalCandidates.length ? <div className="mt-3"><HistoricalPacsCandidates candidates={automaticHistoricalCandidates} canReconcilePatientIdentity={Boolean(historyQuery.data?.canReconcilePatientIdentity)} currentPatientId={historyQuery.data?.currentPatient?.patientId ?? null} source="automatic_candidate" onReconcile={setReconciliationStudy} /></div> : null}
                    {historicalCandidatesQuery.data && historicalCandidatesQuery.data.historicalCandidates.length === 0 && !historicalCandidatesQuery.isError ? <p className="mt-3 text-xs text-muted-foreground">No possible older PACS studies found.</p> : null}
                  <form className="mt-3 flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (oldPacsPatientId.trim()) oldPacsPatientIdMutation.mutate(oldPacsPatientId.trim()); }}>
                    <label className="min-w-0 flex-1 text-xs font-semibold">Search old PACS Patient ID<Input aria-label="Old PACS Patient ID" className="mt-1 w-full" value={oldPacsPatientId} onChange={(event) => setOldPacsPatientId(event.target.value)} maxLength={256} /></label>
                    <Button type="submit" variant="outline" size="sm" disabled={!oldPacsPatientId.trim() || oldPacsPatientIdMutation.isPending}>{oldPacsPatientIdMutation.isPending ? "Searching..." : "Search"}</Button>
                  </form>
                  {oldPacsPatientIdMutation.isError ? <p className="mt-2 text-xs text-red-700">Unable to search Authoritative Orthanc for that Patient ID.</p> : null}
                  {oldPacsPatientIdMutation.isSuccess ? <div className="mt-3"><HistoricalPacsCandidates candidates={oldPacsPatientIdMutation.data} canReconcilePatientIdentity={Boolean(historyQuery.data?.canReconcilePatientIdentity)} currentPatientId={historyQuery.data?.currentPatient?.patientId ?? null} source="manual_candidate" manualSearchPatientId={oldPacsPatientIdMutation.variables} onReconcile={setReconciliationStudy} /></div> : null}
                </section> : null}
               </aside> : <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
                 <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {existing && <div className="mb-3 rounded-lg border p-2" style={{ borderColor: "var(--border)" }}><p className="text-[10px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Current assignment</p><p className="mt-1 text-sm font-semibold">{existing.freeTextProtocol ? "Free-text protocol" : `${existing.protocolName ?? "Saved protocol"} v${existing.versionNumber ?? "-"}`}{existing.scannerName ? ` · ${existing.scannerName}` : ""}</p></div>}
                <div className="mb-3 flex rounded-lg border p-1" role="radiogroup" aria-label="Protocol entry mode" style={{ borderColor: "var(--border)" }}>
                  <button type="button" role="radio" aria-checked={protocolMode === "saved"} onClick={() => { setModeTouched(true); setProtocolModeOverride("saved"); }} className={`flex-1 rounded px-2 py-1.5 text-xs font-semibold ${protocolMode === "saved" ? "bg-accent/10 text-accent" : "text-muted-foreground"}`}>Saved protocol</button>
                  <button type="button" role="radio" aria-checked={protocolMode === "free-text"} onClick={() => { setModeTouched(true); setProtocolModeOverride("free-text"); }} className={`flex-1 rounded px-2 py-1.5 text-xs font-semibold ${protocolMode === "free-text" ? "bg-accent/10 text-accent" : "text-muted-foreground"}`}>Free-text protocol</button>
                </div>
                {protocolMode === "saved" ? <>
                  <label className="block text-xs font-semibold">Saved protocol<input aria-label="Saved protocol" list="saved-protocol-options" value={selectedProtocolLabel} onChange={(event) => { const value = event.target.value; setProtocolSearch(value); const match = activeProtocols.find((protocol) => protocolOptionLabel(protocol).toLowerCase() === value.trim().toLowerCase()); setProtocolId(match ? String(match.id) : ""); }} className={`${inputClass()} mt-1`} placeholder="Search by protocol name" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} disabled={protocolsLoading && activeProtocols.length === 0} /><datalist id="saved-protocol-options">{activeProtocols.map((protocol) => <option key={protocol.id} value={protocolOptionLabel(protocol)} />)}</datalist></label>
                  <div className="mt-3"><ProtocolVersionPreview modality={appointment.modalityCode} selectedProtocol={selectedProtocol} detail={selectedVersionQuery.data ?? null} loading={selectedVersionQuery.isLoading} error={selectedVersionQuery.error} /></div>
                  {activeProtocols.length === 0 ? <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>{noActiveProtocolsMessage}</p> : null}
                </> : <Field label="Free-text protocol"><textarea aria-label="Free-text protocol" placeholder="Enter sequences or phases, coverage, contrast instructions, preparation, and any special instructions." value={freeTextProtocol} onChange={(event) => { setModeTouched(true); setFreeTextProtocol(event.target.value); }} className={`${inputClass()} min-h-48`} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></Field>}
                <div className="mt-3 rounded-lg border" style={{ borderColor: "var(--border)" }}>
                  <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-start text-sm font-semibold" aria-expanded={additionalInstructionsOpen} onClick={() => setAdditionalInstructionsOpen((current) => !current)}>Additional instructions<span aria-hidden="true">{additionalInstructionsOpen ? "−" : "+"}</span></button>
                  {additionalInstructionsOpen ? <div className="space-y-3 border-t p-3" style={{ borderColor: "var(--border)" }}>
                    <Field label="Scanner"><select aria-label="Scanner" value={scannerId} onChange={(event) => setScannerId(event.target.value)} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">Not selected</option>{matchingScanners.map((scanner) => <option key={scanner.id} value={scanner.id}>{scanner.name}</option>)}</select><span className="mt-1 block text-[10px] font-normal" style={{ color: "var(--text-muted)" }}>Optional scanner selection.</span></Field>
                    <Field label="Patient-specific instructions"><textarea aria-label="Protocol instructions" value={protocolNotes} onChange={(event) => setProtocolNotes(event.target.value)} className={`${inputClass()} min-h-20`} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></Field>
                    <Field label="Contrast/preparation instructions"><textarea aria-label="Contrast/preparation instructions" value={contrastNotes} onChange={(event) => setContrastNotes(event.target.value)} className={`${inputClass()} min-h-20`} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></Field>
                  </div> : null}
                </div>
                 {detail?.assignmentDetail ? <div className="mt-3"><ProtocolAssignmentSummary detail={detail} /></div> : null}
                 </div>
                 <div className="sticky bottom-0 z-20 mt-auto flex shrink-0 items-center justify-end gap-1.5 border-t bg-background p-2" style={{ borderColor: "var(--border)" }}>
                   {annotationDirty ? <span className="me-auto text-xs font-semibold text-amber-700">Save document annotations before assigning the protocol.</span> : null}
                    {hasMoreProtocolActions ? <div ref={actionMenuAnchorRef} className="relative">
                      <button type="button" disabled={saving} onClick={toggleActionMenu} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border" style={{ borderColor: "var(--border)" }} aria-label="More protocol actions" aria-expanded={actionMenuOpen} title="More protocol actions"><MoreVertical size={16} aria-hidden="true" /></button>
                      {actionMenuOpen ? createPortal(<div ref={actionMenuRef} className="fixed z-[100] w-40 rounded-lg border bg-background p-1 shadow-xl" style={{ borderColor: "var(--border)", right: actionMenuPosition.right, bottom: actionMenuPosition.bottom }} role="menu">
                        {printableSheet ? <button type="button" role="menuitem" disabled={saving} onClick={() => { setActionMenuOpen(false); printProtocolSheet(printableSheet); }} className="w-full rounded-md px-2 py-1.5 text-start text-xs font-semibold hover:bg-muted">Print protocol</button> : null}
                        {existing ? <button type="button" role="menuitem" disabled={saving} onClick={() => { setActionMenuOpen(false); onClear(); }} className="w-full rounded-md px-2 py-1.5 text-start text-xs font-semibold text-red-700 hover:bg-red-50">Clear assignment</button> : null}
                      </div>, document.body) : null}
                    </div> : null}
                   <button type="button" disabled={saving || annotationDirty || (protocolMode === "saved" ? !protocolId : !freeTextProtocol.trim())} onClick={() => onSave(payload(), false)} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>{saving ? "Saving..." : "Save"}</button>
                   <button type="button" disabled={saving || annotationDirty || (protocolMode === "saved" ? !protocolId : !freeTextProtocol.trim())} onClick={() => onSave(payload(), true)} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white">Assign and next</button>
                 </div>
               </aside>) : null}
             </div>
             </div>
          </>
        )}
        {detailsOpen ? <ProtocolingAppointmentDetailsDrawer key={appointment.appointmentId} appointment={appointment} onClose={() => setDetailsOpen(false)} /> : null}
        <Dialog open={Boolean(reconciliationStudy)} onClose={()=>{if(!reconciliationMutation.isPending){setReconciliationStudy(null);setReconciliationConfirmed(false);}}}><DialogContent maxWidth="680px"><DialogHeader><DialogTitle>Patient Identity Reconciliation</DialogTitle><DialogDescription>Only the DICOM Patient ID will change. Historical demographics and all imaging identifiers will remain unchanged.</DialogDescription></DialogHeader>{reconciliationStudy?<div className="grid gap-3 text-sm md:grid-cols-2"><div className="rounded-lg border p-3"><h4 className="font-semibold">Historical DICOM identity</h4><p>Patient ID: {reconciliationStudy.historicalPatientId||"Unavailable"}</p><p>Patient name: {reconciliationStudy.historicalPatientName||"Unavailable"}</p><p>DOB: {reconciliationStudy.historicalPatientBirthDate||"Unavailable"}</p></div><div className="rounded-lg border p-3"><h4 className="font-semibold">Current RISpro identity</h4><p>Patient ID: {historyQuery.data?.currentPatient?.patientId||"Unavailable"}</p><p>Patient name: {historyQuery.data?.currentPatient?.name||"Unavailable"}</p><p>DOB: {historyQuery.data?.currentPatient?.birthDate||"Unavailable"}</p></div><div className="md:col-span-2 rounded-lg border p-3"><p>Study date: {reconciliationStudy.date||"Unknown"}</p><p>Study: {reconciliationStudy.description||"Study"}</p><p>Accession: {reconciliationStudy.accessionNumber||"Unavailable"}</p><p className="break-all text-xs text-muted-foreground">StudyInstanceUID: {reconciliationStudy.studyInstanceUid}</p></div><label className="md:col-span-2 flex items-start gap-2"><Checkbox checked={reconciliationConfirmed} onCheckedChange={(value)=>setReconciliationConfirmed(Boolean(value))}/><span>I confirm that this historical study belongs to the selected RISpro patient.</span></label>{reconciliationMutation.isError?<p role="alert" className="md:col-span-2 text-red-700">{(reconciliationMutation.error as Error).message}</p>:null}</div>:null}<DialogFooter><Button variant="secondary" onClick={()=>setReconciliationStudy(null)} disabled={reconciliationMutation.isPending}>Cancel</Button><Button onClick={()=>reconciliationMutation.mutate()} disabled={!reconciliationConfirmed||reconciliationMutation.isPending}>{reconciliationMutation.isPending?"Submitting...":"Reconcile patient identity"}</Button></DialogFooter></DialogContent></Dialog>
      </section>
    </div>
  );
}

function ProtocolCategoryBadge({ category }: { category: string | null }) {
  if (category === "oncology") return <Badge variant="error" size="sm">Oncology</Badge>;
  if (category === "non_oncology") return <Badge variant="info" size="sm">Non-oncology</Badge>;
  return <Badge variant="neutral" size="sm">Not set</Badge>;
}

function combineProtocolValues(...values: Array<string | number | null | undefined>): string | null {
  const parts = values.map((value) => (value == null ? "" : String(value).trim())).filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : null;
}

function doctorAssignmentPrintSheet({
  appointment,
  detail,
  selectedProtocol,
  selectedVersionDetail,
  selectedScannerName,
  protocolNotes,
  contrastNotes,
  freeTextProtocol,
}: {
  appointment: DoctorProtocolingAppointment;
  detail: DoctorProtocolingAppointmentDetail | null;
  selectedProtocol: ProtocolLibraryProtocol | null;
  selectedVersionDetail: ProtocolLibraryVersionDetail | null;
  selectedScannerName: string | null;
  protocolNotes: string;
  contrastNotes: string;
  freeTextProtocol: string;
}): ProtocolPrintSheet | null {
  const assignmentDetail = detail?.assignmentDetail ?? null;
  const assigned = assignmentDetail?.assignment ?? appointment.assignment ?? null;
  if (!assigned && (!selectedProtocol || !selectedVersionDetail) && !freeTextProtocol.trim()) return null;

  const appointmentDateTime = [appointment.appointmentDate, appointment.appointmentTime].filter(Boolean).join(" ") || null;
  const base = {
    patientName: protocolingPatientName(appointment),
    mrn: appointment.patientMrn,
    accession: appointment.accessionNumber,
    appointmentDateTime,
    modality: appointment.modalityCode,
    exam: appointment.examTypeName,
    category: appointment.caseCategory,
    clinicalNotes: appointment.clinicalNotes,
    protocolName: assigned?.protocolName ?? selectedProtocol?.name ?? (freeTextProtocol.trim() ? "Free-text protocol" : ""),
    versionNumber: assigned?.versionNumber ?? selectedVersionDetail?.version.versionNumber ?? selectedProtocol?.activeVersionNumber ?? "",
    scanner: assigned?.scannerName ?? selectedScannerName,
    assignedBy: assigned?.assignedBy != null ? String(assigned.assignedBy) : null,
    assignedAt: assigned?.assignedAt ?? null,
    protocolInstructions: assigned?.freeTextProtocol ?? assigned?.protocolNotes ?? nullableText(freeTextProtocol) ?? nullableText(protocolNotes),
    contrastInstructions: assigned?.contrastNotes ?? nullableText(contrastNotes),
  };

  if (appointment.modalityCode === "CT") {
    return {
      ...base,
      modality: "CT",
      ctPhases: assignmentDetail
        ? assignmentDetail.ctPhases.map((phase) => ({
          orderIndex: phase.orderIndex,
          phase: phase.customPhaseName ?? phase.ctPhasePresetName,
          timing: phase.timingOverride,
          coverage: phase.coverageOverride,
          reconstruction: phase.reconstructionOverride,
          instructions: phase.instructionsOverride,
          isRequired: phase.isRequired,
        }))
        : (selectedVersionDetail?.ctPhases ?? []).map((phase) => ({
          orderIndex: phase.orderIndex,
          phase: phase.customPhaseName ?? phase.ctPhasePresetName,
          timing: phase.timingOverride,
          coverage: phase.coverageOverride,
          reconstruction: phase.reconstructionOverride,
          instructions: phase.instructionsOverride,
          isRequired: phase.isRequired,
        })),
    };
  }

  return {
    ...base,
    modality: "MRI",
    mriSequences: assignmentDetail
      ? assignmentDetail.mriSequences.map((sequence) => ({
        orderIndex: sequence.orderIndex,
        scanner: sequence.scannerName,
        sequence: sequence.mriSequencePresetName,
        vendorSequenceName: null,
        plane: sequence.planeOverride,
        coverage: sequence.coverageOverride,
        bValuesTiming: combineProtocolValues(sequence.bValuesOverride, sequence.timingOverride),
        notes: sequence.notesOverride,
        isRequired: sequence.isRequired,
      }))
      : (selectedVersionDetail?.mriSequences ?? []).map((sequence) => ({
        orderIndex: sequence.orderIndex,
        scanner: sequence.scannerName ?? selectedScannerName,
        sequence: mriSequenceRowLabel(sequence),
        vendorSequenceName: sequence.scannerAliasVendorSequenceName ?? null,
        plane: sequence.planeOverride ?? sequence.presetDefaultPlane ?? null,
        coverage: sequence.coverageOverride,
        bValuesTiming: combineProtocolValues(sequence.bValuesOverride, sequence.timingOverride),
        notes: sequence.notesOverride,
        isRequired: sequence.isRequired,
      })),
  };
}

function ProtocolVersionPreview({
  modality,
  selectedProtocol,
  detail,
  loading,
  error,
}: {
  modality: "CT" | "MRI";
  selectedProtocol: ProtocolLibraryProtocol | null;
  detail: ProtocolLibraryVersionDetail | null;
  loading: boolean;
  error: unknown;
}) {
  if (!selectedProtocol) {
    return (
      <section className="rounded-lg border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        Select an active protocol to preview its {modality === "CT" ? "CT phases" : "MRI sequences"} before saving.
      </section>
    );
  }
  if (loading) {
    return (
      <section className="rounded-lg border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        Loading protocol preview...
      </section>
    );
  }
  if (error) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error instanceof Error ? error.message : "Unable to load protocol preview."}
      </section>
    );
  }
  if (!detail) return null;

  const rows = modality === "CT" ? detail.ctPhases : detail.mriSequences;
  return (
    <section className="rounded-lg border p-4" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-foreground">Protocol preview</h4>
        <span className="rounded-full border px-2 py-0.5 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          v{detail.version.versionNumber} / {detail.version.status}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
          No {modality === "CT" ? "CT phases" : "MRI sequences"} found for this active version.
        </p>
      ) : modality === "CT" ? (
        <SettingsTable emptyText="No CT phases found for this active version." headers={["Order", "Phase", "Timing", "Coverage", "Reconstruction / instructions", "Required"]}>
          {detail.ctPhases.map((phase) => (
            <tr key={phase.id}>
              <Cell>{phase.orderIndex}</Cell>
              <Cell>{phase.customPhaseName ?? phase.ctPhasePresetName ?? "-"}</Cell>
              <Cell>{phase.timingOverride ?? "-"}</Cell>
              <Cell>{phase.coverageOverride ?? "-"}</Cell>
              <Cell>{phase.reconstructionOverride ?? phase.instructionsOverride ?? "-"}</Cell>
              <Cell>{phase.isRequired ? "Yes" : "No"}</Cell>
            </tr>
          ))}
        </SettingsTable>
      ) : (
        <SettingsTable emptyText="No MRI sequences found for this active version." headers={["Order", "Scanner", "Sequence", "Plane", "Coverage", "b-values / timing", "Required"]}>
          {detail.mriSequences.map((sequence) => (
            <tr key={sequence.id}>
              <Cell>{sequence.orderIndex}</Cell>
              <Cell>{sequence.scannerName ?? "Generic"}</Cell>
              <Cell>
                {mriSequenceRowLabel(sequence)}
                {sequence.scannerName && sequence.scannerAliasVendorSequenceName ? <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>Vendor name on {sequence.scannerName}: {sequence.scannerAliasVendorSequenceName}</span> : null}
              </Cell>
              <Cell>{sequence.planeOverride ?? sequence.presetDefaultPlane ?? "-"}</Cell>
              <Cell>{sequence.coverageOverride ?? "-"}</Cell>
              <Cell>{sequence.bValuesOverride ?? sequence.timingOverride ?? "-"}</Cell>
              <Cell>{sequence.isRequired ? "Yes" : "No"}</Cell>
            </tr>
          ))}
        </SettingsTable>
      )}
    </section>
  );
}

function ProtocolAssignmentSummary({ detail }: { detail: DoctorProtocolingAppointmentDetail }) {
  const assignmentDetail = detail.assignmentDetail;
  if (!assignmentDetail) return null;
  const assignment = assignmentDetail.assignment;
  return (
    <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--border)" }}>
      <h4 className="font-semibold">Assigned protocol summary</h4>
      <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{assignment.freeTextProtocol ? "Free-text protocol" : `${assignment.protocolName ?? "Saved protocol"} v${assignment.versionNumber ?? "-"}`}{assignment.scannerName ? ` · ${assignment.scannerName}` : ""}</p>
      {assignment.freeTextProtocol && <p className="mt-2 whitespace-pre-wrap text-sm">{assignment.freeTextProtocol}</p>}
      {assignment.protocolNotes && <p className="mt-2 text-sm">Protocol instructions: {assignment.protocolNotes}</p>}
      {assignment.contrastNotes && <p className="mt-1 text-sm">Contrast instructions: {assignment.contrastNotes}</p>}
      {detail.appointment.modalityCode === "CT" ? (
        <SettingsTable emptyText="No CT phases found for this protocol." headers={["Order", "Phase", "Timing", "Coverage", "Required"]}>
          {assignmentDetail.ctPhases.map((phase) => <tr key={phase.id}><Cell>{phase.orderIndex}</Cell><Cell>{phase.customPhaseName ?? phase.ctPhasePresetName ?? "-"}</Cell><Cell>{phase.timingOverride ?? "-"}</Cell><Cell>{phase.coverageOverride ?? "-"}</Cell><Cell>{phase.isRequired ? "Yes" : "No"}</Cell></tr>)}
        </SettingsTable>
      ) : (
        <SettingsTable emptyText="No MRI sequences found for this protocol." headers={["Order", "Scanner", "Sequence", "Plane", "Coverage", "b-values/timing", "Required"]}>
          {assignmentDetail.mriSequences.map((sequence) => <tr key={sequence.id}><Cell>{sequence.orderIndex}</Cell><Cell>{sequence.scannerName ?? "-"}</Cell><Cell>{sequence.mriSequencePresetName ?? "-"}</Cell><Cell>{sequence.planeOverride ?? "-"}</Cell><Cell>{sequence.coverageOverride ?? "-"}</Cell><Cell>{sequence.bValuesOverride ?? sequence.timingOverride ?? "-"}</Cell><Cell>{sequence.isRequired ? "Yes" : "No"}</Cell></tr>)}
        </SettingsTable>
      )}
    </div>
  );
}

export function DoctorProtocolsPage({ me }: { me: DoctorMe }) {
  const canEditLibrary = canManageProtocolLibrary(me);
  const canAssign = Boolean(me.canAssignProtocols);
  const [activeArea, setActiveArea] = useState<"protocoling" | "library">(canAssign ? "protocoling" : "library");

  if (!canAssign && !canEditLibrary) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        You do not have permission to use protocoling or protocol library administration.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {canAssign && <SectionButton label="Protocoling" active={activeArea === "protocoling"} onClick={() => setActiveArea("protocoling")} />}
        {canEditLibrary && <SectionButton label="Protocol Library" active={activeArea === "library"} onClick={() => setActiveArea("library")} />}
      </div>
      {activeArea === "library" && canEditLibrary ? <ProtocolLibraryPanel /> : <ProtocolingWorklist canAssign={canAssign} />}
    </div>
  );
}
