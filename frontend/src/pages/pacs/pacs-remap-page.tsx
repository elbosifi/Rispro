import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";
import { statusLabel, t } from "@/lib/i18n";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { useLanguage } from "@/providers/language-provider";
import { buildDicomUploadSelectionPlan, buildSkipPreviewScanResult, previewDicomStudiesFromFiles, type DicomScanFileEntry, type DicomStudyScanResult } from "@/lib/dicom-study-scan";

type JobStatus = "uploaded" | "awaiting_confirmation" | "remapped" | "sending" | "sent" | "failed" | "cancelled";
type RemapWizardStep =
  | "select_files"
  | "scanning"
  | "choose_study"
  | "choose_patient"
  | "choose_destination"
  | "review"
  | "uploading"
  | "orthanc_processing"
  | "remapping"
  | "sending"
  | "sent"
  | "failed";

type PatientLookupMode = "filtered_appointments" | "all_appointments" | "all_patients";

interface RemapJob {
  id: number;
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
  error_message: string | null;
  cancellation_reason: string | null;
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

function wizardStepLabel(language: string, step: RemapWizardStep): string {
  const map: Record<RemapWizardStep, string> = {
    select_files: t(language as "ar" | "en", "pacs.remap.step1"),
    scanning: t(language as "ar" | "en", "pacs.remap.scanningFiles"),
    choose_study: t(language as "ar" | "en", "pacs.remap.step2"),
    choose_patient: t(language as "ar" | "en", "pacs.remap.step3"),
    choose_destination: t(language as "ar" | "en", "pacs.remap.step4"),
    review: t(language as "ar" | "en", "pacs.remap.step5"),
    uploading: t(language as "ar" | "en", "pacs.remap.processStep"),
    orthanc_processing: t(language as "ar" | "en", "pacs.remap.processStep"),
    remapping: t(language as "ar" | "en", "pacs.remap.processStep"),
    sending: t(language as "ar" | "en", "pacs.remap.processStep"),
    sent: t(language as "ar" | "en", "pacs.remap.resultStep"),
    failed: t(language as "ar" | "en", "pacs.remap.resultStep"),
  };
  return map[step];
}

function isCancellableJobStatus(status: JobStatus): boolean {
  return ["uploaded", "awaiting_confirmation"].includes(status);
}

function canResendJob(job: RemapJob | null | undefined): boolean {
  if (!job) return false;
  if (!["failed", "remapped", "sent"].includes(job.status)) return false;
  return Boolean(job.destination_pacs_key && (job.modified_orthanc_study_id || job.source_orthanc_study_id));
}

function isSendFailedJob(job: RemapJob | null | undefined): boolean {
  if (!job || job.status !== "failed") return false;
  return Boolean(job.destination_pacs_key && (job.modified_orthanc_study_id || job.source_orthanc_study_id));
}

function oneLineReason(message: string | null | undefined): string {
  return String(message || "").replace(/\s+/g, " ").trim();
}

function stepTone(index: number, activeIndex: number): string {
  if (index < activeIndex) return "border-teal-500 bg-teal-50 text-teal-800";
  if (index === activeIndex) return "border-teal-600 bg-teal-600 text-white shadow-sm";
  return "border-slate-200 bg-white/70 text-slate-500";
}

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function uploadMultipartWithProgress(
  path: string,
  formData: FormData,
  timeoutMs: number,
  onProgress: (loaded: number, total: number) => void,
  onUploadComplete?: () => void,
): Promise<UploadMultipartResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const timer = window.setTimeout(() => xhr.abort(), timeoutMs);
    let uploadComplete = false;
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
      window.clearTimeout(timer);
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
        resolve(body as unknown as UploadMultipartResult);
        return;
      }
      const message = (body?.error as { message?: string } | undefined)?.message || (body?.message as string | undefined) || xhr.statusText || "Upload failed.";
      reject(new ApiError(message, xhr.status, (body?.error as { details?: unknown } | undefined)?.details ?? body?.details));
    };
    xhr.onerror = () => {
      window.clearTimeout(timer);
      reject(new ApiError("Network error during upload.", 0));
    };
    xhr.onabort = () => {
      window.clearTimeout(timer);
      reject(new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`, 408));
    };
    xhr.send(formData);
  });
}

export default function PacsRemapPage() {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
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
  const [jobId, setJobId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [errorDetails, setErrorDetails] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [enableFallbackUpload, setEnableFallbackUpload] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [uploadLoaded, setUploadLoaded] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [processingStage, setProcessingStage] = useState<RemapWizardStep>("select_files");
  const [focusStepOverride, setFocusStepOverride] = useState<RemapWizardStep | null>(null);
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const [showReAuthModal, setShowReAuthModal] = useState(false);
  const [retryClearAfterReAuth, setRetryClearAfterReAuth] = useState(false);
  const stepCardRefs = useRef<Partial<Record<RemapWizardStep, HTMLDivElement | null>>>({});

  const selectedStudy = scanResult?.studies.find((study) => study.studyInstanceUid === selectedStudyInstanceUid) || null;

  const destinationsQuery = useQuery({
    queryKey: ["pacs", "remap", "destinations"],
    queryFn: () => api<{ destinations: Destination[] }>("/pacs/remap/destinations"),
  });

  const modalityLookupQuery = useQuery({
    queryKey: ["v2", "lookups", "modalities"],
    queryFn: () => api<{ items: Array<{ id: number; nameEn?: string; nameAr?: string; code?: string }> }>("/v2/lookups/modalities"),
    retry: 0,
  });

  const studyDateForFilter = useMemo(() => {
    if (studyDateMode === "custom") return customStudyDate;
    const now = new Date();
    if (studyDateMode === "yesterday") now.setDate(now.getDate() - 1);
    return toIsoDate(now);
  }, [studyDateMode, customStudyDate]);

  const trimmedPatientSearch = patientSearch.trim();

  const todayStudiesQuery = useQuery({
    queryKey: ["v2", "appointments", "remap-picker", studyDateForFilter, todayModalityFilter, trimmedPatientSearch, patientLookupMode],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("dateFrom", studyDateForFilter);
      params.set("dateTo", studyDateForFilter);
      if (todayModalityFilter) params.set("modalityId", todayModalityFilter);
      if (trimmedPatientSearch) params.set("q", trimmedPatientSearch);
      return api<{ appointments: TodayStudyOption[] }>(`/v2/read/appointments?${params.toString()}`);
    },
    enabled: patientLookupMode === "filtered_appointments",
    retry: 0,
  });

  const allDatesStudiesQuery = useQuery({
    queryKey: ["v2", "appointments", "remap-picker-all-dates", trimmedPatientSearch, todayModalityFilter, patientLookupMode],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("q", trimmedPatientSearch);
      if (todayModalityFilter) params.set("modalityId", todayModalityFilter);
      return api<{ appointments: TodayStudyOption[] }>(`/v2/read/appointments?${params.toString()}`);
    },
    enabled: patientLookupMode === "all_appointments" && trimmedPatientSearch.length >= 2,
    retry: 0,
  });

  const patientQuery = useQuery({
    queryKey: ["patients", "remap-search", trimmedPatientSearch, patientLookupMode],
    queryFn: async () => {
      const primary = await api<Record<string, unknown>>(`/patients?q=${encodeURIComponent(trimmedPatientSearch)}`);
      const primaryPatients = Array.isArray(primary?.patients) ? primary.patients : null;
      if (primaryPatients) return { patients: primaryPatients as PatientOption[] };
      const fallback = await api<Record<string, unknown>>(`/patients/directory?q=${encodeURIComponent(trimmedPatientSearch)}&page=1&pageSize=25`);
      return { patients: (Array.isArray(fallback?.rows) ? fallback.rows : []) as PatientOption[] };
    },
    enabled: patientLookupMode === "all_patients" && trimmedPatientSearch.length >= 2,
    retry: 0,
  });

  const jobsQuery = useQuery({
    queryKey: ["pacs", "remap", "jobs"],
    queryFn: () => api<{ jobs: RemapJob[] }>("/pacs/remap/jobs?limit=20"),
  });

  const replacementPreviewQuery = useQuery({
    queryKey: ["pacs", "remap", "replacement-preview", selectedPatientId],
    queryFn: async () => {
      if (!selectedPatientId) return null;
      const response = await api<{ replacement: ReplacementPreview }>("/pacs/remap/replacement-preview", {
        method: "POST",
        body: JSON.stringify({ risproPatientId: selectedPatientId }),
      });
      return response.replacement;
    },
    enabled: !!selectedPatientId,
    retry: 0,
  });

  const currentJobQuery = useQuery({
    queryKey: ["pacs", "remap", "job", jobId],
    queryFn: () => api<{ job: RemapJob; comparison: RemapComparison | null }>(`/pacs/remap/jobs/${jobId}`),
    enabled: jobId != null,
    refetchInterval: (query) => {
      const status = (query.state.data as { job?: RemapJob } | undefined)?.job?.status;
      return status === "remapped" || status === "sending" ? 1500 : false;
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      return previewDicomStudiesFromFiles(files);
    },
    onMutate: () => {
      setProcessingStage("scanning");
      setFocusStepOverride(null);
      setErrorMessage("");
      setErrorDetails("");
      setSuccessMessage("");
    },
    onSuccess: (result) => {
      setScanResult(result);
      setEnableFallbackUpload(false);
      setSelectedStudyInstanceUid(result.studies.length === 1 ? result.studies[0].studyInstanceUid : "");
      setProcessingStage("choose_study");
      setFocusStepOverride("choose_study");
    },
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to scan DICOM files.");
      setErrorDetails(error instanceof ApiError ? formatTechnicalDetails(error.details) : "");
      setProcessingStage("failed");
    },
  });

  const skipPreview = (): void => {
    const result = buildSkipPreviewScanResult(files);
    if (result.fallbackUploadFiles.length === 0) {
      setErrorMessage(language === "ar" ? "لم يتم العثور على ملفات تشبه DICOM للرفع." : "No DICOM-like files were found for upload.");
      setErrorDetails("");
      return;
    }
    setScanResult(result);
    setEnableFallbackUpload(true);
    setSelectedStudyInstanceUid("");
    setConfirmChecked(false);
    setErrorMessage("");
    setErrorDetails("");
    setSuccessMessage("");
    setProcessingStage("choose_patient");
    setFocusStepOverride("choose_patient");
  };

  const processMutation = useMutation({
    onMutate: () => {
      setErrorMessage("");
      setErrorDetails("");
      setSuccessMessage("");
    },
    mutationFn: async () => {
      if (!selectedPatientId || !selectedDestinationKey) throw new Error("Patient and destination are required.");
      const plan = buildDicomUploadSelectionPlan(scanResult, selectedStudyInstanceUid, enableFallbackUpload);
      const uploadFiles = scanResult?.previewOnly
        ? buildSkipPreviewScanResult(files).fallbackUploadFiles
        : plan.files.length > 0 ? plan.files : files;
      if (uploadFiles.length === 0) throw new Error("No uploadable files were selected.");

      setProcessingStage("uploading");
      setUploadLoaded(0);
      setUploadTotal(uploadFiles.reduce((sum, file) => sum + file.size, 0));

      const formData = new FormData();
      uploadFiles.forEach((file) => formData.append("files", file, file.name));
      const selectedUidForUpload = plan.selectedStudyInstanceUid || selectedStudyInstanceUid;
      if (selectedUidForUpload) formData.append("selectedStudyInstanceUID", selectedUidForUpload);
      if (!selectedUidForUpload) formData.append("uploadMode", "fallback_all_candidates");
      formData.append("risproPatientId", selectedPatientId);
      formData.append("destinationPacsKey", selectedDestinationKey);
      formData.append("confirm", "true");

      const uploadResult = await uploadMultipartWithProgress("/pacs/remap/jobs/process-multipart", formData, 900_000, (loaded, total) => {
        setUploadLoaded(loaded);
        setUploadTotal(total || uploadTotal);
      }, () => {
        setUploadLoaded((current) => Math.max(current, uploadTotal));
        setProcessingStage("orthanc_processing");
      });
      setJobId(uploadResult.job.id);
      return { uploadResult };
    },
    onSuccess: () => {
      setProcessingStage("sent");
      setSuccessMessage(language === "ar" ? "تمت إعادة الربط والإرسال بنجاح." : "Study remapped and sent successfully.");
      setErrorMessage("");
      setErrorDetails("");
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
      void currentJobQuery.refetch();
    },
    onError: (error: unknown) => {
      setProcessingStage("failed");
      setSuccessMessage("");
      setErrorMessage(error instanceof Error ? error.message : "Processing failed.");
      setErrorDetails(error instanceof ApiError ? formatTechnicalDetails(error.details) : "");
      void currentJobQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error("Missing job ID.");
      return api<{ job: RemapJob }>(`/pacs/remap/jobs/${jobId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "Cancelled from DICOM remap page" }),
      });
    },
    onSuccess: () => {
      setProcessingStage("failed");
      setSuccessMessage("");
      setErrorMessage(language === "ar" ? "تم إلغاء المهمة النشطة." : "Active job cancelled.");
      setErrorDetails("");
      void currentJobQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
  });

  const resetJobMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error("Missing job ID.");
      return api<{ summary: { studiesDeleted: number; studiesAlreadyMissing: number } }>(`/pacs/remap/jobs/${jobId}/reset`, { method: "POST" });
    },
    onSuccess: (data) => {
      resetWorkflow();
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
    mutationFn: async (targetJobId?: number) => {
      const resolvedJobId = targetJobId ?? jobId;
      if (!resolvedJobId) throw new Error("Missing job ID.");
      return api<{ job: RemapJob }>(`/pacs/remap/jobs/${resolvedJobId}/resend`, { method: "POST" });
    },
    onMutate: () => {
      setProcessingStage("sending");
      setErrorMessage("");
      setErrorDetails("");
      setSuccessMessage("");
    },
    onSuccess: (data) => {
      setJobId(data.job.id);
      setProcessingStage("sent");
      setSuccessMessage(t(language, "pacs.remap.resendSuccess"));
      void currentJobQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown) => {
      setProcessingStage("failed");
      setSuccessMessage("");
      setErrorMessage(error instanceof Error ? error.message : t(language, "pacs.remap.failedResend"));
      setErrorDetails(error instanceof ApiError ? formatTechnicalDetails(error.details) : "");
      void currentJobQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
  });

  const clearFailedStudiesMutation = useMutation({
    mutationFn: async () => api("/pacs/remap/maintenance/clear-failed-studies", { method: "POST" }),
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

  const currentJob = currentJobQuery.data?.job || null;
  const comparison = currentJobQuery.data?.comparison || null;
  const destinations = destinationsQuery.data?.destinations || [];
  const effectiveOrthancStudyId = currentJob?.modified_orthanc_study_id || currentJob?.source_orthanc_study_id || null;
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
  const selectedDirectoryPatient = directoryPatients.find((patient) => String(patient.id) === selectedPatientId) || null;

  useEffect(() => {
    if (selectedDestinationKey || destinations.length === 0) {
      return;
    }
    const defaultDestination = destinations.find((destination) => destination.isDefault) || null;
    if (defaultDestination) {
      setSelectedDestinationKey(defaultDestination.key);
    } else if (destinations.length === 1) {
      setSelectedDestinationKey(destinations[0]!.key);
    }
  }, [destinations, selectedDestinationKey]);
  const selectedAppointmentPatient = appointmentPatientOptions.find((appointment) => String(appointment.patient_id) === selectedPatientId) || null;
  const selectedPatientLabel =
    selectedAppointmentPatient
      ? (selectedAppointmentPatient.english_full_name || selectedAppointmentPatient.arabic_full_name || formatFallbackPatientLabel(language, selectedAppointmentPatient.patient_id))
      : selectedDirectoryPatient
        ? formatDirectoryPatientName(language, selectedDirectoryPatient)
        : null;
  const canContinueStudy = !!selectedStudy || (scanResult?.studies.length === 0 && enableFallbackUpload);
  const canContinuePatient = !!selectedPatientId;
  const canContinueDestination = !!selectedDestinationKey;
  const canSubmit = canContinueStudy && canContinuePatient && canContinueDestination && confirmChecked && !processMutation.isPending;
  const skipPreviewMode = Boolean(scanResult && scanResult.studies.length === 0 && enableFallbackUpload);
  const reviewFiles = scanResult?.previewOnly || skipPreviewMode
    ? buildSkipPreviewScanResult(files).fallbackUploadFiles
    : selectedStudy?.files || [];
  const uploadPercent = uploadTotal > 0 ? Math.min(100, Math.round((uploadLoaded / uploadTotal) * 100)) : 0;

  const wizardStep: RemapWizardStep = useMemo(() => {
    if (processMutation.isPending) return processingStage;
    if (currentJob?.status === "sent") return "sent";
    if (currentJob?.status === "failed" || currentJob?.status === "cancelled") return "failed";
    if (processingStage === "sent") return "sent";
    if (processingStage === "failed") return "failed";
    if (scanMutation.isPending) return "scanning";
    if (!scanResult) return "select_files";
    if (!canContinueStudy) return "choose_study";
    if (!canContinuePatient) return "choose_patient";
    if (!canContinueDestination) return "choose_destination";
    return "review";
  }, [processMutation.isPending, processingStage, currentJob?.status, scanMutation.isPending, scanResult, canContinueStudy, canContinuePatient, canContinueDestination]);
  const focusedWizardStep = focusStepOverride || wizardStep;

  useEffect(() => {
    if (!focusStepOverride) return;
    if (focusStepOverride === "choose_study" && (selectedPatientId || processingStage !== "choose_study")) {
      setFocusStepOverride(null);
    }
  }, [focusStepOverride, selectedPatientId, processingStage]);

  useEffect(() => {
    const activeElement = stepCardRefs.current[focusedWizardStep];
    if (!activeElement) return;
    const rect = activeElement.getBoundingClientRect();
    const isOutsideViewport = rect.top < 0 || rect.bottom > window.innerHeight;
    if (!isOutsideViewport) return;
    const handle = window.requestAnimationFrame(() => {
      activeElement.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
      activeElement.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [focusedWizardStep]);

  useEffect(() => {
    if (wizardStep !== "sent") return;
    const handle = window.setTimeout(() => {
      resetWorkflow();
    }, 5000);
    return () => window.clearTimeout(handle);
  }, [wizardStep]);

  const visibleErrorMessage =
    wizardStep === "sent"
      ? ""
      : errorMessage || currentJob?.error_message || "";
  const visibleSuccessMessage =
    wizardStep === "failed"
      ? ""
      : successMessage;

  const resetWorkflow = (): void => {
    setFiles([]);
    setScanResult(null);
    setSelectedStudyInstanceUid("");
    setSelectedPatientId("");
    setSelectedDestinationKey("");
    setPatientLookupMode("filtered_appointments");
    setPatientSearch("");
    setEnableFallbackUpload(false);
    setConfirmChecked(false);
    setUploadLoaded(0);
    setUploadTotal(0);
    setJobId(null);
    setErrorMessage("");
    setErrorDetails("");
    setSuccessMessage("");
    setProcessingStage("select_files");
    setFocusStepOverride(null);
    setFileInputVersion((v) => v + 1);
    scanMutation.reset();
    processMutation.reset();
  };

  const stepLabels = [
    t(language, "pacs.remap.step1"),
    t(language, "pacs.remap.step2"),
    t(language, "pacs.remap.step3"),
    t(language, "pacs.remap.step4"),
    t(language, "pacs.remap.step5"),
    t(language, "pacs.remap.processStep"),
    t(language, "pacs.remap.resultStep"),
  ];
  const canonicalWizardOrder: RemapWizardStep[] = ["select_files", "choose_study", "choose_patient", "choose_destination", "review", "uploading", "sent"];
  const currentStepIndex = Math.max(0, canonicalWizardOrder.findIndex((step) => (
    step === focusedWizardStep ||
    (step === "uploading" && ["scanning", "orthanc_processing", "remapping", "sending"].includes(focusedWizardStep)) ||
    (step === "sent" && focusedWizardStep === "failed")
  )));

  const activeCardClassName = "border-teal-500 ring-2 ring-teal-100 shadow-md shadow-teal-900/5";
  const inactiveCardClassName = "border-slate-200/70";
  const stepCardProps = (step: RemapWizardStep, active: boolean) => ({
    ref: (node: HTMLDivElement | null) => {
      stepCardRefs.current[step] = node;
    },
    tabIndex: -1,
    "data-active-step": active ? "true" : "false",
    className: `card-shell p-5 space-y-4 border transition-all duration-200 ${active ? activeCardClassName : inactiveCardClassName}`,
  } as const);

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
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200/70 bg-white/80 p-3 text-xs md:grid-cols-7">
          {stepLabels.map((label, index) => (
            <div key={label} className={`rounded-xl border px-3 py-2 text-center font-medium transition-colors ${stepTone(index, currentStepIndex)}`}>
              <span className="mx-auto mb-1 flex h-5 w-5 items-center justify-center rounded-full bg-current/10 text-[10px]">
                {index + 1}
              </span>
              {label}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <div {...stepCardProps("select_files", focusedWizardStep === "select_files" || focusedWizardStep === "scanning")}>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>{t(language, "pacs.remap.step1")}</h3>
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
                {language === "ar" ? "معاينة سريعة أولا" : "Fast preview first"}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4">
                <label htmlFor="remap-file-input" className="text-xs block mb-1">{t(language, "pacs.remap.selectDicomFiles")}</label>
                <input
                  id="remap-file-input"
                  key={`files-${fileInputVersion}`}
                  type="file"
                  multiple
                  onChange={(event) => {
                    setFiles(Array.from(event.target.files || []));
                    setScanResult(null);
                    setSelectedStudyInstanceUid("");
                    setEnableFallbackUpload(false);
                    setConfirmChecked(false);
                    setProcessingStage("select_files");
                  }}
                  className="input-premium w-full px-3 py-2"
                />
              </div>
              <div className="rounded-2xl border border-dashed border-teal-300 bg-teal-50/50 p-4">
                <label htmlFor="remap-folder-input" className="text-xs block mb-1">{t(language, "pacs.remap.selectFolder")}</label>
                <input
                  id="remap-folder-input"
                  key={`folder-${fileInputVersion}`}
                  type="file"
                  multiple
                  onChange={(event) => {
                    setFiles(Array.from(event.target.files || []));
                    setScanResult(null);
                    setSelectedStudyInstanceUid("");
                    setEnableFallbackUpload(false);
                    setConfirmChecked(false);
                    setProcessingStage("select_files");
                  }}
                  className="input-premium w-full px-3 py-2"
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
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => scanMutation.mutate()}
                disabled={files.length === 0 || scanMutation.isPending || processMutation.isPending}
                className="btn-primary px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {scanMutation.isPending ? t(language, "pacs.remap.scanningFiles") : t(language, "pacs.remap.scanSelected")}
              </button>
              <button
                type="button"
                onClick={skipPreview}
                disabled={files.length === 0 || scanMutation.isPending || processMutation.isPending}
                className="btn-secondary px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {t(language, "pacs.remap.skipPreview")}
              </button>
              <button type="button" onClick={resetWorkflow} className="btn-secondary px-4 py-2 rounded-lg">
                {t(language, "pacs.remap.resetWorkflow")}
              </button>
            </div>
          </div>

          {scanResult && (
            <div {...stepCardProps("choose_study", focusedWizardStep === "choose_study")}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-base font-semibold">{t(language, "pacs.remap.step2")}</h3>
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
              {scanResult.studies.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-amber-700">
                    {skipPreviewMode ? t(language, "pacs.remap.previewSkippedNotice") : t(language, "pacs.remap.unreliableStudyDetection")}
                  </p>
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" checked={enableFallbackUpload} onChange={(e) => setEnableFallbackUpload(e.target.checked)} />
                    <span>{t(language, "pacs.remap.fallbackUploadAll")}</span>
                  </label>
                </div>
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
                            <p className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>{study.studyInstanceUid}</p>
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

          {scanResult && (
            <div {...stepCardProps("choose_patient", focusedWizardStep === "choose_patient")}>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-base font-semibold">{t(language, "pacs.remap.step3")}</h3>
                {selectedPatientLabel && (
                  <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
                    {language === "ar" ? "مريض RISPro محدد" : "RISPro patient selected"}
                  </span>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
                <p className="text-xs font-semibold">{t(language, "pacs.remap.patientsByDateModality")}</p>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <select
                    value={patientLookupMode}
                    onChange={(e) => setPatientLookupMode(e.target.value as PatientLookupMode)}
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
                    disabled={patientLookupMode !== "filtered_appointments"}
                  >
                    <option value="today">{t(language, "pacs.remap.today")}</option>
                    <option value="yesterday">{t(language, "pacs.remap.yesterday")}</option>
                    <option value="custom">{t(language, "pacs.remap.chooseDate")}</option>
                  </select>
                  <input
                    type="date"
                    value={customStudyDate}
                    onChange={(e) => setCustomStudyDate(e.target.value)}
                    disabled={patientLookupMode !== "filtered_appointments" || studyDateMode !== "custom"}
                    className="input-premium w-full px-3 py-2 disabled:opacity-50"
                  />
                  <select
                    value={todayModalityFilter}
                    onChange={(e) => setTodayModalityFilter(e.target.value)}
                    className="input-premium w-full px-3 py-2"
                    disabled={patientLookupMode === "all_patients"}
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
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    placeholder={
                      patientLookupMode === "all_patients"
                        ? t(language, "pacs.remap.searchAnyPatientPlaceholder")
                        : patientLookupMode === "all_appointments"
                          ? t(language, "pacs.remap.searchAllDatesPlaceholder")
                          : t(language, "pacs.remap.optionalPatientSearch")
                    }
                    className="input-premium w-full px-3 py-2"
                  />
                </div>
                {patientLookupMode === "filtered_appointments" && todayStudiesQuery.isLoading && <p className="text-xs">{t(language, "pacs.remap.loadingStudyLinkedPatients")}</p>}
                {patientLookupMode === "filtered_appointments" && todayStudiesQuery.error && <p className="text-xs text-red-600">{t(language, "pacs.remap.failedStudyLinkedPatients")}</p>}
                {patientLookupMode === "filtered_appointments" && !todayStudiesQuery.isLoading && (todayStudiesQuery.data?.appointments?.length || 0) > 0 && (
                  <div className="max-h-56 overflow-y-auto space-y-2">
                    {(todayStudiesQuery.data?.appointments || []).slice(0, 60).map((appointment) => {
                      const displayName = appointment.english_full_name || appointment.arabic_full_name || formatFallbackPatientLabel(language, appointment.patient_id);
                      const modalityName = appointment.modality_name_en || appointment.modality_name_ar || formatFallbackModalityLabel(language, appointment.modality_id);
                      const examName = appointment.exam_name_en || appointment.exam_name_ar || "";
                      const isSelected = Number(selectedPatientId || 0) === Number(appointment.patient_id);
                      return (
                        <button
                          key={appointment.id}
                          type="button"
                          onClick={() => setSelectedPatientId(String(appointment.patient_id))}
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
                {patientLookupMode === "filtered_appointments" && !todayStudiesQuery.isLoading && (todayStudiesQuery.data?.appointments?.length || 0) === 0 && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t(language, "pacs.remap.noAppointmentsForFilter")}</p>
                )}
                {patientLookupMode === "all_appointments" && <p className="text-xs font-semibold">{t(language, "pacs.remap.searchAllDatesAppointments")}</p>}
                {patientLookupMode === "all_appointments" && allDatesStudiesQuery.isLoading && <p className="text-xs">{t(language, "pacs.remap.loadingAllDatesAppointments")}</p>}
                {patientLookupMode === "all_appointments" && allDatesStudiesQuery.error && <p className="text-xs text-red-600">{t(language, "pacs.remap.failedAllDatesAppointments")}</p>}
                {patientLookupMode === "all_appointments" && !allDatesStudiesQuery.isLoading && trimmedPatientSearch.length >= 2 && (allDatesStudiesQuery.data?.appointments?.length || 0) > 0 && (
                  <div className="max-h-56 overflow-y-auto space-y-2">
                    {(allDatesStudiesQuery.data?.appointments || []).slice(0, 60).map((appointment) => {
                      const displayName = appointment.english_full_name || appointment.arabic_full_name || formatFallbackPatientLabel(language, appointment.patient_id);
                      const modalityName = appointment.modality_name_en || appointment.modality_name_ar || formatFallbackModalityLabel(language, appointment.modality_id);
                      const examName = appointment.exam_name_en || appointment.exam_name_ar || "";
                      const isSelected = Number(selectedPatientId || 0) === Number(appointment.patient_id);
                      return (
                        <button
                          key={`all-dates-${appointment.id}`}
                          type="button"
                          onClick={() => setSelectedPatientId(String(appointment.patient_id))}
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
                {patientLookupMode === "all_appointments" && !allDatesStudiesQuery.isLoading && trimmedPatientSearch.length >= 2 && (allDatesStudiesQuery.data?.appointments?.length || 0) === 0 && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t(language, "pacs.remap.noAppointmentsForSearch")}</p>
                )}
                {patientLookupMode === "all_patients" && <p className="text-xs font-semibold">{t(language, "pacs.remap.searchAnyPatient")}</p>}
                {patientLookupMode === "all_patients" && patientQuery.isLoading && <p className="text-xs">{t(language, "pacs.remap.loadingAnyPatient")}</p>}
                {patientLookupMode === "all_patients" && patientQuery.error && <p className="text-xs text-red-600">{t(language, "pacs.remap.failedAnyPatient")}</p>}
                {patientLookupMode === "all_patients" && !patientQuery.isLoading && trimmedPatientSearch.length >= 2 && directoryPatients.length > 0 && (
                  <div className="max-h-56 overflow-y-auto space-y-2">
                    {directoryPatients.slice(0, 25).map((patient) => {
                      const isSelected = Number(selectedPatientId || 0) === Number(patient.id);
                      return (
                        <button
                          key={`directory-${patient.id}`}
                          type="button"
                          onClick={() => setSelectedPatientId(String(patient.id))}
                          className={`w-full text-left rounded-xl border p-3 text-xs transition-all ${isSelected ? "border-teal-500 bg-teal-50 shadow-sm" : "border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/40"}`}
                        >
                          <p><strong>{formatDirectoryPatientName(language, patient)}</strong></p>
                          <p>{patient.national_id || patient.mrn || "—"}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
                {patientLookupMode === "all_patients" && !patientQuery.isLoading && trimmedPatientSearch.length >= 2 && directoryPatients.length === 0 && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t(language, "pacs.remap.noAnyPatientMatches")}</p>
                )}
              </div>
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
            </div>
          )}

          {scanResult && (
            <div {...stepCardProps("choose_destination", focusedWizardStep === "choose_destination")}>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-base font-semibold">{t(language, "pacs.remap.step4")}</h3>
                {selectedDestinationKey && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                    {selectedDestinationKey}
                  </span>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3">
                <select value={selectedDestinationKey} onChange={(e) => setSelectedDestinationKey(e.target.value)} className="input-premium w-full px-3 py-2">
                  <option value="">{t(language, "pacs.remap.selectDestination")}</option>
                  {destinations.map((destination) => (
                    <option key={destination.key} value={destination.key}>
                      {destination.name} ({destination.key}){destination.isDefault ? ` • ${t(language, "pacs.remap.defaultDestinationBadge")}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {scanResult && (
            <div {...stepCardProps("review", focusedWizardStep === "review")}>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-base font-semibold">{t(language, "pacs.remap.step5")}</h3>
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
                      <td className="px-3 py-2 font-mono">{skipPreviewMode ? t(language, "pacs.remap.previewSkipped") : selectedStudy?.patientName || "—"}</td>
                      <td className="px-3 py-2 font-mono">{replacementPreviewQuery.data?.patientName || selectedPatientLabel || "—"}</td>
                    </tr>
                    <tr className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium">PatientID</th>
                      <td className="px-3 py-2 font-mono">{skipPreviewMode ? t(language, "pacs.remap.previewSkipped") : selectedStudy?.patientId || "—"}</td>
                      <td className="px-3 py-2 font-mono">{replacementPreviewQuery.data?.patientId || "—"}</td>
                    </tr>
                    <tr className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium">{language === "ar" ? "الجنس" : "Sex"}</th>
                      <td className="px-3 py-2 font-mono">—</td>
                      <td className="px-3 py-2 font-mono">{replacementPreviewQuery.data?.patientSex || "—"}</td>
                    </tr>
                    <tr className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium">{language === "ar" ? "تاريخ الميلاد" : "Birth date"}</th>
                      <td className="px-3 py-2 font-mono">—</td>
                      <td className="px-3 py-2 font-mono">{replacementPreviewQuery.data?.patientBirthDate || "—"}</td>
                    </tr>
                    <tr className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium">{t(language, "pacs.remap.studyLabel")}</th>
                      <td className="px-3 py-2">{skipPreviewMode ? t(language, "pacs.remap.previewSkipped") : `${selectedStudy?.studyDescription || "—"} • ${selectedStudy?.studyDate || "—"} • ${selectedStudy?.modality || "—"}`}</td>
                      <td className="px-3 py-2">{skipPreviewMode ? t(language, "pacs.remap.backendValidatedOneStudy") : (language === "ar" ? "نفس الدراسة المختارة" : "Selected study only")}</td>
                    </tr>
                    <tr className="border-t">
                      <th scope="row" className="px-3 py-2 text-left font-medium">{t(language, "pacs.remap.destinationLabel")}</th>
                      <td className="px-3 py-2">—</td>
                      <td className="px-3 py-2 font-mono">{selectedDestinationKey || "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-amber-700">
                {skipPreviewMode ? t(language, "pacs.remap.skipPreviewUploadWarning") : t(language, "pacs.remap.selectedStudyOnly")}
              </p>
              <div className="rounded-2xl border border-slate-200 bg-white text-xs">
                <div className="flex flex-col gap-1 border-b border-slate-200 bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="font-semibold">{language === "ar" ? "محتويات الدراسة من القرص" : "CD study contents"}</h4>
                    <p className="text-slate-500">
                      {skipPreviewMode
                        ? t(language, "pacs.remap.skipPreviewFilesNote")
                        : language === "ar"
                        ? "هذه هي ملفات الدراسة التي سيتم رفعها بعد التأكيد."
                        : "These are the selected study files that will be uploaded after confirmation."}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                    {reviewFiles.length} {language === "ar" ? "ملفات" : "files"}
                  </span>
                </div>
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
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 space-y-3">
                <label className="flex items-start gap-2 text-xs font-medium text-amber-950">
                  <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} className="mt-0.5" />
                  <span>{t(language, "pacs.remap.confirmIdentity")}</span>
                </label>
                <button
                  type="button"
                  onClick={() => processMutation.mutate()}
                  disabled={!canSubmit}
                  className="btn-primary px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  {t(language, "pacs.remap.uploadSelectedStudy")}
                </button>
              </div>
            </div>
          )}

          {(wizardStep === "uploading" || wizardStep === "orthanc_processing" || wizardStep === "sending") && (
            <div {...stepCardProps(wizardStep === "sending" ? "sending" : "uploading", wizardStep === "uploading" || wizardStep === "orthanc_processing" || wizardStep === "sending")}>
              <h3 className="text-base font-semibold">{t(language, "pacs.remap.processStep")}</h3>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {[
                  { key: "uploading", label: language === "ar" ? "رفع" : "Upload" },
                  { key: "orthanc_processing", label: language === "ar" ? "معالجة" : "Rewrite" },
                  { key: "sending", label: language === "ar" ? "إرسال" : "Send" },
                ].map((stage) => {
                  const activeStages = ["uploading", "orthanc_processing", "sending"];
                  const currentIndex = activeStages.indexOf(wizardStep);
                  const stageIndex = activeStages.indexOf(stage.key);
                  return (
                    <div key={stage.key} className={`rounded-xl border px-3 py-2 text-center font-medium ${stageIndex <= currentIndex ? "border-teal-500 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-500"}`}>
                      {stage.label}
                    </div>
                  );
                })}
              </div>
              <div className="h-2 w-full rounded bg-black/10 overflow-hidden">
                <div className="h-full bg-teal-600 transition-all duration-200" style={{ width: `${wizardStep === "uploading" ? uploadPercent : wizardStep === "orthanc_processing" ? 75 : 90}%` }} />
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {wizardStep === "uploading" && t(language, "pacs.remap.uploadingSelectedStudy", { percent: uploadPercent })}
                {wizardStep === "orthanc_processing" && t(language, "pacs.remap.waitingOrthanc")}
                {wizardStep === "sending" && t(language, "pacs.remap.sendingToPacs")}
              </p>
            </div>
          )}

          {(wizardStep === "sent" || wizardStep === "failed") && (
            <div {...stepCardProps(wizardStep, focusedWizardStep === "sent" || focusedWizardStep === "failed")}>
              <h3 className="text-sm font-semibold">{t(language, "pacs.remap.resultStep")}</h3>
              {wizardStep === "sent" ? (
                <p className="text-sm text-green-700">{t(language, "pacs.remap.success")}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-red-700">{visibleErrorMessage || t(language, "pacs.remap.failure")}</p>
                  {errorDetails && (
                    <details className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      <summary className="cursor-pointer font-medium">Technical details</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words">{errorDetails}</pre>
                    </details>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={resetWorkflow} className="btn-secondary px-3 py-2 rounded-lg text-sm">{t(language, "pacs.remap.startNewUpload")}</button>
                {jobId && (
                  <>
                    {canResendJob(currentJob) && (
                      <button
                        type="button"
                        onClick={() => resendJobMutation.mutate(jobId)}
                        disabled={resendJobMutation.isPending}
                        className="btn-secondary px-3 py-2 rounded-lg text-sm disabled:opacity-50"
                      >
                        {t(language, "pacs.remap.resendToPacs")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => resetJobMutation.mutate()}
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
          <div className="card-shell sticky top-4 p-4 space-y-3 text-xs">
            <div>
              <h4 className="font-semibold text-sm">{t(language, "pacs.remap.summary")}</h4>
              <p style={{ color: "var(--text-muted)" }}>{t(language, "pacs.remap.currentStep")}: {wizardStepLabel(language, wizardStep)}</p>
            </div>
            <div className="space-y-2">
              {[
                { label: t(language, "pacs.remap.selectedStudy"), value: skipPreviewMode ? t(language, "pacs.remap.previewSkipped") : selectedStudy?.studyDescription || selectedStudy?.studyInstanceUid || t(language, "pacs.remap.noCurrentJob"), ready: !!selectedStudy || skipPreviewMode },
                { label: t(language, "pacs.remap.originalDICOMPatient"), value: skipPreviewMode ? t(language, "pacs.remap.previewSkipped") : `${selectedStudy?.patientName || "—"} (${selectedStudy?.patientId || "—"})`, ready: !!selectedStudy?.patientName || !!selectedStudy?.patientId || skipPreviewMode },
                { label: t(language, "pacs.remap.selectedRISProPatient"), value: selectedPatientLabel || t(language, "pacs.remap.noCurrentJob"), ready: !!selectedPatientLabel },
                { label: t(language, "pacs.remap.destinationLabel"), value: selectedDestinationKey || t(language, "pacs.remap.noCurrentJob"), ready: !!selectedDestinationKey },
                { label: t(language, "pacs.remap.currentJobStatus"), value: currentJob?.status ? statusLabel(language, currentJob.status) : t(language, "pacs.remap.noCurrentJob"), ready: !!currentJob?.status },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-200 bg-white/80 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-slate-500">{item.label}</span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${item.ready ? "bg-teal-500" : "bg-slate-300"}`} />
                  </div>
                  <p className="mt-1 font-semibold" style={{ color: "var(--text)" }}>{item.value}</p>
                </div>
              ))}
            </div>
            {comparison && (
              <div className="rounded border p-2">
                <p><strong>{t(language, "pacs.remap.replacementPatientId")}:</strong> {comparison.replacement.patientId || "—"}</p>
                <p><strong>{t(language, "pacs.remap.replacementPatientName")}:</strong> {comparison.replacement.patientName || "—"}</p>
              </div>
            )}
          </div>

          {currentJob && (
            <div className="card-shell p-4 space-y-2 text-xs">
              <h4 className="font-semibold text-sm">{t(language, "pacs.remap.currentUpload")}</h4>
              <p>{t(language, "pacs.remap.job")} #{currentJob.id}</p>
              <p><strong>{t(language, "pacs.remap.originalDICOMPatient")}:</strong> {currentJob.original_patient_name || "—"} ({currentJob.original_patient_id || "—"})</p>
              <p><strong>{t(language, "pacs.remap.replacementPatient")}:</strong> {currentJob.replacement_patient_name || "—"} ({currentJob.replacement_patient_id || "—"})</p>
              <p><strong>{t(language, "pacs.remap.destinationLabel")}:</strong> {currentJob.destination_pacs_key || "—"}</p>
              <p>{t(language, "pacs.remap.orthancStudy")}: <span className="font-mono text-[11px]">{effectiveOrthancStudyId || "—"}</span></p>
              {currentJob.source_orthanc_study_id && currentJob.modified_orthanc_study_id && currentJob.source_orthanc_study_id !== currentJob.modified_orthanc_study_id && (
                <>
                  <p>{t(language, "pacs.remap.sourceStudy")}: <span className="font-mono text-[11px]">{currentJob.source_orthanc_study_id}</span></p>
                  <p>{t(language, "pacs.remap.modifiedStudy")}: <span className="font-mono text-[11px]">{currentJob.modified_orthanc_study_id}</span></p>
                </>
              )}
              {isSendFailedJob(currentJob) && (
                <p className="text-red-700">{t(language, "pacs.remap.sendFailedBadge")} • {oneLineReason(currentJob.error_message) || t(language, "pacs.remap.failedResend")}</p>
              )}
              {isCancellableJobStatus(currentJob.status) && (
                <button type="button" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="btn-secondary px-3 py-2 rounded-lg text-xs">
                  {t(language, "pacs.remap.cancelActiveJob")}
                </button>
              )}
              {canResendJob(currentJob) && (
                <button
                  type="button"
                  onClick={() => resendJobMutation.mutate(currentJob.id)}
                  disabled={resendJobMutation.isPending}
                  className="btn-secondary px-3 py-2 rounded-lg text-xs disabled:opacity-50"
                >
                  {t(language, "pacs.remap.resendToPacs")}
                </button>
              )}
            </div>
          )}

          <div className="card-shell p-4 space-y-2 text-xs">
            <h4 className="font-semibold text-sm">{t(language, "pacs.remap.maintenance")}</h4>
            <button
              type="button"
              onClick={() => clearFailedStudiesMutation.mutate()}
              disabled={clearFailedStudiesMutation.isPending}
              className="btn-secondary px-3 py-2 rounded-lg text-xs"
            >
              {t(language, "pacs.remap.clearFailedStudies")}
            </button>
          </div>

          <div className="card-shell p-4 space-y-2 text-xs">
            <h4 className="font-semibold text-sm">{t(language, "pacs.remap.viewRecentJobs")}</h4>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {(jobsQuery.data?.jobs || []).map((job) => (
                <div key={job.id} className="rounded border p-2 space-y-2">
                  <button
                    type="button"
                    onClick={() => setJobId(job.id)}
                    className="w-full text-left hover:bg-black/5"
                  >
                    <p className="font-mono">#{job.id} • {statusLabel(language, job.status)}</p>
                    <p className="truncate"><strong>{job.original_patient_name || "—"}</strong></p>
                    <p className="truncate">{job.replacement_patient_name || "—"} • {job.destination_pacs_key || "—"}</p>
                    {isSendFailedJob(job) && (
                      <p className="text-[11px] text-red-700 truncate">{t(language, "pacs.remap.sendFailedBadge")} • {oneLineReason(job.error_message) || t(language, "pacs.remap.failedResend")}</p>
                    )}
                  </button>
                  {canResendJob(job) && (
                    <button
                      type="button"
                      onClick={() => resendJobMutation.mutate(job.id)}
                      disabled={resendJobMutation.isPending}
                      className="btn-secondary px-2 py-1 rounded-lg text-xs disabled:opacity-50"
                    >
                      {t(language, "pacs.remap.resendToPacs")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {visibleErrorMessage && wizardStep !== "failed" && wizardStep !== "sent" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {visibleErrorMessage}
        </div>
      )}
      {visibleSuccessMessage && wizardStep !== "failed" && wizardStep !== "sent" && (
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
