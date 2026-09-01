import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api-client";
import { statusLabel, t } from "@/lib/i18n";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { useLanguage } from "@/providers/language-provider";
import { buildDicomUploadSelectionPlan, DicomStudyScanCancelledError, isLikelyDicomCandidate, previewDicomStudiesFromFiles, scanDicomStudiesFromFiles, type DicomScanFileEntry, type DicomStudyScanProgress, type DicomStudyScanResult } from "@/lib/dicom-study-scan";
import { retryDicomRemapWithOrthanc } from "@/lib/api/clinical-workflows";

type JobStatus = "uploaded" | "processing" | "awaiting_confirmation" | "remapped" | "sending" | "sent" | "failed" | "cancelled";
type RemapWizardUiStep = "source" | "patient" | "destination" | "review" | "processing";
type RemapProcessingStage =
  | "idle"
  | "uploading"
  | "staging"
  | "queued"
  | "validating"
  | "building_uid_plan"
  | "rewriting"
  | "uploading_to_orthanc"
  | "verifying_orthanc"
  | "orthanc_recovery"
  | "awaiting_send_confirmation"
  | "enqueueing_send"
  | "completed"
  | "failed";

type PatientLookupMode = "filtered_appointments" | "all_appointments" | "all_patients";
type SecureStagingStatus = "idle" | "uploading" | "awaiting_confirmation" | "failed";
type RemapHistoryScope = "mine" | "all";

interface ProvisionalSourceIdentity {
  studyInstanceUid: string;
  patientId: string;
  patientName: string;
  patientBirthDate: string;
  patientSex: string;
  modality: string;
  studyDate: string;
}

interface StagedConfirmationSnapshot {
  readonly selectedStudyInstanceUID: string;
  readonly risproPatientId: string;
  readonly destinationPacsKey: string;
}

interface ResumedJobSelection {
  studyInstanceUid: string;
  patientId: string;
  destinationKey: string;
  confirmChecked: boolean;
  patientLookupMode: PatientLookupMode;
  patientSearch: string;
}

interface RemapJob {
  id: number;
  created_by_user_id?: number;
  created_by_user_name?: string | null;
  created_by_username?: string | null;
  comparison_request_id?: number | null;
  status: JobStatus;
  source_orthanc_study_id: string | null;
  modified_orthanc_study_id: string | null;
  rispro_patient_id: number | null;
  destination_pacs_key: string | null;
  original_patient_id: string | null;
  original_patient_name: string | null;
  original_patient_sex: string | null;
  original_patient_birth_date: string | null;
  replacement_patient_id: string | null;
  replacement_patient_name: string | null;
  replacement_patient_sex: string | null;
  replacement_patient_birth_date: string | null;
  orthanc_send_job_id: string | null;
  send_attempt_count: number;
  send_error_code: string | null;
  send_error_details: unknown;
  error_message: string | null;
  cancellation_reason: string | null;
  processing_stage?: string | null;
  staged_file_count?: number | null;
  processed_file_count?: number | null;
  processing_skipped_file_count?: number | null;
  processing_attempt_count?: number | null;
  processing_started_at?: string | null;
  processing_last_heartbeat_at?: string | null;
  processing_error_code?: string | null;
  processing_error_details?: unknown;
  staging_cleanup_completed_at?: string | null;
  source_recovery_available?: boolean;
  dicom_integrity_version?: number | null;
  dicom_integrity_verified_at?: string | null;
  orthanc_recovery_status?: "none" | "available" | "processing" | "failed" | "completed" | null;
  orthanc_recovery_attempt_count?: number | null;
  orthanc_recovery_error_code?: string | null;
  orthanc_recovery_error_details?: unknown;
  orthanc_recovery_expires_at?: string | null;
  orthanc_recovery_stage?: string | null;
  orthanc_recovery_lease_expires_at?: string | null;
  staged_manifest_version?: number | null;
  staged_total_bytes?: number | null;
  selected_study_instance_uid?: string | null;
  provisional_source_identity?: ProvisionalSourceIdentity | null;
  processing_selection_counts?: {
    acceptedUniqueInstances?: number;
    failedSelectedStudyFiles?: number;
    excludedOtherStudyFiles?: number;
    unassignedLikelyDicomFiles?: number;
    partial?: boolean;
    completenessUncertain?: boolean;
    completeSeriesLossCount?: number;
    failureSample?: Array<{ fileLabel: string; category: string }>;
    acknowledgement?: { acknowledgedAt: string; acknowledgedByUserId: number };
  } | null;
}

function isAwaitingStagedJob(job: RemapJob | null | undefined): boolean {
  return Boolean(
    job
    && job.status === "awaiting_confirmation"
    && job.processing_stage === "awaiting_confirmation"
    && Number(job.staged_manifest_version) === 2
    && job.provisional_source_identity
  );
}

interface RemapComparison {
  original: { patientId: string; patientName: string; patientSex: string; patientBirthDate: string };
  replacement: { patientId: string; patientName: string; patientSex: string; patientBirthDate: string };
}

interface Destination {
  key: string;
  name: string;
  isDefault?: boolean;
}

const EMPTY_DESTINATIONS: Destination[] = [];
const RECENT_JOB_POLL_STATUSES = new Set<JobStatus>(["uploaded", "processing", "remapped", "sending"]);

interface PatientOption {
  id: number;
  arabic_full_name?: string;
  english_full_name?: string;
  national_id?: string | null;
  mrn?: string | null;
  sex?: string | null;
  date_of_birth?: string | null;
}

interface ReplacementPreview {
  patientId: string;
  patientName: string;
  patientSex: string;
  patientBirthDate: string;
}

interface TodayStudyOption {
  id: number;
  patient_id: number;
  accession_number: string;
  appointment_date: string;
  modality_id: number;
  modality_name_en?: string | null;
  modality_name_ar?: string | null;
  exam_name_en?: string | null;
  exam_name_ar?: string | null;
  arabic_full_name?: string | null;
  english_full_name?: string | null;
  national_id?: string | null;
  mrn?: string | null;
}

interface UploadMultipartResult {
  job: RemapJob;
  skippedFilesCount?: number;
}

interface ComparisonRemapContext {
  id: number;
  patientId: number;
  patientMrn: string | null;
  patientEnglishName: string | null;
  patientArabicName: string | null;
  linkedExamName: string | null;
  linkedStudyDate: string | null;
  linkedPreviousAccessionNumber: string | null;
  reason: string;
  status: string;
}

function formatTechnicalDetails(details: unknown): string {
  if (!details) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

function formatBytes(bytes: number): string {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatFallbackPatientLabel(language: string, id: number): string {
  return language === "ar" ? `مريض #${id}` : `Patient #${id}`;
}

function formatDirectoryPatientName(language: string, patient: PatientOption): string {
  return patient.english_full_name || patient.arabic_full_name || formatFallbackPatientLabel(language, patient.id);
}

function formatFallbackModalityLabel(language: string, id: number): string {
  return language === "ar" ? `موداليتي #${id}` : `Modality #${id}`;
}

function canResendJob(job: RemapJob | null | undefined): boolean {
  if (!job) return false;
  if (job.status !== "failed" || !job.send_error_code) return false;
  if (requiresDestinationCheck(job)) return false;
  return Boolean(job.destination_pacs_key && job.modified_orthanc_study_id && job.dicom_integrity_verified_at && Number(job.dicom_integrity_version) === 1);
}

function canRetryWithOrthanc(job: RemapJob | null | undefined): boolean {
  if (!job || job.status !== "failed" || !["available", "failed"].includes(job.orthanc_recovery_status || "")) return false;
  if (job.staging_cleanup_completed_at || !job.orthanc_recovery_expires_at) return false;
  return Date.parse(job.orthanc_recovery_expires_at) > Date.now();
}

function requiresDicomReupload(job: RemapJob | null | undefined): boolean {
  return Boolean(job && job.status === "failed" && job.processing_error_code && job.orthanc_recovery_status !== "processing" && !canRetryWithOrthanc(job));
}

function requiresDestinationCheck(job: RemapJob | null | undefined): boolean {
  return Boolean(job && [
    "ORTHANC_SEND_ENQUEUE_AMBIGUOUS",
    "ORTHANC_SEND_MONITOR_UNREACHABLE",
    "ORTHANC_SEND_MONITOR_NETWORK_FAILURE",
    "ORTHANC_SEND_STATE_UNKNOWN",
    "ORTHANC_SEND_JOB_NOT_FOUND",
  ].includes(job.send_error_code || ""));
}

function isSendFailedJob(job: RemapJob | null | undefined): boolean {
  if (!job || job.status !== "failed") return false;
  return Boolean(job.send_error_code && job.destination_pacs_key && job.modified_orthanc_study_id && job.dicom_integrity_verified_at && Number(job.dicom_integrity_version) === 1);
}

function processingStageLabel(language: string, stage: string | null | undefined): string {
  const labels: Record<string, [string, string]> = {
    staging: ["Staging upload", "تجهيز الرفع"], queued: ["Queued", "في الانتظار"], validating: ["Validating study", "التحقق من الدراسة"],
    building_uid_plan: ["Preparing UID remap", "تحضير تعيين UID"], rewriting: ["Rewriting DICOM", "إعادة كتابة DICOM"],
    uploading_to_orthanc: ["Uploading to Orthanc", "الرفع إلى Orthanc"], verifying_orthanc: ["Verifying study", "التحقق من الدراسة"],
    orthanc_recovery: ["Recovering with Orthanc", "الاسترداد باستخدام Orthanc"],
    enqueueing_send: ["Sending to PACS", "الإرسال إلى PACS"], completed: ["Completed", "مكتمل"], failed: ["Failed", "فشل"],
  };
  return labels[stage || ""]?.[language === "ar" ? 1 : 0] || (language === "ar" ? "قيد المعالجة" : "Processing");
}

function compactUid(value: string): string {
  if (value.length <= 28) return value;
  return `${value.slice(0, 12)}…${value.slice(-12)}`;
}

function oneLineReason(message: string | null | undefined): string {
  return String(message || "").replace(/\s+/g, " ").trim();
}

function resumedSelectionFromJob(job: RemapJob): ResumedJobSelection {
  return {
    studyInstanceUid: job.selected_study_instance_uid || job.provisional_source_identity?.studyInstanceUid || "",
    patientId: job.rispro_patient_id ? String(job.rispro_patient_id) : "",
    destinationKey: job.destination_pacs_key || "",
    confirmChecked: false,
    patientLookupMode: "filtered_appointments",
    patientSearch: "",
  };
}

function RemapProgressBar({
  label,
  value,
  max,
  detail,
  state = "active",
  compact = false,
}: {
  label: string;
  value?: number | null;
  max?: number | null;
  detail?: string;
  state?: "active" | "success" | "failed";
  compact?: boolean;
}) {
  const determinate = Number.isFinite(value) && Number.isFinite(max) && Number(max) > 0;
  const percent = determinate ? Math.min(100, Math.max(0, Math.round((Number(value) / Number(max)) * 100))) : null;
  const shownPercent = state === "success" ? 100 : percent;
  const ariaValueText = state === "failed" ? `${label}: ${detail || "Failed"}` : detail || (shownPercent != null ? `${shownPercent}%` : label);
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums">{shownPercent != null ? `${shownPercent}%` : detail}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={determinate || state === "success" ? 0 : undefined}
        aria-valuemax={determinate || state === "success" ? 100 : undefined}
        aria-valuenow={shownPercent ?? undefined}
        aria-valuetext={ariaValueText}
        data-state={state === "failed" ? "failed" : shownPercent == null ? "indeterminate" : state}
        className={`${compact ? "h-1.5" : "h-2.5"} overflow-hidden rounded-full bg-slate-200`}
        dir="ltr"
      >
        <div
          className={`h-full rounded-full ${state === "failed" ? "bg-red-500" : state === "success" ? "bg-emerald-600" : shownPercent == null ? "w-1/3 animate-pulse bg-teal-500" : "bg-teal-600"}`}
          style={shownPercent != null ? { width: `${shownPercent}%` } : undefined}
        />
      </div>
      {!compact && detail && shownPercent != null && <p className="text-xs text-slate-600">{detail}</p>}
    </div>
  );
}

function jobProgress(job: RemapJob): { value?: number; max?: number; state?: "active" | "success" | "failed" } {
  if (job.status === "sent") return { value: 1, max: 1, state: "success" };
  if (job.status === "failed" || job.status === "cancelled") return { state: "failed" };
  const stage = String(job.processing_stage || "");
  if (job.status === "processing" && ["building_uid_plan", "rewriting", "uploading_to_orthanc"].includes(stage)) {
    const max = Number(job.staged_file_count || 0);
    if (max > 0) return { value: Number(job.processed_file_count || 0), max };
  }
  return {};
}

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizePositiveJobId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function canRecoverSource(job: RemapJob | null | undefined): boolean {
  return Boolean(job && job.status === "failed" && job.source_recovery_available === true && !job.staging_cleanup_completed_at);
}

function normalizeRemapJob(value: unknown): RemapJob | null {
  if (!value || typeof value !== "object") return null;
  const id = normalizePositiveJobId((value as { id?: unknown }).id);
  return id == null ? null : { ...(value as RemapJob), id };
}

function requireNormalizedRemapJob(value: unknown): RemapJob {
  const job = normalizeRemapJob(value);
  if (!job) throw new Error("Response is missing a valid remap job ID.");
  return job;
}

function requirePositiveJobId(value: unknown): number {
  const jobId = normalizePositiveJobId(value);
  if (jobId == null) throw new Error("A valid remap job ID is required.");
  return jobId;
}

async function uploadMultipartWithProgress(
  path: string,
  formData: FormData,
  timeoutMs: number,
  onProgress: (loaded: number, total: number) => void,
  onUploadComplete?: () => void,
  signal?: AbortSignal,
): Promise<UploadMultipartResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      xhr.abort();
    }, timeoutMs);
    let uploadComplete = false;
    const abortFromSignal = () => xhr.abort();
    signal?.addEventListener("abort", abortFromSignal, { once: true });
    const cleanup = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromSignal);
    };
    const markUploadComplete = () => {
      if (uploadComplete) return;
      uploadComplete = true;
      onUploadComplete?.();
    };

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(event.loaded, event.total);
      if (event.total > 0 && event.loaded >= event.total) {
        markUploadComplete();
      }
    };
    xhr.upload.onload = () => {
      markUploadComplete();
    };
    xhr.upload.onloadend = () => {
      markUploadComplete();
    };
    xhr.open("POST", `/api${path}`, true);
    xhr.withCredentials = true;
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== XMLHttpRequest.DONE) return;
      cleanup();
      const raw = xhr.responseText || "{}";
      const body = (() => {
        try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
      })();
      if (xhr.status >= 200 && xhr.status < 300) {
        const job = (body as { job?: unknown }).job;
        if (!job || typeof job !== "object") {
          reject(new ApiError("Upload response is missing job details.", xhr.status, body));
          return;
        }
        const normalizedJob = normalizeRemapJob(job);
        if (!normalizedJob) {
          reject(new ApiError("Upload response is missing a valid job ID.", xhr.status, body));
          return;
        }
        const result: UploadMultipartResult = {
          job: normalizedJob,
          ...(typeof body.skippedFilesCount === "number" ? { skippedFilesCount: body.skippedFilesCount } : {}),
        };
        resolve(result);
        return;
      }
      const message = (body?.error as { message?: string } | undefined)?.message || (body?.message as string | undefined) || xhr.statusText || "Upload failed.";
      reject(new ApiError(message, xhr.status, (body?.error as { details?: unknown } | undefined)?.details ?? body?.details));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new ApiError("Network error during upload.", 0));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new ApiError(
        timedOut ? `Request timed out after ${Math.round(timeoutMs / 1000)}s.` : "Secure source staging was cancelled.",
        timedOut ? 408 : 499
      ));
    };
    xhr.send(formData);
  });
}

