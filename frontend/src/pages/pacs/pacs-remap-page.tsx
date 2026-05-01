import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { useAuth } from "@/providers/auth-provider";
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

function formatName(patient: PatientOption): string {
  return patient.english_full_name || patient.arabic_full_name || `Patient #${patient.id}`;
}

function isCancellableJobStatus(status: JobStatus): boolean {
  return ["uploaded", "awaiting_confirmation"].includes(status);
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
        resolve(body as UploadMultipartResult);
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [scanResult, setScanResult] = useState<DicomStudyScanResult | null>(null);
  const [selectedStudyInstanceUid, setSelectedStudyInstanceUid] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedDestinationKey, setSelectedDestinationKey] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
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
  const isSupervisor = user?.role === "supervisor";

  const wizardStep: RemapWizardStep = useMemo(() => {
    if (processMutation.isPending) return processingStage;
    if (processingStage === "sent") return "sent";
    if (processingStage === "failed") return "failed";
    if (scanMutation.isPending) return "scanning";
    if (!scanResult) return "select_files";
    if (!canContinueStudy) return "choose_study";
    if (!canContinuePatient) return "choose_patient";
    if (!canContinueDestination) return "choose_destination";
    return "review";
  }, [processMutation.isPending, processingStage, scanMutation.isPending, scanResult, canContinueStudy, canContinuePatient, canContinueDestination]);

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
    "1. Select folder",
    "2. Choose study",
    "3. Choose patient",
    "4. Destination",
    "5. Review",
    "6. Process",
    "7. Result",
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="card-shell p-5 space-y-2">
        <h2 className="text-2xl font-bold" style={{ color: "var(--text)" }}>DICOM CD / Folder Remap</h2>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Select one study from a CD or folder, assign it to the correct RISPro patient, then send the corrected study to PACS.
        </p>
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This tool changes DICOM patient identity before sending to PACS. Confirm the original and replacement patient details carefully.
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
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>Step 1: Select folder/files</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="remap-file-input" className="text-xs block mb-1">Select DICOM files</label>
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
                <label htmlFor="remap-folder-input" className="text-xs block mb-1">Select CD / Folder</label>
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
              Selected files: {files.length} • Estimated size: {formatBytes(files.reduce((sum, file) => sum + file.size, 0))}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => scanMutation.mutate()}
                disabled={files.length === 0 || scanMutation.isPending || processMutation.isPending}
                className="btn-primary px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {scanMutation.isPending ? "Scanning files..." : "Scan selected folder/files"}
              </button>
              <button type="button" onClick={resetWorkflow} className="btn-secondary px-4 py-2 rounded-lg">Reset workflow</button>
            </div>
          </div>

          {scanResult && (
            <div className="card-shell p-5 space-y-4">
              <h3 className="text-sm font-semibold">Step 2: Choose study</h3>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Detected {scanResult.studies.length} studies • Skipped {scanResult.skippedSidecarCount} sidecar files • {scanResult.unparsedCount} files could not be parsed
              </p>
              {scanResult.studies.length > 1 && (
                <p className="text-xs text-amber-700">Multiple studies detected. Select one study to remap.</p>
              )}
              {scanResult.studies.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-amber-700">RISPro could not reliably detect studies before upload.</p>
                  <label className="flex items-start gap-2 text-xs">
                    <input type="checkbox" checked={enableFallbackUpload} onChange={(e) => setEnableFallbackUpload(e.target.checked)} />
                    <span>Upload all DICOM-like files and let RISPro validate one study</span>
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
                        <p><strong>Description:</strong> {study.studyDescription || "—"} | <strong>Date:</strong> {study.studyDate || "—"} | <strong>Modality:</strong> {study.modality || "—"}</p>
                        <p><strong>PatientID:</strong> {study.patientId || "—"} | <strong>PatientName:</strong> {study.patientName || "—"}</p>
                        <p><strong>Series:</strong> {study.seriesCount} | <strong>Files:</strong> {study.fileCount} | <strong>Size:</strong> {formatBytes(study.totalBytes)}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {scanResult && (
            <div className="card-shell p-5 space-y-4">
              <h3 className="text-sm font-semibold">Step 3: Choose RISPro patient</h3>
              <input
                type="text"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                className="input-premium w-full px-3 py-2"
                placeholder="Search patient"
              />
              <select value={selectedPatientId} onChange={(e) => setSelectedPatientId(e.target.value)} className="input-premium w-full px-3 py-2">
                <option value="">Select patient</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {formatName(patient)} {patient.national_id ? `(${patient.national_id})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {scanResult && (
            <div className="card-shell p-5 space-y-4">
              <h3 className="text-sm font-semibold">Step 4: Choose PACS destination</h3>
              <select value={selectedDestinationKey} onChange={(e) => setSelectedDestinationKey(e.target.value)} className="input-premium w-full px-3 py-2">
                <option value="">Select destination</option>
                {destinations.map((destination) => (
                  <option key={destination.key} value={destination.key}>{destination.name} ({destination.key})</option>
                ))}
              </select>
            </div>
          )}

          {scanResult && (
            <div className="card-shell p-5 space-y-4">
              <h3 className="text-sm font-semibold">Step 5: Review remap</h3>
              <div className="rounded border p-3 text-xs space-y-1">
                <p><strong>Original PatientID:</strong> {selectedStudy?.patientId || "—"}</p>
                <p><strong>Original PatientName:</strong> {selectedStudy?.patientName || "—"}</p>
                <p><strong>Replacement Patient:</strong> {selectedPatient ? formatName(selectedPatient) : "—"}</p>
                <p><strong>Replacement PatientID:</strong> {replacementPreviewQuery.data?.patientId || "—"}</p>
                <p><strong>Replacement PatientName:</strong> {replacementPreviewQuery.data?.patientName || "—"}</p>
                <p><strong>Replacement Sex:</strong> {replacementPreviewQuery.data?.patientSex || "—"}</p>
                <p><strong>Replacement BirthDate:</strong> {replacementPreviewQuery.data?.patientBirthDate || "—"}</p>
                <p><strong>Destination:</strong> {selectedDestinationKey || "—"}</p>
                <p><strong>Study:</strong> {selectedStudy?.studyDescription || "—"} • {selectedStudy?.studyDate || "—"} • {selectedStudy?.modality || "—"}</p>
              </div>
              <p className="text-xs text-amber-700">
                Only the selected study will be uploaded and remapped. Other studies in the selected folder will not be sent.
              </p>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
                <span>I confirm this is the correct study and correct RISPro patient.</span>
              </label>
              <button
                type="button"
                onClick={() => processMutation.mutate()}
                disabled={!canSubmit}
                className="btn-primary px-4 py-2 rounded-lg disabled:opacity-50"
              >
                Upload selected study, remap, and send to PACS
              </button>
            </div>
          )}

          {(wizardStep === "uploading" || wizardStep === "orthanc_processing" || wizardStep === "sending") && (
            <div className="card-shell p-5 space-y-3">
              <h3 className="text-sm font-semibold">Step 6: Process</h3>
              <div className="h-2 w-full rounded bg-black/10 overflow-hidden">
                <div className="h-full bg-teal-600 transition-all duration-200" style={{ width: `${wizardStep === "uploading" ? uploadPercent : wizardStep === "orthanc_processing" ? 75 : 90}%` }} />
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {wizardStep === "uploading" && `Uploading selected study to RISPro (${uploadPercent}%)`}
                {wizardStep === "orthanc_processing" && "Waiting for Orthanc study stability and remapping demographics"}
                {wizardStep === "sending" && "Sending corrected study to PACS"}
              </p>
            </div>
          )}

          {(wizardStep === "sent" || wizardStep === "failed") && (
            <div className="card-shell p-5 space-y-3">
              <h3 className="text-sm font-semibold">Step 7: Result</h3>
              {wizardStep === "sent" ? (
                <p className="text-sm text-green-700">Study remapped and sent successfully.</p>
              ) : (
                <p className="text-sm text-red-700">{errorMessage || "Task failed. Please reset and retry."}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={resetWorkflow} className="btn-secondary px-3 py-2 rounded-lg text-sm">Start new upload</button>
                {jobId && (
                  <button
                    type="button"
                    onClick={() => resetJobMutation.mutate()}
                    disabled={resetJobMutation.isPending}
                    className="btn-secondary px-3 py-2 rounded-lg text-sm disabled:opacity-50"
                  >
                    Reset current upload
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card-shell p-4 space-y-2 text-xs">
            <h4 className="font-semibold text-sm">Summary</h4>
            <p><strong>Current step:</strong> {wizardStep}</p>
            <p><strong>Selected study:</strong> {selectedStudy?.studyDescription || selectedStudy?.studyInstanceUid || "—"}</p>
            <p><strong>Original DICOM patient:</strong> {selectedStudy?.patientName || "—"} ({selectedStudy?.patientId || "—"})</p>
            <p><strong>Selected RISPro patient:</strong> {selectedPatient ? formatName(selectedPatient) : "—"}</p>
            <p><strong>Destination:</strong> {selectedDestinationKey || "—"}</p>
            <p><strong>Current job status:</strong> {currentJob?.status || "—"}</p>
            {comparison && (
              <div className="rounded border p-2">
                <p><strong>Replacement PatientID:</strong> {comparison.replacement.patientId || "—"}</p>
                <p><strong>Replacement PatientName:</strong> {comparison.replacement.patientName || "—"}</p>
              </div>
            )}
          </div>

          {currentJob && (
            <div className="card-shell p-4 space-y-2 text-xs">
              <h4 className="font-semibold text-sm">Current Upload</h4>
              <p>Job #{currentJob.id}</p>
              <p>Source Study: <span className="font-mono">{currentJob.source_orthanc_study_id || "—"}</span></p>
              <p>Modified Study: <span className="font-mono">{currentJob.modified_orthanc_study_id || "—"}</span></p>
              {isCancellableJobStatus(currentJob.status) && (
                <button type="button" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending} className="btn-secondary px-3 py-2 rounded-lg text-xs">
                  Cancel active job
                </button>
              )}
            </div>
          )}

          {isSupervisor && (
            <div className="card-shell p-4 space-y-2 text-xs">
              <h4 className="font-semibold text-sm">Maintenance</h4>
              <button
                type="button"
                onClick={() => clearFailedStudiesMutation.mutate()}
                disabled={clearFailedStudiesMutation.isPending}
                className="btn-secondary px-3 py-2 rounded-lg text-xs"
              >
                Clear failed remap studies
              </button>
            </div>
          )}

          <div className="card-shell p-4 space-y-2 text-xs">
            <h4 className="font-semibold text-sm">Recent jobs</h4>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {(jobsQuery.data?.jobs || []).map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setJobId(job.id)}
                  className="w-full text-left rounded border p-2 hover:bg-black/5"
                >
                  <p className="font-mono">#{job.id} • {job.status}</p>
                  <p className="truncate">{job.source_orthanc_study_id || "—"}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {(errorMessage || currentJob?.error_message) && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage || currentJob?.error_message}
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
