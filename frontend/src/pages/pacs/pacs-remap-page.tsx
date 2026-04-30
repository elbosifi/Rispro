import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";
import { useLanguage } from "@/providers/language-provider";

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",").pop() || "" : value);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function formatName(patient: PatientOption): string {
  return patient.english_full_name || patient.arabic_full_name || `Patient #${patient.id}`;
}

function isLikelyDicomClientFile(file: File): boolean {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();

  if (
    type.includes("dicom") ||
    name.endsWith(".dcm") ||
    name.endsWith(".dicom") ||
    name.endsWith(".ima")
  ) {
    return true;
  }

  if (
    type.startsWith("image/") ||
    type.startsWith("text/") ||
    type === "application/pdf" ||
    name.endsWith(".pdf") ||
    name.endsWith(".txt") ||
    name.endsWith(".csv") ||
    name.endsWith(".json") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".gif") ||
    name.endsWith(".webp")
  ) {
    return false;
  }

  // Unknown binary file types are allowed and validated by Orthanc.
  return true;
}

function isActiveJobStatus(status: JobStatus): boolean {
  return ["uploaded", "awaiting_confirmation", "remapped", "sending"].includes(status);
}

function isCancellableJobStatus(status: JobStatus): boolean {
  return ["uploaded", "awaiting_confirmation"].includes(status);
}

export default function PacsRemapPage() {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [selectedDestinationKey, setSelectedDestinationKey] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [skippedFilesCount, setSkippedFilesCount] = useState<number>(0);
  const [fileInputVersion, setFileInputVersion] = useState(0);

  const setSelectedFiles = (incoming: FileList | null): void => {
    const all = Array.from(incoming || []);
    const accepted = all.filter(isLikelyDicomClientFile);
    const skipped = all.length - accepted.length;
    setFiles(accepted);
    setSkippedFilesCount(skipped);
    if (accepted.length === 0 && all.length > 0) {
      setErrorMessage(language === "ar" ? "لم يتم العثور على ملفات DICOM في الاختيار." : "No DICOM-like files found in selection.");
    } else {
      setErrorMessage("");
    }
  };

  const destinationsQuery = useQuery({
    queryKey: ["pacs", "remap", "destinations"],
    queryFn: () => api<{ destinations: Destination[] }>("/pacs/remap/destinations"),
  });

  const patientQuery = useQuery({
    queryKey: ["patients", "remap-search", patientSearch],
    queryFn: () => api<{ patients: PatientOption[] }>(`/patients?q=${encodeURIComponent(patientSearch)}`),
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
      const payloadFiles = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type || "application/dicom",
          fileContentBase64: await fileToBase64(file),
        }))
      );

      return api<{ job: RemapJob }>("/pacs/remap/jobs/upload", {
        method: "POST",
        body: JSON.stringify({ files: payloadFiles }),
      }, 600_000);
    },
    onSuccess: (data) => {
      setJobId(data.job.id);
      setErrorMessage("");
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

  const canPrepare = currentJob?.status === "uploaded" && !!selectedPatientId && !!selectedDestinationKey;
  const canConfirm = currentJob?.status === "awaiting_confirmation" && comparison != null;
  const canCancelCurrentJob = currentJob ? isCancellableJobStatus(currentJob.status) : false;
  const hasActiveCurrentJob = currentJob ? isActiveJobStatus(currentJob.status) : false;

  const resetWorkflow = (): void => {
    setFiles([]);
    setJobId(null);
    setPatientSearch("");
    setSelectedPatientId("");
    setSelectedDestinationKey("");
    setErrorMessage("");
    setSkippedFilesCount(0);
    setFileInputVersion((value) => value + 1);
    uploadMutation.reset();
    prepareMutation.reset();
    confirmSendMutation.reset();
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
        {skippedFilesCount > 0 && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {language === "ar"
              ? `تم تجاهل ${skippedFilesCount} ملف غير DICOM.`
              : `Skipped ${skippedFilesCount} non-DICOM files.`}
          </p>
        )}
        <button
          type="button"
          onClick={() => uploadMutation.mutate()}
          disabled={uploadMutation.isPending || files.length === 0}
          className="btn-primary px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {uploadMutation.isPending
            ? (language === "ar" ? "جارٍ الرفع..." : "Uploading...")
            : (language === "ar" ? "رفع وإنشاء مهمة" : "Upload and Create Job")}
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

      {destinationsQuery.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {destinationsQuery.error instanceof ApiError ? destinationsQuery.error.message : "Failed to load destinations."}
        </div>
      )}
    </div>
  );
}