export default function PacsRemapPage() {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const comparisonRequestIdValue = Number(searchParams.get("comparisonRequestId") || 0);
  const comparisonRequestId = Number.isSafeInteger(comparisonRequestIdValue) && comparisonRequestIdValue > 0 ? comparisonRequestIdValue : null;
  const requestedReturnPath = String(searchParams.get("returnPath") || "");
  const comparisonReturnPath = comparisonRequestId && requestedReturnPath === `/comparisons/${comparisonRequestId}`
    ? requestedReturnPath
    : comparisonRequestId ? `/comparisons/${comparisonRequestId}` : "";
  const remapApiPath = (path: string) => {
    if (!comparisonRequestId) return path;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}comparisonRequestId=${comparisonRequestId}`;
  };
  const comparisonContextQuery = useQuery({
    queryKey: ["comparison-request", comparisonRequestId, "remap-context"],
    queryFn: () => api<{ comparisonRequest: ComparisonRemapContext }>(`/comparisons/${comparisonRequestId}`),
    enabled: comparisonRequestId != null,
    retry: 0,
  });
  const comparisonContext = comparisonContextQuery.data?.comparisonRequest ?? null;
  const [files, setFiles] = useState<File[]>([]);
  const [scanResult, setScanResult] = useState<DicomStudyScanResult | null>(null);
  const [selectedStudyInstanceUid, setSelectedStudyInstanceUid] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedDestinationKey, setSelectedDestinationKey] = useState("");
  const [patientLookupMode, setPatientLookupMode] = useState<PatientLookupMode>("filtered_appointments");
  const [patientSearch, setPatientSearch] = useState("");
  const [todayModalityFilter, setTodayModalityFilter] = useState("");
  const [studyDateMode, setStudyDateMode] = useState<"today" | "yesterday" | "custom">("today");
  const [customStudyDate, setCustomStudyDate] = useState(toIsoDate(new Date()));
  const [workflowJobId, setWorkflowJobId] = useState<number | null>(null);
  const [viewedRecentJobId, setViewedRecentJobId] = useState<number | null>(null);
  const [historyScope, setHistoryScope] = useState<RemapHistoryScope>("mine");
  const viewedRecentJobIdRef = useRef<number | null>(null);
  const [activeResumedJobId, setActiveResumedJobId] = useState<number | null>(null);
  const [resumedJobSelections, setResumedJobSelections] = useState<Record<number, ResumedJobSelection>>({});
  const [viewedProcessingStage, setViewedProcessingStage] = useState<RemapProcessingStage>("idle");
  const [autoResumeDismissed, setAutoResumeDismissed] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [errorDetails, setErrorDetails] = useState("");
  const [retryActionError, setRetryActionError] = useState("");
  const [retryActionErrorDetails, setRetryActionErrorDetails] = useState("");
  const [previewWarning, setPreviewWarning] = useState("");
  const [gatewayUploadLimitRejected, setGatewayUploadLimitRejected] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [resumedJobMessage, setResumedJobMessage] = useState("");
  const [completeScanStatus, setCompleteScanStatus] = useState<"idle" | "running" | "complete" | "failed" | "skipped">("idle");
  const [scanProgress, setScanProgress] = useState<DicomStudyScanProgress | null>(null);
  const [skipAcknowledged, setSkipAcknowledged] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [destinationCheckedForResend, setDestinationCheckedForResend] = useState(false);
  const [incompleteStudyAcknowledged, setIncompleteStudyAcknowledged] = useState(false);
  const [uploadLoaded, setUploadLoaded] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [secureStagingStatus, setSecureStagingStatus] = useState<SecureStagingStatus>("idle");
  const [pendingStagedConfirmation, setPendingStagedConfirmation] = useState<StagedConfirmationSnapshot | null>(null);
  const [uiStep, setUiStep] = useState<RemapWizardUiStep>("source");
  const [processingStage, setProcessingStage] = useState<RemapProcessingStage>("idle");
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const [showReAuthModal, setShowReAuthModal] = useState(false);
  const [retryClearAfterReAuth, setRetryClearAfterReAuth] = useState(false);
  const mainHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const focusHeadingAfterNavigationRef = useRef(false);
  const fullScanControllerRef = useRef<AbortController | null>(null);
  const stagingUploadControllerRef = useRef<AbortController | null>(null);
  const scanRunIdRef = useRef(0);
  const completedFullScanRunIdRef = useRef<number | null>(null);
  const previewUnavailableRunIdRef = useRef<number | null>(null);
  const latestPartialScanResultRef = useRef<DicomStudyScanResult | null>(null);
  const pendingStagedConfirmationRef = useRef<StagedConfirmationSnapshot | null>(null);
  const localWorkflowStepBeforeRecentRef = useRef<RemapWizardUiStep>("source");
  const localResumedJobIdBeforeRecentRef = useRef<number | null>(null);

  const clearPendingStagedConfirmation = useCallback((): void => {
    pendingStagedConfirmationRef.current = null;
    setPendingStagedConfirmation(null);
  }, []);

  const resumedJobSelection = activeResumedJobId == null ? null : resumedJobSelections[activeResumedJobId] || null;
  const scopedStudyInstanceUid = resumedJobSelection?.studyInstanceUid ?? selectedStudyInstanceUid;
  const scopedPatientId = comparisonRequestId
    ? (comparisonContext ? String(comparisonContext.patientId) : "")
    : resumedJobSelection?.patientId ?? selectedPatientId;
  const scopedDestinationKey = resumedJobSelection?.destinationKey ?? selectedDestinationKey;
  const scopedConfirmChecked = resumedJobSelection?.confirmChecked ?? confirmChecked;
  const scopedPatientLookupMode = resumedJobSelection?.patientLookupMode ?? patientLookupMode;
  const scopedPatientSearch = resumedJobSelection?.patientSearch ?? patientSearch;

  const updateResumedJobSelection = (updates: Partial<ResumedJobSelection>): void => {
    if (activeResumedJobId == null) return;
    setResumedJobSelections((current) => ({
      ...current,
      [activeResumedJobId]: { ...current[activeResumedJobId]!, ...updates },
    }));
  };
  const selectPatient = (patientId: string): void => {
    if (comparisonRequestId) return;
    if (activeResumedJobId == null) setSelectedPatientId(patientId);
    else updateResumedJobSelection({ patientId });
  };
  const selectDestination = (destinationKey: string): void => activeResumedJobId == null
    ? setSelectedDestinationKey(destinationKey)
    : updateResumedJobSelection({ destinationKey });
  const setScopedConfirmChecked = (checked: boolean): void => activeResumedJobId == null
    ? setConfirmChecked(checked)
    : updateResumedJobSelection({ confirmChecked: checked });
  const setScopedPatientLookupMode = (mode: PatientLookupMode): void => activeResumedJobId == null
    ? setPatientLookupMode(mode)
    : updateResumedJobSelection({ patientLookupMode: mode });
  const setScopedPatientSearch = (search: string): void => activeResumedJobId == null
    ? setPatientSearch(search)
    : updateResumedJobSelection({ patientSearch: search });

  const selectedScannedStudy = scanResult?.studies.find((study) => study.studyInstanceUid === scopedStudyInstanceUid) || null;
  const provisionalIdentityIsConsistent = useMemo(() => {
    const entries = selectedScannedStudy?.files || [];
    const values = (key: "patientId" | "patientName" | "patientBirthDate" | "patientSex") => new Set(entries
      .map((entry) => String(entry[key] || "").trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .map((value) => key === "patientName"
        ? value.split("^").map((part) => part.trim()).join("^").toUpperCase()
        : key === "patientSex" ? value.toUpperCase() : value));
    return ["patientId", "patientName", "patientBirthDate", "patientSex"]
      .every((key) => values(key as "patientId" | "patientName" | "patientBirthDate" | "patientSex").size <= 1);
  }, [selectedScannedStudy]);

  const destinationsQuery = useQuery({
    queryKey: ["pacs", "remap", "destinations"],
    queryFn: () => api<{ destinations: Destination[] }>(remapApiPath("/pacs/remap/destinations")),
  });
  const destinations = destinationsQuery.data?.destinations || EMPTY_DESTINATIONS;
  const defaultDestinationKey = useMemo(() => {
    if (destinations.length === 0) return "";
    const defaultDestination = destinations.find((destination) => destination.isDefault) || null;
    return defaultDestination?.key ?? (destinations.length === 1 ? destinations[0]!.key : "");
  }, [destinations]);
  const effectiveSelectedDestinationKey = activeResumedJobId == null
    ? scopedDestinationKey || defaultDestinationKey
    : scopedDestinationKey;

  const modalityLookupQuery = useQuery({
    queryKey: ["v2", "lookups", "modalities"],
    queryFn: () => api<{ items: Array<{ id: number; nameEn?: string; nameAr?: string; code?: string }> }>("/v2/lookups/modalities"),
    retry: 0,
    enabled: uiStep === "patient" && !comparisonRequestId,
  });

  const studyDateForFilter = useMemo(() => {
    if (studyDateMode === "custom") return customStudyDate;
    const now = new Date();
    if (studyDateMode === "yesterday") now.setDate(now.getDate() - 1);
    return toIsoDate(now);
  }, [studyDateMode, customStudyDate]);

  const trimmedPatientSearch = scopedPatientSearch.trim();

  const todayStudiesQuery = useQuery({
    queryKey: ["v2", "appointments", "remap-picker", studyDateForFilter, todayModalityFilter, trimmedPatientSearch, scopedPatientLookupMode],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("dateFrom", studyDateForFilter);
      params.set("dateTo", studyDateForFilter);
      if (todayModalityFilter) params.set("modalityId", todayModalityFilter);
      if (trimmedPatientSearch) params.set("q", trimmedPatientSearch);
      return api<{ appointments: TodayStudyOption[] }>(`/v2/read/appointments?${params.toString()}`);
    },
    enabled: uiStep === "patient" && !comparisonRequestId && scopedPatientLookupMode === "filtered_appointments",
    retry: 0,
  });

  const allDatesStudiesQuery = useQuery({
    queryKey: ["v2", "appointments", "remap-picker-all-dates", trimmedPatientSearch, todayModalityFilter, scopedPatientLookupMode],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("q", trimmedPatientSearch);
      if (todayModalityFilter) params.set("modalityId", todayModalityFilter);
      return api<{ appointments: TodayStudyOption[] }>(`/v2/read/appointments?${params.toString()}`);
    },
    enabled: uiStep === "patient" && !comparisonRequestId && scopedPatientLookupMode === "all_appointments" && trimmedPatientSearch.length >= 2,
    retry: 0,
  });

  const patientQuery = useQuery({
    queryKey: ["patients", "remap-search", trimmedPatientSearch, scopedPatientLookupMode],
    queryFn: () => api<{ patients: PatientOption[] }>(`/pacs/remap/patient-search?q=${encodeURIComponent(trimmedPatientSearch)}`),
    enabled: uiStep === "patient" && !comparisonRequestId && scopedPatientLookupMode === "all_patients" && trimmedPatientSearch.length >= 2,
    retry: 0,
  });

  const jobsQuery = useQuery({
    queryKey: ["pacs", "remap", "jobs", historyScope],
    queryFn: async () => {
      const response = await api<{ jobs?: unknown }>(remapApiPath(`/pacs/remap/jobs?limit=20&scope=${historyScope}`));
      return { ...response, jobs: Array.isArray(response.jobs) ? response.jobs.map(normalizeRemapJob).filter((job): job is RemapJob => job != null) : [] };
    },
    enabled: !comparisonRequestId,
    refetchInterval: (query) => {
      const jobs = (query.state.data as { jobs?: RemapJob[] } | undefined)?.jobs || [];
      return jobs.some((job) => RECENT_JOB_POLL_STATUSES.has(job.status) || job.orthanc_recovery_status === "processing") ? 2_000 : false;
    },
  });

  const activeJobQuery = useQuery({
    queryKey: ["pacs", "remap", "active-job"],
    queryFn: async () => {
      const response = await api<{ job?: unknown; comparison: RemapComparison | null }>(remapApiPath("/pacs/remap/jobs/active"));
      return { ...response, job: normalizeRemapJob(response.job) };
    },
    enabled: !comparisonRequestId,
    retry: 0,
  });
  const refetchActiveJob = activeJobQuery.refetch;
  const startupActiveJobCandidate = !autoResumeDismissed && workflowJobId == null && viewedRecentJobId == null && activeJobQuery.isSuccess ? activeJobQuery.data?.job ?? null : null;
  const startupActiveJob = isAwaitingStagedJob(startupActiveJobCandidate) ? startupActiveJobCandidate : null;
  const effectiveJobId = viewedRecentJobId ?? workflowJobId ?? startupActiveJob?.id ?? null;
  const selectedJobId = normalizePositiveJobId(effectiveJobId);
  const effectiveUiStep: RemapWizardUiStep = startupActiveJob
    ? (uiStep === "source" || uiStep === "processing" ? "patient" : uiStep)
    : uiStep;
  const effectiveResumedJobMessage = startupActiveJob
    ? t(language, "pacs.remap.existingJobResumed", { jobId: startupActiveJob.id })
    : resumedJobMessage;

  const replacementPreviewQuery = useQuery({
    queryKey: ["pacs", "remap", "replacement-preview", scopedPatientId],
    queryFn: async () => {
      if (!scopedPatientId) return null;
      const response = await api<{ replacement: ReplacementPreview }>(remapApiPath("/pacs/remap/replacement-preview"), {
        method: "POST",
        body: JSON.stringify({ risproPatientId: scopedPatientId }),
      });
      return response.replacement;
    },
    enabled: uiStep === "patient" && !!scopedPatientId,
    retry: 0,
  });

  const currentJobQuery = useQuery({
    queryKey: ["pacs", "remap", "job", selectedJobId],
    queryFn: async () => {
      const validJobId = requirePositiveJobId(selectedJobId);
      const response = await api<{ job: unknown; comparison: RemapComparison | null }>(remapApiPath(`/pacs/remap/jobs/${validJobId}`));
      return { ...response, job: requireNormalizedRemapJob(response.job) };
    },
    enabled: selectedJobId != null,
    refetchInterval: (query) => {
      const status = (query.state.data as { job?: RemapJob } | undefined)?.job?.status;
      const job = (query.state.data as { job?: RemapJob } | undefined)?.job;
      if (status === "uploaded" || status === "processing" || status === "remapped" || status === "sending" || job?.orthanc_recovery_status === "processing") return 1500;
      return query.state.status === "error" ? 5_000 : false;
    },
  });

  const cancelActiveFullScan = (): void => {
    scanRunIdRef.current += 1;
    fullScanControllerRef.current?.abort();
    fullScanControllerRef.current = null;
  };

  const cancelActiveStagingUpload = (): void => {
    stagingUploadControllerRef.current?.abort();
    stagingUploadControllerRef.current = null;
  };

  const attachToExistingRemapJob = useCallback((job: RemapJob): void => {
    if (!Number.isSafeInteger(job.id) || job.id <= 0) return;
    focusHeadingAfterNavigationRef.current = true;
    viewedRecentJobIdRef.current = job.id;
    setViewedRecentJobId(job.id);
    setAutoResumeDismissed(true);
    setRetryActionError("");
    setRetryActionErrorDetails("");
    if (isAwaitingStagedJob(job)) {
      setResumedJobSelections((current) => current[job.id] ? current : { ...current, [job.id]: resumedSelectionFromJob(job) });
      setActiveResumedJobId(job.id);
      setUiStep("patient");
    } else {
      setActiveResumedJobId(null);
      setViewedProcessingStage("queued");
      setUiStep("processing");
    }
    setResumedJobMessage(t(language, "pacs.remap.existingJobResumed", { jobId: job.id }));
    queryClient.setQueryData(["pacs", "remap", "job", job.id], (existing: { job: RemapJob; comparison: RemapComparison | null } | undefined) => existing || { job, comparison: null });
    void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "job", job.id] });
    void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "active-job"] });
  }, [language, queryClient]);

  const startCompleteScan = (sourceFiles: File[], runId: number): void => {
    const controller = new AbortController();
    fullScanControllerRef.current = controller;
    setCompleteScanStatus("running");
    setScanProgress(null);
    void scanDicomStudiesFromFiles(sourceFiles, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (runId === scanRunIdRef.current && !controller.signal.aborted) setScanProgress(progress);
      },
      onPartialResult: (result) => {
        if (runId !== scanRunIdRef.current || controller.signal.aborted) return;
        latestPartialScanResultRef.current = result;
        if (previewUnavailableRunIdRef.current !== runId || result.studies.length === 0) return;
        setScanResult(result);
        setSelectedStudyInstanceUid((current) => result.studies.some((study) => study.studyInstanceUid === current)
          ? current
          : result.studies.length === 1 ? result.studies[0]!.studyInstanceUid : "");
      },
    }).then((result) => {
      if (runId !== scanRunIdRef.current || controller.signal.aborted) return;
      completedFullScanRunIdRef.current = runId;
      previewUnavailableRunIdRef.current = null;
      latestPartialScanResultRef.current = null;
      fullScanControllerRef.current = null;
      setScanResult(result);
      setCompleteScanStatus("complete");
      setPreviewWarning("");
      setScanProgress({ candidateFileCount: result.dicomLikeFileCount, processedFileCount: result.dicomLikeFileCount, parsedDicomFileCount: result.parsedDicomFileCount, unparsedCount: result.unparsedCount, studyCount: result.studies.length });
      setSelectedStudyInstanceUid(result.studies.length === 1 ? result.studies[0]!.studyInstanceUid : "");
    }).catch((error: unknown) => {
      if (error instanceof DicomStudyScanCancelledError || controller.signal.aborted || runId !== scanRunIdRef.current) return;
      fullScanControllerRef.current = null;
      setPreviewWarning("");
      setCompleteScanStatus("failed");
      setErrorMessage(error instanceof Error ? error.message : "Failed to scan DICOM files.");
      setUiStep("source");
    });
  };

  const scanMutation = useMutation({
    mutationFn: async (sourceFiles: File[]) => previewDicomStudiesFromFiles(sourceFiles, {
      endpoint: `/api${remapApiPath("/pacs/remap/preview-multipart")}`,
    }),
    onMutate: (sourceFiles) => {
      cancelActiveFullScan();
      const runId = ++scanRunIdRef.current;
      completedFullScanRunIdRef.current = null;
      previewUnavailableRunIdRef.current = null;
      latestPartialScanResultRef.current = null;
      setUiStep("source");
      setErrorMessage("");
      setErrorDetails("");
      setPreviewWarning("");
      setSuccessMessage("");
      setCompleteScanStatus("running");
      setScanProgress(null);
      setSkipAcknowledged(false);
      setSelectedStudyInstanceUid("");
      startCompleteScan(sourceFiles, runId);
      return { runId };
    },
    onSuccess: (result, _sourceFiles, context) => {
      if (context?.runId !== scanRunIdRef.current || completedFullScanRunIdRef.current === context.runId) return;
      previewUnavailableRunIdRef.current = null;
      setScanResult(result);
      if (result.studies.length === 1) setSelectedStudyInstanceUid(result.studies[0]!.studyInstanceUid);
      setPreviewWarning("");
    },
    onError: (_error: unknown, _sourceFiles, context) => {
      if (context?.runId !== scanRunIdRef.current || completedFullScanRunIdRef.current === context?.runId) return;
      previewUnavailableRunIdRef.current = context.runId;
      const partialResult = latestPartialScanResultRef.current;
      if (partialResult?.studies.length) {
        setScanResult(partialResult);
        setSelectedStudyInstanceUid(partialResult.studies.length === 1 ? partialResult.studies[0]!.studyInstanceUid : "");
      }
      setPreviewWarning(t(language, "pacs.remap.fastPreviewUnavailable"));
    },
  });

  const canStartFastStaging = completeScanStatus === "running"
    && (scanResult?.previewOnly === true || scanResult?.scanIncomplete === true)
    && scanResult.parsedDicomFileCount > 0
    && Boolean(selectedScannedStudy?.studyInstanceUid.trim())
    && provisionalIdentityIsConsistent;

  const stageSourceMutation = useMutation({
    onMutate: ({ uploadFiles }) => {
      cancelActiveFullScan();
      focusHeadingAfterNavigationRef.current = true;
      setCompleteScanStatus("skipped");
      setSecureStagingStatus("uploading");
      setUploadLoaded(0);
      setUploadTotal(uploadFiles.reduce((sum, file) => sum + file.size, 0));
      setErrorMessage("");
      setErrorDetails("");
      setUiStep("patient");
    },
    mutationFn: async ({
      study,
      uploadFiles,
      acknowledged,
    }: {
      study: DicomStudyScanResult["studies"][number];
      uploadFiles: File[];
      acknowledged: boolean;
    }) => {
      if (!acknowledged || !study.studyInstanceUid.trim()) {
        throw new Error("Confirm a valid preliminary source study before secure staging.");
      }
      if (!uploadFiles.length) throw new Error("No uploadable DICOM-like files were selected.");
      const provisionalSourceIdentity: ProvisionalSourceIdentity = {
        studyInstanceUid: study.studyInstanceUid,
        patientId: study.patientId || "",
        patientName: study.patientName || "",
        patientBirthDate: study.patientBirthDate || "",
        patientSex: study.patientSex || "",
        modality: study.modality || "",
        studyDate: study.studyDate || "",
      };
      const formData = new FormData();
      uploadFiles.forEach((file) => formData.append("files", file, file.name));
      formData.append("selectedStudyInstanceUID", study.studyInstanceUid);
      formData.append("provisionalSourceIdentity", JSON.stringify(provisionalSourceIdentity));
      formData.append("confirmSource", "true");
      const controller = new AbortController();
      stagingUploadControllerRef.current = controller;
      try {
        return await uploadMultipartWithProgress(
          remapApiPath("/pacs/remap/jobs/stage-multipart"),
          formData,
          900_000,
          (loaded, total) => {
            setUploadLoaded(loaded);
            setUploadTotal(total || uploadFiles.reduce((sum, file) => sum + file.size, 0));
          },
          undefined,
          controller.signal
        );
      } finally {
        if (stagingUploadControllerRef.current === controller) stagingUploadControllerRef.current = null;
      }
    },
    onSuccess: (uploadResult) => {
      setWorkflowJobId(uploadResult.job.id);
      setSecureStagingStatus("awaiting_confirmation");
      setProcessingStage("idle");
      const pendingConfirmation = pendingStagedConfirmationRef.current;
      if (pendingConfirmation) {
        pendingStagedConfirmationRef.current = null;
        confirmStagedMutation.mutate({
          targetJobId: uploadResult.job.id,
          confirmation: pendingConfirmation,
          assignWorkflowJob: true,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "active-job"] });
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "job", uploadResult.job.id] });
    },
    onError: (error: unknown) => {
      const hadPendingConfirmation = pendingStagedConfirmationRef.current !== null;
      clearPendingStagedConfirmation();
      if (error instanceof ApiError && error.status === 499) return;
      setSecureStagingStatus("failed");
      if (hadPendingConfirmation) {
        if (viewedRecentJobIdRef.current == null) setUiStep("review");
        setProcessingStage("idle");
      }
      setErrorMessage(error instanceof Error ? error.message : "Secure source staging failed.");
      setErrorDetails(error instanceof ApiError ? formatTechnicalDetails(error.details) : "");
    },
  });

  const processMutation = useMutation({
    onMutate: () => {
      focusHeadingAfterNavigationRef.current = true;
      setUiStep("processing");
      setGatewayUploadLimitRejected(false);
      setErrorMessage("");
      setErrorDetails("");
      setSuccessMessage("");
    },
    mutationFn: async () => {
      if (!scopedPatientId || !effectiveSelectedDestinationKey) throw new Error("Patient and destination are required.");
      const plan = buildDicomUploadSelectionPlan(scanResult, scopedStudyInstanceUid, false);
      const uploadFiles = skippedScanMode ? files.filter(isLikelyDicomCandidate) : plan.files;
      if (uploadFiles.length === 0) throw new Error("No uploadable files were selected.");

      setProcessingStage("uploading");
      setUploadLoaded(0);
      setUploadTotal(uploadFiles.reduce((sum, file) => sum + file.size, 0));

      const formData = new FormData();
      uploadFiles.forEach((file) => formData.append("files", file, file.name));
      const selectedUidForUpload = skippedScanMode ? scopedStudyInstanceUid : plan.selectedStudyInstanceUid;
      if (selectedUidForUpload) formData.append("selectedStudyInstanceUID", selectedUidForUpload);
      if (skippedScanMode) formData.append("uploadMode", "single_study_folder_unverified");
      formData.append("risproPatientId", scopedPatientId);
      formData.append("destinationPacsKey", effectiveSelectedDestinationKey);
      formData.append("confirm", "true");

      const uploadResult = await uploadMultipartWithProgress(remapApiPath("/pacs/remap/jobs/process-multipart"), formData, 900_000, (loaded, total) => {
        setUploadLoaded(loaded);
        setUploadTotal(total || uploadTotal);
      }, () => {
        setUploadLoaded((current) => Math.max(current, uploadTotal));
        setProcessingStage("queued");
      });
      setWorkflowJobId(uploadResult.job.id);
      return { uploadResult };
    },
    onSuccess: ({ uploadResult }) => {
      setWorkflowJobId(uploadResult.job.id);
      setProcessingStage(uploadResult.job.status === "sending" ? "enqueueing_send" : uploadResult.job.status === "sent" ? "completed" : "queued");
      setSuccessMessage("");
      setErrorMessage("");
      setErrorDetails("");
      setGatewayUploadLimitRejected(false);
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
      void currentJobQuery.refetch();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 413) {
        setProcessingStage("failed");
        setSuccessMessage("");
        setGatewayUploadLimitRejected(true);
        setErrorMessage(t(language, "pacs.remap.gatewayUploadLimitExceeded"));
        // Gateway-generated 413 responses can be HTML. Do not surface that as
        // operator-facing diagnostics; retain only structured API details.
        setErrorDetails(error.details && typeof error.details === "object" ? formatTechnicalDetails(error.details) : "");
        return;
      }
      setProcessingStage("failed");
      setSuccessMessage("");
      setGatewayUploadLimitRejected(false);
      setErrorMessage(error instanceof Error ? error.message : "Processing failed.");
      setErrorDetails(error instanceof ApiError ? formatTechnicalDetails(error.details) : "");
      if (selectedJobId != null) void currentJobQuery.refetch();
      else {
        setProcessingStage("idle");
        setUiStep("review");
      }
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
  });
  const currentJobUnavailable = currentJobQuery.error instanceof ApiError
    && (currentJobQuery.error.status === 404 || currentJobQuery.error.status === 410);
  const transientJobRetrievalError = currentJobQuery.isError && !currentJobUnavailable
    ? (currentJobQuery.error instanceof Error ? currentJobQuery.error.message : "Unable to refresh the selected remap job.")
    : "";

  const confirmStagedMutation = useMutation({
    mutationFn: async ({
      targetJobId,
      confirmation,
    }: {
      targetJobId: number;
      confirmation: StagedConfirmationSnapshot;
      assignWorkflowJob: boolean;
    }) => {
      const validJobId = requirePositiveJobId(targetJobId);
      const response = await api<{ job: unknown }>(remapApiPath(`/pacs/remap/jobs/${validJobId}/confirm-staged`), {
        method: "POST",
        body: JSON.stringify({
          ...confirmation,
          confirm: true,
        }),
      });
      return { ...response, job: requireNormalizedRemapJob(response.job) };
    },
    onMutate: (variables) => {
      focusHeadingAfterNavigationRef.current = true;
      setUiStep("processing");
      if (variables.assignWorkflowJob) setProcessingStage("queued");
      else setViewedProcessingStage("queued");
      setErrorMessage("");
      setErrorDetails("");
      setSuccessMessage("");
    },
    onSuccess: (result, variables) => {
      clearPendingStagedConfirmation();
      if (variables.assignWorkflowJob) {
        setWorkflowJobId(result.job.id);
        setSecureStagingStatus("awaiting_confirmation");
      }
      if (variables.assignWorkflowJob) setProcessingStage("queued");
      else setViewedProcessingStage("queued");
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "active-job"] });
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "job", result.job.id] });
    },
    onError: (error: unknown, variables) => {
      clearPendingStagedConfirmation();
      if (viewedRecentJobIdRef.current == null || !variables.assignWorkflowJob) setUiStep("review");
      if (variables.assignWorkflowJob) setProcessingStage("idle");
      else setViewedProcessingStage("idle");
      setErrorMessage(error instanceof Error ? error.message : "Staged confirmation failed.");
      setErrorDetails(error instanceof ApiError ? formatTechnicalDetails(error.details) : "");
    },
  });

  const confirmIncompleteStudyMutation = useMutation({
    mutationFn: async (targetJobId: number) => {
      const validJobId = requirePositiveJobId(targetJobId);
      const response = await api<{ job: unknown }>(remapApiPath(`/pacs/remap/jobs/${validJobId}/confirm-send`), {
        method: "POST",
        body: JSON.stringify({ confirm: true, confirmIncompleteStudy: true }),
      });
      return { ...response, job: requireNormalizedRemapJob(response.job) };
    },
    onSuccess: (data) => {
      setIncompleteStudyAcknowledged(false);
      queryClient.setQueryData(["pacs", "remap", "job", data.job.id], { job: data.job, comparison: null });
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "job", data.job.id] });
    },
    onError: (error: unknown) => {
      setRetryActionError(error instanceof Error ? error.message : "Incomplete-study acknowledgement failed.");
      setRetryActionErrorDetails(error instanceof ApiError ? formatTechnicalDetails(error.details) : "");
    },
  });

  const resetJobMutation = useMutation({
    mutationFn: async ({ targetJobId }: { targetJobId: number }) => {
      const validJobId = requirePositiveJobId(targetJobId);
      return api<{ summary: { studiesDeleted: number; studiesAlreadyMissing: number } }>(remapApiPath(`/pacs/remap/jobs/${validJobId}/reset`), { method: "POST" });
    },
    onSuccess: (data, input) => {
      if (viewedRecentJobIdRef.current === input.targetJobId) {
        viewedRecentJobIdRef.current = null;
        setViewedRecentJobId(null);
        setActiveResumedJobId(localResumedJobIdBeforeRecentRef.current);
        localResumedJobIdBeforeRecentRef.current = null;
        setViewedProcessingStage("idle");
        setUiStep(localWorkflowStepBeforeRecentRef.current);
      } else {
        resetWorkflow();
      }
      setSuccessMessage(
        language === "ar"
          ? `تمت إعادة الضبط. تم حذف ${data.summary.studiesDeleted} دراسة.`
          : `Reset complete. Deleted ${data.summary.studiesDeleted} linked Orthanc studies.`
      );
      setErrorDetails("");
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown) => {
      setSuccessMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Reset failed.");
      setErrorDetails(error instanceof ApiError ? formatTechnicalDetails(error.details) : "");
    },
  });

  const resendJobMutation = useMutation({
    mutationFn: async (input: { targetJobId: number; viewTargetJob?: RemapJob; confirmDestinationChecked?: boolean }) => {
      const validJobId = requirePositiveJobId(input.targetJobId);
      const response = await api<{ job: unknown }>(remapApiPath(`/pacs/remap/jobs/${validJobId}/resend`), {
        method: "POST",
        body: JSON.stringify({ confirmDestinationChecked: input.confirmDestinationChecked === true }),
      });
      return { ...response, job: requireNormalizedRemapJob(response.job) };
    },
    onMutate: (input) => {
      if (input.viewTargetJob) {
        if (viewedRecentJobId == null) {
          localWorkflowStepBeforeRecentRef.current = uiStep;
          localResumedJobIdBeforeRecentRef.current = activeResumedJobId;
        }
        viewedRecentJobIdRef.current = input.targetJobId;
        setViewedRecentJobId(input.targetJobId);
        setActiveResumedJobId(null);
        setAutoResumeDismissed(true);
        queryClient.setQueryData(["pacs", "remap", "job", input.targetJobId], (existing: { job: RemapJob; comparison: RemapComparison | null } | undefined) => existing || { job: input.viewTargetJob!, comparison: null });
      }
      setUiStep("processing");
      if (input.viewTargetJob || viewedRecentJobId === input.targetJobId) setViewedProcessingStage("enqueueing_send");
      else setProcessingStage("enqueueing_send");
      setRetryActionError("");
      setRetryActionErrorDetails("");
      setSuccessMessage("");
    },
    onSuccess: (data, input) => {
      setDestinationCheckedForResend(false);
      if (input.viewTargetJob || viewedRecentJobId === input.targetJobId) {
        setViewedProcessingStage(data.job.status === "sending" ? "enqueueing_send" : data.job.status === "sent" ? "completed" : "failed");
      } else {
        setProcessingStage(data.job.status === "sending" ? "enqueueing_send" : data.job.status === "sent" ? "completed" : "failed");
      }
      setRetryActionError("");
      setRetryActionErrorDetails("");
      setSuccessMessage("");
      queryClient.setQueryData(["pacs", "remap", "job", input.targetJobId], (existing: { comparison: RemapComparison | null } | undefined) => ({ job: data.job, comparison: existing?.comparison || null }));
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "job", input.targetJobId] });
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown, input) => {
      if (input.viewTargetJob || viewedRecentJobId === input.targetJobId) setViewedProcessingStage("failed");
      else setProcessingStage("failed");
      setSuccessMessage("");
      setRetryActionError(error instanceof Error ? error.message : t(language, "pacs.remap.failedResend"));
      setRetryActionErrorDetails(error instanceof ApiError ? formatTechnicalDetails(error.details) : "");
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "job", input.targetJobId] });
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
  });

  const orthancRecoveryMutation = useMutation({
    mutationFn: async (input: { targetJobId: number; viewTargetJob?: RemapJob }) => {
      const response = await retryDicomRemapWithOrthanc<unknown>(input.targetJobId, comparisonRequestId);
      return { ...response, job: requireNormalizedRemapJob(response.job) };
    },
    onMutate: (input) => {
      if (input.viewTargetJob) {
        if (viewedRecentJobId == null) {
          localWorkflowStepBeforeRecentRef.current = uiStep;
          localResumedJobIdBeforeRecentRef.current = activeResumedJobId;
        }
        viewedRecentJobIdRef.current = input.targetJobId;
        setViewedRecentJobId(input.targetJobId);
        setActiveResumedJobId(null);
        setAutoResumeDismissed(true);
        queryClient.setQueryData(["pacs", "remap", "job", input.targetJobId], { job: { ...input.viewTargetJob, orthanc_recovery_status: "processing" }, comparison: null });
      }
      setUiStep("processing");
      if (input.viewTargetJob || viewedRecentJobId === input.targetJobId) setViewedProcessingStage("orthanc_recovery");
      else setProcessingStage("orthanc_recovery");
      setRetryActionError("");
      setRetryActionErrorDetails("");
      setSuccessMessage("");
    },
    onSuccess: (data, input) => {
      const nextStage: RemapProcessingStage = data.job.status === "sending" ? "enqueueing_send" : data.job.status === "sent" ? "completed" : data.job.orthanc_recovery_status === "processing" ? "orthanc_recovery" : "failed";
      if (input.viewTargetJob || viewedRecentJobId === input.targetJobId) setViewedProcessingStage(nextStage);
      else setProcessingStage(nextStage);
      queryClient.setQueryData(["pacs", "remap", "job", input.targetJobId], (existing: { comparison: RemapComparison | null } | undefined) => ({ job: data.job, comparison: existing?.comparison || null }));
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "job", input.targetJobId] });
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown, input) => {
      if (input.viewTargetJob || viewedRecentJobId === input.targetJobId) setViewedProcessingStage("failed");
      else setProcessingStage("failed");
      setRetryActionError(error instanceof Error ? error.message : t(language, "pacs.remap.orthancRecoveryFailed"));
      setRetryActionErrorDetails(error instanceof ApiError ? formatTechnicalDetails(error.details) : "");
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "job", input.targetJobId] });
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
  });

  const clearFailedStudiesMutation = useMutation({
    mutationFn: async () => api(remapApiPath("/pacs/remap/maintenance/clear-failed-studies"), { method: "POST" }),
    onSuccess: () => {
      setSuccessMessage(language === "ar" ? "اكتملت صيانة الدراسات الفاشلة." : "Failed-study maintenance completed.");
      setErrorMessage("");
      setErrorDetails("");
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown) => {
      setSuccessMessage("");
      const message = error instanceof Error ? error.message : "Failed to clear failed remap studies.";
      if (message.includes("re-authentication") || message.includes("403")) {
        setRetryClearAfterReAuth(true);
        setShowReAuthModal(true);
      }
      setErrorMessage(message);
      setErrorDetails(error instanceof ApiError ? formatTechnicalDetails(error.details) : "");
    },
  });

  const currentJob = (currentJobQuery.data?.job || startupActiveJob || null) as RemapJob;
  const viewingPersistedJob = effectiveUiStep === "processing"
    && viewedRecentJobId != null
    && currentJob?.id === viewedRecentJobId;
  const stagedProvisionalIdentity = Number(currentJob?.staged_manifest_version) === 2
    ? currentJob.provisional_source_identity || null
    : null;
  const selectedStudy = selectedScannedStudy || (stagedProvisionalIdentity
    ? {
      studyInstanceUid: stagedProvisionalIdentity.studyInstanceUid,
      studyDescription: "",
      studyDate: stagedProvisionalIdentity.studyDate,
      modality: stagedProvisionalIdentity.modality,
      patientId: stagedProvisionalIdentity.patientId,
      patientName: stagedProvisionalIdentity.patientName,
      patientBirthDate: stagedProvisionalIdentity.patientBirthDate,
      patientSex: stagedProvisionalIdentity.patientSex,
      seriesCount: 0,
      fileCount: Number(currentJob?.staged_file_count || 0),
      totalBytes: Number(currentJob?.staged_total_bytes || 0),
      files: [],
    }
    : null);
  const fastStagedWorkflow = secureStagingStatus !== "idle"
    || isAwaitingStagedJob(currentJob)
    || Number(currentJob?.staged_manifest_version) === 2;
  const directoryPatients = patientQuery.data?.patients || [];
  const appointmentPatientOptions = useMemo(() => {
    const combinedAppointments = [
      ...(todayStudiesQuery.data?.appointments || []),
      ...(allDatesStudiesQuery.data?.appointments || []),
    ];
    const seen = new Set<number>();
    return combinedAppointments.filter((appointment) => {
      if (seen.has(appointment.patient_id)) return false;
      seen.add(appointment.patient_id);
      return true;
    });
  }, [todayStudiesQuery.data?.appointments, allDatesStudiesQuery.data?.appointments]);
  const selectedDirectoryPatient = directoryPatients.find((patient) => String(patient.id) === scopedPatientId) || null;

  const selectedAppointmentPatient = appointmentPatientOptions.find((appointment) => String(appointment.patient_id) === scopedPatientId) || null;
  const selectedPatientLabel =
    selectedAppointmentPatient
      ? (selectedAppointmentPatient.english_full_name || selectedAppointmentPatient.arabic_full_name || formatFallbackPatientLabel(language, selectedAppointmentPatient.patient_id))
      : selectedDirectoryPatient
        ? formatDirectoryPatientName(language, selectedDirectoryPatient)
        : null;
  const displayedSourceIdentity = viewingPersistedJob
    ? {
      patientId: currentJob.original_patient_id || stagedProvisionalIdentity?.patientId || "",
      patientName: currentJob.original_patient_name || stagedProvisionalIdentity?.patientName || "",
    }
    : {
      patientId: selectedStudy?.patientId || stagedProvisionalIdentity?.patientId || "",
      patientName: selectedStudy?.patientName || stagedProvisionalIdentity?.patientName || "",
    };
  const displayedReplacementIdentity = viewingPersistedJob
    ? {
      patientId: currentJob.replacement_patient_id || (currentJob.rispro_patient_id ? String(currentJob.rispro_patient_id) : ""),
      patientName: currentJob.replacement_patient_name || "",
    }
    : {
      patientId: replacementPreviewQuery.data?.patientId || "",
      patientName: selectedPatientLabel || replacementPreviewQuery.data?.patientName || "",
    };
  const displayedStudyUid = viewingPersistedJob
    ? currentJob.selected_study_instance_uid || stagedProvisionalIdentity?.studyInstanceUid || ""
    : selectedStudy?.studyInstanceUid || scopedStudyInstanceUid;
  const displayedStudySummary = viewingPersistedJob || activeResumedJobId != null
    ? displayedStudyUid
    : selectedStudy?.studyDescription || selectedStudy?.modality || "";
  const displayedStudyFileCount = viewingPersistedJob
    ? Number(currentJob.staged_file_count || 0)
    : Number(selectedStudy?.fileCount || 0);
  const effectiveSelectedPatientLabel = viewingPersistedJob
    ? displayedReplacementIdentity.patientName || displayedReplacementIdentity.patientId || null
    : selectedPatientLabel
      || currentJob?.replacement_patient_name
      || (currentJob?.rispro_patient_id ? formatFallbackPatientLabel(language, currentJob.rispro_patient_id) : null);
  const displayedDestinationKey = viewingPersistedJob
    ? currentJob.destination_pacs_key || ""
    : currentJob?.destination_pacs_key || effectiveSelectedDestinationKey;
  const stagingCompleted = secureStagingStatus === "awaiting_confirmation" || isAwaitingStagedJob(currentJob);
  const canContinueStudy = fastStagedWorkflow
    ? Boolean(selectedStudy)
    : completeScanStatus === "complete" && Boolean(selectedStudy);
  const canContinuePatient = !!scopedPatientId
    && !replacementPreviewQuery.isLoading
    && !replacementPreviewQuery.isError
    && !!replacementPreviewQuery.data;
  const canContinueDestination = !!effectiveSelectedDestinationKey;
  const stagingCanAcceptConfirmation = !fastStagedWorkflow
    || stagingCompleted
    || secureStagingStatus === "uploading";
  const canSubmit = canContinueStudy
    && canContinuePatient
    && canContinueDestination
    && scopedConfirmChecked
    && stagingCanAcceptConfirmation
    && !pendingStagedConfirmation
    && !processMutation.isPending
    && !confirmStagedMutation.isPending;

  const requestStagedConfirmation = (): void => {
    if (!canSubmit || pendingStagedConfirmationRef.current) return;
    const confirmation = Object.freeze<StagedConfirmationSnapshot>({
      selectedStudyInstanceUID: scopedStudyInstanceUid,
      risproPatientId: scopedPatientId,
      destinationPacsKey: effectiveSelectedDestinationKey,
    });
    if (stagingCompleted) {
      if (selectedJobId == null) {
        setErrorMessage("Secure staging job is not available.");
        return;
      }
      pendingStagedConfirmationRef.current = confirmation;
      confirmStagedMutation.mutate({ targetJobId: selectedJobId, confirmation, assignWorkflowJob: viewedRecentJobId == null });
      return;
    }
    pendingStagedConfirmationRef.current = confirmation;
    setPendingStagedConfirmation(confirmation);
    focusHeadingAfterNavigationRef.current = true;
    setUiStep("processing");
    setProcessingStage("uploading");
    setErrorMessage("");
    setErrorDetails("");
    setSuccessMessage("");
  };
  const skippedScanMode = fastStagedWorkflow;
  const reviewFiles = skippedScanMode
    ? (scanResult?.scanIncomplete ? selectedStudy?.files || [] : files.filter(isLikelyDicomCandidate))
    : selectedStudy?.files || [];
  const fastStagingFiles = scanResult?.scanIncomplete
    ? buildDicomUploadSelectionPlan(scanResult, scopedStudyInstanceUid, false).files
    : files.filter(isLikelyDicomCandidate);
  const uploadPercent = uploadTotal > 0 ? Math.min(100, Math.round((uploadLoaded / uploadTotal) * 100)) : 0;

  const recoveryIsProcessing = currentJob?.orthanc_recovery_status === "processing" || orthancRecoveryMutation.isPending;
  const effectiveProcessingStage: RemapProcessingStage = recoveryIsProcessing
    ? "orthanc_recovery"
    : currentJob?.status === "sent"
    ? "completed"
    : currentJob?.status === "sending"
      ? "enqueueing_send"
      : currentJob?.status === "failed" || currentJob?.status === "cancelled"
        ? "failed"
        : currentJob?.processing_stage && currentJob.processing_stage in {
          staging: true, queued: true, validating: true, building_uid_plan: true, rewriting: true,
          uploading_to_orthanc: true, verifying_orthanc: true, orthanc_recovery: true, awaiting_send_confirmation: true, enqueueing_send: true, completed: true, failed: true,
        }
          ? currentJob.processing_stage as RemapProcessingStage
          : viewedRecentJobId != null ? viewedProcessingStage : processingStage;
  const isTerminalSuccess = effectiveProcessingStage === "completed" || currentJob?.status === "sent";
  const isTerminalFailure = !recoveryIsProcessing && (effectiveProcessingStage === "failed" || currentJob?.status === "failed" || currentJob?.status === "cancelled");

  const navigateTo = (nextStep: RemapWizardUiStep): void => {
    focusHeadingAfterNavigationRef.current = true;
    setUiStep(nextStep);
  };

  const openRecentJob = (job: RemapJob): void => {
    const hasDraft = files.length > 0 || !!selectedPatientId || !!effectiveSelectedDestinationKey;
    if (effectiveUiStep !== "processing" && hasDraft && !window.confirm(language === "ar" ? "سيتم فتح المهمة دون حذف المسودة الحالية. هل تريد المتابعة؟" : "Open this job without discarding the current draft?")) return;
    if (viewedRecentJobId == null) {
      localWorkflowStepBeforeRecentRef.current = uiStep;
      localResumedJobIdBeforeRecentRef.current = activeResumedJobId;
    }
    attachToExistingRemapJob(job);
  };

  const recoverSource = (jobId: number): void => {
    const anchor = document.createElement("a");
    anchor.href = `/api${remapApiPath(`/pacs/remap/jobs/${jobId}/recover-source`)}`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  useEffect(() => {
    if (!startupActiveJob || activeResumedJobId === startupActiveJob.id) return;
    setResumedJobSelections((current) => current[startupActiveJob.id]
      ? current
      : { ...current, [startupActiveJob.id]: resumedSelectionFromJob(startupActiveJob) });
    setWorkflowJobId(startupActiveJob.id);
    setActiveResumedJobId(startupActiveJob.id);
    setSecureStagingStatus("awaiting_confirmation");
    setResumedJobMessage(t(language, "pacs.remap.existingJobResumed", { jobId: startupActiveJob.id }));
    if (uiStep === "source" || uiStep === "processing") setUiStep("patient");
  }, [activeResumedJobId, language, startupActiveJob, uiStep]);

  useEffect(() => {
    if (!effectiveJobId || !currentJobUnavailable) return;
    let active = true;
    void refetchActiveJob().then((result) => {
      if (!active || result.data?.job?.id === effectiveJobId) return;
      if (viewedRecentJobId === effectiveJobId) {
        viewedRecentJobIdRef.current = null;
        setViewedRecentJobId(null);
        setActiveResumedJobId(localResumedJobIdBeforeRecentRef.current);
        localResumedJobIdBeforeRecentRef.current = null;
        setUiStep(localWorkflowStepBeforeRecentRef.current);
      } else if (workflowJobId === effectiveJobId) {
        setWorkflowJobId(null);
        if (activeResumedJobId === effectiveJobId) {
          setActiveResumedJobId(null);
          setResumedJobSelections((current) => {
            if (!(effectiveJobId in current)) return current;
            const next = { ...current };
            delete next[effectiveJobId];
            return next;
          });
        }
        setSecureStagingStatus("idle");
        clearPendingStagedConfirmation();
        setProcessingStage("idle");
        setAutoResumeDismissed(true);
        setUiStep("source");
      }
      setResumedJobMessage("");
      setErrorDetails("");
      setErrorMessage(t(language, "pacs.remap.resumedJobUnavailable"));
    });
    return () => { active = false; };
  }, [activeResumedJobId, clearPendingStagedConfirmation, currentJobUnavailable, effectiveJobId, language, refetchActiveJob, viewedRecentJobId, workflowJobId]);

  useEffect(() => {
    if (!focusHeadingAfterNavigationRef.current) return;
    focusHeadingAfterNavigationRef.current = false;
    const handle = window.requestAnimationFrame(() => mainHeadingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(handle);
  }, [uiStep]);

  useEffect(() => () => {
    scanRunIdRef.current += 1;
    fullScanControllerRef.current?.abort();
    fullScanControllerRef.current = null;
    stagingUploadControllerRef.current?.abort();
    stagingUploadControllerRef.current = null;
  }, []);

  const visibleErrorMessage =
    isTerminalSuccess
      ? ""
      : [
        "DICOM_REMAP_MULTIPLE_STUDIES_DETECTED",
        "DICOM_REMAP_SOURCE_IDENTITY_INCONSISTENT",
        "DICOM_REMAP_SOURCE_IDENTITY_MISMATCH",
        "DICOM_REMAP_SELECTED_STUDY_NOT_FOUND",
      ].includes(currentJob?.processing_error_code || "")
        ? t(language, "pacs.remap.serverVerificationFailed")
        : viewingPersistedJob
          ? currentJob?.error_message || ""
          : errorMessage || currentJob?.error_message || "";
  const persistedJobErrorDetails = currentJob?.orthanc_recovery_error_details
    ? formatTechnicalDetails(currentJob.orthanc_recovery_error_details)
    : currentJob?.processing_error_details
    ? formatTechnicalDetails(currentJob.processing_error_details)
    : currentJob?.send_error_details ? formatTechnicalDetails(currentJob.send_error_details) : "";
  const visibleErrorDetails = viewingPersistedJob ? persistedJobErrorDetails : errorDetails || persistedJobErrorDetails;
  const visibleSuccessMessage =
    isTerminalFailure || viewingPersistedJob
      ? ""
      : successMessage;
  const persistedJobContext = viewingPersistedJob ? (
    <dl className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-2" aria-label={language === "ar" ? "سياق المهمة المحفوظ" : "Persisted job context"}>
      <div><dt className="font-semibold">Study Instance UID</dt><dd className="break-all font-mono">{displayedStudyUid || "—"}</dd></div>
      <div><dt className="font-semibold">{language === "ar" ? "مريض المصدر" : "Source patient"}</dt><dd>{displayedSourceIdentity.patientName || displayedSourceIdentity.patientId || "—"}</dd></div>
      <div><dt className="font-semibold">{t(language, "pacs.remap.selectedRISProPatient")}</dt><dd>{displayedReplacementIdentity.patientName || displayedReplacementIdentity.patientId || "—"}</dd></div>
      <div><dt className="font-semibold">{t(language, "pacs.remap.destinationLabel")}</dt><dd>{destinations.find((destination) => destination.key === displayedDestinationKey)?.name || displayedDestinationKey || "—"}</dd></div>
    </dl>
  ) : null;

  const resetWorkflow = (): void => {
    cancelActiveFullScan();
    clearPendingStagedConfirmation();
    cancelActiveStagingUpload();
    setFiles([]);
    setScanResult(null);
    setSelectedStudyInstanceUid("");
    setSelectedPatientId("");
    setSelectedDestinationKey("");
    setPatientLookupMode("filtered_appointments");
    setPatientSearch("");
    setCompleteScanStatus("idle");
    setScanProgress(null);
    setSkipAcknowledged(false);
    setConfirmChecked(false);
    setUploadLoaded(0);
    setUploadTotal(0);
    setSecureStagingStatus("idle");
    setWorkflowJobId(null);
    viewedRecentJobIdRef.current = null;
    setViewedRecentJobId(null);
    setActiveResumedJobId(null);
    localResumedJobIdBeforeRecentRef.current = null;
    setResumedJobSelections({});
    setViewedProcessingStage("idle");
    setAutoResumeDismissed(true);
    setErrorMessage("");
    setErrorDetails("");
    setRetryActionError("");
    setRetryActionErrorDetails("");
    setPreviewWarning("");
    setGatewayUploadLimitRejected(false);
    setSuccessMessage("");
    setResumedJobMessage("");
    setProcessingStage("idle");
    setUiStep("source");
    focusHeadingAfterNavigationRef.current = false;
    setFileInputVersion((v) => v + 1);
    scanMutation.reset();
    stageSourceMutation.reset();
    processMutation.reset();
    confirmStagedMutation.reset();
  };

  const startNewUpload = (): void => {
    if (viewedRecentJobId == null) {
      resetWorkflow();
      return;
    }
    focusHeadingAfterNavigationRef.current = true;
    viewedRecentJobIdRef.current = null;
    setViewedRecentJobId(null);
    setActiveResumedJobId(localResumedJobIdBeforeRecentRef.current);
    localResumedJobIdBeforeRecentRef.current = null;
    setViewedProcessingStage("idle");
    setAutoResumeDismissed(true);
    setRetryActionError("");
    setRetryActionErrorDetails("");
    setResumedJobMessage("");
    setUiStep(localWorkflowStepBeforeRecentRef.current);
  };

  const cancelUnconfirmedDraftAndReset = (): void => {
    const viewedAwaitingJobId = viewedRecentJobId != null
      && currentJob?.id === viewedRecentJobId
      && isAwaitingStagedJob(currentJob)
      ? viewedRecentJobId
      : null;
    const localAwaitingJobId = viewedRecentJobId == null
      && effectiveJobId
      && secureStagingStatus === "awaiting_confirmation"
      && (!currentJob || isAwaitingStagedJob(currentJob))
      ? effectiveJobId
      : null;
    const cancellableJobId = viewedAwaitingJobId ?? localAwaitingJobId;
    const cancellingViewedJob = cancellableJobId != null && viewedRecentJobId === cancellableJobId;
    if (cancellingViewedJob) {
      viewedRecentJobIdRef.current = null;
      setViewedRecentJobId(null);
      setActiveResumedJobId(localResumedJobIdBeforeRecentRef.current);
      localResumedJobIdBeforeRecentRef.current = null;
      setViewedProcessingStage("idle");
      setAutoResumeDismissed(true);
      setUiStep(localWorkflowStepBeforeRecentRef.current);
    } else {
      resetWorkflow();
    }
    const validCancellableJobId = normalizePositiveJobId(cancellableJobId);
    if (validCancellableJobId == null) return;
    void api(remapApiPath(`/pacs/remap/jobs/${validCancellableJobId}/cancel`), {
      method: "POST",
      body: JSON.stringify({ reason: "Operator cancelled secure staging before final confirmation." }),
    }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "active-job"] });
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Pending secure staging could not be cancelled.");
    });
  };

  const stepLabels = language === "ar"
    ? ["المصدر", "المريض", "الوجهة", "المراجعة", "المعالجة"]
    : ["Source", "Patient", "Destination", "Review", "Processing"];
  const uiStepOrder: RemapWizardUiStep[] = ["source", "patient", "destination", "review", "processing"];
  const currentStepIndex = uiStepOrder.indexOf(effectiveUiStep);
  const activeCardProps = {
    className: "card-shell min-h-[28rem] border border-teal-500 p-5 shadow-md shadow-teal-900/5",
    "aria-busy": effectiveUiStep === "source" && (scanMutation.isPending || completeScanStatus === "running"),
  } as const;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="card-shell overflow-hidden border border-slate-200/70">
        <div className="relative p-5 space-y-4 bg-gradient-to-br from-slate-50 via-white to-teal-50/60">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-700">
                {language === "ar" ? "أداة آمنة لإعادة الربط" : "Safe DICOM remap"}
              </p>
              <h2 className="text-2xl font-bold" style={{ color: "var(--text)" }}>{t(language, "pacs.remap.title")}</h2>
              <p className="max-w-3xl text-sm leading-6" style={{ color: "var(--text-muted)" }}>{t(language, "pacs.remap.subtitle")}</p>
            </div>
            <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900 shadow-sm md:max-w-sm">
              <strong className="block text-amber-950">{language === "ar" ? "تحقق قبل الإرسال" : "Verify before sending"}</strong>
              {t(language, "pacs.remap.safetyBanner")}
            </div>
          </div>
          {comparisonRequestId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-300 bg-teal-50 px-4 py-3 text-sm text-teal-950">
              <div>
                <strong>{t(language, "comparisons.remapTitle")}</strong>
                <span className="ms-2">{t(language, "comparisons.remapLocked", { id: comparisonRequestId })}</span>
              </div>
              <button type="button" className="btn-secondary rounded-lg px-3 py-2 text-xs" onClick={() => navigate(comparisonReturnPath)}>
                {t(language, "comparisons.return")}
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex gap-2 overflow-x-auto border-t border-slate-200/70 bg-white/80 p-3 text-xs" aria-label={language === "ar" ? "مراحل إعادة الربط" : "Remap steps"}>
          {stepLabels.map((label, index) => {
            const completed = index < currentStepIndex;
            const current = index === currentStepIndex;
            return (
              <div
                key={label}
                className={`min-w-[5.5rem] flex-1 rounded-xl border px-3 py-2 text-center font-medium ${completed ? "border-teal-500 bg-teal-50 text-teal-800" : current ? "border-teal-600 bg-teal-600 text-white shadow-sm" : "border-slate-200 bg-white/70 text-slate-500"}`}
                aria-current={current ? "step" : undefined}
                aria-label={`${label}${completed ? (language === "ar" ? " مكتملة" : " complete") : current ? (language === "ar" ? " الحالية" : " current") : ""}`}
              >
                <span className="mx-auto mb-1 flex h-5 w-5 items-center justify-center rounded-full bg-current/10 text-[10px]">
                  {completed ? "✓" : index + 1}
                </span>
                <span className="whitespace-nowrap">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4">
        <section className="card-shell flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-xs" aria-label={language === "ar" ? "ملخص الاختيارات" : "Selection summary"}>
          <strong className="w-full text-sm sm:w-auto">{language === "ar" ? "ملخص الاختيارات" : "Selected context"}</strong>
          <span className={!displayedStudySummary ? "text-slate-400" : ""}><b>{t(language, "pacs.remap.studyLabel")}:</b> {displayedStudySummary || (viewingPersistedJob ? "—" : language === "ar" ? "غير مكتملة" : "Not selected")}{displayedStudySummary && displayedStudyFileCount > 0 ? ` • ${displayedStudyFileCount} ${language === "ar" ? "ملف" : "files"}` : ""}</span>
          <span className={!effectiveSelectedPatientLabel ? "text-slate-400" : ""}><b>{t(language, "pacs.remap.selectedRISProPatient")}:</b> {effectiveSelectedPatientLabel || (viewingPersistedJob ? "—" : language === "ar" ? "غير مكتمل" : "Not selected")}</span>
          <span className={!displayedDestinationKey ? "text-slate-400" : ""}><b>{t(language, "pacs.remap.destinationLabel")}:</b> {destinations.find((destination) => destination.key === displayedDestinationKey)?.name || displayedDestinationKey || (viewingPersistedJob ? "—" : language === "ar" ? "غير مكتملة" : "Not selected")}</span>
          {!viewingPersistedJob && skippedScanMode && <span className="font-semibold text-amber-800">{t(language, "pacs.remap.folderNotFullyScanned")}</span>}
        </section>

        {transientJobRetrievalError && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
            <strong>{language === "ar" ? "تعذر تحديث المهمة مؤقتًا." : "The selected job could not be refreshed temporarily."}</strong>{" "}
            {language === "ar" ? "تم الاحتفاظ بالسياق الحالي وستحاول RISpro التحديث مرة أخرى." : "The current context was preserved and RISpro will retry."}{" "}
            <span>{transientJobRetrievalError}</span>
          </div>
        )}

        {fastStagedWorkflow && effectiveUiStep !== "processing" && (
          <section className="rounded-2xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-xs text-teal-950" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{language === "ar" ? "رفع المصدر الآمن" : "Secure source staging"}</strong>
              <span>
                {stagingCompleted
                  ? (language === "ar" ? "اكتمل — في انتظار التأكيد النهائي" : "Complete — awaiting final confirmation")
                  : secureStagingStatus === "failed"
                    ? (language === "ar" ? "فشل" : "Failed")
                    : `${uploadPercent}%`}
              </span>
            </div>
            {!stagingCompleted && secureStagingStatus !== "failed" && (
              <div className="mt-2">
                <RemapProgressBar
                  label={language === "ar" ? "تقدم رفع المصدر الآمن" : "Secure source staging progress"}
                  value={uploadTotal > 0 ? uploadLoaded : null}
                  max={uploadTotal > 0 ? uploadTotal : null}
                  detail={uploadTotal > 0 ? `${formatBytes(uploadLoaded)} / ${formatBytes(uploadTotal)}` : undefined}
                />
              </div>
            )}
            <p className="mt-1">
              {stagingCompleted
                ? (language === "ar" ? "لن تبدأ المعالجة أو الإرسال قبل التأكيد النهائي." : "Backend validation, rewriting and PACS sending will not start before final confirmation.")
                : (language === "ar" ? "يمكنك متابعة اختيار المريض والوجهة أثناء الرفع." : "Patient and destination selection remain available while the source uploads.")}
            </p>
            {effectiveResumedJobMessage && <p className="mt-1 font-semibold text-teal-800">{effectiveResumedJobMessage}</p>}
            {stagedProvisionalIdentity && (
              <p className="mt-1">
                {language === "ar" ? "المصدر" : "Source"}: <strong>{stagedProvisionalIdentity.patientName || stagedProvisionalIdentity.patientId || "—"}</strong>
                {" · "}Study Instance UID: <span className="font-mono">{stagedProvisionalIdentity.studyInstanceUid}</span>
              </p>
            )}
            <button type="button" onClick={cancelUnconfirmedDraftAndReset} className="mt-2 rounded-lg border border-teal-300 bg-white px-3 py-1.5 font-semibold text-teal-900">
              {language === "ar" ? "إلغاء الرفع الآمن وإعادة البدء" : "Cancel secure staging and reset"}
            </button>
          </section>
        )}

        <div {...activeCardProps}>
          {effectiveUiStep === "source" && <>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h3 ref={mainHeadingRef} id="remap-active-step" tabIndex={-1} className="text-lg font-semibold" style={{ color: "var(--text)" }}>
                {stepLabels[0]}
              </h3>
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
                {t(language, "pacs.remap.fastPreviewAndCompleteScan")}
              </span>
            </div>
            <div className="hidden" aria-hidden="true">
              <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>{t(language, "pacs.remap.step1")}</h3>
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
                {t(language, "pacs.remap.fastPreviewAndCompleteScan")}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4">
                <label htmlFor="remap-file-input" className="flex min-h-24 cursor-pointer flex-col justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold shadow-sm hover:border-teal-400 focus-within:ring-2 focus-within:ring-teal-500">
                  <span>{language === "ar" ? "اختيار الملفات" : "Choose files"}</span>
                  <span className="mt-1 text-xs font-normal text-slate-500">{t(language, "pacs.remap.selectDicomFiles")}</span>
                </label>
                <input
                  id="remap-file-input"
                  aria-label={t(language, "pacs.remap.selectDicomFiles")}
                  key={`files-${fileInputVersion}`}
                  type="file"
                  multiple
                  onChange={(event) => {
                    setAutoResumeDismissed(true);
                    const selectedFiles = Array.from(event.target.files || []);
                    cancelActiveFullScan();
                    cancelActiveStagingUpload();
                    setFiles(selectedFiles);
                    setScanResult(null);
                    setSelectedStudyInstanceUid("");
                    setSelectedPatientId("");
                    setSelectedDestinationKey("");
                    setCompleteScanStatus("idle");
                    setScanProgress(null);
                    setSkipAcknowledged(false);
                    setConfirmChecked(false);
                    setSecureStagingStatus("idle");
                    setUiStep("source");
                    if (selectedFiles.length > 0) scanMutation.mutate(selectedFiles);
                  }}
                  className="sr-only"
                />
              </div>
              <div className="rounded-2xl border border-dashed border-teal-300 bg-teal-50/50 p-4">
                <label htmlFor="remap-folder-input" className="flex min-h-24 cursor-pointer flex-col justify-center rounded-xl border border-teal-300 bg-white px-4 py-3 text-sm font-semibold shadow-sm hover:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500">
                  <span>{language === "ar" ? "اختيار مجلد" : "Choose folder"}</span>
                  <span className="mt-1 text-xs font-normal text-slate-500">{t(language, "pacs.remap.selectFolder")}</span>
                </label>
                <input
                  id="remap-folder-input"
                  aria-label={t(language, "pacs.remap.selectFolder")}
                  key={`folder-${fileInputVersion}`}
                  type="file"
                  multiple
                  onChange={(event) => {
                    setAutoResumeDismissed(true);
                    const selectedFiles = Array.from(event.target.files || []);
                    cancelActiveFullScan();
                    cancelActiveStagingUpload();
                    setFiles(selectedFiles);
                    setScanResult(null);
                    setSelectedStudyInstanceUid("");
                    setSelectedPatientId("");
                    setSelectedDestinationKey("");
                    setCompleteScanStatus("idle");
                    setScanProgress(null);
                    setSkipAcknowledged(false);
                    setConfirmChecked(false);
                    setSecureStagingStatus("idle");
                    setUiStep("source");
                    if (selectedFiles.length > 0) scanMutation.mutate(selectedFiles);
                  }}
                  className="sr-only"
                  {...({ webkitdirectory: "true", directory: "true", mozdirectory: "true" } as Record<string, string>)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                {t(language, "pacs.remap.selectedFiles")}: <strong>{files.length}</strong>
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                {t(language, "pacs.remap.estimatedSize")}: <strong>{formatBytes(files.reduce((sum, file) => sum + file.size, 0))}</strong>
              </span>
            </div>
            {scanResult && (
              <div className={`rounded-xl border px-3 py-2 text-xs ${completeScanStatus === "skipped" ? "border-amber-300 bg-amber-50 text-amber-900" : completeScanStatus === "complete" ? "border-teal-200 bg-teal-50 text-teal-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                <p className="font-semibold" aria-live="polite">
                  {completeScanStatus === "running" ? t(language, "pacs.remap.completeScanRunning") : completeScanStatus === "complete" ? t(language, "pacs.remap.completeScanComplete") : completeScanStatus === "failed" ? t(language, "pacs.remap.completeScanFailed") : completeScanStatus === "skipped" ? t(language, "pacs.remap.completeScanSkipped") : t(language, "pacs.remap.quickPreviewComplete")}
                </p>
                {scanProgress && <>
                  <p>{t(language, "pacs.remap.scanProgress", { processed: scanProgress.processedFileCount, total: scanProgress.candidateFileCount, parsed: scanProgress.parsedDicomFileCount, unparsed: scanProgress.unparsedCount, studies: scanProgress.studyCount })}</p>
                  {scanProgress.candidateFileCount > 0 && (
                    <div className="mt-2">
                      <RemapProgressBar
                        label={language === "ar" ? "تقدم الفحص الكامل" : "Complete scan progress"}
                        value={scanProgress.processedFileCount}
                        max={scanProgress.candidateFileCount}
                        detail={`${scanProgress.processedFileCount} / ${scanProgress.candidateFileCount}`}
                      />
                    </div>
                  )}
                </>}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => scanMutation.mutate(files)}
                disabled={files.length === 0 || scanMutation.isPending || processMutation.isPending}
                className="btn-primary px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {scanMutation.isPending ? t(language, "pacs.remap.scanningFiles") : t(language, "pacs.remap.scanSelected")}
              </button>
              <button type="button" onClick={resetWorkflow} className="btn-secondary px-4 py-2 rounded-lg">
                {t(language, "pacs.remap.resetWorkflow")}
              </button>
            </div>

            {visibleErrorMessage && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{visibleErrorMessage}</div>}
            {previewWarning && completeScanStatus === "running" && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">{previewWarning}</div>}

          {scanResult && (
            <div className="mt-6 space-y-4 border-t border-slate-200 pt-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-base font-semibold">{language === "ar" ? "الدراسات المكتشفة" : "Detected studies"}</h4>
                <p className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  {t(language, "pacs.remap.detectedStudiesSummary", {
                    count: scanResult.studies.length,
                    skipped: scanResult.skippedSidecarCount,
                    unparsed: scanResult.unparsedCount,
                  })}
                </p>
              </div>
              {scanResult.studies.length > 1 && (
                <p className="text-xs text-amber-700">{t(language, "pacs.remap.multipleStudiesWarning")}</p>
              )}
              {(scanResult.previewOnly || scanResult.scanIncomplete) && completeScanStatus === "running" && (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="text-sm font-semibold">{language === "ar" ? "تحقق سريع على الخادم" : "Fast server verification"}</p>
                  <p>{t(language, "pacs.remap.preliminaryScanNotice")}</p>
                  {canStartFastStaging && selectedScannedStudy && (
                     <>
                      <div className="grid grid-cols-2 gap-2 rounded-xl border border-amber-200 bg-white/80 p-3 sm:grid-cols-4">
                        <div><span className="block text-slate-500">{t(language, "pacs.remap.studyPatientName")}</span><strong>{selectedScannedStudy.patientName || "—"}</strong></div>
                        <div><span className="block text-slate-500">{t(language, "pacs.remap.studyPatientId")}</span><strong>{selectedScannedStudy.patientId || "—"}</strong></div>
                        <div><span className="block text-slate-500">{language === "ar" ? "تاريخ الميلاد" : "Date of birth"}</span><strong>{selectedScannedStudy.patientBirthDate || "—"}</strong></div>
                        <div><span className="block text-slate-500">{language === "ar" ? "الجنس" : "Sex"}</span><strong>{selectedScannedStudy.patientSex || "—"}</strong></div>
                        <div><span className="block text-slate-500">{t(language, "pacs.remap.studyModality")}</span><strong>{selectedScannedStudy.modality || "—"}</strong></div>
                        <div><span className="block text-slate-500">{t(language, "pacs.remap.studyDate")}</span><strong>{selectedScannedStudy.studyDate || "—"}</strong></div>
                        <div className="col-span-2"><span className="block text-slate-500">Study Instance UID</span><strong className="break-all font-mono text-[11px]">{selectedScannedStudy.studyInstanceUid}</strong></div>
                      </div>
                      <p className="font-semibold">
                        {language === "ar"
                          ? "سيتم إعادة ربط وإرسال الملفات التابعة لمعرّف Study Instance UID هذا فقط. لن يتم إرسال الدراسات الأخرى الموجودة على القرص."
                          : "Only this Study Instance UID will be remapped and sent. Other studies on the CD will not be sent."}
                      </p>
                      <label className="flex items-start gap-2">
                        <input type="checkbox" checked={skipAcknowledged} onChange={(event) => setSkipAcknowledged(event.target.checked)} />
                        <span>
                          {language === "ar"
                            ? "أؤكد أن بطاقة الدراسة الأولية هذه هي المصدر المقصود وأريد بدء الرفع الآمن الآن."
                            : "I confirm this preliminary source study and want to begin secure staging now."}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => stageSourceMutation.mutate({
                          study: selectedScannedStudy,
                          uploadFiles: fastStagingFiles,
                          acknowledged: skipAcknowledged,
                        })}
                        disabled={!skipAcknowledged || stageSourceMutation.isPending}
                        className="btn-primary px-3 py-2 rounded-lg disabled:opacity-50"
                      >
                        {language === "ar" ? "تأكيد هذه الدراسة وبدء الرفع الآمن" : "Confirm this source study and begin secure staging"}
                      </button>
                    </>
                  )}
                </div>
              )}
              {completeScanStatus === "skipped" && (
                <div className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" role="status">
                  <p className="font-semibold">{t(language, "pacs.remap.folderNotFullyScanned")}</p>
                  <p>
                    {secureStagingStatus === "uploading"
                      ? (language === "ar" ? "يجري رفع المصدر الآمن. يمكنك اختيار المريض والوجهة أثناء الرفع." : "Secure source staging is in progress. You can select the patient and destination while it uploads.")
                      : (language === "ar" ? "اكتمل الرفع الآمن وتنتظر المهمة التأكيد النهائي." : "Secure staging is complete and the job is awaiting final confirmation.")}
                  </p>
                </div>
              )}
              {scanResult.studies.length === 0 && (
                <p className="text-xs text-amber-700">{t(language, "pacs.remap.unreliableStudyDetection")}</p>
              )}
              <div className="grid grid-cols-1 gap-3">
                {scanResult.studies.map((study) => {
                  const isSelected = selectedStudyInstanceUid === study.studyInstanceUid;
                  return (
                  <label key={study.studyInstanceUid} className={`block cursor-pointer rounded-2xl border p-4 text-xs transition-all ${isSelected ? "border-teal-500 bg-teal-50 shadow-sm" : "border-slate-200 hover:border-teal-300 hover:bg-slate-50"}`}>
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="study"
                        value={study.studyInstanceUid}
                        checked={selectedStudyInstanceUid === study.studyInstanceUid}
                        onChange={(e) => setSelectedStudyInstanceUid(e.target.value)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{study.studyDescription || study.modality || "—"}</p>
                            <p className="font-mono text-[11px]" title={study.studyInstanceUid} style={{ color: "var(--text-muted)" }}>{compactUid(study.studyInstanceUid)}</p>
                          </div>
                          {isSelected && <span className="rounded-full bg-teal-600 px-2 py-1 text-[11px] font-medium text-white">{language === "ar" ? "مختارة" : "Selected"}</span>}
                        </div>
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                          <div className="rounded-lg bg-white/70 p-2"><span className="block text-slate-500">{t(language, "pacs.remap.studyPatientName")}</span><strong>{study.patientName || "—"}</strong></div>
                          <div className="rounded-lg bg-white/70 p-2"><span className="block text-slate-500">{t(language, "pacs.remap.studyPatientId")}</span><strong>{study.patientId || "—"}</strong></div>
                          <div className="rounded-lg bg-white/70 p-2"><span className="block text-slate-500">{t(language, "pacs.remap.studyDate")}</span><strong>{study.studyDate || "—"}</strong></div>
                          <div className="rounded-lg bg-white/70 p-2"><span className="block text-slate-500">{t(language, "pacs.remap.studyModality")}</span><strong>{study.modality || "—"}</strong></div>
                          <div className="rounded-lg bg-white/70 p-2"><span className="block text-slate-500">{t(language, "pacs.remap.studyFiles")}</span><strong>{study.fileCount} • {formatBytes(study.totalBytes)}</strong></div>
                        </div>
                      </div>
                    </div>
                  </label>
                );})}
              </div>
            </div>
          )}
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                {scanMutation.isPending || completeScanStatus === "running"
                  ? (language === "ar" ? "ابقَ في المصدر حتى يكتمل الفحص أو يتم تأكيد التخطي." : "Stay in Source until scanning completes or the skip is acknowledged.")
                  : !canContinueStudy
                    ? (language === "ar" ? "اختر دراسة صالحة بعد اكتمال الفحص للمتابعة." : "Select a valid study after the scan completes to continue.")
                    : ""}
              </p>
              {selectedStudy && <p className="text-xs text-slate-600">{language === "ar" ? "السلاسل" : "Series"}: {selectedStudy.seriesCount}</p>}
              <button type="button" onClick={() => navigateTo("patient")} disabled={!canContinueStudy} className="btn-primary w-full rounded-lg px-4 py-2 disabled:opacity-50 sm:w-auto">
                {language === "ar" ? "متابعة إلى المريض" : "Continue to Patient"}
              </button>
            </div>
          </>}

          {effectiveUiStep === "patient" && selectedStudy && (
            <div className="space-y-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 ref={mainHeadingRef} tabIndex={-1} className="text-base font-semibold">{stepLabels[1]}</h3>
                {selectedPatientLabel && (
                  <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
                    {language === "ar" ? "مريض RISPro محدد" : "RISPro patient selected"}
                  </span>
                )}
              </div>
              {comparisonRequestId ? (
                <div className="rounded-2xl border border-teal-300 bg-teal-50 p-4 text-sm" data-testid="comparison-remap-context">
                  <p className="font-semibold">{t(language, "comparisons.uploadLocked")}</p>
                  {comparisonContextQuery.isLoading ? <p className="mt-1 text-xs text-slate-600">{t(language, "comparisons.loadingRequest")}</p> : null}
                  {comparisonContextQuery.isError ? <p className="mt-1 text-xs text-red-700">{t(language, "comparisons.requestLoadError")}</p> : null}
                  {comparisonContext ? (
                    <div className="mt-2 grid gap-1 text-xs">
                      <p><strong>{t(language, "comparisons.patient")}:</strong> {comparisonContext.patientEnglishName || comparisonContext.patientArabicName || comparisonContext.patientMrn || `#${comparisonContext.patientId}`}</p>
                      <p><strong>{t(language, "comparisons.previousStudy")}:</strong> {[comparisonContext.linkedStudyDate, comparisonContext.linkedExamName, comparisonContext.linkedPreviousAccessionNumber].filter(Boolean).join(" | ")}</p>
                      <p><strong>{t(language, "comparisons.reason")}:</strong> {comparisonContext.reason}</p>
                      <p className="font-semibold text-teal-800">{t(language, "comparisons.patientLocked")}</p>
                    </div>
                  ) : null}
                </div>
              ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
                <p className="text-xs font-semibold">{t(language, "pacs.remap.patientsByDateModality")}</p>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <select
                    value={scopedPatientLookupMode}
                    onChange={(e) => setScopedPatientLookupMode(e.target.value as PatientLookupMode)}
                    className="input-premium w-full px-3 py-2"
                  >
                    <option value="filtered_appointments">{t(language, "pacs.remap.lookupModeFilteredAppointments")}</option>
                    <option value="all_appointments">{t(language, "pacs.remap.lookupModeAllAppointments")}</option>
                    <option value="all_patients">{t(language, "pacs.remap.lookupModeAllPatients")}</option>
                  </select>
                  <select
                    value={studyDateMode}
                    onChange={(e) => setStudyDateMode(e.target.value as "today" | "yesterday" | "custom")}
                    className="input-premium w-full px-3 py-2"
                    disabled={scopedPatientLookupMode !== "filtered_appointments"}
                  >
                    <option value="today">{t(language, "pacs.remap.today")}</option>
                    <option value="yesterday">{t(language, "pacs.remap.yesterday")}</option>
                    <option value="custom">{t(language, "pacs.remap.chooseDate")}</option>
                  </select>
                  <input
                    type="date"
                    value={customStudyDate}
                    onChange={(e) => setCustomStudyDate(e.target.value)}
                    disabled={scopedPatientLookupMode !== "filtered_appointments" || studyDateMode !== "custom"}
                    className="input-premium w-full px-3 py-2 disabled:opacity-50"
                  />
                  <select
                    value={todayModalityFilter}
                    onChange={(e) => setTodayModalityFilter(e.target.value)}
                    className="input-premium w-full px-3 py-2"
                    disabled={scopedPatientLookupMode === "all_patients"}
                  >
                    <option value="">{t(language, "pacs.remap.allModalities")}</option>
                    {(modalityLookupQuery.data?.items || []).map((modality) => (
                      <option key={modality.id} value={modality.id}>
                        {modality.nameEn || modality.nameAr || modality.code || formatFallbackModalityLabel(language, modality.id)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={scopedPatientSearch}
                    onChange={(e) => setScopedPatientSearch(e.target.value)}
                    placeholder={
                      scopedPatientLookupMode === "all_patients"
                        ? t(language, "pacs.remap.searchAnyPatientPlaceholder")
                        : scopedPatientLookupMode === "all_appointments"
                          ? t(language, "pacs.remap.searchAllDatesPlaceholder")
                          : t(language, "pacs.remap.optionalPatientSearch")
                    }
                    className="input-premium w-full px-3 py-2"
                  />
                </div>
                {scopedPatientLookupMode === "filtered_appointments" && todayStudiesQuery.isLoading && <p className="text-xs">{t(language, "pacs.remap.loadingStudyLinkedPatients")}</p>}
                {scopedPatientLookupMode === "filtered_appointments" && todayStudiesQuery.error && <p className="text-xs text-red-600">{t(language, "pacs.remap.failedStudyLinkedPatients")}</p>}
                {scopedPatientLookupMode === "filtered_appointments" && !todayStudiesQuery.isLoading && (todayStudiesQuery.data?.appointments?.length || 0) > 0 && (
                  <div className="max-h-56 overflow-y-auto space-y-2">
                    {(todayStudiesQuery.data?.appointments || []).slice(0, 60).map((appointment) => {
                      const displayName = appointment.english_full_name || appointment.arabic_full_name || formatFallbackPatientLabel(language, appointment.patient_id);
                      const modalityName = appointment.modality_name_en || appointment.modality_name_ar || formatFallbackModalityLabel(language, appointment.modality_id);
                      const examName = appointment.exam_name_en || appointment.exam_name_ar || "";
                      const isSelected = Number(scopedPatientId || 0) === Number(appointment.patient_id);
                      return (
                        <button
                          key={appointment.id}
                          type="button"
                          onClick={() => selectPatient(String(appointment.patient_id))}
                          className={`w-full text-left rounded-xl border p-3 text-xs transition-all ${isSelected ? "border-teal-500 bg-teal-50 shadow-sm" : "border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/40"}`}
                        >
                          <p><strong>{displayName}</strong></p>
                          <p>{modalityName}{examName ? ` • ${examName}` : ""}</p>
                          <p>{appointment.appointment_date} • {appointment.accession_number}{appointment.national_id ? ` • ${appointment.national_id}` : ""}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
                {scopedPatientLookupMode === "filtered_appointments" && !todayStudiesQuery.isLoading && (todayStudiesQuery.data?.appointments?.length || 0) === 0 && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t(language, "pacs.remap.noAppointmentsForFilter")}</p>
                )}
                {scopedPatientLookupMode === "all_appointments" && <p className="text-xs font-semibold">{t(language, "pacs.remap.searchAllDatesAppointments")}</p>}
                {scopedPatientLookupMode === "all_appointments" && allDatesStudiesQuery.isLoading && <p className="text-xs">{t(language, "pacs.remap.loadingAllDatesAppointments")}</p>}
                {scopedPatientLookupMode === "all_appointments" && allDatesStudiesQuery.error && <p className="text-xs text-red-600">{t(language, "pacs.remap.failedAllDatesAppointments")}</p>}
                {scopedPatientLookupMode === "all_appointments" && !allDatesStudiesQuery.isLoading && trimmedPatientSearch.length >= 2 && (allDatesStudiesQuery.data?.appointments?.length || 0) > 0 && (
                  <div className="max-h-56 overflow-y-auto space-y-2">
                    {(allDatesStudiesQuery.data?.appointments || []).slice(0, 60).map((appointment) => {
                      const displayName = appointment.english_full_name || appointment.arabic_full_name || formatFallbackPatientLabel(language, appointment.patient_id);
                      const modalityName = appointment.modality_name_en || appointment.modality_name_ar || formatFallbackModalityLabel(language, appointment.modality_id);
                      const examName = appointment.exam_name_en || appointment.exam_name_ar || "";
                      const isSelected = Number(scopedPatientId || 0) === Number(appointment.patient_id);
                      return (
                        <button
                          key={`all-dates-${appointment.id}`}
                          type="button"
                          onClick={() => selectPatient(String(appointment.patient_id))}
                          className={`w-full text-left rounded-xl border p-3 text-xs transition-all ${isSelected ? "border-teal-500 bg-teal-50 shadow-sm" : "border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/40"}`}
                        >
                          <p><strong>{displayName}</strong></p>
                          <p>{modalityName}{examName ? ` • ${examName}` : ""}</p>
                          <p>{appointment.appointment_date} • {appointment.accession_number}{appointment.national_id ? ` • ${appointment.national_id}` : ""}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
                {scopedPatientLookupMode === "all_appointments" && !allDatesStudiesQuery.isLoading && trimmedPatientSearch.length >= 2 && (allDatesStudiesQuery.data?.appointments?.length || 0) === 0 && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t(language, "pacs.remap.noAppointmentsForSearch")}</p>
                )}
                {scopedPatientLookupMode === "all_patients" && <p className="text-xs font-semibold">{t(language, "pacs.remap.searchAnyPatient")}</p>}
                {scopedPatientLookupMode === "all_patients" && patientQuery.isLoading && <p className="text-xs">{t(language, "pacs.remap.loadingAnyPatient")}</p>}
                {scopedPatientLookupMode === "all_patients" && patientQuery.error && <p className="text-xs text-red-600">{t(language, "pacs.remap.failedAnyPatient")}</p>}
                {scopedPatientLookupMode === "all_patients" && !patientQuery.isLoading && trimmedPatientSearch.length >= 2 && directoryPatients.length > 0 && (
                  <div className="max-h-56 overflow-y-auto space-y-2">
                    {directoryPatients.slice(0, 25).map((patient) => {
                      const isSelected = Number(scopedPatientId || 0) === Number(patient.id);
                      return (
                        <button
                          key={`directory-${patient.id}`}
                          type="button"
                          onClick={() => selectPatient(String(patient.id))}
                          className={`w-full text-left rounded-xl border p-3 text-xs transition-all ${isSelected ? "border-teal-500 bg-teal-50 shadow-sm" : "border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/40"}`}
                        >
                          <p><strong>{formatDirectoryPatientName(language, patient)}</strong></p>
                          <p>{patient.national_id || patient.mrn || "—"}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
                {scopedPatientLookupMode === "all_patients" && !patientQuery.isLoading && trimmedPatientSearch.length >= 2 && directoryPatients.length === 0 && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t(language, "pacs.remap.noAnyPatientMatches")}</p>
                )}
              </div>
              )}
              {selectedAppointmentPatient && (
                <div className="rounded-2xl border border-teal-300 bg-teal-50 p-3 text-xs space-y-1">
                  <p><strong>{t(language, "pacs.remap.selectedAppointmentPatient")}:</strong> {selectedAppointmentPatient.english_full_name || selectedAppointmentPatient.arabic_full_name || formatFallbackPatientLabel(language, selectedAppointmentPatient.patient_id)}</p>
                  <p><strong>{t(language, "pacs.remap.appointmentDateLabel")}:</strong> {selectedAppointmentPatient.appointment_date} • <strong>ACC</strong>: {selectedAppointmentPatient.accession_number}</p>
                  <p><strong>{t(language, "common.modality")}:</strong> {selectedAppointmentPatient.modality_name_en || selectedAppointmentPatient.modality_name_ar || formatFallbackModalityLabel(language, selectedAppointmentPatient.modality_id)}</p>
                </div>
              )}
              {!selectedAppointmentPatient && selectedDirectoryPatient && (
                <div className="rounded-2xl border border-teal-300 bg-teal-50 p-3 text-xs space-y-1">
                  <p><strong>{t(language, "pacs.remap.selectedAppointmentPatient")}:</strong> {formatDirectoryPatientName(language, selectedDirectoryPatient)}</p>
                  <p><strong>{t(language, "pacs.remap.directoryPatientBadge")}:</strong> {selectedDirectoryPatient.national_id || selectedDirectoryPatient.mrn || "—"}</p>
                </div>
              )}
              {replacementPreviewQuery.isError && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">{language === "ar" ? "تعذر تحميل معاينة الاستبدال. أصلح الخطأ قبل المتابعة." : "Replacement preview failed. Resolve the error before continuing."}</p>}
              {replacementPreviewQuery.isLoading && scopedPatientId && <p className="text-xs text-slate-500" aria-live="polite">{language === "ar" ? "جارٍ تحميل معاينة الاستبدال…" : "Loading replacement preview…"}</p>}
              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={() => navigateTo("source")} className="btn-secondary w-full rounded-lg px-4 py-2 sm:w-auto">{language === "ar" ? "رجوع" : "Back"}</button>
                <button type="button" onClick={() => navigateTo("destination")} disabled={!canContinuePatient} className="btn-primary w-full rounded-lg px-4 py-2 disabled:opacity-50 sm:w-auto">{language === "ar" ? "متابعة إلى الوجهة" : "Continue to Destination"}</button>
              </div>
            </div>
          )}

          {effectiveUiStep === "destination" && selectedStudy && (
            <div className="space-y-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 ref={mainHeadingRef} tabIndex={-1} className="text-base font-semibold">{stepLabels[2]}</h3>
                {effectiveSelectedDestinationKey && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                    {effectiveSelectedDestinationKey}
                  </span>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3">
                <select value={effectiveSelectedDestinationKey} onChange={(e) => selectDestination(e.target.value)} className="input-premium w-full px-3 py-2">
                  <option value="">{t(language, "pacs.remap.selectDestination")}</option>
                  {destinations.map((destination) => (
                    <option key={destination.key} value={destination.key}>
                      {destination.name} ({destination.key}){destination.isDefault ? ` • ${t(language, "pacs.remap.defaultDestinationBadge")}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={() => navigateTo("patient")} className="btn-secondary w-full rounded-lg px-4 py-2 sm:w-auto">{language === "ar" ? "رجوع" : "Back"}</button>
                <button type="button" onClick={() => navigateTo("review")} disabled={!canContinueDestination} className="btn-primary w-full rounded-lg px-4 py-2 disabled:opacity-50 sm:w-auto">{language === "ar" ? "متابعة إلى المراجعة" : "Continue to Review"}</button>
              </div>
            </div>
          )}

          {effectiveUiStep === "review" && selectedStudy && (
            <div className="space-y-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 ref={mainHeadingRef} tabIndex={-1} className="text-base font-semibold">{stepLabels[3]}</h3>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                  {language === "ar" ? "نقطة تحقق نهائية" : "Final safety checkpoint"}
                </span>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-200 text-xs">
                <table className="w-full border-collapse">
                  <thead className="bg-black/5">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">{language === "ar" ? "الحقل" : "Field"}</th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">{language === "ar" ? "القيمة الأصلية من DICOM" : "Original DICOM"}</th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">{language === "ar" ? "القيمة بعد الاستبدال" : "Replacement / Target"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium">{language === "ar" ? "المريض" : "Patient"}</th>
                      <td className="px-3 py-2 font-mono">{selectedStudy?.patientName || "—"}</td>
                      <td className="px-3 py-2 font-mono">{replacementPreviewQuery.data?.patientName || selectedPatientLabel || "—"}</td>
                    </tr>
                    <tr className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium">PatientID</th>
                      <td className="px-3 py-2 font-mono">{selectedStudy?.patientId || "—"}</td>
                      <td className="px-3 py-2 font-mono">{replacementPreviewQuery.data?.patientId || "—"}</td>
                    </tr>
                    <tr className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium">{language === "ar" ? "الجنس" : "Sex"}</th>
                      <td className="px-3 py-2 font-mono">{selectedStudy?.patientSex || "—"}</td>
                      <td className="px-3 py-2 font-mono">{replacementPreviewQuery.data?.patientSex || "—"}</td>
                    </tr>
                    <tr className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium">{language === "ar" ? "تاريخ الميلاد" : "Birth date"}</th>
                      <td className="px-3 py-2 font-mono">{selectedStudy?.patientBirthDate || "—"}</td>
                      <td className="px-3 py-2 font-mono">{replacementPreviewQuery.data?.patientBirthDate || "—"}</td>
                    </tr>
                    <tr className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium">{t(language, "pacs.remap.studyLabel")}</th>
                      <td className="px-3 py-2">{skippedScanMode ? scopedStudyInstanceUid : `${selectedStudy?.studyDescription || "—"} • ${selectedStudy?.studyDate || "—"} • ${selectedStudy?.modality || "—"}`}</td>
                      <td className="px-3 py-2">{skippedScanMode ? (language === "ar" ? "سيتحقق الخادم من هذا المعرّف فقط ويستبعد الدراسات الأخرى." : "The server will verify this exact UID and exclude other studies.") : (language === "ar" ? "نفس الدراسة المختارة" : "Selected study only")}</td>
                    </tr>
                    <tr className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium">{t(language, "pacs.remap.destinationLabel")}</th>
                      <td className="px-3 py-2">—</td>
                      <td className="px-3 py-2 font-mono">{effectiveSelectedDestinationKey || "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-amber-700">
                {skippedScanMode
                  ? (stagingCompleted
                    ? (language === "ar" ? "اكتمل الرفع الآمن. سيعزل الخادم الدراسة المختارة ويتحقق منها بعد التأكيد النهائي." : "Secure staging is complete. The server will isolate and validate the selected study after final confirmation.")
                    : (language === "ar" ? "يمكنك التأكيد الآن. ستبدأ المعالجة تلقائياً عند اكتمال الرفع الآمن." : "You can confirm now. Processing will begin automatically when secure staging completes."))
                  : t(language, "pacs.remap.selectedStudyOnly")}
              </p>
              <details className="rounded-2xl border border-slate-200 bg-white text-xs">
                <summary className="flex cursor-pointer list-none flex-col gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="font-semibold">{language === "ar" ? "محتويات الدراسة من القرص" : "CD study contents"}</h4>
                    <p className="text-slate-500">
                      {skippedScanMode
                        ? (language === "ar" ? "تمت قراءة هذه الملفات من المصدر مرة واحدة للرفع الآمن. لن يعيد التأكيد النهائي رفعها." : "These source files are read once for secure staging. Final confirmation will not upload them again.")
                        : language === "ar"
                        ? "هذه هي ملفات الدراسة التي سيتم رفعها بعد التأكيد."
                        : "These are the selected study files that will be uploaded after confirmation."}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                    {reviewFiles.length} {language === "ar" ? "ملفات" : "files"}
                  </span>
                </summary>
                {reviewFiles.length ? (
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full min-w-[720px] border-collapse">
                      <thead className="sticky top-0 bg-white shadow-sm">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">#</th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">{language === "ar" ? "المسار / الملف" : "Path / file"}</th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">{language === "ar" ? "الحجم" : "Size"}</th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">{language === "ar" ? "السلسلة" : "Series"}</th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">SOP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reviewFiles.slice(0, 200).map((entry, index) => {
                          const fileEntry = entry as Partial<DicomScanFileEntry> & File & { file?: File };
                          const fileName = fileEntry.filePath || fileEntry.fileName || fileEntry.file?.name || fileEntry.name || "—";
                          const fileSize = fileEntry.fileSize || fileEntry.file?.size || fileEntry.size || 0;
                          return (
                            <tr key={`${fileName}-${index}`} className="border-t border-slate-100">
                              <td className="px-3 py-2 text-slate-500">{index + 1}</td>
                              <td className="px-3 py-2 font-mono text-[11px]">{fileName}</td>
                              <td className="px-3 py-2">{formatBytes(fileSize)}</td>
                              <td className="px-3 py-2 font-mono text-[11px]">{fileEntry.seriesInstanceUid || "—"}</td>
                              <td className="px-3 py-2 font-mono text-[11px]">{fileEntry.sopInstanceUid || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {reviewFiles.length > 200 && (
                      <p className="border-t border-slate-100 px-3 py-2 text-slate-500">
                        {language === "ar"
                          ? `تم عرض أول 200 ملف من ${reviewFiles.length}.`
                          : `Showing first 200 of ${reviewFiles.length} files.`}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="px-3 py-3 text-slate-500">
                    {language === "ar" ? "لم يتم العثور على ملفات للدراسة المختارة." : "No files found for the selected study."}
                  </p>
                )}
              </details>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 space-y-3">
                <label className="flex items-start gap-2 text-xs font-medium text-amber-950">
                  <input type="checkbox" checked={scopedConfirmChecked} onChange={(e) => setScopedConfirmChecked(e.target.checked)} className="mt-0.5" />
                  <span>{t(language, "pacs.remap.confirmIdentity")}</span>
                </label>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <button type="button" onClick={() => navigateTo("destination")} className="btn-secondary w-full rounded-lg px-4 py-2 sm:w-auto">{language === "ar" ? "رجوع" : "Back"}</button>
                  <button
                    type="button"
                    onClick={() => fastStagedWorkflow ? requestStagedConfirmation() : processMutation.mutate()}
                    disabled={!canSubmit}
                    className="btn-primary w-full rounded-lg px-4 py-2 disabled:opacity-50 sm:w-auto"
                  >
                    {fastStagedWorkflow
                      ? (language === "ar" ? "تأكيد المريض والوجهة وبدء إعادة الربط" : "Confirm patient and destination; begin remap")
                      : t(language, "pacs.remap.uploadSelectedStudy")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {effectiveUiStep === "processing" && !isTerminalSuccess && !isTerminalFailure && (
            <div {...activeCardProps}>
              <h3 ref={mainHeadingRef} tabIndex={-1} className="text-base font-semibold">{stepLabels[4]}</h3>
              {recoveryIsProcessing && (
                <p className="rounded border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950" role="status">
                  {t(language, "pacs.remap.orthancRecoveryProcessing")}
                </p>
              )}
              {currentJob?.status === "awaiting_confirmation" && currentJob.processing_stage === "awaiting_send_confirmation" && (() => {
                const counts = currentJob.processing_selection_counts || {};
                const uncertainOnly = !counts.partial && counts.completenessUncertain;
                return (
                  <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
                    <h4 className="font-semibold">{uncertainOnly ? "Study completeness uncertain" : "Partial study import"}</h4>
                    <p>RISpro accepted {counts.acceptedUniqueInstances || 0} unique selected-study DICOM instances.{counts.failedSelectedStudyFiles ? ` ${counts.failedSelectedStudyFiles} selected-study files could not be processed.` : ""}{counts.unassignedLikelyDicomFiles ? ` Membership could not be established for ${counts.unassignedLikelyDicomFiles} likely-DICOM files.` : ""}</p>
                    <p>Excluded other-study files: {counts.excludedOtherStudyFiles || 0}. RISpro cannot confirm diagnostic completeness.</p>
                    {!!counts.completeSeriesLossCount && <p className="font-semibold">Warning: {counts.completeSeriesLossCount} series have failures and no accepted instances.</p>}
                    {!!counts.failureSample?.length && <ul className="list-disc ps-5 text-xs">{counts.failureSample.map((failure) => <li key={`${failure.fileLabel}-${failure.category}`}>{failure.fileLabel}: {failure.category}</li>)}</ul>}
                    <label className="flex items-start gap-2">
                      <input type="checkbox" checked={incompleteStudyAcknowledged} onChange={(event) => setIncompleteStudyAcknowledged(event.target.checked)} />
                      <span>{uncertainOnly ? "I understand that RISpro could not determine whether every likely-DICOM file belonged to the selected study, and I reviewed this warning." : "I understand that the remapped study is incomplete and have reviewed the skipped-file warning."}</span>
                    </label>
                    <button type="button" className="btn-primary rounded-lg px-3 py-2 disabled:opacity-50" disabled={!incompleteStudyAcknowledged || confirmIncompleteStudyMutation.isPending} onClick={() => effectiveJobId && confirmIncompleteStudyMutation.mutate(effectiveJobId)}>Acknowledge and send to PACS</button>
                  </div>
                );
              })()}
              {pendingStagedConfirmation && secureStagingStatus === "uploading" && (
                <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-950" role="status">
                  <p>{language === "ar"
                    ? "تم تسجيل التأكيد. يستمر الرفع الآمن؛ وستبدأ المعالجة تلقائياً."
                    : "Confirmation recorded. Secure staging is continuing; processing will start automatically."}</p>
                  <div className="mt-2">
                    <RemapProgressBar
                      label={language === "ar" ? "تقدم رفع المصدر الآمن" : "Secure source staging progress"}
                      value={uploadTotal > 0 ? uploadLoaded : null}
                      max={uploadTotal > 0 ? uploadTotal : null}
                      detail={uploadTotal > 0 ? `${formatBytes(uploadLoaded)} / ${formatBytes(uploadTotal)}` : undefined}
                    />
                  </div>
                  <button type="button" onClick={cancelUnconfirmedDraftAndReset} className="mt-2 rounded-lg border border-teal-300 bg-white px-3 py-1.5 font-semibold text-teal-900">
                    {language === "ar" ? "إلغاء الرفع الآمن وإعادة البدء" : "Cancel secure staging and reset"}
                  </button>
                </div>
              )}
              <ol className="space-y-2 text-xs" aria-label={language === "ar" ? "مراحل المعالجة" : "Processing stages"}>
                {[
                  ["uploading", language === "ar" ? "رفع المتصفح إلى RISpro" : "Uploading to RISpro"],
                  ["queued", language === "ar" ? "في الانتظار" : "Queued"],
                  ["validating", language === "ar" ? "التحقق من الدراسة" : "Validating study"],
                  ["building_uid_plan", language === "ar" ? "تحضير خطة UID" : "Preparing UID remap"],
                  ["rewriting", language === "ar" ? "إعادة كتابة DICOM" : "Rewriting DICOM"],
                  ["uploading_to_orthanc", language === "ar" ? "الرفع إلى Orthanc" : "Uploading to Orthanc"],
                  ["verifying_orthanc", language === "ar" ? "التحقق في Orthanc" : "Verifying in Orthanc"],
                  ["enqueueing_send", language === "ar" ? "الإرسال إلى PACS" : "Sending to PACS"],
                ].map(([key, label], index, stages) => {
                  const activeIndex = stages.findIndex(([stageKey]) => stageKey === effectiveProcessingStage);
                  const complete = index < activeIndex;
                  const current = index === activeIndex;
                  return <li key={key} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${complete ? "border-teal-200 bg-teal-50 text-teal-800" : current ? "border-teal-500 bg-white text-teal-900" : "border-slate-200 bg-white text-slate-500"}`}><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold">{complete ? "✓" : index + 1}</span><span>{label}</span>{current && <span className="ms-auto">{language === "ar" ? "جارٍ" : "Active"}</span>}</li>;
                })}
              </ol>
              <div className="hidden">
                {[
                  { key: "uploading", label: language === "ar" ? "رفع" : "Upload" },
                  { key: "orthanc_processing", label: language === "ar" ? "معالجة" : "Rewrite" },
                  { key: "sending", label: language === "ar" ? "إرسال" : "Send" },
                ].map((stage) => {
                  const activeStages = ["uploading", "orthanc_processing", "sending"];
                  const currentIndex = activeStages.indexOf(effectiveProcessingStage);
                  const stageIndex = activeStages.indexOf(stage.key);
                  return (
                    <div key={stage.key} className={`rounded-xl border px-3 py-2 text-center font-medium ${stageIndex <= currentIndex ? "border-teal-500 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-500"}`}>
                      {stage.label}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }} aria-live="polite">
                {effectiveResumedJobMessage && <span className="block font-medium text-teal-800">{effectiveResumedJobMessage}</span>}
                {effectiveProcessingStage === "uploading" && t(language, "pacs.remap.uploadingSelectedStudy", { percent: uploadPercent })}
                {effectiveProcessingStage !== "uploading" && effectiveProcessingStage !== "enqueueing_send" && (currentJob ? processingStageLabel(language, currentJob.processing_stage) : t(language, "pacs.remap.waitingOrthanc"))}
                {effectiveProcessingStage === "enqueueing_send" && t(language, "pacs.remap.sendingToPacs")}
              </p>
              {effectiveProcessingStage === "uploading" && !(pendingStagedConfirmation && secureStagingStatus === "uploading") && (
                <RemapProgressBar
                  label={language === "ar" ? "تقدم رفع المصدر" : "Source upload progress"}
                  value={uploadTotal > 0 ? uploadLoaded : null}
                  max={uploadTotal > 0 ? uploadTotal : null}
                  detail={uploadTotal > 0 ? `${formatBytes(uploadLoaded)} / ${formatBytes(uploadTotal)}` : undefined}
                />
              )}
              {effectiveProcessingStage !== "uploading" && currentJob && (() => {
                const progress = jobProgress(currentJob);
                const detail = progress.max
                  ? `${Number(currentJob.processed_file_count || 0)} / ${progress.max}`
                  : processingStageLabel(language, currentJob.processing_stage);
                return (
                  <RemapProgressBar
                    label={processingStageLabel(language, currentJob.processing_stage)}
                    value={progress.value}
                    max={progress.max}
                    state={progress.state}
                    detail={detail}
                  />
                );
              })()}
              {persistedJobContext || (stagedProvisionalIdentity && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {language === "ar" ? "المصدر" : "Source"}: <strong>{stagedProvisionalIdentity.patientName || stagedProvisionalIdentity.patientId || "—"}</strong>
                  {" · "}Study Instance UID: <span className="font-mono">{stagedProvisionalIdentity.studyInstanceUid}</span>
                </p>
              ))}
              {viewingPersistedJob && currentJob?.error_message && (
                <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  <strong>{language === "ar" ? "سبب الفشل المحفوظ" : "Persisted failure"}:</strong> {currentJob.error_message}
                </p>
              )}
              {currentJob && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {language === "ar" ? "حالة المهمة" : "Job status"}: {statusLabel(language, currentJob.status)} •{" "}
                  {language === "ar" ? "الملفات المعالجة" : "Processed files"}: {currentJob.processed_file_count || 0}/{currentJob.staged_file_count || "—"}
                  {currentJob.processing_skipped_file_count ? ` • ${language === "ar" ? "تم تجاوز" : "Skipped"}: ${currentJob.processing_skipped_file_count}` : ""}
                  {currentJob.processing_attempt_count ? ` • ${language === "ar" ? "المحاولة" : "Attempt"}: ${currentJob.processing_attempt_count}` : ""}
                </p>
              )}
              {currentJob && ["uploaded", "processing", "remapped", "sending"].includes(currentJob.status) && (
                <button type="button" onClick={startNewUpload} className="btn-secondary w-fit rounded-lg px-3 py-2 text-sm">
                  {t(language, "pacs.remap.startNewUpload")}
                </button>
              )}
              {effectiveProcessingStage === "enqueueing_send" && currentJob?.send_error_code && (
                <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  {currentJob.send_error_code}: {oneLineReason(currentJob.error_message) || "RISpro is continuing to monitor this PACS send."}
                </p>
              )}
            </div>
          )}

          {effectiveUiStep === "processing" && (isTerminalSuccess || isTerminalFailure) && (
            <div {...activeCardProps}>
              <h3 ref={mainHeadingRef} tabIndex={-1} className="text-lg font-semibold">{stepLabels[4]}</h3>
              {isTerminalSuccess ? (
                <div className="space-y-2">
                  <p className="text-sm text-green-700">{t(language, "pacs.remap.success")}</p>
                  <RemapProgressBar label={language === "ar" ? "اكتملت معالجة DICOM" : "DICOM remap completed"} value={1} max={1} state="success" />
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-red-700">{visibleErrorMessage || t(language, "pacs.remap.failure")}</p>
                  {currentJob?.error_message && currentJob.error_message !== visibleErrorMessage && (
                    <p className="text-sm text-red-700">{currentJob.error_message}</p>
                  )}
                  <RemapProgressBar label={language === "ar" ? "توقفت معالجة DICOM" : "DICOM remap stopped"} state="failed" detail={language === "ar" ? "فشل" : "Failed"} />
                  {currentJob && (
                    <dl className="grid grid-cols-1 gap-1 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800 sm:grid-cols-2">
                      {currentJob.processing_error_code && <div><dt className="font-semibold">Processing error</dt><dd className="font-mono">{currentJob.processing_error_code}</dd></div>}
                      {currentJob.orthanc_recovery_error_code && <div><dt className="font-semibold">{t(language, "pacs.remap.orthancRecoveryError")}</dt><dd className="font-mono">{currentJob.orthanc_recovery_error_code}</dd></div>}
                      {currentJob.send_error_code && <div><dt className="font-semibold">Send error</dt><dd className="font-mono">{currentJob.send_error_code}</dd></div>}
                      {currentJob.orthanc_send_job_id && <div><dt className="font-semibold">Orthanc job ID</dt><dd className="break-all font-mono">{currentJob.orthanc_send_job_id}</dd></div>}
                      <div><dt className="font-semibold">Send attempts</dt><dd>{currentJob.send_attempt_count || 0}</dd></div>
                      {currentJob.processing_attempt_count != null && <div><dt className="font-semibold">Processing attempts</dt><dd>{currentJob.processing_attempt_count}</dd></div>}
                    </dl>
                  )}
                  {visibleErrorDetails && (
                    <details className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      <summary className="cursor-pointer font-medium">Technical details</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words">{visibleErrorDetails}</pre>
                    </details>
                  )}
                  {currentJob?.processing_error_details != null && currentJob?.send_error_details != null && (
                    <details className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      <summary className="cursor-pointer font-medium">Send error details</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words">{formatTechnicalDetails(currentJob.send_error_details)}</pre>
                    </details>
                  )}
                  {retryActionError && (
                    <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950" role="alert">
                      <p><strong>{language === "ar" ? "فشل إجراء إعادة الإرسال" : "Resend action failed"}:</strong> {retryActionError}</p>
                      {retryActionErrorDetails && <pre className="mt-1 whitespace-pre-wrap break-words">{retryActionErrorDetails}</pre>}
                    </div>
                  )}
                  {persistedJobContext}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {gatewayUploadLimitRejected ? (
                  <button type="button" onClick={() => navigateTo("review")} className="btn-secondary px-3 py-2 rounded-lg text-sm">{t(language, "pacs.remap.backToReview")}</button>
                ) : (
                  <button type="button" onClick={startNewUpload} className="btn-secondary px-3 py-2 rounded-lg text-sm">{t(language, "pacs.remap.startNewUpload")}</button>
                )}
                {effectiveJobId && (
                  <>
                    {requiresDestinationCheck(currentJob) && (
                      <div className="w-full rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 space-y-2">
                        <p>RISpro could not confirm whether PACS received this study. Check the destination PACS before resending to avoid a duplicate study.</p>
                        <label className="flex items-start gap-2">
                          <input type="checkbox" checked={destinationCheckedForResend} onChange={(event) => setDestinationCheckedForResend(event.target.checked)} />
                          <span>I checked the destination PACS and confirmed this study is not already present.</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => resendJobMutation.mutate({ targetJobId: effectiveJobId, confirmDestinationChecked: true })}
                          disabled={!destinationCheckedForResend || resendJobMutation.isPending}
                          className="btn-secondary px-3 py-2 rounded-lg text-sm disabled:opacity-50"
                        >
                          {t(language, "pacs.remap.resendToPacs")}
                        </button>
                      </div>
                    )}
                    {canResendJob(currentJob) && (
                      <button
                        type="button"
                        onClick={() => resendJobMutation.mutate({ targetJobId: effectiveJobId })}
                        disabled={resendJobMutation.isPending}
                        className="btn-secondary px-3 py-2 rounded-lg text-sm disabled:opacity-50"
                      >
                        {t(language, "pacs.remap.resendToPacs")}
                      </button>
                    )}
                    {canRetryWithOrthanc(currentJob) && (
                      <button
                        type="button"
                        onClick={() => orthancRecoveryMutation.mutate({ targetJobId: effectiveJobId })}
                        disabled={orthancRecoveryMutation.isPending}
                        className="btn-secondary px-3 py-2 rounded-lg text-sm disabled:opacity-50"
                      >
                        {orthancRecoveryMutation.isPending ? t(language, "pacs.remap.orthancRecoveryProcessing") : t(language, "pacs.remap.retryWithOrthanc")}
                      </button>
                    )}
                    {canRecoverSource(currentJob) && (
                      <button
                        type="button"
                        onClick={() => recoverSource(effectiveJobId)}
                        className="btn-secondary px-3 py-2 rounded-lg text-sm"
                      >
                        Recover Source
                      </button>
                    )}
                    {requiresDicomReupload(currentJob) && (
                      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                        {t(language, "pacs.remap.reuploadRequired")}
                      </p>
                    )}
                    {currentJob?.status === "failed" && currentJob.source_recovery_available === false && (
                      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                        Preserved source files are no longer available.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => resetJobMutation.mutate({ targetJobId: effectiveJobId })}
                      disabled={resetJobMutation.isPending}
                      className="btn-secondary px-3 py-2 rounded-lg text-sm disabled:opacity-50"
                    >
                      {t(language, "pacs.remap.resetCurrentUpload")}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <details className="card-shell p-4 space-y-2 text-xs">
            <summary className="cursor-pointer font-semibold text-sm">{language === "ar" ? "سجل إعادة التعيين" : "Remap History"}</summary>
            <div className="flex gap-1" role="group" aria-label="Remap history scope">
              <button type="button" onClick={() => setHistoryScope("mine")} aria-pressed={historyScope === "mine"} className="btn-secondary px-2 py-1 rounded-lg text-xs">My Jobs</button>
              <button type="button" onClick={() => setHistoryScope("all")} aria-pressed={historyScope === "all"} className="btn-secondary px-2 py-1 rounded-lg text-xs">All Users</button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {(jobsQuery.data?.jobs || []).map((job) => (
                <div key={job.id} className="rounded border p-2 space-y-2">
                  <button
                    type="button"
                    onClick={() => openRecentJob(job)}
                    className="w-full text-left hover:bg-black/5"
                  >
                    <p className="font-mono">#{job.id} • {statusLabel(language, job.status)}</p>
                    {(job.status === "uploaded" || job.status === "processing") && <p className="text-[11px]">{processingStageLabel(language, job.processing_stage)} • {job.processed_file_count || 0}/{job.staged_file_count || "—"}</p>}
                    {["uploaded", "processing", "remapped", "sending", "sent", "failed"].includes(job.status) && (() => {
                      const progress = jobProgress(job);
                      return <RemapProgressBar
                        compact
                        label={`${language === "ar" ? "المهمة" : "Job"} #${job.id}: ${processingStageLabel(language, job.processing_stage)}`}
                        value={progress.value}
                        max={progress.max}
                        state={progress.state}
                        detail={progress.max ? `${Number(job.processed_file_count || 0)} / ${progress.max}` : processingStageLabel(language, job.processing_stage)}
                      />;
                    })()}
                    <p className="truncate"><strong>{job.original_patient_name || "—"}</strong></p>
                    <p className="truncate">{job.replacement_patient_name || "—"} • {job.destination_pacs_key || "—"}</p>
                    <p className="text-[11px] text-slate-600">Created by: {job.created_by_user_name || job.created_by_username || "Unknown user"}</p>
                    {(job.processing_selection_counts?.partial || job.processing_selection_counts?.completenessUncertain) && (
                      <p className="text-[11px] font-semibold text-amber-800">
                        {job.processing_selection_counts.partial ? "Partial study" : "Completeness uncertain"}: {job.processing_selection_counts.acceptedUniqueInstances || 0} accepted unique instances
                      </p>
                    )}
                    {isSendFailedJob(job) && (
                      <p className="text-[11px] text-red-700 truncate">{t(language, "pacs.remap.sendFailedBadge")} • {oneLineReason(job.error_message) || t(language, "pacs.remap.failedResend")}</p>
                    )}
                    {job.orthanc_recovery_status === "processing" && <p className="text-[11px] font-semibold text-teal-800">{t(language, "pacs.remap.orthancRecoveryProcessing")}</p>}
                    {requiresDicomReupload(job) && <p className="text-[11px] font-semibold text-amber-800">{t(language, "pacs.remap.reuploadRequired")}</p>}
                    {job.status === "failed" && job.source_recovery_available === false && <p className="text-[11px] font-semibold text-amber-800">Preserved source files are no longer available.</p>}
                  </button>
                  {canResendJob(job) && viewedRecentJobId !== job.id && (
                    <button
                      type="button"
                      onClick={() => resendJobMutation.mutate({ targetJobId: job.id, viewTargetJob: job })}
                      disabled={resendJobMutation.isPending}
                      className="btn-secondary px-2 py-1 rounded-lg text-xs disabled:opacity-50"
                    >
                      {t(language, "pacs.remap.resendToPacs")}
                    </button>
                  )}
                  {canRetryWithOrthanc(job) && viewedRecentJobId !== job.id && (
                    <button
                      type="button"
                      onClick={() => orthancRecoveryMutation.mutate({ targetJobId: job.id, viewTargetJob: job })}
                      disabled={orthancRecoveryMutation.isPending}
                      className="btn-secondary px-2 py-1 rounded-lg text-xs disabled:opacity-50"
                    >
                      {t(language, "pacs.remap.retryWithOrthanc")}
                    </button>
                  )}
                  {canRecoverSource(job) && viewedRecentJobId !== job.id && (
                    <button
                      type="button"
                      onClick={() => recoverSource(job.id)}
                      className="btn-secondary px-2 py-1 rounded-lg text-xs"
                    >
                      Recover Source
                    </button>
                  )}
                </div>
              ))}
            </div>
          </details>
          <details className="card-shell p-4 text-xs">
            <summary className="cursor-pointer font-semibold">{language === "ar" ? "صيانة المشرف" : "Supervisor maintenance"}</summary>
            <div className="mt-3 space-y-2">
              <p className="text-slate-500">{language === "ar" ? "إجراء مشرف للصيانة فقط." : "Supervisor-only maintenance action."}</p>
              <button type="button" onClick={() => clearFailedStudiesMutation.mutate()} disabled={clearFailedStudiesMutation.isPending} className="btn-secondary rounded-lg px-3 py-2 text-xs">
                {t(language, "pacs.remap.clearFailedStudies")}
              </button>
            </div>
          </details>
        </div>
      </div>

      {visibleErrorMessage && effectiveUiStep !== "processing" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {visibleErrorMessage}
        </div>
      )}
      {visibleSuccessMessage && effectiveUiStep !== "processing" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {visibleSuccessMessage}
        </div>
      )}

      {showReAuthModal && (
        <SupervisorReAuthModal
          onClose={() => {
            setShowReAuthModal(false);
            setRetryClearAfterReAuth(false);
          }}
          onSuccess={() => {
            setShowReAuthModal(false);
            if (retryClearAfterReAuth) {
              setRetryClearAfterReAuth(false);
              clearFailedStudiesMutation.mutate();
            }
          }}
        />
      )}
    </div>
  );
}
