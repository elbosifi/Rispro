import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";
import { statusLabel, t } from "@/lib/i18n";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { useLanguage } from "@/providers/language-provider";
import { buildDicomUploadSelectionPlan, scanDicomStudiesFromFiles, type DicomStudyScanResult } from "@/lib/dicom-study-scan";

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
}

interface ReplacementPreview {
  patientId: string;
  patientName: string;
  patientSex: string;
  patientBirthDate: string;
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

function formatBytes(bytes: number): string {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatName(language: string, patient: PatientOption): string {
  return patient.english_full_name || patient.arabic_full_name || formatFallbackPatientLabel(language, patient.id);
}

function formatFallbackPatientLabel(language: string, id: number): string {
  return language === "ar" ? `مريض #${id}` : `Patient #${id}`;
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

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function uploadMultipartWithProgress(
  formData: FormData,
  timeoutMs: number,
  onProgress: (loaded: number, total: number) => void
): Promise<UploadMultipartResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const timer = window.setTimeout(() => xhr.abort(), timeoutMs);
    xhr.open("POST", "/api/pacs/remap/jobs/upload-multipart", true);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
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
  const [patientSearch, setPatientSearch] = useState("");
  const [todayPatientSearch, setTodayPatientSearch] = useState("");
  const [todayModalityFilter, setTodayModalityFilter] = useState("");
  const [studyDateMode, setStudyDateMode] = useState<"today" | "yesterday" | "custom">("today");
  const [customStudyDate, setCustomStudyDate] = useState(toIsoDate(new Date()));
  const [jobId, setJobId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [enableFallbackUpload, setEnableFallbackUpload] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [uploadLoaded, setUploadLoaded] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [processingStage, setProcessingStage] = useState<RemapWizardStep>("select_files");
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const [showReAuthModal, setShowReAuthModal] = useState(false);
  const [retryClearAfterReAuth, setRetryClearAfterReAuth] = useState(false);

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

  const todayStudiesQuery = useQuery({
    queryKey: ["v2", "appointments", "remap-picker", studyDateForFilter, todayModalityFilter, todayPatientSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("dateFrom", studyDateForFilter);
      params.set("dateTo", studyDateForFilter);
      if (todayModalityFilter) params.set("modalityId", todayModalityFilter);
      if (todayPatientSearch.trim()) params.set("q", todayPatientSearch.trim());
      return api<{ appointments: TodayStudyOption[] }>(`/v2/read/appointments?${params.toString()}`);
    },
    retry: 0,
  });

  const patientQuery = useQuery({
    queryKey: ["patients", "remap-search", patientSearch],
    queryFn: async () => {
      const search = patientSearch.trim();
      const primary = await api<Record<string, unknown>>(`/patients?q=${encodeURIComponent(search)}`);
      const primaryPatients = Array.isArray(primary?.patients) ? primary.patients : null;
      if (primaryPatients) return { patients: primaryPatients as PatientOption[] };
      const fallback = await api<Record<string, unknown>>(`/patients/directory?q=${encodeURIComponent(search)}&page=1&pageSize=25`);
      return { patients: (Array.isArray(fallback?.rows) ? fallback.rows : []) as PatientOption[] };
    },
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
    mutationFn: async () => scanDicomStudiesFromFiles(files, { batchSize: 20 }),
    onMutate: () => {
      setProcessingStage("scanning");
      setErrorMessage("");
      setSuccessMessage("");
    },
    onSuccess: (result) => {
      setScanResult(result);
      setEnableFallbackUpload(false);
      setSelectedStudyInstanceUid(result.studies.length === 1 ? result.studies[0].studyInstanceUid : "");
      setProcessingStage("choose_study");
    },
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to scan DICOM files.");
      setProcessingStage("failed");
    },
  });

  const processMutation = useMutation({
    onMutate: () => {
      setErrorMessage("");
      setSuccessMessage("");
    },
    mutationFn: async () => {
      if (!selectedPatientId || !selectedDestinationKey) throw new Error("Patient and destination are required.");
      const plan = buildDicomUploadSelectionPlan(scanResult, selectedStudyInstanceUid, enableFallbackUpload);
      const uploadFiles = plan.files.length > 0 ? plan.files : files;
      if (uploadFiles.length === 0) throw new Error("No uploadable files were selected.");

      setProcessingStage("uploading");
      setUploadLoaded(0);
      setUploadTotal(uploadFiles.reduce((sum, file) => sum + file.size, 0));

      const formData = new FormData();
      uploadFiles.forEach((file) => formData.append("files", file, file.name));
      if (selectedStudy?.studyInstanceUid) formData.append("selectedStudyInstanceUID", selectedStudy.studyInstanceUid);
      if (!selectedStudy) formData.append("uploadMode", "fallback_all_candidates");

      const uploadResult = await uploadMultipartWithProgress(formData, 600_000, (loaded, total) => {
        setUploadLoaded(loaded);
        setUploadTotal(total || uploadTotal);
      });
      setJobId(uploadResult.job.id);

      setProcessingStage("orthanc_processing");
      const prepared = await api<{ job: RemapJob; comparison: RemapComparison }>(
        `/pacs/remap/jobs/${uploadResult.job.id}/prepare`,
        {
          method: "POST",
          body: JSON.stringify({ risproPatientId: selectedPatientId, destinationPacsKey: selectedDestinationKey }),
        },
        120_000
      );

      setProcessingStage("sending");
      const sent = await api<{ job: RemapJob }>(
        `/pacs/remap/jobs/${uploadResult.job.id}/confirm-send`,
        { method: "POST", body: JSON.stringify({ confirm: true }) },
        180_000
      );
      return { uploadResult, prepared, sent };
    },
    onSuccess: () => {
      setProcessingStage("sent");
      setSuccessMessage(language === "ar" ? "تمت إعادة الربط والإرسال بنجاح." : "Study remapped and sent successfully.");
      setErrorMessage("");
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
      void currentJobQuery.refetch();
    },
    onError: (error: unknown) => {
      setProcessingStage("failed");
      setErrorMessage(error instanceof Error ? error.message : "Processing failed.");
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
      setErrorMessage(language === "ar" ? "تم إلغاء المهمة النشطة." : "Active job cancelled.");
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
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown) => setErrorMessage(error instanceof Error ? error.message : "Reset failed."),
  });

  const clearFailedStudiesMutation = useMutation({
    mutationFn: async () => api("/pacs/remap/maintenance/clear-failed-studies", { method: "POST" }),
    onSuccess: () => {
      setSuccessMessage(language === "ar" ? "اكتملت صيانة الدراسات الفاشلة." : "Failed-study maintenance completed.");
      setErrorMessage("");
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to clear failed remap studies.";
      if (message.includes("re-authentication") || message.includes("403")) {
        setRetryClearAfterReAuth(true);
        setShowReAuthModal(true);
      }
      setErrorMessage(message);
    },
  });

  const currentJob = currentJobQuery.data?.job || null;
  const comparison = currentJobQuery.data?.comparison || null;
  const patients = patientQuery.data?.patients || [];
  const destinations = destinationsQuery.data?.destinations || [];
  const selectedPatient = patients.find((patient) => String(patient.id) === selectedPatientId) || null;
  const canContinueStudy = !!selectedStudy || (scanResult?.studies.length === 0 && enableFallbackUpload);
  const canContinuePatient = !!selectedPatientId;
  const canContinueDestination = !!selectedDestinationKey;
  const canSubmit = canContinueStudy && canContinuePatient && canContinueDestination && confirmChecked && !processMutation.isPending;
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

  const visibleErrorMessage =
    wizardStep === "sent"
      ? ""
      : errorMessage || currentJob?.error_message || "";

  const resetWorkflow = (): void => {
    setFiles([]);
    setScanResult(null);
    setSelectedStudyInstanceUid("");
    setSelectedPatientId("");
    setSelectedDestinationKey("");
    setPatientSearch("");
    setEnableFallbackUpload(false);
    setConfirmChecked(false);
    setUploadLoaded(0);
    setUploadTotal(0);
    setJobId(null);
    setErrorMessage("");
    setSuccessMessage("");
    setProcessingStage("select_files");
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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="card-shell p-5 space-y-2">
        <h2 className="text-2xl font-bold" style={{ color: "var(--text)" }}>{t(language, "pacs.remap.title")}</h2>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t(language, "pacs.remap.subtitle")}</p>
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t(language, "pacs.remap.safetyBanner")}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-xs">
          {stepLabels.map((label) => (
            <div key={label} className="rounded border px-2 py-1 text-center" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              {label}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          <div className="card-shell p-5 space-y-4">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t(language, "pacs.remap.step1")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
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
              <div>
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
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t(language, "pacs.remap.selectedFiles")}: {files.length} • {t(language, "pacs.remap.estimatedSize")}: {formatBytes(files.reduce((sum, file) => sum + file.size, 0))}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => scanMutation.mutate()}
                disabled={files.length === 0 || scanMutation.isPending || processMutation.isPending}
                className="btn-primary px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {scanMutation.isPending ? t(language, "pacs.remap.scanningFiles") : t(language, "pacs.remap.scanSelected")}
              </button>
              <button type="button" onClick={resetWorkflow} className="btn-secondary px-4 py-2 rounded-lg">
                {t(language, "pacs.remap.resetWorkflow")}
              </button>
            </div>
          </div>

          {scanResult && (
            <div className="card-shell p-5 space-y-4">
              <h3 className="text-sm font-semibold">{t(language, "pacs.remap.step2")}</h3>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t(language, "pacs.remap.detectedStudiesSummary", {
                  count: scanResult.studies.length,
                  skipped: scanResult.skippedSidecarCount,
                  unparsed: scanResult.unparsedCount,
                })}
              </p>
              {scanResult.studies.length > 1 && (
                <p className="text-xs text-amber-700">{t(language, "pacs.remap.multipleStudiesWarning")}</p>
              )}
              {scanResult.studies.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-amber-700">{t(language, "pacs.remap.unreliableStudyDetection")}</p>
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" checked={enableFallbackUpload} onChange={(e) => setEnableFallbackUpload(e.target.checked)} />
                    <span>{t(language, "pacs.remap.fallbackUploadAll")}</span>
                  </label>
                </div>
              )}
              <div className="space-y-2">
                {scanResult.studies.map((study) => (
                  <label key={study.studyInstanceUid} className="block rounded border p-3 text-xs">
                    <div className="flex items-start gap-2">
                      <input
                        type="radio"
                        name="study"
                        value={study.studyInstanceUid}
                        checked={selectedStudyInstanceUid === study.studyInstanceUid}
                        onChange={(e) => setSelectedStudyInstanceUid(e.target.value)}
                      />
                      <div className="space-y-1">
                        <p><strong>{t(language, "pacs.remap.studyDescription")}:</strong> {study.studyDescription || "—"} | <strong>{t(language, "pacs.remap.studyDate")}:</strong> {study.studyDate || "—"} | <strong>{t(language, "pacs.remap.studyModality")}:</strong> {study.modality || "—"}</p>
                        <p><strong>{t(language, "pacs.remap.studyPatientId")}:</strong> {study.patientId || "—"} | <strong>{t(language, "pacs.remap.studyPatientName")}:</strong> {study.patientName || "—"}</p>
                        <p><strong>{t(language, "pacs.remap.studySeries")}:</strong> {study.seriesCount} | <strong>{t(language, "pacs.remap.studyFiles")}:</strong> {study.fileCount} | <strong>{t(language, "pacs.remap.studySize")}:</strong> {formatBytes(study.totalBytes)}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {scanResult && (
            <div className="card-shell p-5 space-y-4">
              <h3 className="text-sm font-semibold">{t(language, "pacs.remap.step3")}</h3>
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-xs font-semibold">{t(language, "pacs.remap.patientsByDateModality")}</p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <select
                    value={studyDateMode}
                    onChange={(e) => setStudyDateMode(e.target.value as "today" | "yesterday" | "custom")}
                    className="input-premium w-full px-3 py-2"
                  >
                    <option value="today">{t(language, "pacs.remap.today")}</option>
                    <option value="yesterday">{t(language, "pacs.remap.yesterday")}</option>
                    <option value="custom">{t(language, "pacs.remap.chooseDate")}</option>
                  </select>
                  <input
                    type="date"
                    value={customStudyDate}
                    onChange={(e) => setCustomStudyDate(e.target.value)}
                    disabled={studyDateMode !== "custom"}
                    className="input-premium w-full px-3 py-2 disabled:opacity-50"
                  />
                  <select
                    value={todayModalityFilter}
                    onChange={(e) => setTodayModalityFilter(e.target.value)}
                    className="input-premium w-full px-3 py-2"
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
                    value={todayPatientSearch}
                    onChange={(e) => setTodayPatientSearch(e.target.value)}
                    placeholder={t(language, "pacs.remap.optionalPatientSearch")}
                    className="input-premium w-full px-3 py-2"
                  />
                </div>
                {todayStudiesQuery.isLoading && <p className="text-xs">{t(language, "pacs.remap.loadingStudyLinkedPatients")}</p>}
                {todayStudiesQuery.error && <p className="text-xs text-red-600">{t(language, "pacs.remap.failedStudyLinkedPatients")}</p>}
                {!todayStudiesQuery.isLoading && (todayStudiesQuery.data?.appointments?.length || 0) > 0 && (
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
                          className={`w-full text-left rounded border p-2 text-xs ${isSelected ? "border-teal-500 bg-teal-50" : "hover:bg-black/5"}`}
                        >
                          <p><strong>{displayName}</strong></p>
                          <p>{modalityName}{examName ? ` • ${examName}` : ""}</p>
                          <p>{appointment.appointment_date} • {appointment.accession_number}{appointment.national_id ? ` • ${appointment.national_id}` : ""}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <input
                type="text"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                className="input-premium w-full px-3 py-2"
                placeholder={t(language, "pacs.remap.searchPatient")}
              />
              <select value={selectedPatientId} onChange={(e) => setSelectedPatientId(e.target.value)} className="input-premium w-full px-3 py-2">
                <option value="">{t(language, "pacs.remap.selectPatient")}</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {formatName(language, patient)} {patient.national_id ? `(${patient.national_id})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {scanResult && (
            <div className="card-shell p-5 space-y-4">
              <h3 className="text-sm font-semibold">{t(language, "pacs.remap.step4")}</h3>
              <select value={selectedDestinationKey} onChange={(e) => setSelectedDestinationKey(e.target.value)} className="input-premium w-full px-3 py-2">
                <option value="">{t(language, "pacs.remap.selectDestination")}</option>
                {destinations.map((destination) => (
                  <option key={destination.key} value={destination.key}>{destination.name} ({destination.key})</option>
                ))}
              </select>
            </div>
          )}

          {scanResult && (
            <div className="card-shell p-5 space-y-4">
              <h3 className="text-sm font-semibold">{t(language, "pacs.remap.step5")}</h3>
              <div className="rounded border p-3 text-xs space-y-1">
                <p><strong>{t(language, "pacs.remap.originalPatientId")}:</strong> {selectedStudy?.patientId || "—"}</p>
                <p><strong>{t(language, "pacs.remap.originalPatientName")}:</strong> {selectedStudy?.patientName || "—"}</p>
                <p><strong>{t(language, "pacs.remap.replacementPatient")}:</strong> {selectedPatient ? formatName(language, selectedPatient) : "—"}</p>
                <p><strong>{t(language, "pacs.remap.replacementPatientId")}:</strong> {replacementPreviewQuery.data?.patientId || "—"}</p>
                <p><strong>{t(language, "pacs.remap.replacementPatientName")}:</strong> {replacementPreviewQuery.data?.patientName || "—"}</p>
                <p><strong>{t(language, "pacs.remap.replacementSex")}:</strong> {replacementPreviewQuery.data?.patientSex || "—"}</p>
                <p><strong>{t(language, "pacs.remap.replacementBirthDate")}:</strong> {replacementPreviewQuery.data?.patientBirthDate || "—"}</p>
                <p><strong>{t(language, "pacs.remap.destinationLabel")}:</strong> {selectedDestinationKey || "—"}</p>
                <p><strong>{t(language, "pacs.remap.studyLabel")}:</strong> {selectedStudy?.studyDescription || "—"} • {selectedStudy?.studyDate || "—"} • {selectedStudy?.modality || "—"}</p>
              </div>
              <p className="text-xs text-amber-700">
                {t(language, "pacs.remap.selectedStudyOnly")}
              </p>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
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
          )}

          {(wizardStep === "uploading" || wizardStep === "orthanc_processing" || wizardStep === "sending") && (
            <div className="card-shell p-5 space-y-3">
              <h3 className="text-sm font-semibold">{t(language, "pacs.remap.processStep")}</h3>
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
            <div className="card-shell p-5 space-y-3">
              <h3 className="text-sm font-semibold">{t(language, "pacs.remap.resultStep")}</h3>
              {wizardStep === "sent" ? (
                <p className="text-sm text-green-700">{t(language, "pacs.remap.success")}</p>
              ) : (
                <p className="text-sm text-red-700">{visibleErrorMessage || t(language, "pacs.remap.failure")}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={resetWorkflow} className="btn-secondary px-3 py-2 rounded-lg text-sm">{t(language, "pacs.remap.startNewUpload")}</button>
                {jobId && (
                  <button
                    type="button"
                    onClick={() => resetJobMutation.mutate()}
                    disabled={resetJobMutation.isPending}
                    className="btn-secondary px-3 py-2 rounded-lg text-sm disabled:opacity-50"
                  >
                    {t(language, "pacs.remap.resetCurrentUpload")}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card-shell p-4 space-y-2 text-xs">
            <h4 className="font-semibold text-sm">{t(language, "pacs.remap.summary")}</h4>
            <p><strong>{t(language, "pacs.remap.currentStep")}:</strong> {wizardStepLabel(language, wizardStep)}</p>
            <p><strong>{t(language, "pacs.remap.selectedStudy")}:</strong> {selectedStudy?.studyDescription || selectedStudy?.studyInstanceUid || t(language, "pacs.remap.noCurrentJob")}</p>
            <p><strong>{t(language, "pacs.remap.originalDICOMPatient")}:</strong> {selectedStudy?.patientName || "—"} ({selectedStudy?.patientId || "—"})</p>
            <p><strong>{t(language, "pacs.remap.selectedRISProPatient")}:</strong> {selectedPatient ? formatName(language, selectedPatient) : t(language, "pacs.remap.noCurrentJob")}</p>
            <p><strong>{t(language, "pacs.remap.destinationLabel")}:</strong> {selectedDestinationKey || t(language, "pacs.remap.noCurrentJob")}</p>
            <p><strong>{t(language, "pacs.remap.currentJobStatus")}:</strong> {currentJob?.status ? statusLabel(language, currentJob.status) : t(language, "pacs.remap.noCurrentJob")}</p>
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
              <p>{t(language, "pacs.remap.sourceStudy")}: <span className="font-mono">{currentJob.source_orthanc_study_id || "—"}</span></p>
              <p>{t(language, "pacs.remap.modifiedStudy")}: <span className="font-mono">{currentJob.modified_orthanc_study_id || "—"}</span></p>
              {isCancellableJobStatus(currentJob.status) && (
                <button type="button" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="btn-secondary px-3 py-2 rounded-lg text-xs">
                  {t(language, "pacs.remap.cancelActiveJob")}
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
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setJobId(job.id)}
                  className="w-full text-left rounded border p-2 hover:bg-black/5"
                >
                  <p className="font-mono">#{job.id} • {statusLabel(language, job.status)}</p>
                  <p className="truncate">{job.source_orthanc_study_id || "—"}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {visibleErrorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {visibleErrorMessage}
        </div>
      )}
      {successMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {successMessage}
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
