import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import { buildDicomUploadSelectionPlan, scanDicomStudiesFromFiles, type DicomStudyScanResult } from "@/lib/dicom-study-scan";

type JobStatus = "uploaded" | "awaiting_confirmation" | "remapped" | "sending" | "sent" | "failed" | "cancelled";

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
  created_at: string;
  updated_at: string;
}

interface RemapComparison {
  original: {
    patientId: string;
    patientName: string;
    patientSex: string;
    patientBirthDate: string;
  };
  replacement: {
    patientId: string;
    patientName: string;
    patientSex: string;
    patientBirthDate: string;
  };
}

interface Destination {
  key: string;
  id: number;
  name: string;
}

interface PatientOption {
  id: number;
  arabic_full_name?: string;
  english_full_name?: string;
  national_id?: string | null;
  mrn?: string | null;
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

function isActiveJobStatus(status: JobStatus): boolean {
  return ["uploaded", "awaiting_confirmation", "remapped", "sending"].includes(status);
}

function isCancellableJobStatus(status: JobStatus): boolean {
  return ["uploaded", "awaiting_confirmation"].includes(status);
}

export default function PacsRemapPage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [selectedDestinationKey, setSelectedDestinationKey] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [showReAuthModal, setShowReAuthModal] = useState(false);
  const [retryClearAfterReAuth, setRetryClearAfterReAuth] = useState(false);
  const [skippedFilesCount, setSkippedFilesCount] = useState<number>(0);
  const [scanResult, setScanResult] = useState<DicomStudyScanResult | null>(null);
  const [selectedStudyInstanceUid, setSelectedStudyInstanceUid] = useState("");
  const [enableFallbackUpload, setEnableFallbackUpload] = useState(false);
  const [fileInputVersion, setFileInputVersion] = useState(0);

  const setSelectedFiles = (incoming: FileList | null): void => {
    const all = Array.from(incoming || []);
    setFiles(all);
    setSkippedFilesCount(0);
    setErrorMessage("");
    setSuccessMessage("");
    setScanResult(null);
    setSelectedStudyInstanceUid("");
    setEnableFallbackUpload(false);
    if (all.length === 0) {
      scanMutation.reset();
      return;
    }
    scanMutation.mutate(all);
  };

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
      if (primaryPatients) {
        return { patients: primaryPatients as PatientOption[] };
      }

