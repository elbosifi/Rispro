import { Children, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MoreVertical, Pencil, TriangleAlert, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  activateProtocolLibraryVersion,
  cancelDoctorProtocolAssignment,
  withdrawComplementaryRecallRequest,
  createComplementaryRecallRequest,
  createDoctorProtocolAssignment,
  createProtocolLibraryAnatomyRegion,
  createProtocolLibraryCtPhasePreset,
  createProtocolLibraryCtPhaseRow,
  createProtocolLibraryDraftFromActive,
  duplicateProtocolLibraryCtVersion,
  createProtocolLibraryMriSequencePreset,
  createProtocolLibraryMriSequenceRow,
  createProtocolLibraryProtocol,
  deleteProtocolLibraryCtPhaseRow,
  deleteProtocolLibraryCtTechnique,
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
  updateProtocolLibraryVersion,
  upsertProtocolLibraryCtTechnique,
  updateDoctorProtocolAssignment,
  updateDoctorProtocolReportRequirement,
  type CtPhasePresetPayload,
  type MriSequencePresetPayload,
  type MriSequenceImportInspect,
  type MriSequenceImportPreview,
  type MriSequenceImportSummary,
  type ProtocolLibraryCtPhaseRowPayload,
  type ProtocolLibraryCtTechniquePayload,
  type ProtocolLibraryMriSequenceRowPayload,
  type ProtocolLibraryProtocolPayload,
  type ProtocolAnatomyRegionPayload,
} from "@/lib/api-hooks";
import type { CtPhasePreset, DoctorMe, DoctorProtocolingAppointment, DoctorProtocolingAppointmentDetail, HistoricalPacsCandidate, ImagingScanner, MriSequencePreset, PatientIdentityReconciliationSummary, ProtocolAnatomyRegion, ProtocolAssignmentPayload, ProtocolLibraryCtPhaseRow, ProtocolLibraryCtTechniqueRow, ProtocolLibraryMriSequenceRow, ProtocolLibraryProtocol, ProtocolLibraryVersionDetail } from "@/types/api";
import { printProtocolSheet, type ProtocolPrintSheet } from "@/lib/protocol-printing";
import { pushToast } from "@/lib/toast";
import { formatDateLy, formatDateTimeLy } from "@/lib/date-format";
import { Badge, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Textarea } from "@/components/shared";
import { DateInput } from "@/components/common/date-input";
import { MriPrimaryScreeningBadges } from "@/components/appointments/mri-primary-screening-badges";
import { rescheduleV2Booking, useV2ExamTypes } from "@/v2/appointments/api";

const PROTOCOLING_WORKLIST_REFRESH_MS = 10_000;
import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { ProtocolingAppointmentDetailsDrawer } from "@/components/doctor/protocoling-appointment-details-drawer";
import { ComplementaryRecallRequestDialog } from "@/components/doctor/complementary-recall-request-dialog";
import { ComplementaryRecallWithdrawDialog } from "@/components/doctor/complementary-recall-withdraw-dialog";
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