      const fallback = await api<Record<string, unknown>>(
        `/patients/directory?q=${encodeURIComponent(search)}&page=1&pageSize=25`
      );
      const fallbackRows = Array.isArray(fallback?.rows) ? fallback.rows : [];
      return { patients: fallbackRows as PatientOption[] };
    },
    retry: 0,
  });

  const currentJobQuery = useQuery({
    queryKey: ["pacs", "remap", "job", jobId],
    queryFn: () => api<{ job: RemapJob; comparison: RemapComparison | null }>(`/pacs/remap/jobs/${jobId}`),
    enabled: jobId != null,
    refetchInterval: (query) => {
      const status = (query.state.data as { job?: RemapJob } | undefined)?.job?.status;
      if (status === "remapped" || status === "sending") {
        return 1500;
      }
      return false;
    },
  });

  const jobsQuery = useQuery({
    queryKey: ["pacs", "remap", "jobs"],
    queryFn: () => api<{ jobs: RemapJob[] }>("/pacs/remap/jobs?limit=20"),
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (files.length === 0) {
        throw new Error(language === "ar" ? "يرجى اختيار ملف DICOM واحد على الأقل." : "Please choose at least one DICOM file.");
      }

      const chosenStudy = scanResult?.studies.find((study) => study.studyInstanceUid === selectedStudyInstanceUid) || null;
      const hasDetectedStudies = (scanResult?.studies.length || 0) > 0;
      const plan = buildDicomUploadSelectionPlan(scanResult, selectedStudyInstanceUid, enableFallbackUpload);
      const useFallback = plan.usesFallback;
      if (hasDetectedStudies && !chosenStudy) {
        throw new Error(language === "ar" ? "يرجى اختيار دراسة واحدة قبل الرفع." : "Please select one detected study before upload.");
      }
      if (!hasDetectedStudies && !useFallback) {
        throw new Error(
          language === "ar"
            ? "تعذر على RISPro تحديد الدراسات بدقة. فعّل خيار الرفع المتقدم للمتابعة."
            : "RISPro could not reliably detect studies before upload. Enable advanced fallback upload to continue."
        );
      }

      const uploadFiles = plan.files.length > 0 ? plan.files : files;
      if (uploadFiles.length === 0) {
        throw new Error(language === "ar" ? "لا توجد ملفات مناسبة للرفع." : "No uploadable files were selected.");
      }

      const formData = new FormData();
      for (const file of uploadFiles) {
        formData.append("files", file, file.name);
      }
      if (chosenStudy?.studyInstanceUid) {
        formData.append("selectedStudyInstanceUID", chosenStudy.studyInstanceUid);
      }
      if (!chosenStudy) {
        formData.append("uploadMode", "fallback_all_candidates");
      }

      return api<{ job: RemapJob; skippedFilesCount?: number }>("/pacs/remap/jobs/upload-multipart", {
        method: "POST",
        body: formData,
      }, 600_000);
    },
    onSuccess: (data) => {
      setJobId(data.job.id);
      setSkippedFilesCount(data.skippedFilesCount || 0);
      setErrorMessage("");
      setSuccessMessage("");
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        const details = (error.details || {}) as { activeJobId?: number };
        if (details.activeJobId) {
          setJobId(Number(details.activeJobId));
          setErrorMessage(
            language === "ar"
              ? `لديك مهمة نشطة بالفعل (#${details.activeJobId}). تم فتحها.`
              : `You already have an active job (#${details.activeJobId}). Opened it for you.`
          );
          return;
        }
      }
      setErrorMessage(error instanceof Error ? error.message : "Upload failed.");
    },
  });

  const scanMutation = useMutation({
    mutationFn: async (selectedFiles: File[]) => scanDicomStudiesFromFiles(selectedFiles, { batchSize: 20 }),
    onSuccess: (result) => {
      setScanResult(result);
      setSkippedFilesCount(result.skippedSidecarCount);
      setEnableFallbackUpload(false);
      if (result.studies.length === 1) {
        setSelectedStudyInstanceUid(result.studies[0].studyInstanceUid);
      } else {
        setSelectedStudyInstanceUid("");
      }
    },
    onError: (error: unknown) => {
      setScanResult(null);
      setSelectedStudyInstanceUid("");
      setEnableFallbackUpload(false);
      setErrorMessage(error instanceof Error ? error.message : "Failed to scan DICOM files.");
    },
  });

  const prepareMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error("Missing job ID.");
      if (!selectedPatientId) throw new Error(language === "ar" ? "يرجى اختيار المريض." : "Select a patient.");
      if (!selectedDestinationKey) throw new Error(language === "ar" ? "يرجى اختيار وجهة PACS." : "Select a PACS destination.");

      return api<{ job: RemapJob; comparison: RemapComparison }>(`/pacs/remap/jobs/${jobId}/prepare`, {
        method: "POST",
        body: JSON.stringify({
          risproPatientId: selectedPatientId,
          destinationPacsKey: selectedDestinationKey,
        }),
      });
    },
    onSuccess: () => {
      setErrorMessage("");
      void currentJobQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Prepare failed.");
    },
  });

  const confirmSendMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error("Missing job ID.");
      return api<{ job: RemapJob }>(`/pacs/remap/jobs/${jobId}/confirm-send`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      }, 120_000);
    },
    onSuccess: () => {
      setErrorMessage("");
      void currentJobQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Send failed.");
      void currentJobQuery.refetch();
    },
  });

  const currentJob = currentJobQuery.data?.job || null;
  const comparison = currentJobQuery.data?.comparison || null;
  const patients = patientQuery.data?.patients || [];
  const destinations = destinationsQuery.data?.destinations || [];
  const isSupervisor = user?.role === "supervisor";
  const selectedStudy = scanResult?.studies.find((study) => study.studyInstanceUid === selectedStudyInstanceUid) || null;
  const detectedStudiesCount = scanResult?.studies.length || 0;
  const hasUnparsedFiles = (scanResult?.unparsedCount || 0) > 0;
  const canUseFallbackUpload = !scanMutation.isPending && (detectedStudiesCount === 0);

  const canPrepare = currentJob?.status === "uploaded" && !!selectedPatientId && !!selectedDestinationKey;
  const canConfirm = currentJob?.status === "awaiting_confirmation" && comparison != null;
  const canCancelCurrentJob = currentJob ? isCancellableJobStatus(currentJob.status) : false;
  const hasActiveCurrentJob = currentJob ? isActiveJobStatus(currentJob.status) : false;
  const canResetCurrentJob = currentJob ? !["sending", "sent"].includes(currentJob.status) : false;

  const resetWorkflow = (): void => {
    setFiles([]);
    setJobId(null);
    setPatientSearch("");
    setSelectedPatientId("");
    setSelectedDestinationKey("");
    setErrorMessage("");
    setSuccessMessage("");
    setSkippedFilesCount(0);
    setScanResult(null);
    setSelectedStudyInstanceUid("");
    setEnableFallbackUpload(false);
    setFileInputVersion((value) => value + 1);
    uploadMutation.reset();
    prepareMutation.reset();
    confirmSendMutation.reset();
    scanMutation.reset();
  };

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error("Missing job ID.");
      return api<{ job: RemapJob }>(`/pacs/remap/jobs/${jobId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "Cancelled from DICOM remap page" }),
      });
    },
    onSuccess: () => {
      setErrorMessage("");
      setJobId(null);
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Cancel failed.");
      void currentJobQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
  });

  const resetJobMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error("Missing job ID.");
      return api<{
        job: RemapJob;
        summary: {
          studiesAttempted: number;
          studiesDeleted: number;
          studiesAlreadyMissing: number;
          failures: unknown[];
        };
      }>(`/pacs/remap/jobs/${jobId}/reset`, {
        method: "POST",
      });
    },
    onSuccess: (data) => {
      const message = language === "ar"
        ? `تمت إعادة الضبط. تم حذف ${data.summary.studiesDeleted} دراسة، و${data.summary.studiesAlreadyMissing} كانت محذوفة مسبقاً.`
        : `Reset complete. Deleted ${data.summary.studiesDeleted} linked Orthanc studies; ${data.summary.studiesAlreadyMissing} were already missing.`;
      resetWorkflow();
      setSuccessMessage(message);
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Reset failed.");
      void currentJobQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
    },
  });

  const clearFailedStudiesMutation = useMutation({
    mutationFn: async () => api<{
      summary: {
        studiesAttempted: number;
        studiesDeleted: number;
        studiesAlreadyMissing: number;
        failures: Array<{ studyId?: string; orthancStatus?: number; message?: string }>;
      };
    }>("/pacs/remap/maintenance/clear-failed-studies", {
      method: "POST",
    }),
    onSuccess: (data) => {
      const failures = data.summary.failures.length;
      const message = language === "ar"
        ? `اكتملت الصيانة. تمت محاولة ${data.summary.studiesAttempted} دراسة، حذف ${data.summary.studiesDeleted}، ${data.summary.studiesAlreadyMissing} كانت محذوفة مسبقاً، وفشل ${failures}.`
        : `Maintenance complete. Attempted ${data.summary.studiesAttempted} studies; deleted ${data.summary.studiesDeleted}; ${data.summary.studiesAlreadyMissing} already missing; ${failures} failed.`;
      setSuccessMessage(message);
      setErrorMessage("");
      void queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "jobs"] });
      if (jobId) void currentJobQuery.refetch();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to clear failed remap studies.";
      const requiresReAuth = message.includes("re-authentication") || message.includes("403");
      if (requiresReAuth) {
        setRetryClearAfterReAuth(true);
        setShowReAuthModal(true);
        setErrorMessage(
          language === "ar"
            ? "يلزم تأكيد هوية المشرف قبل تشغيل صيانة Orthanc."
            : "Supervisor re-authentication is required before running Orthanc maintenance."
        );
      } else {
        setErrorMessage(message);
      }
      setSuccessMessage("");
    },
  });

  const title = language === "ar" ? "رفع DICOM وإعادة ربط المريض" : "DICOM Upload + Patient Remap";

  const statusLabel = useMemo(() => {
    if (!currentJob) return "";
    const map: Record<JobStatus, string> = {
      uploaded: language === "ar" ? "تم الرفع" : "Uploaded",
      awaiting_confirmation: language === "ar" ? "بانتظار التأكيد" : "Awaiting confirmation",
      remapped: language === "ar" ? "تمت إعادة الربط" : "Remapped",
      sending: language === "ar" ? "جارٍ الإرسال" : "Sending",
      sent: language === "ar" ? "تم الإرسال" : "Sent",
      failed: language === "ar" ? "فشل" : "Failed",
      cancelled: language === "ar" ? "ملغي" : "Cancelled",
    };
    return map[currentJob.status];
  }, [currentJob, language]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="card-shell p-5">
        <h2 className="text-xl font-bold" style={{ color: "var(--text)" }}>{title}</h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          {language === "ar"
            ? "أداة داخلية آمنة: رفع دراسة واحدة، اختيار مريض، تأكيد، ثم إرسال إلى PACS."
            : "Safe internal tool: upload one study, choose patient, confirm, then send to PACS."}
        </p>
      </div>

      <div className="card-shell p-5 space-y-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {language === "ar" ? "1) رفع الدراسة" : "1) Upload Study"}
        </h3>
        <input
          key={`files-${fileInputVersion}`}
          type="file"
          multiple
          accept=".dcm,.dicom,.ima,application/dicom,application/octet-stream"
          onChange={(event) => setSelectedFiles(event.target.files)}
          className="input-premium w-full px-3 py-2"
        />
        <input
          key={`directory-${fileInputVersion}`}
          type="file"
          multiple
          onChange={(event) => setSelectedFiles(event.target.files)}
          className="input-premium w-full px-3 py-2"
          {...({ webkitdirectory: "true", directory: "true", mozdirectory: "true" } as Record<string, string>)}
        />
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {language === "ar"
            ? `الملفات المختارة: ${files.length}`
            : `Selected files: ${files.length}`}
        </p>
        {scanMutation.isPending && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {language === "ar" ? "جارٍ فحص الملفات..." : "Scanning files..."}
          </p>
        )}
        {scanResult && !scanMutation.isPending && (
          <div className="rounded-lg border p-3 space-y-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            <p>
              {language === "ar"
                ? `تم اكتشاف ${scanResult.studies.length} دراسة`
                : `Detected ${scanResult.studies.length} studies`}
            </p>
            <p>
              {language === "ar"
                ? `تم تجاهل ${scanResult.skippedSidecarCount} ملف جانبي`
                : `Skipped ${scanResult.skippedSidecarCount} sidecar files`}
            </p>
            <p>
              {language === "ar"
                ? `${scanResult.unparsedCount} ملف لم يمكن تحليله`
                : `${scanResult.unparsedCount} files could not be parsed`}
            </p>
            {scanResult.studies.length > 1 && (
              <p className="text-amber-600">
                {language === "ar"
                  ? "تم العثور على عدة دراسات. اختر دراسة واحدة قبل الرفع."
                  : "Multiple studies detected. Select one study before upload."}
              </p>
            )}
            {scanResult.studies.length === 0 && (
              <p className="text-amber-600">
                {language === "ar"
                  ? "تعذر على RISPro تحديد الدراسات قبل الرفع."
                  : "RISPro could not reliably detect studies before upload."}
              </p>
            )}
          </div>
        )}
        {skippedFilesCount > 0 && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {language === "ar"
              ? `تم تجاهل ${skippedFilesCount} ملف غير DICOM.`
              : `Skipped ${skippedFilesCount} non-DICOM files.`}
          </p>
        )}
        {scanResult && scanResult.studies.length > 0 && (
          <div className="space-y-2">
            {scanResult.studies.map((study) => (
              <label key={study.studyInstanceUid} className="block rounded-lg border p-3 cursor-pointer">
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="detectedStudy"
                    value={study.studyInstanceUid}
                    checked={selectedStudyInstanceUid === study.studyInstanceUid}
                    onChange={(event) => {
                      setSelectedStudyInstanceUid(event.target.value);
                      setEnableFallbackUpload(false);
                    }}
                  />
                  <div className="text-xs space-y-1">
                    <p><strong>{language === "ar" ? "الوصف" : "StudyDescription"}:</strong> {study.studyDescription || "—"}</p>
                    <p><strong>{language === "ar" ? "التاريخ" : "StudyDate"}:</strong> {study.studyDate || "—"}</p>
                    <p><strong>{language === "ar" ? "الموداليتي" : "Modality"}:</strong> {study.modality || "—"}</p>
                    <p><strong>{language === "ar" ? "PatientID" : "PatientID"}:</strong> {study.patientId || "—"}</p>
                    <p><strong>{language === "ar" ? "PatientName" : "PatientName"}:</strong> {study.patientName || "—"}</p>
                    <p>
                      <strong>{language === "ar" ? "السلاسل/الملفات/الحجم" : "Series/Files/Size"}:</strong>{" "}
                      {study.seriesCount} / {study.fileCount} / {formatBytes(study.totalBytes)}
                    </p>
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
        {canUseFallbackUpload && (
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={enableFallbackUpload}
              onChange={(event) => setEnableFallbackUpload(event.target.checked)}
            />
            <span>
              {language === "ar"
                ? "رفع متقدم: ارفع كل ملفات DICOM المحتملة ودع RISPro يتحقق من دراسة واحدة."
                : "Advanced fallback: Upload all DICOM-like files and let RISPro validate one study."}
            </span>
          </label>
        )}
        {hasUnparsedFiles && selectedStudy && (
          <p className="text-xs text-amber-600">
            {language === "ar"
              ? "الملفات غير المحللة لن تُرفع افتراضياً."
              : "Unparsed files are not uploaded by default."}
          </p>
        )}
        <button
          type="button"
          onClick={() => uploadMutation.mutate()}
          disabled={
            uploadMutation.isPending ||
            scanMutation.isPending ||
            files.length === 0 ||
            (
              (detectedStudiesCount > 0 && !selectedStudy) ||
              (detectedStudiesCount === 0 && !enableFallbackUpload)
            )
          }
          className="btn-primary px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {uploadMutation.isPending
            ? (language === "ar" ? "جارٍ الرفع..." : "Uploading...")
            : (language === "ar" ? "رفع الدراسة المختارة" : "Upload selected study")}
        </button>
        <button
          type="button"
          onClick={resetWorkflow}
          className="btn-secondary px-4 py-2 rounded-lg"
        >
          {language === "ar" ? "إعادة ضبط" : "Reset"}
        </button>
      </div>

      {currentJob && (
        <div className="card-shell p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              {language === "ar" ? "حالة المهمة" : "Job Status"}
            </h3>
            <span className="text-xs px-2 py-1 rounded-full pill-soft">{statusLabel}</span>
          </div>
          {hasActiveCurrentJob && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => cancelMutation.mutate()}
                disabled={!canCancelCurrentJob || cancelMutation.isPending}
                className="btn-secondary px-3 py-2 rounded-lg text-xs disabled:opacity-50"
              >
                {cancelMutation.isPending
                  ? (language === "ar" ? "جارٍ الإلغاء..." : "Cancelling...")
                  : (language === "ar" ? "إلغاء المهمة النشطة" : "Cancel active job")}
              </button>
              {!canCancelCurrentJob && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {language === "ar"
                    ? "لا يمكن إيقاف مهمة بدأت المعالجة بالفعل."
                    : "Jobs already being processed cannot be interrupted safely."}
                </p>
              )}
            </div>
          )}
          {canResetCurrentJob && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => resetJobMutation.mutate()}
                disabled={resetJobMutation.isPending}
                className="btn-secondary px-3 py-2 rounded-lg text-xs disabled:opacity-50"
              >
                {resetJobMutation.isPending
                  ? (language === "ar" ? "جارٍ إعادة الضبط..." : "Resetting...")
                  : (language === "ar" ? "إعادة ضبط الرفع الحالي" : "Reset current upload")}
              </button>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {language === "ar"
                  ? "يحذف فقط دراسات Orthanc المرتبطة بهذه المهمة."
                  : "Deletes only Orthanc studies linked to this job."}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="font-medium">{language === "ar" ? "معرف المهمة" : "Job ID"}</p>
              <p className="font-mono">{currentJob.id}</p>
            </div>
            <div>
              <p className="font-medium">{language === "ar" ? "دراسة Orthanc الأصلية" : "Source Orthanc Study"}</p>
              <p className="font-mono">{currentJob.source_orthanc_study_id || "—"}</p>
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="font-medium mb-2">{language === "ar" ? "بيانات المريض الأصلية (DICOM)" : "Original DICOM Patient Fields"}</p>
            <p>{language === "ar" ? "PatientID" : "PatientID"}: {currentJob.original_patient_id || "—"}</p>
            <p>{language === "ar" ? "PatientName" : "PatientName"}: {currentJob.original_patient_name || "—"}</p>
            <p>{language === "ar" ? "PatientSex" : "PatientSex"}: {currentJob.original_patient_sex || "—"}</p>
            <p>{language === "ar" ? "PatientBirthDate" : "PatientBirthDate"}: {currentJob.original_patient_birth_date || "—"}</p>
          </div>
        </div>
      )}

      {currentJob && currentJob.status === "uploaded" && (
        <div className="card-shell p-5 space-y-4">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {language === "ar" ? "2) اختيار المريض والوجهة" : "2) Select Patient and Destination"}
          </h3>

          <input
            type="text"
            value={patientSearch}
            onChange={(event) => setPatientSearch(event.target.value)}
            className="input-premium w-full px-3 py-2"
            placeholder={language === "ar" ? "ابحث عن مريض..." : "Search patient..."}
          />
          {patientQuery.error && (
            <p className="text-xs text-red-600">
              {patientQuery.error instanceof Error
                ? patientQuery.error.message
                : (language === "ar" ? "تعذر تحميل نتائج المرضى." : "Failed to load patient search results.")}
            </p>
          )}

          <select
            value={selectedPatientId}
            onChange={(event) => setSelectedPatientId(event.target.value)}
            className="input-premium w-full px-3 py-2"
          >
            <option value="">{language === "ar" ? "اختر المريض" : "Select patient"}</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {formatName(patient)} {patient.national_id ? `(${patient.national_id})` : ""}
              </option>
            ))}
          </select>

          <select
            value={selectedDestinationKey}
            onChange={(event) => setSelectedDestinationKey(event.target.value)}
            className="input-premium w-full px-3 py-2"
          >
            <option value="">{language === "ar" ? "اختر وجهة PACS" : "Select PACS destination"}</option>
            {destinations.map((destination) => (
              <option key={destination.key} value={destination.key}>{destination.name}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => prepareMutation.mutate()}
            disabled={!canPrepare || prepareMutation.isPending}
            className="btn-primary px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {prepareMutation.isPending
              ? (language === "ar" ? "جارٍ التحضير..." : "Preparing...")
              : (language === "ar" ? "تحضير شاشة التأكيد" : "Prepare Confirmation")}
          </button>
        </div>
      )}

      {canConfirm && comparison && (
        <div className="card-shell p-5 space-y-4">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {language === "ar" ? "3) تأكيد الإرسال" : "3) Confirm and Send"}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border p-3">
              <p className="font-medium mb-2">{language === "ar" ? "القيم الأصلية" : "Original Values"}</p>
              <p>PatientID: {comparison.original.patientId || "—"}</p>
              <p>PatientName: {comparison.original.patientName || "—"}</p>
              <p>PatientSex: {comparison.original.patientSex || "—"}</p>
              <p>PatientBirthDate: {comparison.original.patientBirthDate || "—"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium mb-2">{language === "ar" ? "القيم البديلة" : "Replacement Values"}</p>
              <p>PatientID: {comparison.replacement.patientId || "—"}</p>
              <p>PatientName: {comparison.replacement.patientName || "—"}</p>
              <p>PatientSex: {comparison.replacement.patientSex || "—"}</p>
              <p>PatientBirthDate: {comparison.replacement.patientBirthDate || "—"}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => confirmSendMutation.mutate()}
            disabled={confirmSendMutation.isPending}
            className="btn-primary px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {confirmSendMutation.isPending
              ? (language === "ar" ? "جارٍ التنفيذ..." : "Processing...")
              : (language === "ar" ? "تأكيد وإرسال إلى PACS" : "Confirm and Send to PACS")}
          </button>
        </div>
      )}

      {isSupervisor && (
        <div className="card-shell p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              {language === "ar" ? "صيانة Orthanc للمشرف" : "Supervisor Orthanc Maintenance"}
            </h3>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              {language === "ar"
                ? "يحذف فقط دراسات Orthanc المرتبطة بمهام DICOM remap الفاشلة أو الملغاة."
                : "Deletes only Orthanc studies linked to failed or cancelled DICOM remap jobs."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => clearFailedStudiesMutation.mutate()}
            disabled={clearFailedStudiesMutation.isPending}
            className="btn-secondary px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {clearFailedStudiesMutation.isPending
              ? (language === "ar" ? "جارٍ التنظيف..." : "Clearing...")
              : (language === "ar" ? "تنظيف دراسات remap الفاشلة" : "Clear failed remap studies")}
          </button>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {language === "ar"
              ? "لا يحذف الدراسات النشطة أو المرسلة ولا يشغل إعادة الضبط الشاملة."
              : "Does not delete active or sent job studies, and does not run hard reset."}
          </p>
        </div>
      )}

      <div className="card-shell p-5 space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {language === "ar" ? "مهماتي الأخيرة" : "My Recent Jobs"}
        </h3>
        {jobsQuery.isLoading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{language === "ar" ? "جارٍ التحميل..." : "Loading..."}</p>
        ) : (
          <div className="space-y-2">
            {(jobsQuery.data?.jobs || []).map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => {
                  setJobId(job.id);
                  setErrorMessage("");
                }}
                className="w-full text-left rounded-lg border p-3 hover:bg-black/5"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono">#{job.id}</span>
                  <span className="text-xs">{job.status}</span>
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {job.source_orthanc_study_id || "—"}
                </p>
              </button>
            ))}
          </div>
        )}
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

      {destinationsQuery.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {destinationsQuery.error instanceof ApiError ? destinationsQuery.error.message : "Failed to load destinations."}
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