function MriPrimarySafetyPanel({ appointment }: { appointment: DoctorProtocolingAppointment }) {
  if (appointment.modalitySafetyWorkflowType !== "mri_primary_implant_screening") return null;

  if (appointment.mriPrimaryScreeningResult === "no_known_implant_reported") {
    return <section className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-2 text-emerald-950" aria-label="MRI primary screening" data-testid="mri-primary-safety-panel"><p className="text-xs font-bold uppercase tracking-wide">MRI Primary Screening</p><p className="mt-0.5 text-sm font-semibold">No known implant/device reported</p></section>;
  }

  const reviewRequired = appointment.mriPrimaryScreeningResult === "implant_reported_review_required";
  return (
    <section className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-amber-950" aria-label="MRI primary screening" data-testid="mri-primary-safety-panel">
      <div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 shrink-0 text-amber-700" size={22} aria-hidden="true" /><div>
        <p className="text-xs font-bold uppercase tracking-wide">{reviewRequired ? "MRI SAFETY REVIEW REQUIRED" : "MRI PRIMARY SCREENING NOT RECORDED"}</p>
        {reviewRequired ? <p className="mt-0.5 text-sm font-semibold">Implant/device reported during primary screening</p> : null}
        {reviewRequired && (appointment.mriPrimaryScreeningImplantSite || appointment.mriPrimaryScreeningImplantDescription || appointment.mriPrimaryScreeningPreviousReviewerNameReported) ? <dl className="mt-2 space-y-1 text-sm">
          {appointment.mriPrimaryScreeningImplantSite ? <div><dt className="inline font-semibold">Implant/device site: </dt><dd className="inline">{appointment.mriPrimaryScreeningImplantSite}</dd></div> : null}
          {appointment.mriPrimaryScreeningImplantDescription ? <div><dt className="inline font-semibold">Description: </dt><dd className="inline">{appointment.mriPrimaryScreeningImplantDescription}</dd></div> : null}
          {appointment.mriPrimaryScreeningPreviousReviewerNameReported ? <div><dt className="inline font-semibold">Previous reviewer reported by patient: </dt><dd className="inline">{appointment.mriPrimaryScreeningPreviousReviewerNameReported}</dd></div> : null}
        </dl> : null}
      </div></div>
    </section>
  );
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
            {study.attestation ? <p className="mt-1 text-[11px] font-semibold text-foreground">{study.attestation.status === "confirmed" ? "Patient confirmed" : "Patient denied ownership"} · {study.attestation.recordedByName || "Staff"} · {formatDateTimeLy(study.attestation.recordedAt)}</p> : null}
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
const EMPTY_CT_PROTOCOL: ProtocolLibraryProtocolPayload = {
  name: "",
  modality: "CT",
  anatomyRegionId: null,
  category: null,
  indication: null,
  contrastPolicy: null,
  oralContrastPolicy: null,
  bowelPreparation: null,
  preparationNotes: null,
  changeSummary: "Initial protocol version",
  protocolNotes: null,
};
const EMPTY_MRI_PROTOCOL: ProtocolLibraryProtocolPayload = {
  ...EMPTY_CT_PROTOCOL,
  modality: "MRI",
  category: "General",
  contrastPolicy: "Non-contrast",
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
  timingType: "NON_CONTRAST",
  delaySeconds: null,
  bolusTrackingSite: null,
  triggerHu: null,
  postTriggerDelaySeconds: null,
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

function textValue(value: string | null | undefined): string {
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

function AppointmentStatusBadge({ status }: { status: string }) {
  const presentations: Record<string, { label: string; variant: "info" | "warning" | "success" | "error" | "neutral" }> = {
    scheduled: { label: "Scheduled", variant: "info" },
    arrived: { label: "Arrived", variant: "warning" },
    waiting: { label: "Waiting", variant: "warning" },
    completed: { label: "Completed", variant: "success" },
    "no-show": { label: "No-show", variant: "error" },
  };
  const presentation = presentations[status] ?? { label: status || "Unknown", variant: "neutral" };
  return <Badge variant={presentation.variant}>{presentation.label}</Badge>;
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
  const [duplicateVersion, setDuplicateVersion] = useState<{ versionId: number; protocolName: string; versionNumber: string | null; source: ProtocolLibraryVersionDetail | null } | null>(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [protocolPendingToggle, setProtocolPendingToggle] = useState<ProtocolLibraryProtocol | null>(null);
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
  const duplicateSourceQuery = useQuery({
    queryKey: ["doctor", "protocol-library", "duplicate-source", duplicateVersion?.versionId],
    queryFn: () => fetchProtocolLibraryVersionDetail(duplicateVersion!.versionId),
    enabled: section === "protocols" && duplicateVersion !== null && duplicateVersion.source === null,
  });

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
  const updateVersionMutation = useMutation({ mutationFn: ({ versionId, changeSummary, protocolNotes }: { versionId: number; changeSummary: string | null; protocolNotes: string | null }) => updateProtocolLibraryVersion(versionId, { changeSummary, protocolNotes }), onError: onMutationError, onSuccess: async () => { setMessage({ tone: "success", text: "Draft saved." }); await refreshBuilder(); } });
  const activateVersionMutation = useMutation({ mutationFn: activateProtocolLibraryVersion, onError: onMutationError, onSuccess: async () => { setMessage({ tone: "success", text: "Protocol version activated." }); await refreshBuilder(); } });
  const draftFromActiveMutation = useMutation({ mutationFn: ({ protocolId, revisionType }: { protocolId: number; revisionType: "MINOR" | "MAJOR" }) => createProtocolLibraryDraftFromActive(protocolId, revisionType), onError: onMutationError, onSuccess: async (detail) => { setSelectedVersionId(detail.version.id); setMessage({ tone: "success", text: "Draft version created." }); await refreshBuilder(); } });
  const duplicateCtVersionMutation = useMutation({ mutationFn: ({ versionId, name }: { versionId: number; name: string }) => duplicateProtocolLibraryCtVersion(versionId, name), onError: onMutationError, onSuccess: async (detail) => { setDuplicateVersion(null); setSelectedVersionId(detail.version.id); setMessage({ tone: "success", text: "Protocol duplicated as a new draft." }); await refreshBuilder(); } });
  const createCtRowMutation = useMutation({ mutationFn: ({ versionId, payload }: { versionId: number; payload: ProtocolLibraryCtPhaseRowPayload }) => createProtocolLibraryCtPhaseRow(versionId, payload), onError: onMutationError, onSuccess: async () => { setCtRowDraft(null); setEditingCtRowId(null); await refreshBuilder(); } });
  const updateCtRowMutation = useMutation({ mutationFn: ({ versionId, rowId, payload }: { versionId: number; rowId: number; payload: Partial<ProtocolLibraryCtPhaseRowPayload> }) => updateProtocolLibraryCtPhaseRow(versionId, rowId, payload), onError: onMutationError, onSuccess: async () => { setCtRowDraft(null); setEditingCtRowId(null); await refreshBuilder(); } });
  const deleteCtRowMutation = useMutation({ mutationFn: ({ versionId, rowId }: { versionId: number; rowId: number }) => deleteProtocolLibraryCtPhaseRow(versionId, rowId), onError: onMutationError, onSuccess: refreshBuilder });
  const reorderCtRowsMutation = useMutation({ mutationFn: ({ versionId, rowIds }: { versionId: number; rowIds: number[] }) => reorderProtocolLibraryCtPhaseRows(versionId, rowIds), onError: onMutationError, onSuccess: refreshBuilder });
  const createMriRowMutation = useMutation({ mutationFn: ({ versionId, payload }: { versionId: number; payload: ProtocolLibraryMriSequenceRowPayload }) => createProtocolLibraryMriSequenceRow(versionId, payload), onError: onMutationError, onSuccess: async () => { setMriRowDraft(null); setEditingMriRowId(null); await refreshBuilder(); } });
  const updateMriRowMutation = useMutation({ mutationFn: ({ versionId, rowId, payload }: { versionId: number; rowId: number; payload: Partial<ProtocolLibraryMriSequenceRowPayload> }) => updateProtocolLibraryMriSequenceRow(versionId, rowId, payload), onError: onMutationError, onSuccess: async () => { setMriRowDraft(null); setEditingMriRowId(null); await refreshBuilder(); } });
  const deleteMriRowMutation = useMutation({ mutationFn: ({ versionId, rowId }: { versionId: number; rowId: number }) => deleteProtocolLibraryMriSequenceRow(versionId, rowId), onError: onMutationError, onSuccess: refreshBuilder });
  const reorderMriRowsMutation = useMutation({ mutationFn: ({ versionId, rowIds }: { versionId: number; rowIds: number[] }) => reorderProtocolLibraryMriSequenceRows(versionId, rowIds), onError: onMutationError, onSuccess: refreshBuilder });

  const startRegionEdit = (item: ProtocolAnatomyRegion) => { setEditingRegionId(item.id); setRegionDraft({ name: item.name, bodySystem: item.bodySystem, modalityScope: item.modalityScope, defaultCoverageNote: item.defaultCoverageNote, isActive: item.isActive }); };
  const startCtPhaseEdit = (item: CtPhasePreset) => { setEditingCtPhaseId(item.id); setCtPhaseDraft({ name: item.name, contrastStatus: item.contrastStatus, timingType: item.timingType, delaySeconds: item.delaySeconds, bolusTrackingSite: item.bolusTrackingSite, triggerHu: item.triggerHu, defaultCoverage: item.defaultCoverage, reconstructionNotes: item.reconstructionNotes, instructions: item.instructions, isActive: item.isActive }); };
  const startMriSequenceEdit = (item: MriSequencePreset) => { setEditingMriSequenceId(item.id); setMriSequenceDraft({ scannerId: item.scannerId, vendor: item.vendor, name: item.name, vendorSequenceName: item.vendorSequenceName, genericFamily: item.genericFamily, weighting: item.weighting, defaultPlane: item.defaultPlane, fatSuppression: item.fatSuppression ?? null, acquisitionType: item.acquisitionType ?? null, contrastRelation: item.contrastRelation, defaultCoverage: item.defaultCoverage, defaultBValues: item.defaultBValues, defaultDynamicTiming: item.defaultDynamicTiming, estimatedScanTimeMinutes: item.estimatedScanTimeMinutes, notes: item.notes, scannerAliases: (item.scannerAliases ?? []).map((alias) => ({ scannerId: alias.scannerId, vendorSequenceName: alias.vendorSequenceName, notes: alias.notes })), isActive: item.isActive }); };
  const startCtRowEdit = (item: ProtocolLibraryCtPhaseRow) => { setEditingCtRowId(item.id); setCtRowDraft({ ctPhasePresetId: item.ctPhasePresetId, customPhaseName: item.customPhaseName, timingOverride: item.timingOverride, timingType: item.timingType, delaySeconds: item.delaySeconds, bolusTrackingSite: item.bolusTrackingSite, triggerHu: item.triggerHu, postTriggerDelaySeconds: item.postTriggerDelaySeconds, coverageOverride: item.coverageOverride, reconstructionOverride: item.reconstructionOverride, instructionsOverride: item.instructionsOverride, isRequired: item.isRequired }); };
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
        {section === "protocols" && !selectedVersion ? <div className="flex flex-wrap gap-2"><AddButton label="New CT Protocol" onClick={() => setProtocolDraft(EMPTY_CT_PROTOCOL)} /><button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }} onClick={() => setProtocolDraft(EMPTY_MRI_PROTOCOL)}>New MRI Protocol</button></div> : null}
        {section === "anatomy" && <AddButton label="Add region" onClick={() => { setEditingRegionId(null); setRegionDraft(EMPTY_REGION); }} />}
        {section === "ctPhases" && <AddButton label="Add CT phase" onClick={() => { setEditingCtPhaseId(null); setCtPhaseDraft(EMPTY_CT_PHASE); }} />}
        {section === "mriSequences" && <AddButton label="Add MRI sequence" onClick={() => { setEditingMriSequenceId(null); setMriSequenceDraft(EMPTY_MRI_SEQUENCE); }} />}
      </div>

      {message && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${message.tone === "error" ? "text-red-700" : "text-emerald-700"}`} style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
          {message.text}
        </p>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2" aria-label="Protocol library areas">
          <span className="me-1 text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>Library areas</span>
          <SectionButton label="Protocols" active={section === "protocols"} onClick={() => setSection("protocols")} />
          <SectionButton label="Library setup" active={section !== "protocols"} onClick={() => setSection("anatomy")} />
        </div>
        {section !== "protocols" ? <div className="flex flex-wrap items-center gap-2 border-s ps-3" style={{ borderColor: "var(--border)" }} aria-label="Library setup navigation">
          <span className="me-1 text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>Configuration</span>
          <SectionButton label="Anatomy / Regions" active={section === "anatomy"} onClick={() => setSection("anatomy")} />
          <SectionButton label="Scanners" active={section === "scanners"} onClick={() => setSection("scanners")} />
          <SectionButton label="Legacy CT Phase Presets" active={section === "ctPhases"} onClick={() => setSection("ctPhases")} />
          <SectionButton label="MRI Sequence Presets" active={section === "mriSequences"} onClick={() => setSection("mriSequences")} />
        </div> : null}
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
          onSaveDraft={(changeSummary, protocolNotes) => updateVersionMutation.mutate({ versionId: selectedVersion.version.id, changeSummary, protocolNotes })}
          onActivate={() => activateVersionMutation.mutate(selectedVersion.version.id)}
          onDraftFromActive={(revisionType) => draftFromActiveMutation.mutate({ protocolId: selectedVersion.protocol.id, revisionType })}
          onDuplicate={(source) => { setDuplicateVersion({ versionId: source.version.id, protocolName: source.protocol.name, versionNumber: source.version.versionNumber, source }); setDuplicateName(`Copy of ${source.protocol.name}`); }}
          onAddCtRow={() => { setEditingCtRowId(null); setCtRowDraft(EMPTY_PROTOCOL_CT_PHASE); }}
          onEditCtRow={startCtRowEdit}
          onCancelCtRow={() => { setCtRowDraft(null); setEditingCtRowId(null); }}
          onSaveCtRow={(payload) => editingCtRowId ? updateCtRowMutation.mutate({ versionId: selectedVersion.version.id, rowId: editingCtRowId, payload }) : createCtRowMutation.mutate({ versionId: selectedVersion.version.id, payload: payload as ProtocolLibraryCtPhaseRowPayload })}
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
      <Dialog open={duplicateVersion !== null} onClose={() => { if (!duplicateCtVersionMutation.isPending) setDuplicateVersion(null); }}>
        <DialogContent maxWidth="520px">
          <DialogHeader>
            <DialogTitle>Duplicate protocol</DialogTitle>
            <DialogDescription>Create an independent draft from the exact source version below.</DialogDescription>
          </DialogHeader>
          {duplicateVersion ? (() => {
            const source = duplicateVersion.source ?? duplicateSourceQuery.data;
            return <div className="space-y-3">
              <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
                <p className="font-semibold">Source: {duplicateVersion.protocolName} · v{duplicateVersion.versionNumber ?? source?.version.versionNumber ?? "—"} · {source?.version.status ?? "Loading"}</p>
                {source ? <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{source.ctPhases.length} CT phase{source.ctPhases.length === 1 ? "" : "s"} · {source.ctTechniques.length} scanner technique{source.ctTechniques.length === 1 ? "" : "s"}</p> : <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>Loading source content…</p>}
              </div>
              <Field label="New protocol name"><Input aria-label="New protocol name" value={duplicateName} onChange={(event) => setDuplicateName(event.target.value)} /></Field>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>Creates an independent Draft v1.0 protocol.</p>
            </div>;
          })() : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDuplicateVersion(null)} disabled={duplicateCtVersionMutation.isPending}>Cancel</Button>
            <Button disabled={!duplicateName.trim() || duplicateCtVersionMutation.isPending} onClick={() => duplicateVersion && duplicateCtVersionMutation.mutate({ versionId: duplicateVersion.versionId, name: duplicateName.trim() })}>{duplicateCtVersionMutation.isPending ? "Duplicating…" : "Duplicate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={protocolPendingToggle !== null} onClose={() => setProtocolPendingToggle(null)}>
        <DialogContent maxWidth="460px">
          <DialogHeader>
            <DialogTitle>{protocolPendingToggle?.isActive ? "Deactivate protocol?" : "Reactivate protocol?"}</DialogTitle>
            <DialogDescription>{protocolPendingToggle?.isActive ? "This protocol will stop being available for new assignments." : "This protocol will become available for new assignments again."}</DialogDescription>
          </DialogHeader>
          <p className="text-sm font-semibold">{protocolPendingToggle?.name}</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setProtocolPendingToggle(null)}>Cancel</Button>
            <Button variant={protocolPendingToggle?.isActive ? "destructive" : "primary"} onClick={() => { if (protocolPendingToggle) updateProtocolMutation.mutate({ id: protocolPendingToggle.id, payload: { isActive: !protocolPendingToggle.isActive } }); setProtocolPendingToggle(null); }}>{protocolPendingToggle?.isActive ? "Deactivate protocol" : "Reactivate protocol"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          onToggle={(protocol) => protocol.isActive ? setProtocolPendingToggle(protocol) : updateProtocolMutation.mutate({ id: protocol.id, payload: { isActive: !protocol.isActive } })}
          onDuplicate={(protocol) => { const versionId = protocol.activeVersionId ?? protocol.latestDraftVersionId; if (versionId) { setDuplicateVersion({ versionId, protocolName: protocol.name, versionNumber: protocol.activeVersionNumber ?? protocol.latestDraftVersionNumber, source: null }); setDuplicateName(`Copy of ${protocol.name}`); } }}
        />
      )}
      {section === "anatomy" && (
        <SettingsTable emptyText="No anatomy regions yet" headers={["Name", "Scope", "Body system", "Coverage", "Status", "Actions"]}>
          {regionDraft && <RegionForm draft={regionDraft} setDraft={setRegionDraft} saving={createRegionMutation.isPending || updateRegionMutation.isPending} onCancel={() => { setRegionDraft(null); setEditingRegionId(null); }} onSave={() => editingRegionId ? updateRegionMutation.mutate({ id: editingRegionId, payload: regionDraft }) : createRegionMutation.mutate(regionDraft)} />}
          {anatomy.map((item) => <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}><Cell>{item.name}</Cell><Cell>{item.modalityScope}</Cell><Cell>{item.bodySystem ?? "-"}</Cell><Cell>{item.defaultCoverageNote ?? "-"}</Cell><Cell><StatusBadge active={item.isActive} /></Cell><Cell><RowActions onEdit={() => startRegionEdit(item)} onToggle={() => updateRegionMutation.mutate({ id: item.id, payload: { isActive: !item.isActive } })} active={item.isActive} /></Cell></tr>)}
        </SettingsTable>
      )}
      {section === "scanners" && <p className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)" }}>Scanner equipment is managed in Settings → Equipment.</p>}
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
  onDuplicate,
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
  onDuplicate: (protocol: ProtocolLibraryProtocol) => void;
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
      <SettingsTable emptyText="No protocols yet" headers={["Name", "Modality", "Indication", "Active version", "Status", "Actions"]}>
        {draft && (draft.modality === "CT" ? <CtProtocolCreateForm draft={draft} saving={saving} setDraft={setDraft} onCancel={() => setDraft(null)} onSave={onCreate} /> : <MriProtocolCreateForm draft={draft} anatomy={anatomy} saving={saving} setDraft={setDraft} onManageAnatomy={onManageAnatomy} onCancel={() => setDraft(null)} onSave={onCreate} />)}
        {rows.length === 0 && !draft ? <tr><td className="p-6 text-sm" colSpan={6} style={{ color: "var(--text-muted)" }}><p>No protocols yet</p><p>Create CT or MRI protocols from your saved phase and sequence presets.</p></td></tr> : null}
        {rows.map((item) => (
          <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}>
            <Cell>{item.name}</Cell>
            <Cell>{item.modality}</Cell>
            <Cell>{item.indication ?? "-"}</Cell>
            <Cell>{item.activeVersionNumber ?? "-"}</Cell>
            <Cell>{item.activeVersionId ? "Active" : item.latestDraftVersionId ? "Draft only" : "No active version"}</Cell>
            <Cell><div className="flex flex-wrap gap-2"><button type="button" onClick={() => onOpen(item)} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>View/Edit</button>{item.modality === "CT" && (item.activeVersionId ?? item.latestDraftVersionId) ? <button type="button" onClick={() => onDuplicate(item)} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>Duplicate</button> : null}<button type="button" onClick={() => onToggle(item)} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>{item.isActive ? "Deactivate" : "Reactivate"}</button></div></Cell>
          </tr>
        ))}
      </SettingsTable>
    </div>
  );
}

function CtProtocolCreateForm({ draft, saving, setDraft, onSave, onCancel }: { draft: ProtocolLibraryProtocolPayload; saving: boolean; setDraft: (draft: ProtocolLibraryProtocolPayload | null) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <tr><td colSpan={6} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-3">
      <Field label="Protocol name"><input aria-label="Protocol name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Indication"><input aria-label="Indication" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.indication)} onChange={(event) => setDraft({ ...draft, indication: editableText(event.target.value) })} /></Field>
      <Field label="Internal protocol notes"><Textarea aria-label="Internal protocol notes" value={textValue(draft.protocolNotes ?? null)} onChange={(event) => setDraft({ ...draft, protocolNotes: editableText(event.target.value) })} /><span className="mt-1 block text-xs font-normal" style={{ color: "var(--text-muted)" }}>Reusable guidance for doctors during protocoling. Not patient-facing.</span></Field>
      <FormActions saving={saving} saveLabel="Create" canSave={Boolean(draft.name.trim())} onSave={onSave} onCancel={onCancel} />
    </div></td></tr>
  );
}

function VersionBadge({ status }: { status: string }) {
  const variant = status === "ACTIVE" ? "success" : status === "DRAFT" ? "draft" : "neutral";
  return <Badge variant={variant} size="sm">{status}</Badge>;
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
  onDuplicate,
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
  onSaveDraft: (changeSummary: string | null, protocolNotes: string | null) => void;
  onActivate: () => void;
  onDraftFromActive: (revisionType: "MINOR" | "MAJOR") => void;
  onDuplicate: (source: ProtocolLibraryVersionDetail) => void;
  onAddCtRow: () => void;
  onEditCtRow: (row: ProtocolLibraryCtPhaseRow) => void;
  onCancelCtRow: () => void;
  onSaveCtRow: (payload: Partial<ProtocolLibraryCtPhaseRowPayload>) => void;
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
  const [protocolNotes, setProtocolNotes] = useState(detail.version.protocolNotes ?? "");
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const editable = detail.version.status === "DRAFT";
  const isCt = detail.protocol.modality === "CT";
  const canPublish = !isCt || detail.ctPhases.length > 0;
  const currentActiveVersion = detail.protocol.activeVersionId && detail.protocol.activeVersionId !== detail.version.id
    ? detail.protocol.activeVersionNumber
    : null;
  return (
    <div className="space-y-4" data-testid="protocol-builder">
      <section className="rounded-xl border p-3" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
              <span>{detail.protocol.modality}</span>
              {detail.protocol.modality === "MRI" && detail.protocol.anatomyRegionName ? <><span aria-hidden="true">·</span><span>{detail.protocol.anatomyRegionName}</span></> : null}
              <span aria-hidden="true">·</span>
              <span>v{detail.version.versionNumber}</span>
              <VersionBadge status={detail.version.status} />
            </div>
            <h3 className="mt-1 truncate text-xl font-semibold">{detail.protocol.name}</h3>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onBack}>Back</Button>
            {editable ? <Button type="button" variant="secondary" size="sm" onClick={() => onSaveDraft(nullableText(changeSummary), nullableText(protocolNotes))} disabled={saving}>Save draft</Button> : null}
            {isCt ? <Button type="button" variant="secondary" size="sm" onClick={() => onDuplicate(detail)}>Duplicate</Button> : null}
            {editable ? <Button type="button" size="sm" onClick={() => isCt ? setPublishDialogOpen(true) : onActivate()} disabled={saving || !canPublish}>{isCt ? "Publish protocol" : "Activate version"}</Button> : <Button type="button" size="sm" onClick={() => setRevisionDialogOpen(true)}>{isCt ? "Create revision" : "Create new draft version"}</Button>}
          </div>
        </div>
        {editable && isCt && !canPublish ? <div className="mt-2 flex justify-end"><p className="text-xs font-medium text-amber-700">Add at least one phase before publishing.</p></div> : null}
      </section>

      {isCt ? <section className="rounded-lg border px-3 py-2.5" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Internal protocol notes</h3>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>Reusable guidance for doctors during protocoling. Not patient-facing.</p>
          </div>
          {editable && protocolNotes.trim() ? <span className="text-xs" style={{ color: "var(--text-muted)" }}>Draft content</span> : null}
        </div>
        {editable ? <Textarea aria-label="Internal protocol notes" className="mt-2 min-h-20" value={protocolNotes} onChange={(event) => setProtocolNotes(event.target.value)} placeholder="Add reusable guidance for protocoling…" /> : <p className="mt-2 whitespace-pre-wrap text-sm">{protocolNotes.trim() || <span style={{ color: "var(--text-muted)" }}>No internal protocol notes.</span>}</p>}
      </section> : null}

      {detail.protocol.modality === "MRI" || detail.version.versionNumber !== "1.0" ? <section className="rounded-lg border px-3 py-2.5" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
        {editable ? <Field label={detail.protocol.modality === "CT" ? "Reason for change" : "Change summary"}><Input aria-label={detail.protocol.modality === "CT" ? "Reason for change" : "Change summary"} value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} /></Field> : <><p className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>{detail.protocol.modality === "CT" ? "Reason for change" : "Change summary"}</p><p className="mt-1 text-sm">{changeSummary || "Not recorded"}</p></>}
      </section> : null}

      <Dialog open={publishDialogOpen} onClose={() => setPublishDialogOpen(false)}>
        <DialogContent maxWidth="500px">
          <DialogHeader>
            <DialogTitle>Publish protocol?</DialogTitle>
            <DialogDescription>Review the version before it becomes available for future assignments.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
            <p className="font-semibold">{detail.protocol.name} · v{detail.version.versionNumber}</p>
            <p>{detail.ctPhases.length} CT phase{detail.ctPhases.length === 1 ? "" : "s"} · {detail.ctTechniques.length} scanner technique{detail.ctTechniques.length === 1 ? "" : "s"}</p>
            {currentActiveVersion ? <p className="text-amber-700">Current active version: v{currentActiveVersion}</p> : null}
          </div>
          <p className="mt-3 text-sm">This version will become the active protocol used for future assignments.</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPublishDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={() => { setPublishDialogOpen(false); onActivate(); }} disabled={saving || !canPublish}>Publish v{detail.version.versionNumber}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revisionDialogOpen} onClose={() => setRevisionDialogOpen(false)}>
        <DialogContent maxWidth="500px">
          <DialogHeader>
            <DialogTitle>Create revision</DialogTitle>
            <DialogDescription>Current active version: v{detail.version.versionNumber}</DialogDescription>
          </DialogHeader>
          <div className="mt-1 grid gap-2">
            <Button variant="secondary" className="h-auto min-h-0 justify-start p-3 text-start" onClick={() => { setRevisionDialogOpen(false); onDraftFromActive("MINOR"); }}><span><span className="block font-semibold">Minor revision</span><span className="mt-0.5 block text-xs font-normal" style={{ color: "var(--text-muted)" }}>Creates v{nextMinorVersion(detail.version.versionNumber)}</span></span></Button>
            <Button variant="secondary" className="h-auto min-h-0 justify-start p-3 text-start" onClick={() => { setRevisionDialogOpen(false); onDraftFromActive("MAJOR"); }}><span><span className="block font-semibold">Major revision</span><span className="mt-0.5 block text-xs font-normal" style={{ color: "var(--text-muted)" }}>Creates v{nextMajorVersion(detail.version.versionNumber)}</span></span></Button>
          </div>
        </DialogContent>
      </Dialog>

      {isCt ? <><CtProtocolRows detail={detail} presets={ctPhasePresets} draft={ctRowDraft} editingRowId={editingCtRowId} editable={editable} setDraft={setCtRowDraft} onAdd={onAddCtRow} onEdit={onEditCtRow} onCancel={onCancelCtRow} onSave={onSaveCtRow} onRemove={onRemoveCtRow} onReorder={onReorderCtRows} /><ClinicalCtAdvancedTechniqueEditor detail={detail} scanners={scanners} editable={editable} /></> : <MriProtocolRows detail={detail} scanners={scanners} presets={mriSequencePresets} draft={mriRowDraft} editingRowId={editingMriRowId} editable={editable} setDraft={setMriRowDraft} onAdd={onAddMriRow} onEdit={onEditMriRow} onCancel={onCancelMriRow} onSave={onSaveMriRow} onRemove={onRemoveMriRow} onReorder={onReorderMriRows} />}
    </div>
  );
}

function nextMinorVersion(version: string): string {
  const [major, minor] = version.split(".").map(Number);
  return `${Number.isFinite(major) ? major : 1}.${Number.isFinite(minor) ? minor + 1 : 1}`;
}

function nextMajorVersion(version: string): string {
  const major = Number(version.split(".")[0]);
  return `${Number.isFinite(major) ? major + 1 : 2}.0`;
}

type CtPhaseDisplayRow = { timingType: string | null; timingOverride: string | null; delaySeconds: number | null; bolusTrackingSite?: string | null; triggerHu?: number | null; postTriggerDelaySeconds?: number | null; coverageOverride: string | null; reconstructionOverride: string | null; instructionsOverride: string | null; presetContrastStatus?: string | null; presetTimingType?: string | null; presetDelaySeconds?: number | null; presetBolusTrackingSite?: string | null; presetTriggerHu?: number | null; presetDefaultCoverage?: string | null; presetReconstructionNotes?: string | null; presetInstructions?: string | null; };

function formatCtPhaseTiming(row: CtPhaseDisplayRow): string {
  if (row.timingType === "NON_CONTRAST") return "Non-contrast";
  if (row.timingType === "FIXED_DELAY_INJECTION_START") return `${row.delaySeconds ?? 0} sec after start of IV contrast`;
  if (row.timingType === "FIXED_DELAY_INJECTION_END") return `${row.delaySeconds ?? 0} sec after completion of IV contrast`;
  if (row.timingType === "BOLUS_TRACKING") return ["Bolus tracking", row.bolusTrackingSite, row.triggerHu == null ? null : `${row.triggerHu} HU`, row.postTriggerDelaySeconds ? `+${row.postTriggerDelaySeconds} sec` : null].filter(Boolean).join(" · ");
  if (row.presetContrastStatus === "NON_CONTRAST") return "Non-contrast";
  if (row.presetTimingType === "FIXED_DELAY") return `Fixed delay${row.presetDelaySeconds == null ? "" : ` · ${row.presetDelaySeconds} sec`} (legacy preset)`;
  if (row.presetTimingType === "BOLUS_TRACKING") return ["Bolus tracking", row.presetBolusTrackingSite, row.presetTriggerHu == null ? null : `${row.presetTriggerHu} HU`].filter(Boolean).join(" · ");
  return row.timingOverride ?? row.presetInstructions ?? "Timing not specified";
}

function effectiveCtPhaseCoverage(row: CtPhaseDisplayRow): string | null { return row.coverageOverride ?? row.presetDefaultCoverage ?? null; }
function effectiveCtPhaseReconstruction(row: CtPhaseDisplayRow): string | null { return row.reconstructionOverride ?? row.presetReconstructionNotes ?? null; }
function effectiveCtPhaseInstructions(row: CtPhaseDisplayRow): string | null { return row.instructionsOverride ?? row.presetInstructions ?? null; }

function CtProtocolSummary({ detail }: { detail: ProtocolLibraryVersionDetail }) {
  return <section className="rounded-lg border p-4 text-sm" style={{ borderColor: "var(--border)" }}><h3 className="font-semibold">CT protocol summary</h3><p className="mt-1">{detail.protocol.name} · Version {detail.version.versionNumber} · {detail.version.status}</p>{detail.protocol.indication ? <p>Indication: {detail.protocol.indication}</p> : null}{detail.version.protocolNotes ? <p>Notes: {detail.version.protocolNotes}</p> : null}<ol className="mt-2 list-decimal space-y-1 ps-5">{detail.ctPhases.map((phase) => <li key={phase.id}>{phase.customPhaseName ?? phase.ctPhasePresetName ?? "Unnamed phase"} — {formatCtPhaseTiming(phase)}{effectiveCtPhaseCoverage(phase) ? ` — ${effectiveCtPhaseCoverage(phase)}` : ""}</li>)}</ol>{detail.ctTechniques.length ? <p className="mt-2">Techniques: {detail.ctTechniques.map((technique) => [technique.scannerName, technique.kvMode, technique.tubeCurrentMode, technique.reconstructionMethod].filter(Boolean).join(" · ")).join("; ")}</p> : null}</section>;
}

function techniquePayloadFromRow(row: ProtocolLibraryCtTechniqueRow): ProtocolLibraryCtTechniquePayload {
  return {
    scannerId: row.scannerId,
    kvMode: row.kvMode,
    kvp: row.kvp,
    tubeCurrentMode: row.tubeCurrentMode,
    fixedMa: row.fixedMa,
    referenceMas: row.referenceMas,
    exposureControl: row.exposureControl,
    noiseIndex: row.noiseIndex,
    minMa: row.minMa,
    maxMa: row.maxMa,
    reconstructionMethod: row.reconstructionMethod,
    reconstructionStrength: row.reconstructionStrength,
    reconstructionImageDefinition: row.reconstructionImageDefinition,
    sliceThicknessMm: row.sliceThicknessMm,
    reconstructionIntervalMm: row.reconstructionIntervalMm,
    kernel: row.kernel,
  };
}

function emptyTechniquePayload(scannerId: number): ProtocolLibraryCtTechniquePayload {
  return { scannerId, kvMode: null, kvp: null, tubeCurrentMode: null, fixedMa: null, referenceMas: null, exposureControl: null, noiseIndex: null, minMa: null, maxMa: null, reconstructionMethod: null, reconstructionStrength: null, reconstructionImageDefinition: null, sliceThicknessMm: null, reconstructionIntervalMm: null, kernel: null };
}

function techniqueLabel(row: ProtocolLibraryCtTechniqueRow): string {
  return row.scannerName || [row.scannerVendor, row.scannerModel].filter(Boolean).join(" ") || "Scanner technique";
}

function techniqueSummary(row: ProtocolLibraryCtTechniqueRow): string[] {
  const vendor = `${row.scannerVendor ?? ""} ${row.scannerModel ?? ""}`.toLowerCase();
  const exposure = row.tubeCurrentMode === "AUTOMATIC"
    ? [row.exposureControl ?? (vendor.includes("ge") ? "SmartmA" : vendor.includes("philips") ? "DoseRight / AEC" : "Automatic modulation"), row.noiseIndex != null ? `NI ${row.noiseIndex}` : null].filter(Boolean).join(" · ")
    : row.tubeCurrentMode === "FIXED_MA" && row.fixedMa != null ? `${row.fixedMa} mA` : row.tubeCurrentMode === "REFERENCE_MAS" && row.referenceMas != null ? `${row.referenceMas} mAs` : null;
  const currentRange = row.minMa != null && row.maxMa != null ? `${row.minMa}–${row.maxMa} mA` : row.minMa != null ? `min ${row.minMa} mA` : row.maxMa != null ? `max ${row.maxMa} mA` : null;
  const reconstruction = row.reconstructionMethod === "Precise Image"
    ? [row.reconstructionMethod, row.reconstructionImageDefinition, row.reconstructionStrength].filter(Boolean).join(" · ")
    : [row.reconstructionMethod, row.reconstructionStrength ? `${row.reconstructionStrength}%` : null].filter(Boolean).join(" ");
  const geometry = row.sliceThicknessMm != null && row.reconstructionIntervalMm != null ? `${row.sliceThicknessMm} / ${row.reconstructionIntervalMm} mm` : row.sliceThicknessMm != null ? `${row.sliceThicknessMm} mm slice` : row.reconstructionIntervalMm != null ? `${row.reconstructionIntervalMm} mm interval` : null;
  return [row.kvMode === "AUTO" ? "Auto kV" : row.kvMode === "FIXED" && row.kvp != null ? `${row.kvp} kVp` : null, exposure, currentRange || null, reconstruction || null, geometry, row.kernel].filter((value): value is string => Boolean(value));
}

function ClinicalCtAdvancedTechniqueEditor({ detail, scanners, editable }: { detail: ProtocolLibraryVersionDetail; scanners: ImagingScanner[]; editable: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scannerId, setScannerId] = useState("");
  const [draft, setDraft] = useState<ProtocolLibraryCtTechniquePayload | null>(null);
  const [initialDraft, setInitialDraft] = useState<ProtocolLibraryCtTechniquePayload | null>(null);
  const [editing, setEditing] = useState(false);
  const [removeScannerId, setRemoveScannerId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<"collapse" | { type: "scanner"; value: string } | null>(null);
  const mutation = useMutation({ mutationFn: (payload: ProtocolLibraryCtTechniquePayload) => upsertProtocolLibraryCtTechnique(detail.version.id, payload), onSuccess: async () => { setDraft(null); setInitialDraft(null); setEditing(false); await queryClient.invalidateQueries({ queryKey: ["doctor", "protocol-library", "protocol-version", detail.version.id] }); } });
  const removeMutation = useMutation({ mutationFn: (id: number) => deleteProtocolLibraryCtTechnique(detail.version.id, id), onSuccess: async () => { setRemoveScannerId(null); setScannerId(""); setDraft(null); setInitialDraft(null); setEditing(false); await queryClient.invalidateQueries({ queryKey: ["doctor", "protocol-library", "protocol-version", detail.version.id] }); } });
  const ctScanners = scanners.filter((scanner) => scanner.isActive && scanner.modality === "CT");
  const selectedScanner = ctScanners.find((scanner) => String(scanner.id) === scannerId) ?? null;
  const existing = detail.ctTechniques.find((item) => String(item.scannerId) === scannerId) ?? null;
  const vendor = selectedScanner?.vendor?.toLowerCase() ?? existing?.scannerVendor?.toLowerCase() ?? "";
  const dirty = Boolean(draft && initialDraft && JSON.stringify(draft) !== JSON.stringify(initialDraft));
  const normalizedTechnique = (value: ProtocolLibraryCtTechniquePayload): ProtocolLibraryCtTechniquePayload => {
    const normalized = value.tubeCurrentMode === "AUTOMATIC" ? { ...value, fixedMa: null, referenceMas: null } : value.tubeCurrentMode === "FIXED_MA" ? { ...value, referenceMas: null, noiseIndex: null, minMa: null, maxMa: null } : value.tubeCurrentMode === "REFERENCE_MAS" ? { ...value, fixedMa: null, noiseIndex: null, minMa: null, maxMa: null } : value;
    return { ...normalized, kvp: normalized.kvMode === "AUTO" ? null : normalized.kvp };
  };
  const begin = () => { if (!selectedScanner) return; const next = existing ? techniquePayloadFromRow(existing) : emptyTechniquePayload(selectedScanner.id); setDraft(next); setInitialDraft(next); setEditing(true); };
  const discardPendingAction = () => { if (pendingAction && pendingAction !== "collapse") setScannerId(pendingAction.value); setDraft(null); setInitialDraft(null); setEditing(false); if (pendingAction === "collapse") setOpen(false); setPendingAction(null); };
  const changeScanner = (value: string) => { if (dirty) { setPendingAction({ type: "scanner", value }); return; } setScannerId(value); setDraft(null); setInitialDraft(null); setEditing(false); };
  const toggleOpen = () => { if (open && dirty) { setPendingAction("collapse"); return; } setOpen((value) => !value); };
  return <section className="rounded-lg border" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }} data-testid="advanced-technique-section">
    <button type="button" className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-start" aria-expanded={open} onClick={toggleOpen}>
      <span><span className="block text-sm font-semibold">Advanced technique</span><span className="mt-0.5 block text-xs font-normal" style={{ color: "var(--text-muted)" }}>Scanner-specific acquisition and reconstruction settings</span></span>
      <span className="flex shrink-0 items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-muted)" }}>{detail.ctTechniques.length ? `${detail.ctTechniques.length} scanner${detail.ctTechniques.length === 1 ? "" : "s"} configured` : "No scanner-specific techniques"}{open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}</span>
    </button>
    {open ? <div className="space-y-3 border-t px-3 py-3" style={{ borderColor: "var(--border)" }}>
      {detail.ctTechniques.length ? <div className="space-y-2">{detail.ctTechniques.map((technique) => <div key={technique.id} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{techniqueLabel(technique)}</p><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{techniqueSummary(technique).join(" · ") || "No populated settings"}</p></div>{editable ? <div className="flex shrink-0 items-center gap-1"><Button type="button" variant="secondary" size="sm" onClick={() => { setScannerId(String(technique.scannerId)); const next = techniquePayloadFromRow(technique); setDraft(next); setInitialDraft(next); setEditing(true); }}>Edit</Button><Button type="button" variant="ghost" size="sm" className="text-red-700" onClick={() => setRemoveScannerId(technique.scannerId)}>Remove</Button></div> : null}</div></div>)}</div> : <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>No scanner-specific techniques</p>}
      {editable ? <div className="flex flex-wrap items-end gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}><label className="min-w-64 flex-1 text-sm font-medium">Scanner technique<select aria-label="Scanner technique" className={inputClass()} value={scannerId} onChange={(event) => changeScanner(event.target.value)}><option value="">Select a scanner</option>{ctScanners.map((scanner) => <option key={scanner.id} value={scanner.id}>{[scanner.name, scanner.vendor, scanner.model].filter(Boolean).join(" · ")}</option>)}</select></label><Button type="button" variant="secondary" size="sm" disabled={!selectedScanner} onClick={begin}>{existing ? "Edit technique" : "Add scanner technique"}</Button></div> : null}
      {editing && draft && selectedScanner ? <CanonicalClinicalCtTechniqueFields current={draft} vendor={vendor} editable={editable} setDraft={setDraft} onSave={() => mutation.mutate(normalizedTechnique(draft))} onCancel={() => { if (dirty) setPendingAction("collapse"); else { setDraft(null); setInitialDraft(null); setEditing(false); } }} onRemove={existing ? () => setRemoveScannerId(existing.scannerId) : null} /> : null}
    </div> : null}
    <Dialog open={removeScannerId !== null} onClose={() => setRemoveScannerId(null)}><DialogContent maxWidth="460px"><DialogHeader><DialogTitle>Remove {detail.ctTechniques.find((item) => item.scannerId === removeScannerId)?.scannerName ?? "scanner"} technique?</DialogTitle><DialogDescription>This removes the saved scanner-specific settings from the current draft.</DialogDescription></DialogHeader><DialogFooter><Button variant="secondary" onClick={() => setRemoveScannerId(null)} disabled={removeMutation.isPending}>Cancel</Button><Button variant="destructive" onClick={() => removeScannerId !== null && removeMutation.mutate(removeScannerId)} disabled={removeMutation.isPending}>{removeMutation.isPending ? "Removing..." : "Remove technique"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={pendingAction !== null} onClose={() => setPendingAction(null)}><DialogContent maxWidth="460px"><DialogHeader><DialogTitle>Discard unsaved changes?</DialogTitle><DialogDescription>Advanced Technique has unsaved changes.</DialogDescription></DialogHeader><p className="text-sm">Keep editing or discard the scanner-specific changes made in this editor.</p><DialogFooter><Button variant="secondary" onClick={() => setPendingAction(null)}>Keep editing</Button><Button variant="destructive" onClick={discardPendingAction}>Discard changes</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}

function CanonicalClinicalCtTechniqueFields({ current, vendor, editable, setDraft, onSave, onCancel, onRemove }: { current: ProtocolLibraryCtTechniquePayload; vendor: string; editable: boolean; setDraft: (draft: ProtocolLibraryCtTechniquePayload) => void; onSave: () => void; onCancel: () => void; onRemove: (() => void) | null }) {
  return <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>
    <TechniqueFieldGroup title="Exposure"><Field label="kV mode"><select aria-label="kV mode" className={inputClass()} value={current.kvMode ?? ""} onChange={(event) => setDraft({ ...current, kvMode: (event.target.value || null) as ProtocolLibraryCtTechniquePayload["kvMode"] })}><option value="">Not specified</option><option value="AUTO">Automatic</option><option value="FIXED">Fixed</option></select></Field>{current.kvMode === "FIXED" ? <NumberField label="kVp" value={current.kvp} positive onChange={(value) => setDraft({ ...current, kvp: nullableNumber(value, true) })} /> : null}<Field label="Tube current mode"><select aria-label="Tube current mode" className={inputClass()} value={current.tubeCurrentMode ?? ""} onChange={(event) => setDraft({ ...current, tubeCurrentMode: (event.target.value || null) as ProtocolLibraryCtTechniquePayload["tubeCurrentMode"] })}><option value="">Not specified</option><option value="AUTOMATIC">{vendor.includes("ge") ? "SmartmA / automatic modulation" : vendor.includes("philips") ? "DoseRight / AEC" : "Automatic modulation"}</option><option value="FIXED_MA">Fixed mA</option><option value="REFERENCE_MAS">Reference mAs</option></select></Field>{current.tubeCurrentMode === "FIXED_MA" ? <NumberField label="Fixed mA" value={current.fixedMa} positive onChange={(value) => setDraft({ ...current, fixedMa: nullableNumber(value, true) })} /> : null}{current.tubeCurrentMode === "REFERENCE_MAS" ? <NumberField label="Reference mAs" value={current.referenceMas} positive onChange={(value) => setDraft({ ...current, referenceMas: nullableNumber(value, true) })} /> : null}{vendor.includes("ge") && current.tubeCurrentMode === "AUTOMATIC" ? <><Field label="Exposure control"><Input aria-label="Exposure control" value={textValue(current.exposureControl)} onChange={(event) => setDraft({ ...current, exposureControl: editableText(event.target.value) })} placeholder="SmartmA" /></Field><NumberField label="Noise Index" value={current.noiseIndex} onChange={(value) => setDraft({ ...current, noiseIndex: nullableNumber(value) })} /><NumberField label="Minimum mA" value={current.minMa} onChange={(value) => setDraft({ ...current, minMa: nullableNumber(value) })} /><NumberField label="Maximum mA" value={current.maxMa} onChange={(value) => setDraft({ ...current, maxMa: nullableNumber(value) })} /></> : null}{vendor.includes("philips") ? <Field label="Exposure control"><select aria-label="Exposure control" className={inputClass()} value={current.exposureControl ?? ""} onChange={(event) => setDraft({ ...current, exposureControl: editableText(event.target.value) })}><option value="">Not specified</option><option>DoseRight / AEC</option><option>Reference mAs</option></select></Field> : null}</TechniqueFieldGroup>
    <TechniqueFieldGroup title="Reconstruction"><Field label="Reconstruction method"><select aria-label="Reconstruction method" className={inputClass()} value={current.reconstructionMethod ?? ""} onChange={(event) => setDraft({ ...current, reconstructionMethod: editableText(event.target.value), reconstructionStrength: null, reconstructionImageDefinition: null })}><option value="">Not specified</option>{(vendor.includes("ge") ? ["FBP", "ASiR-V", "TrueFidelity", "Other"] : vendor.includes("philips") ? ["FBP", "iDose⁴", "Precise Image", "Other"] : ["FBP", "Other"]).map((value) => <option key={value}>{value}</option>)}</select></Field>{current.reconstructionMethod === "ASiR-V" ? <NumberField label="ASiR-V strength (%)" value={current.reconstructionStrength ? Number(current.reconstructionStrength) : null} onChange={(value) => setDraft({ ...current, reconstructionStrength: value || null })} /> : null}{current.reconstructionMethod === "TrueFidelity" ? <Field label="TrueFidelity strength"><select aria-label="TrueFidelity strength" className={inputClass()} value={current.reconstructionStrength ?? ""} onChange={(event) => setDraft({ ...current, reconstructionStrength: editableText(event.target.value) })}><option value="">Not specified</option><option>Low</option><option>Medium</option><option>High</option></select></Field> : null}{current.reconstructionMethod === "iDose⁴" ? <Field label="iDose⁴ level"><Input aria-label="iDose⁴ level" value={textValue(current.reconstructionStrength)} onChange={(event) => setDraft({ ...current, reconstructionStrength: editableText(event.target.value) })} /></Field> : null}{current.reconstructionMethod === "Precise Image" ? <><Field label="Precise Image definition"><select aria-label="Precise Image definition" className={inputClass()} value={current.reconstructionImageDefinition ?? ""} onChange={(event) => setDraft({ ...current, reconstructionImageDefinition: editableText(event.target.value) })}><option value="">Not specified</option><option>Soft Tissue</option><option>Bone</option><option>Lung</option></select></Field><Field label="Precise Image strength"><select aria-label="Precise Image strength" className={inputClass()} value={current.reconstructionStrength ?? ""} onChange={(event) => setDraft({ ...current, reconstructionStrength: editableText(event.target.value) })}><option value="">Not specified</option>{["Smoother", "Smooth", "Standard", "Sharp", "Sharper"].map((value) => <option key={value}>{value}</option>)}</select></Field></> : null}</TechniqueFieldGroup>
    <TechniqueFieldGroup title="Image geometry"><NumberField label="Slice thickness (mm)" value={current.sliceThicknessMm} onChange={(value) => setDraft({ ...current, sliceThicknessMm: nullableNumber(value) })} /><NumberField label="Reconstruction interval (mm)" value={current.reconstructionIntervalMm} onChange={(value) => setDraft({ ...current, reconstructionIntervalMm: nullableNumber(value) })} /><Field label="Kernel"><Input aria-label="Kernel" value={textValue(current.kernel)} onChange={(event) => setDraft({ ...current, kernel: editableText(event.target.value) })} /></Field></TechniqueFieldGroup>
    {editable ? <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button><Button type="button" size="sm" onClick={onSave} disabled={!current.scannerId}>Save technique</Button>{onRemove ? <Button type="button" variant="destructive" size="sm" onClick={onRemove}>Remove</Button> : null}</div> : null}
  </div>;
}

function TechniqueFieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}><h4 className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>{title}</h4><div className="mt-2 grid gap-3 md:grid-cols-3">{children}</div></section>;
}

function normalizeCtPhasePayload(draft: ProtocolLibraryCtPhaseRowPayload): Partial<ProtocolLibraryCtPhaseRowPayload> {
  const base = { ctPhasePresetId: draft.ctPhasePresetId, customPhaseName: draft.customPhaseName, coverageOverride: draft.coverageOverride, isRequired: true };
  if (!draft.timingType) return base;
  if (draft.timingType === "NON_CONTRAST") return { ...base, timingType: draft.timingType, timingOverride: null, delaySeconds: null, bolusTrackingSite: null, triggerHu: null, postTriggerDelaySeconds: null };
  if (draft.timingType === "FIXED_DELAY_INJECTION_START" || draft.timingType === "FIXED_DELAY_INJECTION_END") return { ...base, timingType: draft.timingType, timingOverride: null, delaySeconds: draft.delaySeconds, bolusTrackingSite: null, triggerHu: null, postTriggerDelaySeconds: null };
  if (draft.timingType === "BOLUS_TRACKING") return { ...base, timingType: draft.timingType, timingOverride: null, delaySeconds: null, bolusTrackingSite: draft.bolusTrackingSite, triggerHu: draft.triggerHu, postTriggerDelaySeconds: draft.postTriggerDelaySeconds };
  return { ...base, timingType: draft.timingType, timingOverride: draft.timingOverride, delaySeconds: null, bolusTrackingSite: null, triggerHu: null, postTriggerDelaySeconds: null };
}

function CtProtocolRows({ detail, presets, draft, editingRowId, editable, setDraft, onAdd, onEdit, onCancel, onSave, onRemove, onReorder }: { detail: ProtocolLibraryVersionDetail; presets: CtPhasePreset[]; draft: ProtocolLibraryCtPhaseRowPayload | null; editingRowId: number | null; editable: boolean; setDraft: (draft: ProtocolLibraryCtPhaseRowPayload | null) => void; onAdd: () => void; onEdit: (row: ProtocolLibraryCtPhaseRow) => void; onCancel: () => void; onSave: (payload: Partial<ProtocolLibraryCtPhaseRowPayload>) => void; onRemove: (rowId: number) => void; onReorder: (rowIds: number[]) => void }) {
  const activePresets = presets.filter((preset) => preset.isActive);
  const [pendingRemove, setPendingRemove] = useState<ProtocolLibraryCtPhaseRow | null>(null);
  const move = (index: number, direction: -1 | 1) => {
    const rows = [...detail.ctPhases];
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    onReorder(rows.map((row) => row.id));
  };
  const renderEditor = () => draft && editable ? <CtProtocolRowForm draft={draft} presets={activePresets} setDraft={setDraft} onCancel={onCancel} onSave={() => onSave(normalizeCtPhasePayload(draft))} /> : null;
  return (
    <section className="space-y-3" aria-labelledby="ct-phases-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="ct-phases-heading" className="text-lg font-semibold">CT phases</h3>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>{detail.ctPhases.length ? `${detail.ctPhases.length} acquisition${detail.ctPhases.length === 1 ? "" : "s"} in scan order` : "Build the protocol in scan order"}</p>
        </div>
        {editable && <AddButton label={detail.ctPhases.length ? "Add phase" : "Add first phase"} onClick={onAdd} />}
      </div>
      <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
        {detail.ctPhases.length === 0 && !draft ? <div className="px-4 py-8 text-center">
          <p className="text-sm font-semibold">No phases yet</p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>Build this CT protocol by adding acquisitions in scan order.</p>
          {editable ? <Button type="button" size="sm" className="mt-4" onClick={onAdd}>Add first phase</Button> : null}
        </div> : null}
        {draft && editable && editingRowId === null ? <div className="border-b p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>{renderEditor()}</div> : null}
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {detail.ctPhases.map((row, index) => {
            const phaseName = row.customPhaseName ?? row.ctPhasePresetName ?? "Unnamed phase";
            return <div key={row.id} className="px-3 py-3">
              <div className="grid gap-3 md:grid-cols-[2rem_minmax(10rem,1.15fr)_minmax(17rem,2fr)_minmax(13rem,1.35fr)_auto] md:items-center">
                <div className="flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }} aria-label={`Phase ${row.orderIndex}`}>{row.orderIndex}</div>
                <div className="min-w-0"><p className="font-semibold leading-5">{phaseName}</p><p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>{row.isRequired ? "Required acquisition" : "Optional acquisition"}</p></div>
                <div className="min-w-0"><p className="text-sm leading-5">{formatCtPhaseTiming(row)}</p>{effectiveCtPhaseInstructions(row) ? <p className="mt-0.5 truncate text-xs" title={effectiveCtPhaseInstructions(row) ?? undefined} style={{ color: "var(--text-muted)" }}>{effectiveCtPhaseInstructions(row)}</p> : null}</div>
                <div className="min-w-0"><p className="text-sm leading-5">{effectiveCtPhaseCoverage(row) ?? "Coverage not specified"}</p>{effectiveCtPhaseReconstruction(row) ? <p className="mt-0.5 truncate text-xs" title={effectiveCtPhaseReconstruction(row) ?? undefined} style={{ color: "var(--text-muted)" }}>{effectiveCtPhaseReconstruction(row)}</p> : null}</div>
                {editable ? <PhaseActions phaseName={phaseName} onEdit={() => onEdit(row)} onRemove={() => setPendingRemove(row)} onMoveUp={() => move(index, -1)} onMoveDown={() => move(index, 1)} first={index === 0} last={index === detail.ctPhases.length - 1} editing={editingRowId === row.id} /> : <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>Read-only</span>}
              </div>
              {draft && editable && editingRowId === row.id ? <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}>{renderEditor()}</div> : null}
            </div>;
          })}
        </div>
      </div>
      <Dialog open={pendingRemove !== null} onClose={() => setPendingRemove(null)}>
        <DialogContent maxWidth="460px">
          <DialogHeader><DialogTitle>Remove {pendingRemove?.customPhaseName ?? pendingRemove?.ctPhasePresetName ?? "phase"} phase?</DialogTitle><DialogDescription>This removes the phase from the current draft.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="secondary" onClick={() => setPendingRemove(null)}>Cancel</Button><Button variant="destructive" onClick={() => { if (pendingRemove) onRemove(pendingRemove.id); setPendingRemove(null); }}>Remove phase</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CtProtocolRowForm({ draft, presets, setDraft, onSave, onCancel }: { draft: ProtocolLibraryCtPhaseRowPayload; presets: CtPhasePreset[]; setDraft: (draft: ProtocolLibraryCtPhaseRowPayload | null) => void; onSave: () => void; onCancel: () => void }) {
  const selectedPreset = presets.find((preset) => preset.id === draft.ctPhasePresetId) ?? null;
  const legacyPreset = Boolean(draft.ctPhasePresetId && !draft.timingType);
  const effectiveCoverage = draft.coverageOverride?.trim() || selectedPreset?.defaultCoverage?.trim() || null;
  return (
    <div className="space-y-3" role="group" aria-label={`${draft.customPhaseName || "CT phase"} editor`}>
      {legacyPreset && <p className="text-xs" style={{ color: "var(--text-muted)" }}>Legacy preset: {selectedPreset?.name ?? "Unknown preset"} · {formatCtPhaseTiming({ ...draft, presetContrastStatus: selectedPreset?.contrastStatus, presetTimingType: selectedPreset?.timingType, presetDelaySeconds: selectedPreset?.delaySeconds, presetBolusTrackingSite: selectedPreset?.bolusTrackingSite, presetTriggerHu: selectedPreset?.triggerHu, presetInstructions: selectedPreset?.instructions })}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Phase name"><Input aria-label="Phase name" value={textValue(draft.customPhaseName)} onChange={(event) => setDraft({ ...draft, customPhaseName: editableText(event.target.value) })} /></Field>
        <Field label="Timing"><select aria-label="Timing" className={inputClass()} value={draft.timingType ?? ""} onChange={(event) => setDraft({ ...draft, timingType: (event.target.value || null) as ProtocolLibraryCtPhaseRowPayload["timingType"] })}>{legacyPreset && <option value="">Keep legacy preset timing</option>}<option value="NON_CONTRAST">Non-contrast</option><option value="FIXED_DELAY_INJECTION_START">Fixed delay after start</option><option value="FIXED_DELAY_INJECTION_END">Fixed delay after completion</option><option value="BOLUS_TRACKING">Bolus tracking</option><option value="MANUAL">Manual</option></select></Field>
      </div>
      {draft.timingType === "BOLUS_TRACKING" ? <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}><p className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>Trigger</p><div className="mt-2 grid gap-3 md:grid-cols-3"><Field label="Tracking site"><Input aria-label="Tracking site" value={textValue(draft.bolusTrackingSite)} onChange={(event) => setDraft({ ...draft, bolusTrackingSite: editableText(event.target.value) })} /></Field><NumberField label="Trigger threshold (HU)" value={draft.triggerHu} onChange={(value) => setDraft({ ...draft, triggerHu: nullableNumber(value) })} /><NumberField label="Post-trigger delay (sec)" value={draft.postTriggerDelaySeconds} onChange={(value) => setDraft({ ...draft, postTriggerDelaySeconds: nullableNumber(value) })} /></div></div> : null}
      {(draft.timingType === "FIXED_DELAY_INJECTION_START" || draft.timingType === "FIXED_DELAY_INJECTION_END") ? <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}><p className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>Timing</p><div className="mt-2 max-w-xs"><NumberField label={draft.timingType === "FIXED_DELAY_INJECTION_START" ? "Delay after start of IV contrast" : "Delay after completion of IV contrast"} value={draft.delaySeconds} onChange={(value) => setDraft({ ...draft, delaySeconds: nullableNumber(value) })} /></div></div> : null}
      {draft.timingType === "MANUAL" ? <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}><p className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>Timing</p><div className="mt-2"><Field label="Timing instructions"><Input aria-label="Timing instructions" value={textValue(draft.timingOverride)} onChange={(event) => setDraft({ ...draft, timingOverride: editableText(event.target.value) })} /></Field></div></div> : null}
      <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}><p className="text-xs font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>Coverage</p><div className="mt-2"><Field label="Coverage"><Input aria-label="Coverage" value={textValue(draft.coverageOverride)} onChange={(event) => setDraft({ ...draft, coverageOverride: editableText(event.target.value) })} /></Field></div></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><div>{selectedPreset && <p className="text-xs" style={{ color: "var(--text-muted)" }}>Preset reference: {selectedPreset.contrastStatus} · {selectedPreset.timingType} · {selectedPreset.defaultCoverage ?? "No default coverage"}</p>}</div><FormActions saving={false} saveLabel="Save phase" canSave={Boolean(draft.customPhaseName?.trim()) && Boolean(draft.timingType || legacyPreset) && Boolean(draft.ctPhasePresetId ? effectiveCoverage : draft.coverageOverride?.trim())} onSave={onSave} onCancel={onCancel} /></div>
    </div>
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

export function ProtocolingAppointmentWorkspace({ appointmentId, canAssign, onClose, onUpdated }: { appointmentId: number; canAssign: boolean; onClose: () => void; onUpdated?: () => void | Promise<void> }) {
  if (!canAssign) return null;
  return <ProtocolingWorklist canAssign={canAssign} embeddedAppointmentId={appointmentId} onEmbeddedClose={onClose} onEmbeddedUpdated={onUpdated} />;
}

function PhaseActions({ phaseName, first, last, editing, onEdit, onRemove, onMoveUp, onMoveDown }: { phaseName: string; first: boolean; last: boolean; editing: boolean; onEdit: () => void; onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void }) {
  return <div className="flex flex-wrap items-center justify-end gap-1">
    <Button type="button" variant="ghost" size="icon" disabled={first} onClick={onMoveUp} aria-label={`Move ${phaseName} phase up`} title={`Move ${phaseName} phase up`}><ChevronUp size={15} aria-hidden="true" /></Button>
    <Button type="button" variant="ghost" size="icon" disabled={last} onClick={onMoveDown} aria-label={`Move ${phaseName} phase down`} title={`Move ${phaseName} phase down`}><ChevronDown size={15} aria-hidden="true" /></Button>
    <Button type="button" variant="secondary" size="sm" onClick={onEdit} aria-label={editing ? `Editing ${phaseName} phase` : `Edit ${phaseName} phase`}>{editing ? "Editing" : "Edit"}</Button>
    <Button type="button" variant="ghost" size="sm" className="text-red-700" onClick={onRemove} aria-label={`Remove ${phaseName} phase`}>Remove</Button>
  </div>;
}

function EmbeddedProtocolingWorkspaceState({ loading, error, onRetry, onClose }: { loading: boolean; error: unknown; onRetry: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/45 p-2 sm:p-4" onClick={() => { if (!loading) onClose(); }} role="presentation" data-testid="protocoling-appointment-workspace-shell">
      <section className="relative flex max-h-[94vh] w-[96vw] max-w-2xl min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-label="Protocoling workspace" onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between border-b px-3 py-2.5 sm:px-4" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-lg font-bold text-foreground">Protocoling workspace</h2>
          <button type="button" onClick={onClose} className="rounded border p-1.5 font-semibold" aria-label="Close workspace" title="Close workspace"><X size={16} aria-hidden="true" /></button>
        </header>
        {loading ? (
          <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }} role="status" aria-live="polite">Loading appointment protocol details...</div>
        ) : (
          <div className="space-y-4 p-6">
            <p className="text-sm text-red-700" role="alert">{error instanceof Error ? error.message : "Unable to load appointment protocol details."}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onRetry} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white">Retry</button>
              <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Close</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MriProtocolCreateForm({ draft, anatomy, saving, setDraft, onManageAnatomy, onSave, onCancel }: { draft: ProtocolLibraryProtocolPayload; anatomy: ProtocolAnatomyRegion[]; saving: boolean; setDraft: (draft: ProtocolLibraryProtocolPayload | null) => void; onManageAnatomy: () => void; onSave: () => void; onCancel: () => void }) {
  return <tr><td colSpan={6} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-3"><Field label="Protocol name"><input aria-label="Protocol name" className={inputClass()} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field><Field label="Anatomy region"><select aria-label="Anatomy region" className={inputClass()} value={draft.anatomyRegionId ?? ""} onChange={(event) => setDraft({ ...draft, anatomyRegionId: event.target.value ? Number(event.target.value) : null })}><option value="">No region</option>{anatomy.filter((region) => region.isActive && (region.modalityScope === "MRI" || region.modalityScope === "BOTH")).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></Field><Field label="Category"><select aria-label="Category" className={inputClass()} value={draft.category ?? ""} onChange={(event) => setDraft({ ...draft, category: editableText(event.target.value) })}><option value="">Not specified</option>{PROTOCOL_CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Indication"><input aria-label="Indication" className={inputClass()} value={textValue(draft.indication)} onChange={(event) => setDraft({ ...draft, indication: editableText(event.target.value) })} /></Field><Field label="IV contrast policy"><select aria-label="IV contrast policy" className={inputClass()} value={draft.contrastPolicy ?? ""} onChange={(event) => setDraft({ ...draft, contrastPolicy: editableText(event.target.value) })}><option value="">Not specified</option>{IV_CONTRAST_POLICIES.map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Oral contrast policy"><input aria-label="Oral contrast policy" className={inputClass()} value={textValue(draft.oralContrastPolicy)} onChange={(event) => setDraft({ ...draft, oralContrastPolicy: editableText(event.target.value) })} /></Field><Field label="Bowel preparation"><input aria-label="Bowel preparation" className={inputClass()} value={textValue(draft.bowelPreparation)} onChange={(event) => setDraft({ ...draft, bowelPreparation: editableText(event.target.value) })} /></Field><Field label="Preparation notes"><textarea aria-label="Preparation notes" className={`${inputClass()} min-h-20`} value={textValue(draft.preparationNotes)} onChange={(event) => setDraft({ ...draft, preparationNotes: editableText(event.target.value) })} /></Field><Field label="Initial change summary"><input aria-label="Initial change summary" className={inputClass()} value={textValue(draft.changeSummary)} onChange={(event) => setDraft({ ...draft, changeSummary: editableText(event.target.value) })} /></Field><Field label="Protocol notes"><textarea aria-label="Protocol notes" className={`${inputClass()} min-h-24`} value={textValue(draft.protocolNotes)} onChange={(event) => setDraft({ ...draft, protocolNotes: editableText(event.target.value) })} /></Field><div className="md:col-span-3"><button type="button" className="text-xs underline" onClick={onManageAnatomy}>Manage anatomy regions</button></div><FormActions saving={saving} saveLabel="Create" canSave={Boolean(draft.name.trim())} onSave={onSave} onCancel={onCancel} /></div></td></tr>;
}

function ProtocolingWorklist({ canAssign, embeddedAppointmentId, onEmbeddedClose, onEmbeddedUpdated }: { canAssign: boolean; embeddedAppointmentId?: number; onEmbeddedClose?: () => void; onEmbeddedUpdated?: () => void | Promise<void> }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(addDays(todayIso(), 7));
  const [modality, setModality] = useState<"" | "CT" | "MRI">("");
  const [protocolStatus, setProtocolStatus] = useState<"NOT_PROTOCOLLED" | "ASSIGNED" | "ALL">("NOT_PROTOCOLLED");
  const [appointmentStatus, setAppointmentStatus] = useState<"" | "scheduled" | "arrived" | "waiting" | "completed" | "no-show">("");
  const [waitingFirst, setWaitingFirst] = useState(false);
  const [search, setSearch] = useState("");
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const embedded = embeddedAppointmentId !== undefined;
  const selectedAppointmentId = embeddedAppointmentId ?? (() => {
    const appointmentId = Number(new URLSearchParams(location.search).get("appointmentId"));
    return Number.isInteger(appointmentId) && appointmentId > 0 ? appointmentId : null;
  })();
  const updateSelectedAppointment = useCallback((appointmentId: number | null) => {
    if (embeddedAppointmentId !== undefined) {
      if (appointmentId === null) onEmbeddedClose?.();
      return;
    }
    const params = new URLSearchParams(location.search);
    if (appointmentId === null) {
      params.delete("appointmentId");
    } else {
      params.set("appointmentId", String(appointmentId));
    }
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : "" }, { replace: true });
  }, [embeddedAppointmentId, location.pathname, location.search, navigate, onEmbeddedClose]);

  const filters = useMemo(() => ({
    dateFrom,
    dateTo,
    modality: modality || null,
    protocolStatus,
    appointmentStatus: appointmentStatus || null,
    waitingFirst: !appointmentStatus && waitingFirst,
    search: nullableText(search),
  }), [dateFrom, dateTo, modality, protocolStatus, appointmentStatus, waitingFirst, search]);

  const appointmentsQuery = useQuery({
    queryKey: ["doctor", "protocoling", "appointments", filters],
    queryFn: () => fetchDoctorProtocolingAppointments(filters),
    enabled: canAssign && !embedded,
    refetchInterval: canAssign && !embedded ? PROTOCOLING_WORKLIST_REFRESH_MS : false,
    refetchIntervalInBackground: false,
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
    enabled: canAssign && selectedAppointmentId !== null,
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
    setAssignmentError(null);
    updateSelectedAppointment(null);
  };
  const openAssignmentModal = (appointmentId: number) => {
    setAssignmentError(null);
    updateSelectedAppointment(appointmentId);
  };
  const navigateWorklist = (direction: -1 | 1) => {
    if (selectedAppointmentId === null) return;
    const currentIndex = appointments.findIndex((item) => item.appointmentId === selectedAppointmentId);
    const target = currentIndex >= 0 ? appointments[currentIndex + direction] : null;
    if (!target) return;
    setAssignmentError(null);
    updateSelectedAppointment(target.appointmentId);
  };
  const handleAssignmentSuccess = async (message: string, currentAppointmentId: number, assignNext: boolean) => {
    const currentIndex = appointments.findIndex((item) => item.appointmentId === currentAppointmentId);
    const next = assignNext && currentIndex >= 0 ? appointments[currentIndex + 1] : null;
    await invalidate();
    await onEmbeddedUpdated?.();
    if (assignNext && next) {
      updateSelectedAppointment(next.appointmentId);
    } else if (assignNext) {
      updateSelectedAppointment(currentAppointmentId);
    } else {
      updateSelectedAppointment(null);
    }
    setAssignmentError(null);
    pushToast({ type: "success", title: assignNext && !next ? `${message} No more matching appointments.` : message });
  };
  const handleAssignmentError = (error: unknown) => {
    setAssignmentError(error instanceof Error ? error.message : "Unable to save protocol assignment.");
  };

  if (embedded && !selectedDetail) {
    return <EmbeddedProtocolingWorkspaceState
      loading={appointmentDetailQuery.isLoading || appointmentDetailQuery.isFetching}
      error={appointmentDetailQuery.error}
      onRetry={() => void appointmentDetailQuery.refetch()}
      onClose={() => onEmbeddedClose?.()}
    />;
  }

  return (
    <section className={embeddedAppointmentId !== undefined ? "contents" : "space-y-4"}>
      {embeddedAppointmentId === undefined ? <>
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
        <DateInput label="From" value={dateFrom} onChange={setDateFrom} />
        <DateInput label="To" value={dateTo} onChange={setDateTo} />
        <label className="text-sm font-medium">Modality<select value={modality} onChange={(event) => setModality(event.target.value as "" | "CT" | "MRI")} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">All</option><option value="CT">CT</option><option value="MRI">MRI</option></select></label>
        <label className="text-sm font-medium">Protocol status<select value={protocolStatus} onChange={(event) => setProtocolStatus(event.target.value as "NOT_PROTOCOLLED" | "ASSIGNED" | "ALL")} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="NOT_PROTOCOLLED">Not protocolled</option><option value="ASSIGNED">Protocol assigned</option><option value="ALL">All</option></select></label>
        <label className="text-sm font-medium">Appointment status<select value={appointmentStatus} onChange={(event) => setAppointmentStatus(event.target.value as "" | "scheduled" | "arrived" | "waiting" | "completed" | "no-show")} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">All statuses</option><option value="scheduled">Scheduled</option><option value="arrived">Arrived</option><option value="waiting">Waiting</option><option value="completed">Completed</option><option value="no-show">No-show</option></select></label>
        <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={waitingFirst} onCheckedChange={(value) => setWaitingFirst(Boolean(value))} disabled={appointmentStatus !== ""} />Waiting patients first</label>
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
        <SettingsTable emptyText="No appointments need protocol assignment." headers={["Date/time", "Patient", "Age/sex", "Modality", "Exam", "Category", "Notes", "Appointment status", "Protocol status", "Assigned protocol", "Actions"]}>
          {appointments.map((appointment) => (
            <tr key={appointment.appointmentId} onClick={() => openAssignmentModal(appointment.appointmentId)} className="cursor-pointer hover:bg-slate-50">
              <Cell>{appointment.appointmentDate} {appointment.appointmentTime ?? ""}</Cell>
              <Cell>{protocolingPatientName(appointment)}</Cell>
              <Cell>{appointment.ageYears ?? "-"} / {appointment.sex ?? "-"}</Cell>
              <Cell>{appointment.modalityName ?? appointment.modalityCode}</Cell>
              <Cell>{appointment.examTypeName ?? "-"}</Cell>
              <Cell>{appointment.caseCategory ?? "-"}</Cell>
              <Cell><span className="block max-w-[16rem] truncate" title={appointment.clinicalNotes ?? undefined}>{appointment.clinicalNotes ?? "-"}</span></Cell>
              <Cell><AppointmentStatusBadge status={appointment.appointmentStatus} /></Cell>
              <Cell><div className="flex flex-wrap items-center gap-1"><ProtocolStatusBadge assigned={appointment.assignment !== null} />{appointment.latestComplementaryRecall ? <Badge variant={appointment.latestComplementaryRecall.status === "completed" ? "success" : appointment.latestComplementaryRecall.status === "cancelled" ? "neutral" : appointment.latestComplementaryRecall.status === "pending_scheduling" ? "warning" : "info"} size="sm" className={appointment.latestComplementaryRecall.status === "pending_scheduling" ? "border-amber-300 bg-amber-50 text-amber-800" : ""}>{appointment.latestComplementaryRecall.status === "pending_scheduling" ? "Additional imaging pending · Needs booking" : appointment.latestComplementaryRecall.status === "scheduled" ? "Additional imaging pending · Scheduled" : appointment.latestComplementaryRecall.status === "completed" ? "Additional imaging completed" : "Additional imaging withdrawn"}</Badge> : null}{appointment.modalitySafetyWorkflowType === "mri_primary_implant_screening" ? <MriPrimaryScreeningBadges result={appointment.mriPrimaryScreeningResult} /> : null}</div></Cell>
              <Cell>{appointment.assignment ? (appointment.assignment.freeTextProtocol ? "Free-text protocol" : `${appointment.assignment.protocolName ?? "Saved protocol"} v${appointment.assignment.versionNumber ?? "-"}`) + (appointment.assignment.scannerName ? ` · ${appointment.assignment.scannerName}` : "") : "-"}</Cell>
              <Cell><button type="button" onClick={(event) => { event.stopPropagation(); openAssignmentModal(appointment.appointmentId); }} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>{appointment.assignment ? "Change" : "Assign"}</button></Cell>
            </tr>
          ))}
        </SettingsTable>
      )}

      </> : null}
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
          embedded={embedded}
          onNavigate={(direction) => navigateWorklist(direction)}
          onUpdated={onEmbeddedUpdated}
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
  embedded,
  onNavigate,
  onUpdated,
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
  embedded: boolean;
  onNavigate: (direction: -1 | 1) => void;
  onUpdated?: () => void | Promise<void>;
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
  const [recallDialogOpen, setRecallDialogOpen] = useState(false);
  const [withdrawRecallDialogOpen, setWithdrawRecallDialogOpen] = useState(false);
  const [reportEditorOpen, setReportEditorOpen] = useState(false);
  const [reportDraft, setReportDraft] = useState(appointment.requiresReport);
  const [reportOverride, setReportOverride] = useState<{ appointmentId: number; value: boolean } | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState({ right: 8, bottom: 56 });
  const actionMenuAnchorRef = useRef<HTMLDivElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const title = existing ? "Change assigned protocol" : "Assign protocol";
  const noActiveProtocolsMessage = `No active ${appointment.modalityCode} protocols are available. Enter a free-text protocol.`;
  const selectedProtocol = activeProtocols.find((protocol) => String(protocol.id) === protocolId) ?? null;
  const recallMutation = useMutation({ mutationFn: (payload: Parameters<typeof createComplementaryRecallRequest>[1]) => createComplementaryRecallRequest(appointment.appointmentId, payload), onSuccess: async () => { setRecallDialogOpen(false); await queryClient.invalidateQueries({ queryKey: ["doctor", "protocoling"] }); await onUpdated?.(); pushToast({ type: "success", title: "Additional imaging requested" }); } });
  const withdrawRecallMutation = useMutation({ mutationFn: () => withdrawComplementaryRecallRequest(appointment.activeComplementaryRecall!.id), onSuccess: async () => { setWithdrawRecallDialogOpen(false); await queryClient.invalidateQueries({ queryKey: ["doctor", "protocoling"] }); await onUpdated?.(); pushToast({ type: "success", title: "Additional imaging withdrawn" }); } });
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
      await onUpdated?.();
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
      await onUpdated?.();
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
  const historyItems = useMemo(() => historyQuery.data?.items ?? [], [historyQuery.data?.items]);
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
      if (embedded) return;
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement).tagName) && !(event.target as HTMLElement).isContentEditable) {
        if (event.key === "ArrowLeft" && worklistPosition > 1) { event.preventDefault(); requestNavigate(-1); }
        if (event.key === "ArrowRight" && worklistPosition > 0 && worklistPosition < worklistTotal) { event.preventDefault(); requestNavigate(1); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actionMenuOpen, embedded, requestClose, requestNavigate, saving, worklistPosition, worklistTotal]);

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
              {appointment.latestComplementaryRecall ? <Badge variant={appointment.latestComplementaryRecall.status === "completed" ? "success" : appointment.latestComplementaryRecall.status === "cancelled" ? "neutral" : appointment.latestComplementaryRecall.status === "pending_scheduling" ? "warning" : "info"} size="sm" className={appointment.latestComplementaryRecall.status === "pending_scheduling" ? "border-amber-300 bg-amber-50 text-amber-800" : ""}>{appointment.latestComplementaryRecall.status === "pending_scheduling" ? "Additional imaging pending · Needs booking" : appointment.latestComplementaryRecall.status === "scheduled" ? "Additional imaging pending · Scheduled" : appointment.latestComplementaryRecall.status === "completed" ? "Additional imaging completed" : "Additional imaging withdrawn"}</Badge> : null}
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
              {!embedded ? <div className="flex items-center gap-1 rounded-md border px-1 py-0.5" style={{ borderColor: "var(--border)" }}>
                <button type="button" onClick={() => requestNavigate(-1)} disabled={saving || worklistPosition <= 1} className="inline-flex h-7 w-7 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous appointment" title="Previous appointment"><ChevronLeft size={15} aria-hidden="true" /></button>
                {worklistPosition > 0 ? <span className="whitespace-nowrap px-1 text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>{worklistPosition} of {worklistTotal}</span> : null}
                <button type="button" onClick={() => requestNavigate(1)} disabled={saving || worklistPosition <= 0 || worklistPosition >= worklistTotal} className="inline-flex h-7 w-7 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next appointment" title="Next appointment"><ChevronRight size={15} aria-hidden="true" /></button>
              </div> : null}
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
                 <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="protocol-entry-pane">
                <MriPrimarySafetyPanel appointment={appointment} />
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
                   <div className="me-auto flex items-center gap-2">{appointment.appointmentStatus === "completed" && appointment.activeComplementaryRecall == null ? <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => setRecallDialogOpen(true)}>Request additional imaging</Button> : null}{appointment.activeComplementaryRecall?.status === "pending_scheduling" ? <Button type="button" variant="destructive" size="sm" disabled={saving || withdrawRecallMutation.isPending} onClick={() => setWithdrawRecallDialogOpen(true)}>Withdraw request</Button> : null}{annotationDirty ? <span className="text-xs font-semibold text-amber-700">Save document annotations before assigning the protocol.</span> : null}</div>
                    {hasMoreProtocolActions ? <div ref={actionMenuAnchorRef} className="relative">
                      <button type="button" disabled={saving} onClick={toggleActionMenu} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border" style={{ borderColor: "var(--border)" }} aria-label="More protocol actions" aria-expanded={actionMenuOpen} title="More protocol actions"><MoreVertical size={16} aria-hidden="true" /></button>
                      {actionMenuOpen ? createPortal(<div ref={actionMenuRef} className="fixed z-[100] w-40 rounded-lg border bg-background p-1 shadow-xl" style={{ borderColor: "var(--border)", right: actionMenuPosition.right, bottom: actionMenuPosition.bottom }} role="menu">
                        {printableSheet ? <button type="button" role="menuitem" disabled={saving} onClick={() => { setActionMenuOpen(false); printProtocolSheet(printableSheet); }} className="w-full rounded-md px-2 py-1.5 text-start text-xs font-semibold hover:bg-muted">Print protocol</button> : null}
                        {existing ? <button type="button" role="menuitem" disabled={saving} onClick={() => { setActionMenuOpen(false); onClear(); }} className="w-full rounded-md px-2 py-1.5 text-start text-xs font-semibold text-red-700 hover:bg-red-50">Clear assignment</button> : null}
                      </div>, document.body) : null}
                    </div> : null}
                   <button type="button" disabled={saving || annotationDirty || (protocolMode === "saved" ? !protocolId : !freeTextProtocol.trim())} onClick={() => onSave(payload(), false)} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>{saving ? "Saving..." : "Save"}</button>
                   {!embedded ? <button type="button" disabled={saving || annotationDirty || (protocolMode === "saved" ? !protocolId : !freeTextProtocol.trim())} onClick={() => onSave(payload(), true)} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white">Assign and next</button> : null}
                 </div>
               </aside>) : null}
             </div>
             </div>
          </>
        )}
        {detailsOpen ? <ProtocolingAppointmentDetailsDrawer key={appointment.appointmentId} appointment={appointment} onClose={() => setDetailsOpen(false)} /> : null}
        <ComplementaryRecallRequestDialog open={recallDialogOpen} onClose={() => setRecallDialogOpen(false)} examLabel={appointment.examTypeName ?? "Unspecified"} submitting={recallMutation.isPending} error={recallMutation.error instanceof Error ? recallMutation.error.message : null} onSubmit={(payload) => recallMutation.mutate(payload)} />
        <ComplementaryRecallWithdrawDialog open={withdrawRecallDialogOpen} status={appointment.activeComplementaryRecall?.status ?? "pending_scheduling"} submitting={withdrawRecallMutation.isPending} error={withdrawRecallMutation.error instanceof Error ? withdrawRecallMutation.error.message : null} onClose={() => setWithdrawRecallDialogOpen(false)} onConfirm={() => withdrawRecallMutation.mutate()} />
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
          coverage: effectiveCtPhaseCoverage(phase),
          reconstruction: effectiveCtPhaseReconstruction(phase),
          instructions: effectiveCtPhaseInstructions(phase),
          isRequired: phase.isRequired,
        }))
        : (selectedVersionDetail?.ctPhases ?? []).map((phase) => ({
          orderIndex: phase.orderIndex,
          phase: phase.customPhaseName ?? phase.ctPhasePresetName,
          timing: formatCtPhaseTiming(phase),
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
      {detail.version.protocolNotes ? <div className="mt-3 rounded border p-2 text-sm" style={{ borderColor: "var(--border)" }}><p className="font-semibold">Protocol notes</p><p className="mt-1 whitespace-pre-wrap">{detail.version.protocolNotes}</p></div> : null}
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
              <Cell>{formatCtPhaseTiming(phase)}</Cell>
              <Cell>{effectiveCtPhaseCoverage(phase) ?? "-"}</Cell>
              <Cell>{effectiveCtPhaseReconstruction(phase) ?? effectiveCtPhaseInstructions(phase) ?? "-"}</Cell>
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
          {assignmentDetail.ctPhases.map((phase) => <tr key={phase.id}><Cell>{phase.orderIndex}</Cell><Cell>{phase.customPhaseName ?? phase.ctPhasePresetName ?? "-"}</Cell><Cell>{formatCtPhaseTiming(phase)}</Cell><Cell>{effectiveCtPhaseCoverage(phase) ?? "-"}</Cell><Cell>{phase.isRequired ? "Yes" : "No"}</Cell></tr>)}
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
