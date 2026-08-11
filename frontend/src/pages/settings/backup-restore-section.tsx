import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { formatDateTimeLy } from "@/lib/date-format";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";

type BackupV3Preview = {
  ok: boolean;
  manifest: {
    formatVersion: number;
    createdAt: string;
    appName: string;
    packageVersion: string | null;
    gitCommit: string | null;
    migrationVersion: string | null;
  };
  counts: {
    tables: number;
    rows: number;
    archiveEntries: number;
    storageFiles: number;
    envVars: number;
  };
  warnings: string[];
  errors: string[];
};

type BackupV3PreviewJob = {
  previewJobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "expired" | "consumed";
  progress: number;
  manifest: BackupV3Preview["manifest"] | null;
  counts: BackupV3Preview["counts"] | null;
  warnings: string[];
  errors: string[];
  failureDiagnostics: string | null;
  compatibilityClassification?: "same_version" | "older_supported" | "newer_than_runtime" | "unsupported_history" | null;
  compatibilityMessage?: string | null;
};

type BackupV3UploadSession = { uploadSessionId: string; status: string; receivedOffset: number; expectedSizeBytes: number; expiresAt: string; failureMessage?: string | null };

type BackupV3RestoreResult = {
  ok: boolean;
  dbRestored?: boolean;
  storageRestored?: boolean | "partial";
  externalDocumentsRestored?: boolean | "partial";
  envRestored?: boolean;
  restoreIncomplete?: boolean;
  restartRequired?: boolean;
  safetyBackupsCreated?: Record<string, unknown>;
  restoredCounts?: Record<string, unknown>;
  warnings?: string[];
  partialFailure?: { component?: string; message?: string; details?: unknown };
  env?: {
    envVarsRestored?: Array<{ name: string; value?: string; isSecret?: boolean }>;
    ignoredArchiveKeys?: string[];
    preservedLocalKeys?: Array<{ name: string; value?: string; isSecret?: boolean }>;
  };
};

type BackupV3RestoreStatus = {
  enabled: boolean;
  dbOnlyEnabled: boolean;
  requiresSuperAdmin: true;
  userCanExecute: boolean;
  recentReauthRequired: true;
  recentReauthSatisfied: boolean;
  confirmationText: string;
  acceptedArchiveExtensions: string[];
  disabledReason?: string;
};

type BackupControlDestination = {
  destination_id: string;
  name: string;
  destination_type: "local" | "smb" | "sftp" | "nextcloud" | "onedrive";
  enabled: boolean;
  config: Record<string, unknown>;
  credentialsConfigured: boolean;
  last_connection_at: string | null;
  last_connection_status: string | null;
  last_failure_message: string | null;
};

type BackupControlJob = {
  job_id: string;
  artifact_id?: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  archive_name: string | null;
  archive_size_bytes: string | number | null;
  failure_message: string | null;
  source_schedule_id?: string | null;
  destination_copies?: Array<{ destinationId: string; copyAttemptId?: string; status: string; remotePath?: string | null; failureMessage?: string | null }>;
};

type BackupControlSummary = {
  destinations?: number;
  enabled_destinations?: number;
  recent_failures?: number;
  overdue_schedules?: number;
  health?: "healthy" | "warning" | "critical";
  health_reasons?: string[];
  staging_free_bytes?: string | number | null;
  active_job?: { status?: string; archive_name?: string | null } | null;
  last_successful_backup?: { archive_name?: string | null; completed_at?: string | null; archive_size_bytes?: string | number | null } | null;
  last_verified_copy?: { destination_name?: string; destination_type?: string; completed_at?: string | null } | null;
  latest_restore_verification_attempt?: { status?: string; created_at?: string | null; started_at?: string | null; completed_at?: string | null; failure_message?: string | null } | null;
  last_successful_restore_verification?: { completed_at?: string | null } | null;
  next_schedule?: { name?: string; next_run_at?: string | null } | null;
  worker?: { heartbeat_at?: string | null; last_failure_message?: string | null } | null;
  encryption?: {
    state?: "fresh_setup_required" | "ready" | "restart_required" | "runtime_key_persistence_required" | "recovery_required" | "invalid_key" | "validation_unavailable" | "deliberate_reset_required";
    encryptionReady: boolean;
    setupRequired: boolean;
    restartRequired: boolean;
    setupAvailable: boolean;
    limitation?: string;
  };
};

type BackupControlSchedule = {
  schedule_id: string;
  name: string;
  frequency: "daily" | "weekdays" | "weekly" | "monthly";
  time_of_day: string;
  timezone: string;
  selected_weekdays: number[];
  selected_day_of_month: number | null;
  destination_ids: string[];
  retention_policy: Record<string, unknown>;
  restore_verification_frequency: "disabled" | "weekly" | "monthly";
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
};

type BackupControlRestoreVerification = {
  restore_verification_job_id: string;
  job_id: string | null;
  archive_name: string | null;
  status: string;
  completed_at: string | null;
  failure_message: string | null;
  destination_name?: string | null;
  destination_type?: string | null;
  remote_path?: string | null;
  retrieval?: { fallbackToLocal?: boolean; retrievedSha256?: string; retrievedByteSize?: number; cleanupStatus?: string; restoreDrillStatus?: string };
};

const RESTORE_CONFIRMATION_TEXT = "RESTORE RISPRO";

function isSensitiveText(value: unknown): boolean {
  return /secret|password|token|passphrase|database_url|cookie|private/i.test(String(value || ""));
}

function safeDisplayValue(value: unknown): string {
  if (value == null) return "none";
  if (isSensitiveText(value)) return "********";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export const BackupRestoreSection = forwardRef<{ onReAuthSuccess: () => void }, { onReAuthRequired: (key: string[]) => void }>(
  function BackupRestoreSection({ onReAuthRequired }, ref) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreV3File, setRestoreV3File] = useState<File | null>(null);
  const [restoreV3SourceType, setRestoreV3SourceType] = useState<"artifact" | "destination_copy" | "upload_session">("upload_session");
  const [restoreV3ArtifactId, setRestoreV3ArtifactId] = useState("");
  const [restoreV3CopyAttemptId, setRestoreV3CopyAttemptId] = useState("");
  const [restoreV3Upload, setRestoreV3Upload] = useState<BackupV3UploadSession | null>(null);
  const [restoreV3PreviewJob, setRestoreV3PreviewJob] = useState<BackupV3PreviewJob | null>(null);
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [backupV3Passphrase, setBackupV3Passphrase] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreV3Passphrase, setRestoreV3Passphrase] = useState("");
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [restoreV3Confirmation, setRestoreV3Confirmation] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupV3Busy, setBackupV3Busy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewV3Busy, setPreviewV3Busy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreV3Busy, setRestoreV3Busy] = useState(false);
  const [restoreComplete, setRestoreComplete] = useState(false);
  const [restoreV3Result, setRestoreV3Result] = useState<BackupV3RestoreResult | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);
  const [restartRequested, setRestartRequested] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<unknown>(null);
  const [, setFullRestoreEnabled] = useState<boolean | null>(null);
  const [restoreV3Status, setRestoreV3Status] = useState<BackupV3RestoreStatus | null>(null);
  const [fullRestoreStatus, setFullRestoreStatus] = useState("Checking v3 restore availability...");
  const [restoreV3Preview, setRestoreV3Preview] = useState<BackupV3Preview | null>(null);
  const [migrationRehearsal, setMigrationRehearsal] = useState<{ rehearsal_id: string; status: string; progress: number; promotion_ready: boolean; errors: string[]; validation_results: Record<string, unknown> } | null>(null);
  const [backupControlSummary, setBackupControlSummary] = useState<BackupControlSummary | null>(null);
  const [backupDestinations, setBackupDestinations] = useState<BackupControlDestination[]>([]);
  const [backupJobs, setBackupJobs] = useState<BackupControlJob[]>([]);
  const [backupSchedules, setBackupSchedules] = useState<BackupControlSchedule[]>([]);
  const [backupRestoreVerifications, setBackupRestoreVerifications] = useState<BackupControlRestoreVerification[]>([]);
  const [verificationCopyIds, setVerificationCopyIds] = useState<Record<string, string>>({});
  const [selectedBackupDestinationIds, setSelectedBackupDestinationIds] = useState<string[]>([]);
  const [backupControlBusy, setBackupControlBusy] = useState(false);
  const [backupControlMessage, setBackupControlMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [backupKeySetupId, setBackupKeySetupId] = useState<string | null>(null);
  const [backupRecoveryDownloaded, setBackupRecoveryDownloaded] = useState(false);
  const [backupRecoveryConfirmed, setBackupRecoveryConfirmed] = useState(false);
  const [backupInstallationRecoveryValue, setBackupInstallationRecoveryValue] = useState("");
  const [destinationForm, setDestinationForm] = useState({ name: "", type: "local" as BackupControlDestination["destination_type"], rootPath: "", baseUrl: "", username: "", remotePath: "", host: "", port: "22", hostFingerprint: "", server: "", share: "", subfolder: "", domain: "", password: "", appPassword: "", privateKey: "" });
  const [editingDestinationId, setEditingDestinationId] = useState<string | null>(null);
  const [automatedPassphrase, setAutomatedPassphrase] = useState("");
  const [scheduleForm, setScheduleForm] = useState({ name: "", frequency: "daily" as BackupControlSchedule["frequency"], timeOfDay: "02:00", weekday: "1", dayOfMonth: "1", retentionPreset: "7_daily_4_weekly_12_monthly", retentionDaily: "7", retentionWeekly: "4", retentionMonthly: "12", restoreVerificationFrequency: "weekly" as BackupControlSchedule["restore_verification_frequency"] });
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [restorePreview, setRestorePreview] = useState<{
    manifest: {
      createdAt: string;
      schemas: string[];
      tableCounts: Record<string, number>;
      documents: { rows: number; filesIncluded: number; filesMissing: number };
    };
    tables: Array<{ name: string; rows: number }>;
    documents: { rows: number; filesIncluded: number; filesMissing: number };
    env: Array<{ name: string; value: string; isSecret: boolean; requiresReview: boolean }>;
    warnings: string[];
  } | null>(null);

  const restoreSteps = [
    { label: "File", done: Boolean(restoreFile), active: !restoreFile },
    { label: "Passphrase", done: restorePassphrase.length >= 8, active: Boolean(restoreFile) && restorePassphrase.length < 8 },
    { label: "Validate", done: Boolean(restorePreview), active: previewBusy || (Boolean(restoreFile) && restorePassphrase.length >= 8 && !restorePreview) },
    { label: "Confirm", done: restoreConfirmation === "RESTORE RISPRO", active: Boolean(restorePreview) && restoreConfirmation !== "RESTORE RISPRO" },
    { label: "Restore", done: restoreComplete, active: restoreBusy },
    { label: "Restart", done: false, active: restoreComplete }
  ];
  const restoreProgress = restoreComplete
    ? 100
    : Math.round((restoreSteps.filter((step) => step.done).length / restoreSteps.length) * 100);
  const exportProgress = backupBusy ? 70 : backupPassphrase.length >= 8 ? 35 : 0;
  const exportV3Progress = backupV3Busy ? 70 : backupV3Passphrase.length >= 8 ? 35 : 0;
  const canExecuteV3Restore =
    restoreV3Status?.enabled === true &&
    restoreV3Status.userCanExecute === true &&
    restoreV3Status.recentReauthSatisfied === true;
  const v3PreviewHasErrors = Boolean(restoreV3Preview && (!restoreV3Preview.ok || restoreV3Preview.errors.length > 0));
  const isSuperAdmin = user?.role === "super_admin";
  // Deprecated V2 compatibility endpoints intentionally have no normal UI.
  const showDeprecatedV2Controls = new URLSearchParams(window.location.search).has("deprecated-v2");

  useImperativeHandle(ref, () => ({
    onReAuthSuccess: handleReAuthSuccess
  }));

  const parseErrorMessage = useCallback(async (response: Response) => {
    const responseData = await response.json().catch(() => null);
    return (
      (responseData?.error && typeof responseData.error === "object" && responseData.error.message) ||
      responseData?.message ||
      (responseData?.error && typeof responseData.error === "string" ? responseData.error : null) ||
      `HTTP ${response.status}`
    );
  }, []);

  const refreshBackupControl = useCallback(async () => {
    try {
      const [summaryResponse, destinationsResponse, jobsResponse, schedulesResponse, restoreVerificationsResponse] = await Promise.all([
        fetch("/api/backup-control/summary", { credentials: "include" }),
        fetch("/api/backup-control/destinations", { credentials: "include" }),
        fetch("/api/backup-control/jobs", { credentials: "include" }),
        fetch("/api/backup-control/schedules", { credentials: "include" }),
        fetch("/api/backup-control/restore-verifications", { credentials: "include" }),
      ]);
      if (summaryResponse.ok) setBackupControlSummary((await summaryResponse.json()) as BackupControlSummary);
      if (destinationsResponse.ok) {
        const result = (await destinationsResponse.json()) as { destinations?: BackupControlDestination[] };
        const destinations = result.destinations || [];
        setBackupDestinations(destinations);
        setSelectedBackupDestinationIds((current) => current.filter((id) => destinations.some((destination) => destination.destination_id === id)));
      }
      if (jobsResponse.ok) setBackupJobs(((await jobsResponse.json()) as { jobs?: BackupControlJob[] }).jobs || []);
      if (schedulesResponse.ok) setBackupSchedules(((await schedulesResponse.json()) as { schedules?: BackupControlSchedule[] }).schedules || []);
      if (restoreVerificationsResponse.ok) setBackupRestoreVerifications(((await restoreVerificationsResponse.json()) as { verifications?: BackupControlRestoreVerification[] }).verifications || []);
    } catch {
      // The legacy backup/restore controls remain available if the control API is temporarily unavailable.
    }
  }, []);

  const probeV3RestoreAvailability = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/restore/v3/status", {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        const message = await parseErrorMessage(response);
        setFullRestoreEnabled(false);
        setRestoreV3Status(null);
        setFullRestoreStatus(message);
        return;
      }
      const status = (await response.json()) as BackupV3RestoreStatus;
      setRestoreV3Status(status);
      setFullRestoreEnabled(status.enabled);
      setFullRestoreStatus(status.enabled && status.userCanExecute && status.recentReauthSatisfied
        ? "V3 full restore is enabled for this authenticated super_admin session."
        : status.disabledReason || "V3 full restore execution is unavailable for this session.");
    } catch {
      setFullRestoreEnabled(false);
      setRestoreV3Status(null);
      setFullRestoreStatus("Could not confirm v3 full restore availability.");
    }
  }, [parseErrorMessage]);

  useEffect(() => {
    void probeV3RestoreAvailability();
    void refreshBackupControl();
  }, [probeV3RestoreAvailability, refreshBackupControl, user?.recentSupervisorReauth]);

  useEffect(() => {
    if (!backupRestoreVerifications.some((verification) => verification.status === "queued" || verification.status === "running")) return;
    const timer = window.setInterval(() => { void refreshBackupControl(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [backupRestoreVerifications, refreshBackupControl]);

  const runAutomatedBackupNow = async () => {
    if (!selectedBackupDestinationIds.length) {
      setBackupControlMessage({ type: "error", text: "Select at least one enabled destination." });
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch("/api/backup-control/run-now", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationIds: selectedBackupDestinationIds }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupControlMessage({ type: "success", text: "Backup job queued. The worker will generate and verify copies in the background." });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not queue backup job." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const createAutomatedDestination = async () => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "destination"]);
      setBackupControlMessage({ type: "error", text: "Recent supervisor re-authentication is required to change backup destinations." });
      return;
    }
    if (!backupControlSummary?.encryption?.encryptionReady) {
      setBackupControlMessage({ type: "error", text: "Complete Backup security setup and restart RISpro before saving protected destination settings." });
      return;
    }
    const config = destinationForm.type === "local"
      ? { rootPath: destinationForm.rootPath }
      : destinationForm.type === "nextcloud"
        ? { serverUrl: destinationForm.baseUrl, username: destinationForm.username, remoteDirectory: destinationForm.remotePath }
        : destinationForm.type === "sftp"
          ? { host: destinationForm.host, port: Number(destinationForm.port), username: destinationForm.username, authenticationType: destinationForm.privateKey ? "private_key" : "password", remoteDirectory: destinationForm.remotePath, hostKeyFingerprint: destinationForm.hostFingerprint }
          : destinationForm.type === "smb"
            ? { server: destinationForm.server, share: destinationForm.share, subfolder: destinationForm.subfolder, domain: destinationForm.domain || undefined }
            : {};
    const enteredCredentials = destinationForm.type === "local"
      ? undefined
      : destinationForm.type === "nextcloud"
      ? { appPassword: destinationForm.appPassword }
      : destinationForm.type === "sftp"
        ? (destinationForm.privateKey ? { privateKey: destinationForm.privateKey } : { password: destinationForm.password })
        : destinationForm.type === "smb"
          ? { username: destinationForm.username, password: destinationForm.password }
          : undefined;
    const hasEnteredCredentials = Object.values(enteredCredentials || {}).some((value) => typeof value === "string" && value.length > 0);
    const credentials = editingDestinationId && !hasEnteredCredentials ? undefined : enteredCredentials;
    setBackupControlBusy(true);
    try {
      const response = await fetch(editingDestinationId ? `/api/backup-control/destinations/${editingDestinationId}` : "/api/backup-control/destinations", { method: editingDestinationId ? "PATCH" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: destinationForm.name, destinationType: destinationForm.type, config, ...(credentials === undefined ? {} : { credentials }) }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setDestinationForm({ name: "", type: "local", rootPath: "", baseUrl: "", username: "", remotePath: "", host: "", port: "22", hostFingerprint: "", server: "", share: "", subfolder: "", domain: "", password: "", appPassword: "", privateKey: "" });
      setEditingDestinationId(null);
      setBackupControlMessage({ type: "success", text: `Destination ${editingDestinationId ? "updated" : "saved"}. Test it before relying on a schedule.` });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save destination." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const editAutomatedDestination = (destination: BackupControlDestination) => {
    const config = destination.config;
    setEditingDestinationId(destination.destination_id);
    setDestinationForm({
      name: destination.name,
      type: destination.destination_type,
      rootPath: typeof config.rootPath === "string" ? config.rootPath : "",
      baseUrl: typeof config.serverUrl === "string" ? config.serverUrl : "",
      username: typeof config.username === "string" ? config.username : "",
      remotePath: typeof config.remoteDirectory === "string" ? config.remoteDirectory : "",
      host: typeof config.host === "string" ? config.host : "",
      port: typeof config.port === "number" ? String(config.port) : "22",
      hostFingerprint: typeof config.hostKeyFingerprint === "string" ? config.hostKeyFingerprint : "",
      server: typeof config.server === "string" ? config.server : "",
      share: typeof config.share === "string" ? config.share : "",
      subfolder: typeof config.subfolder === "string" ? config.subfolder : "",
      domain: typeof config.domain === "string" ? config.domain : "",
      password: "", appPassword: "", privateKey: "",
    });
  };

  const testAutomatedDestination = async (destinationId: string) => {
    setBackupControlBusy(true);
    try {
      const response = await fetch(`/api/backup-control/destinations/${destinationId}/test`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupControlMessage({ type: "success", text: "Destination connection and permissions verified." });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Destination test failed." });
      await refreshBackupControl();
    } finally {
      setBackupControlBusy(false);
    }
  };

  const saveAutomatedPassphrase = async () => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "passphrase"]);
      return;
    }
    if (!backupControlSummary?.encryption?.encryptionReady) {
      setBackupControlMessage({ type: "error", text: "Complete Backup security setup and restart RISpro before saving the automated archive passphrase." });
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch("/api/backup-control/encryption-passphrase", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passphrase: automatedPassphrase }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setAutomatedPassphrase("");
      setBackupControlMessage({ type: "success", text: "Automated archive passphrase is configured and stored encrypted." });
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save automated archive passphrase." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const generateBackupSecurityRecovery = async () => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "security-setup"]);
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch("/api/backup-control/encryption-setup", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      const result = (await response.json()) as { setupId: string };
      setBackupKeySetupId(result.setupId);
      setBackupRecoveryDownloaded(false);
      setBackupRecoveryConfirmed(false);
      setBackupControlMessage({ type: "success", text: "A one-time recovery copy is ready. Download it and store it separately from this server before saving setup." });
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not generate Backup security setup." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const downloadBackupSecurityRecovery = async () => {
    if (!backupKeySetupId) return;
    setBackupControlBusy(true);
    try {
      const response = await fetch(`/api/backup-control/encryption-setup/${backupKeySetupId}/recovery`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await response.blob());
      link.download = "rispro-backup-v3-encryption-key-recovery.txt";
      link.click();
      URL.revokeObjectURL(link.href);
      setBackupRecoveryDownloaded(true);
      setBackupRecoveryConfirmed(false);
      setBackupControlMessage({ type: "success", text: "Recovery copy downloaded once. Confirm it is stored separately, then save Backup security setup." });
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not download the Backup recovery copy." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const saveBackupSecuritySetup = async () => {
    if (!backupKeySetupId || !backupRecoveryDownloaded || !backupRecoveryConfirmed) return;
    setBackupControlBusy(true);
    try {
      const response = await fetch(`/api/backup-control/encryption-setup/${backupKeySetupId}/confirm`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupKeySetupId(null);
      setBackupRecoveryDownloaded(false);
      setBackupRecoveryConfirmed(false);
      setBackupControlMessage({ type: "success", text: "Backup security setup was saved securely. Restart RISpro now, then this page will confirm encryption is ready." });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save Backup security setup." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const recoverBackupInstallationKey = async () => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "security-recovery"]);
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch("/api/backup-control/encryption-recovery", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recoveryValue: backupInstallationRecoveryValue }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupInstallationRecoveryValue("");
      setBackupControlMessage({ type: "success", text: "The installation credential-encryption key was validated and saved. Restart RISpro to load it." });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not recover the installation credential-encryption key." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const createAutomatedSchedule = async () => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "schedule"]);
      setBackupControlMessage({ type: "error", text: "Recent supervisor re-authentication is required to save a backup schedule." });
      return;
    }
    if (!selectedBackupDestinationIds.length) {
      setBackupControlMessage({ type: "error", text: "Select the enabled destinations this schedule should protect." });
      return;
    }
    setBackupControlBusy(true);
    try {
      const retentionPolicy = scheduleForm.retentionPreset === "custom"
        ? { daily: Number(scheduleForm.retentionDaily), weekly: Number(scheduleForm.retentionWeekly), monthly: Number(scheduleForm.retentionMonthly) }
        : { preset: scheduleForm.retentionPreset };
      const response = await fetch(editingScheduleId ? `/api/backup-control/schedules/${editingScheduleId}` : "/api/backup-control/schedules", { method: editingScheduleId ? "PATCH" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: scheduleForm.name, frequency: scheduleForm.frequency, timeOfDay: scheduleForm.timeOfDay, timezone: "Africa/Tripoli", selectedWeekdays: scheduleForm.frequency === "weekly" ? [Number(scheduleForm.weekday)] : [], selectedDayOfMonth: scheduleForm.frequency === "monthly" ? Number(scheduleForm.dayOfMonth) : null, destinationIds: selectedBackupDestinationIds, retentionPolicy, restoreVerificationFrequency: scheduleForm.restoreVerificationFrequency }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setScheduleForm({ name: "", frequency: "daily", timeOfDay: "02:00", weekday: "1", dayOfMonth: "1", retentionPreset: "7_daily_4_weekly_12_monthly", retentionDaily: "7", retentionWeekly: "4", retentionMonthly: "12", restoreVerificationFrequency: "weekly" });
      setEditingScheduleId(null);
      setBackupControlMessage({ type: "success", text: `Backup schedule ${editingScheduleId ? "updated" : "saved"} with weekly isolated restore verification.` });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save backup schedule." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const toggleAutomatedSchedule = async (schedule: BackupControlSchedule) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "schedule"]);
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch(`/api/backup-control/schedules/${schedule.schedule_id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !schedule.enabled }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupControlMessage({ type: "success", text: `Schedule ${schedule.enabled ? "paused" : "resumed"}.` });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not update schedule." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const runBackupControlAction = async (url: string, init: RequestInit, successMessage: string) => {
    setBackupControlBusy(true);
    try {
      const response = await fetch(url, { credentials: "include", ...init });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupControlMessage({ type: "success", text: successMessage });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Backup control action failed." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const toggleAutomatedDestination = async (destination: BackupControlDestination) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "destination"]);
      return;
    }
    await runBackupControlAction(`/api/backup-control/destinations/${destination.destination_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !destination.enabled }) }, `Destination ${destination.enabled ? "paused" : "resumed"}.`);
  };

  const deleteAutomatedSchedule = async (schedule: BackupControlSchedule) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth || !confirm(`Delete backup schedule ${schedule.name}?`)) return;
    await runBackupControlAction(`/api/backup-control/schedules/${schedule.schedule_id}`, { method: "DELETE" }, "Backup schedule deleted.");
  };

  const editAutomatedSchedule = (schedule: BackupControlSchedule) => {
    setEditingScheduleId(schedule.schedule_id);
    const savedPreset = typeof schedule.retention_policy.preset === "string" ? schedule.retention_policy.preset : "custom";
    const retentionPreset = savedPreset === "14_daily_12_monthly" || savedPreset === "30_daily" || savedPreset === "7_daily_4_weekly_12_monthly" ? savedPreset : "custom";
    setScheduleForm({ name: schedule.name, frequency: schedule.frequency, timeOfDay: schedule.time_of_day, weekday: String(schedule.selected_weekdays[0] ?? 1), dayOfMonth: String(schedule.selected_day_of_month ?? 1), retentionPreset, retentionDaily: String(schedule.retention_policy.daily ?? 0), retentionWeekly: String(schedule.retention_policy.weekly ?? 0), retentionMonthly: String(schedule.retention_policy.monthly ?? 0), restoreVerificationFrequency: schedule.restore_verification_frequency });
    setSelectedBackupDestinationIds(schedule.destination_ids);
  };

  const deleteAutomatedDestination = async (destination: BackupControlDestination) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth || !confirm(`Remove backup destination ${destination.name}? Destinations with backup history must be paused instead.`)) return;
    await runBackupControlAction(`/api/backup-control/destinations/${destination.destination_id}`, { method: "DELETE" }, "Backup destination removed.");
  };

  const retryAutomatedJob = async (job: BackupControlJob) => {
    await runBackupControlAction(`/api/backup-control/jobs/${job.job_id}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, "Destination-copy retry queued using the existing verified archive.");
  };

  const cancelAutomatedJob = async (job: BackupControlJob) => {
    if (!confirm("Cancel this queued backup before generation begins?")) return;
    await runBackupControlAction(`/api/backup-control/jobs/${job.job_id}/cancel`, { method: "POST" }, "Queued backup cancelled.");
  };

  const queueManualRestoreVerification = async (job: BackupControlJob) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "restore-verification"]);
      return;
    }
    const copyAttemptId = verificationCopyIds[job.job_id] || job.destination_copies?.find((copy) => copy.status === "verified")?.copyAttemptId;
    if (!copyAttemptId) { setBackupControlMessage({ type: "error", text: "Select a verified destination copy before running restore verification." }); return; }
    await runBackupControlAction(`/api/backup-control/jobs/${job.job_id}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ copyAttemptId }) }, "Restore verification queued against the selected destination copy.");
  };

  const previewAutomatedRetention = async (destination: BackupControlDestination) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "retention"]);
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch(`/api/backup-control/destinations/${destination.destination_id}/retention/preview`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy: { preset: "7_daily_4_weekly_12_monthly" } }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      const result = (await response.json()) as { plan?: { keep?: unknown[]; delete?: unknown[] } };
      setBackupControlMessage({ type: "success", text: `Retention preview: ${result.plan?.keep?.length || 0} copies retained and ${result.plan?.delete?.length || 0} eligible for safe deletion.` });
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not preview retention." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const executeAutomatedRetention = async (destination: BackupControlDestination) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth || !confirm(`Apply the configured retention policy to ${destination.name}? Only eligible verified RISpro backups may be deleted.`)) return;
    await runBackupControlAction(`/api/backup-control/destinations/${destination.destination_id}/retention/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy: { preset: "7_daily_4_weekly_12_monthly" } }) }, "Retention policy applied.");
  };

  const downloadBackup = async () => {
    if (backupPassphrase.length < 8) {
      setRestoreMessage({ type: "error", text: "Backup passphrase must be at least 8 characters." });
      return;
    }

    setBackupBusy(true);
    setRestoreMessage(null);
    try {
      const response = await fetch("/api/admin/backup", {
        method: "GET",
        credentials: "include",
        headers: { "x-backup-passphrase": backupPassphrase }
      });

      if (!response.ok) {
        if (response.status === 403) {
          onReAuthRequired(["admin", "backup"]);
          throw new Error("Recent supervisor re-authentication is required. Try download again after re-auth.");
        }
        throw new Error(await parseErrorMessage(response));
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] || `rispro-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setRestoreMessage({ type: "success", text: "Backup downloaded. Keep the file and passphrase together in a secure place." });
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "Backup failed." });
    } finally {
      setBackupBusy(false);
    }
  };

  const downloadV3Backup = async () => {
    if (backupV3Passphrase.length < 8) {
      setRestoreMessage({ type: "error", text: "V3 backup passphrase must be at least 8 characters." });
      return;
    }

    setBackupV3Busy(true);
    setRestoreMessage(null);
    try {
      const response = await fetch("/api/admin/backup/v3", {
        method: "GET",
        credentials: "include",
        headers: { "x-backup-passphrase": backupV3Passphrase }
      });

      if (!response.ok) {
        if (response.status === 403) {
          onReAuthRequired(["admin", "backup", "v3"]);
          throw new Error("Recent supervisor re-authentication is required. Try v3 download again after re-auth.");
        }
        throw new Error(await parseErrorMessage(response));
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] || `rispro-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.rispro.zip`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename.endsWith(".rispro.zip") ? filename : `${filename}.rispro.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setRestoreMessage({ type: "success", text: "V3 full app-stack backup downloaded. Keep the archive and passphrase in secure storage." });
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "V3 backup failed." });
    } finally {
      setBackupV3Busy(false);
    }
  };

  const readRestorePayload = async () => {
    if (!restoreFile) {
      throw new Error("Select a backup file first.");
    }
    const content = await restoreFile.text();
    return JSON.parse(content);
  };

  const handlePreview = async () => {
    if (restorePassphrase.length < 8) {
      setRestoreMessage({ type: "error", text: "Restore passphrase must be at least 8 characters." });
      return;
    }

    setPreviewBusy(true);
    setRestoreMessage(null);
    setRestorePreview(null);
    try {
      const backup = await readRestorePayload();
      const response = await fetch("/api/admin/restore/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup, passphrase: restorePassphrase })
      });

      if (!response.ok) {
        if (response.status === 403) {
          onReAuthRequired(["admin", "restore", "preview"]);
          throw new Error("Recent supervisor re-authentication is required. Validate again after re-auth.");
        }
        throw new Error(await parseErrorMessage(response));
      }

      setRestorePreview(await response.json());
      setRestoreMessage({ type: "success", text: "Backup validated. Review the preview before restoring." });
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "Restore preview failed." });
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleV3Preview = async () => {
    if (restoreV3Passphrase.length < 8) {
      setRestoreMessage({ type: "error", text: "Restore passphrase must be at least 8 characters." });
      return;
    }
    if (restoreV3SourceType === "artifact" && !restoreV3ArtifactId) { setRestoreMessage({ type: "error", text: "Select an existing local backup artifact." }); return; }
    if (restoreV3SourceType === "destination_copy" && !restoreV3CopyAttemptId) { setRestoreMessage({ type: "error", text: "Select a verified destination copy." }); return; }
    if (restoreV3SourceType === "upload_session" && !restoreV3File && !restoreV3Upload) { setRestoreMessage({ type: "error", text: "Select a .rispro.zip archive first." }); return; }

    setPreviewV3Busy(true);
    setRestoreMessage(null);
    setRestoreV3Preview(null);
    setRestoreV3Result(null);
    try {
      let upload = restoreV3Upload;
      if (restoreV3SourceType === "upload_session" && (!upload || upload.status !== "completed")) {
        if (!restoreV3File) throw new Error("Select a .rispro.zip archive first.");
        const created = await fetch("/api/admin/restore/v3/upload-sessions", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archiveName: restoreV3File.name, expectedSizeBytes: restoreV3File.size }) });
        if (!created.ok) throw new Error(await parseErrorMessage(created));
        upload = await created.json() as BackupV3UploadSession;
        setRestoreV3Upload(upload);
        const chunkBytes = 4 * 1024 * 1024;
        while (upload.receivedOffset < restoreV3File.size) {
          const chunk = restoreV3File.slice(upload.receivedOffset, Math.min(upload.receivedOffset + chunkBytes, restoreV3File.size));
          const chunkResponse = await fetch(`/api/admin/restore/v3/upload-sessions/${upload.uploadSessionId}/chunks`, { method: "PUT", credentials: "include", headers: { "X-Upload-Offset": String(upload.receivedOffset), "Content-Type": "application/octet-stream" }, body: chunk });
          if (!chunkResponse.ok) throw new Error(await parseErrorMessage(chunkResponse));
          upload = await chunkResponse.json() as BackupV3UploadSession;
          setRestoreV3Upload(upload);
        }
        const completed = await fetch(`/api/admin/restore/v3/upload-sessions/${upload.uploadSessionId}/complete`, { method: "POST", credentials: "include" });
        if (!completed.ok) throw new Error(await parseErrorMessage(completed));
        upload = await completed.json() as BackupV3UploadSession;
        setRestoreV3Upload(upload);
      }
      const source = restoreV3SourceType === "artifact" ? { type: "artifact", artifactId: restoreV3ArtifactId } : restoreV3SourceType === "destination_copy" ? { type: "destination_copy", copyAttemptId: restoreV3CopyAttemptId } : { type: "upload_session", uploadSessionId: upload!.uploadSessionId };
      const response = await fetch("/api/admin/restore/v3/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, passphrase: restoreV3Passphrase })
      });

      if (!response.ok) {
        if (response.status === 403) {
          onReAuthRequired(["admin", "restore", "v3", "preview"]);
          throw new Error("Recent supervisor re-authentication is required. Preview again after re-auth.");
        }
        throw new Error(await parseErrorMessage(response));
      }

      let job = await response.json() as BackupV3PreviewJob;
      setRestoreV3PreviewJob(job);
      for (let attempts = 0; attempts < 180 && (job.status === "queued" || job.status === "running"); attempts += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(`/api/admin/restore/v3/preview/${job.previewJobId}`, { method: "GET", credentials: "include" });
        if (!statusResponse.ok) throw new Error(await parseErrorMessage(statusResponse));
        job = await statusResponse.json() as BackupV3PreviewJob;
        setRestoreV3PreviewJob(job);
      }
      if (!job.manifest || !job.counts) throw new Error(job.failureDiagnostics || "Preview did not complete before polling timed out.");
      const preview: BackupV3Preview = { ok: job.status === "succeeded" && job.errors.length === 0, manifest: job.manifest, counts: job.counts, warnings: job.warnings, errors: job.errors };
      setRestoreV3Preview(preview);
      setRestoreMessage({
        type: preview.ok ? "success" : "error",
        text: preview.ok ? "V3 backup preview completed. Review all counts and warnings before restore." : "V3 backup preview found errors. Restore is blocked."
      });
      await probeV3RestoreAvailability();
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "V3 restore preview failed." });
    } finally {
      setPreviewV3Busy(false);
    }
  };

  const doRestore = async (payload: unknown) => {
    const response = await fetch("/api/admin/restore", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backup: payload,
        passphrase: restorePassphrase,
        confirmation: restoreConfirmation
      })
    });

    if (!response.ok) {
      if (response.status === 403) {
        setPendingPayload(payload);
        onReAuthRequired(["admin", "restore"]);
        throw new Error("REAUTH_REQUIRED");
      }
      throw new Error(await parseErrorMessage(response));
    }

    const result = await response.json();
    setRestoreComplete(true);
    setRestoreMessage({
      type: "success",
      text: `Restore completed successfully. ${result.envVarsRestored || 0} env variables were restored. Restart the RISpro service to apply restored runtime settings.`
    });
    setRestoreFile(null);
    setPendingPayload(null);
    setRestorePreview(null);
  };

  const handleRestore = async () => {
    if (!restorePreview) {
      setRestoreMessage({ type: "error", text: "Validate the backup before restoring." });
      return;
    }
    if (restoreConfirmation !== "RESTORE RISPRO") {
      setRestoreMessage({ type: "error", text: "Type RESTORE RISPRO to confirm this destructive restore." });
      return;
    }

    setRestoreBusy(true);
    setRestoreMessage(null);

    try {
      const payload = await readRestorePayload();
      await doRestore(payload);
    } catch (err) {
      if (err instanceof Error && err.message === "REAUTH_REQUIRED") {
        setRestoreMessage({ type: "error", text: "Re-authentication required. Restore will retry after re-authenticating." });
      } else {
        const message = err instanceof Error ? err.message : "Restore failed.";
        setRestoreMessage({ type: "error", text: message });
      }
    } finally {
      setRestoreBusy(false);
    }
  };

  const startMigrationRehearsal = async () => {
    if (!restoreV3PreviewJob) return;
    try {
      const started = await fetch(`/api/admin/restore/v3/preview/${restoreV3PreviewJob.previewJobId}/migration-rehearsals`, { method: "POST", credentials: "include" });
      if (!started.ok) throw new Error(await parseErrorMessage(started));
      let rehearsal = await started.json(); setMigrationRehearsal(rehearsal);
      for (let attempt = 0; attempt < 60 && ["queued", "running"].includes(rehearsal.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await fetch(`/api/admin/restore/v3/migration-rehearsals/${rehearsal.rehearsal_id}`, { credentials: "include" });
        if (!status.ok) throw new Error(await parseErrorMessage(status)); rehearsal = await status.json(); setMigrationRehearsal(rehearsal);
      }
    } catch (error) { setRestoreMessage({ type: "error", text: error instanceof Error ? error.message : "Migration rehearsal could not start." }); }
  };

  const handleV3Restore = async () => {
    if (!restoreV3Preview) {
      setRestoreMessage({ type: "error", text: "Run v3 restore preview before restoring." });
      return;
    }
    if (v3PreviewHasErrors) {
      setRestoreMessage({ type: "error", text: "Preview errors block v3 restore execution." });
      return;
    }
    if (!canExecuteV3Restore) {
      setRestoreMessage({ type: "error", text: fullRestoreStatus });
      return;
    }
    if (!restoreV3PreviewJob || restoreV3PreviewJob.status !== "succeeded") {
      setRestoreMessage({ type: "error", text: "The successful preview job is no longer available. Preview again before restoring." });
      return;
    }
    if (restoreV3Confirmation !== RESTORE_CONFIRMATION_TEXT) {
      setRestoreMessage({ type: "error", text: "Type RESTORE RISPRO to confirm this destructive restore." });
      return;
    }

    setRestoreV3Busy(true);
    setRestoreMessage(null);
    setRestoreV3Result(null);
    try {
      const response = await fetch("/api/admin/restore/v3", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewJobId: restoreV3PreviewJob.previewJobId, passphrase: restoreV3Passphrase, confirmation: restoreV3Confirmation })
      });

      if (!response.ok) {
        if (response.status === 403) {
          await probeV3RestoreAvailability();
        }
        throw new Error(await parseErrorMessage(response));
      }

      const result = (await response.json()) as BackupV3RestoreResult;
      setRestoreV3Result(result);
      setRestoreMessage({
        type: result.ok && !result.restoreIncomplete ? "success" : "error",
        text: result.ok && !result.restoreIncomplete
          ? "V3 full app-stack restore completed. Restart RISpro before clinical use."
          : "V3 restore finished with a partial failure. Do not retry blindly; review logs and safety backups."
      });
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "V3 restore failed." });
    } finally {
      setRestoreV3Busy(false);
    }
  };

  const handleSystemRestart = async () => {
    if (!confirm("Restart RISpro now? The app may be unavailable for a few seconds while it starts again.")) {
      return;
    }

    setRestartBusy(true);
    setRestoreMessage(null);
    try {
      const response = await fetch("/api/admin/system/restart", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        if (response.status === 403) {
          onReAuthRequired(["admin", "system", "restart"]);
          throw new Error("Recent supervisor re-authentication is required. Click Restart again after re-auth.");
        }
        throw new Error(await parseErrorMessage(response));
      }

      const result = await response.json();
      setRestartRequested(true);
      window.setTimeout(() => { void refreshBackupControl(); }, 5_000);
      setRestoreMessage({
        type: "success",
        text: result.message || "RISpro restart requested. Wait a few seconds, then refresh if needed."
      });
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "Restart request failed." });
    } finally {
      setRestartBusy(false);
    }
  };

  // Auto-retry restore after successful re-auth
  const handleReAuthSuccess = async () => {
    await probeV3RestoreAvailability();
    if (pendingPayload) {
      setRestoreBusy(true);
      setRestoreMessage({ type: "success", text: "Re-authenticated. Retrying restore..." });
      try {
        await doRestore(pendingPayload);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Restore failed.";
        setRestoreMessage({ type: "error", text: message });
      } finally {
        setRestoreBusy(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      <p className="description-center">{t("settings.backupInfo")}</p>

      <section className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900 dark:bg-sky-950/20">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-stone-900 dark:text-white">Automated Backup V3 control center</h4>
            <p className="mt-1 text-xs text-stone-700 dark:text-stone-300">RISpro backup does not include the Orthanc PACS image-storage tank. PACS studies require a separate backup or replication plan.</p>
          </div>
          <button type="button" onClick={() => void refreshBackupControl()} disabled={backupControlBusy} className="btn-secondary text-xs disabled:opacity-50">Refresh</button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Backup health</span><p className={`font-semibold ${backupControlSummary?.health === "critical" ? "text-red-700 dark:text-red-300" : backupControlSummary?.health === "warning" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>{backupControlSummary?.health ? backupControlSummary.health[0].toUpperCase() + backupControlSummary.health.slice(1) : "Not assessed"}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Destinations</span><p className="font-semibold">{backupControlSummary?.enabled_destinations ?? 0} enabled / {backupControlSummary?.destinations ?? 0}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Failed jobs in the last 7 days</span><p className="font-semibold">{backupControlSummary?.recent_failures ?? 0}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Worker heartbeat</span><p className="font-semibold">{backupControlSummary?.worker?.heartbeat_at ? formatDateTimeLy(backupControlSummary.worker.heartbeat_at) : "Not reported"}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Last backup</span><p className="font-semibold">{backupControlSummary?.last_successful_backup?.completed_at ? formatDateTimeLy(backupControlSummary.last_successful_backup.completed_at) : "Never"}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Last verified copy</span><p className="font-semibold">{backupControlSummary?.last_verified_copy?.destination_name || "Never"}</p>{backupControlSummary?.last_verified_copy?.completed_at ? <p className="mt-1 text-stone-500">{formatDateTimeLy(backupControlSummary.last_verified_copy.completed_at)}</p> : null}</div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Last successful restore verification</span><p className="font-semibold">{backupControlSummary?.last_successful_restore_verification?.completed_at ? formatDateTimeLy(backupControlSummary.last_successful_restore_verification.completed_at) : "Never"}</p>{backupControlSummary?.latest_restore_verification_attempt ? <p className="mt-1 text-stone-500">Latest attempt: {backupControlSummary.latest_restore_verification_attempt.status}{backupControlSummary.latest_restore_verification_attempt.completed_at ? ` · ${formatDateTimeLy(backupControlSummary.latest_restore_verification_attempt.completed_at)}` : ""}</p> : null}</div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Next schedule</span><p className="font-semibold">{backupControlSummary?.next_schedule?.next_run_at ? formatDateTimeLy(backupControlSummary.next_schedule.next_run_at) : "Not scheduled"}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Archive limits</span><p className="font-semibold">ZIP64 · 3 GiB content / file · 60,000 files</p></div>
        </div>

        {backupControlSummary?.active_job && <p className="rounded border border-sky-200 bg-sky-100 p-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100">Active backup job: {backupControlSummary.active_job.status}{backupControlSummary.active_job.archive_name ? ` · ${backupControlSummary.active_job.archive_name}` : ""}</p>}
        {backupControlSummary?.overdue_schedules ? <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">{backupControlSummary.overdue_schedules} automatic backup schedule{backupControlSummary.overdue_schedules === 1 ? " is" : "s are"} overdue.</p> : null}
        {backupControlSummary?.health_reasons?.length ? <ul className="list-disc space-y-1 pl-5 text-xs text-stone-700 dark:text-stone-300">{backupControlSummary.health_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
        {backupControlSummary?.staging_free_bytes != null && <p className="text-xs text-stone-600 dark:text-stone-300">Local staging space available: {Math.floor(Number(backupControlSummary.staging_free_bytes) / (1024 * 1024))} MiB.</p>}
        {backupControlSummary?.worker?.last_failure_message && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Worker warning: {backupControlSummary.worker.last_failure_message}</p>}
        {backupControlMessage && <p className={`rounded border p-2 text-xs ${backupControlMessage.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200" : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"}`}>{backupControlMessage.text}</p>}

        {backupControlSummary?.encryption?.setupRequired && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100"><p className="font-semibold">Backup security setup required</p><p className="mt-1 text-xs">RISpro needs a permanent encryption key before it can safely store backup destination passwords and automated backup passphrases.</p>{backupControlSummary.encryption.limitation ? <p className="mt-2 text-xs">{backupControlSummary.encryption.limitation}</p> : isSuperAdmin ? <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => void generateBackupSecurityRecovery()} disabled={backupControlBusy || !user?.recentSupervisorReauth || !backupControlSummary.encryption?.setupAvailable} className="btn-primary text-xs disabled:opacity-50">Generate secure encryption key</button>{backupKeySetupId && <button type="button" onClick={() => void downloadBackupSecurityRecovery()} disabled={backupControlBusy || backupRecoveryDownloaded} className="btn-secondary text-xs disabled:opacity-50">{backupRecoveryDownloaded ? "Recovery copy downloaded" : "Download one-time recovery copy"}</button>}{backupKeySetupId && backupRecoveryDownloaded && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={backupRecoveryConfirmed} onChange={(event) => setBackupRecoveryConfirmed(event.target.checked)} />I saved the recovery copy separately from this server.</label>}{backupKeySetupId && <button type="button" onClick={() => void saveBackupSecuritySetup()} disabled={backupControlBusy || !backupRecoveryDownloaded || !backupRecoveryConfirmed} className="btn-primary text-xs disabled:opacity-50">Save securely</button>}</div> : <p className="mt-2 text-xs">A recently re-authenticated super administrator must complete this setup.</p>}{isSuperAdmin && !user?.recentSupervisorReauth && <p className="mt-2 text-xs">Recent supervisor re-authentication is required before setup can begin.</p>}</div>}
        {(backupControlSummary?.encryption?.state === "recovery_required" || backupControlSummary?.encryption?.state === "invalid_key") && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100"><p className="font-semibold">Backup credential-encryption key recovery required</p><p className="mt-1 text-xs">This installation already contains encrypted backup credentials. Restore the original installation key. Generating a new key will not recover them.</p>{backupControlSummary.encryption.limitation ? <p className="mt-2 text-xs">{backupControlSummary.encryption.limitation}</p> : isSuperAdmin ? <div className="mt-3 flex flex-wrap items-center gap-2"><textarea aria-label="Installation credential-encryption key recovery value" value={backupInstallationRecoveryValue} onChange={(event) => setBackupInstallationRecoveryValue(event.target.value)} placeholder="Paste the original BACKUP_V3_MASTER_KEY recovery value" className="input-premium min-h-16 text-xs" /><button type="button" onClick={() => void recoverBackupInstallationKey()} disabled={backupControlBusy || !user?.recentSupervisorReauth || !backupInstallationRecoveryValue.trim()} className="btn-primary text-xs disabled:opacity-50">Validate and restore key</button></div> : <p className="mt-2 text-xs">A recently re-authenticated super administrator must restore the original key.</p>}</div>}
        {backupControlSummary?.encryption?.restartRequired && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-semibold">Backup security setup saved — restart required</p><p className="mt-1 text-xs">Restart RISpro safely to load the encryption key. This page will show Ready after the restarted service confirms it.</p>{isSuperAdmin && <button type="button" onClick={() => void handleSystemRestart()} disabled={restartBusy || !user?.recentSupervisorReauth} className="btn-primary mt-3 text-xs disabled:opacity-50">{restartBusy ? "Restarting..." : "Restart RISpro safely"}</button>}</div>}
        {backupControlSummary?.encryption?.encryptionReady && <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">Backup credential encryption: Ready</p>}

        <div className="rounded border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-stone-900 dark:text-white">Run Backup V3 now</p><button type="button" onClick={() => void runAutomatedBackupNow()} disabled={backupControlBusy || !selectedBackupDestinationIds.length} className="btn-primary text-xs disabled:opacity-50">{backupControlBusy ? "Working..." : "Run now"}</button></div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {backupDestinations.filter((destination) => destination.enabled).map((destination) => (
              <label key={destination.destination_id} className="flex items-center gap-1 text-xs text-stone-700 dark:text-stone-300">
                <input type="checkbox" checked={selectedBackupDestinationIds.includes(destination.destination_id)} onChange={(event) => setSelectedBackupDestinationIds((current) => event.target.checked ? [...current, destination.destination_id] : current.filter((id) => id !== destination.destination_id))} />
                {destination.name} ({destination.destination_type})
              </label>
            ))}
            {!backupDestinations.some((destination) => destination.enabled) && <span className="text-xs text-stone-500">Create and test an enabled destination first.</span>}
          </div>
        </div>

        <div className="overflow-x-auto rounded border border-stone-200 dark:border-stone-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"><tr><th className="p-2">Destination</th><th className="p-2">Protection</th><th className="p-2">Last test</th><th className="p-2">Action</th></tr></thead>
            <tbody>
              {backupDestinations.map((destination) => <tr key={destination.destination_id} className="border-t border-stone-200 dark:border-stone-700"><td className="p-2"><p className="font-medium">{destination.name}</p><p className="text-stone-500">{destination.destination_type} · {destination.enabled ? "enabled" : "paused"}</p></td><td className="p-2">{destination.credentialsConfigured ? "Credentials configured" : "No credentials"}</td><td className="p-2">{destination.last_connection_status || "Not tested"}{destination.last_failure_message ? <p className="mt-1 text-red-700 dark:text-red-300">{destination.last_failure_message}</p> : null}</td><td className="flex flex-wrap gap-1 p-2"><button type="button" onClick={() => void testAutomatedDestination(destination.destination_id)} disabled={!isSuperAdmin || !user?.recentSupervisorReauth || backupControlBusy || destination.destination_type === "onedrive"} className="btn-secondary text-xs disabled:opacity-50">Test</button>{isSuperAdmin && <><button type="button" onClick={() => editAutomatedDestination(destination)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Edit</button><button type="button" onClick={() => void toggleAutomatedDestination(destination)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">{destination.enabled ? "Pause" : "Resume"}</button><button type="button" onClick={() => void previewAutomatedRetention(destination)} disabled={backupControlBusy || !user?.recentSupervisorReauth || destination.destination_type === "onedrive"} className="btn-secondary text-xs disabled:opacity-50">Retention preview</button><button type="button" onClick={() => void executeAutomatedRetention(destination)} disabled={backupControlBusy || !user?.recentSupervisorReauth || destination.destination_type === "onedrive"} className="btn-secondary text-xs disabled:opacity-50">Apply retention</button><button type="button" onClick={() => void deleteAutomatedDestination(destination)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Remove</button></>}</td></tr>)}
              {!backupDestinations.length && <tr><td colSpan={4} className="p-3 text-stone-500">No automated destinations configured.</td></tr>}
            </tbody>
          </table>
        </div>

        {isSuperAdmin && <details className="rounded border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
          <summary className="cursor-pointer text-xs font-medium text-stone-900 dark:text-white">Protected destination and encryption settings</summary>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input aria-label="Automated destination name" value={destinationForm.name} onChange={(event) => setDestinationForm((current) => ({ ...current, name: event.target.value }))} placeholder="Destination name" className="input-premium text-xs" />
            <select aria-label="Automated destination type" value={destinationForm.type} onChange={(event) => setDestinationForm((current) => ({ ...current, type: event.target.value as BackupControlDestination["destination_type"] }))} className="input-premium text-xs"><option value="local">Local approved path</option><option value="smb">SMB share</option><option value="sftp">SFTP</option><option value="nextcloud">Nextcloud WebDAV</option><option value="onedrive" disabled>OneDrive (not yet available)</option></select>
            {destinationForm.type === "local" && <input aria-label="Automated local root" value={destinationForm.rootPath} onChange={(event) => setDestinationForm((current) => ({ ...current, rootPath: event.target.value }))} placeholder="Approved local backup root" className="input-premium text-xs sm:col-span-2" />}
            {destinationForm.type === "nextcloud" && <><input aria-label="Nextcloud base URL" value={destinationForm.baseUrl} onChange={(event) => setDestinationForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://cloud.example" className="input-premium text-xs" /><input aria-label="Nextcloud username" value={destinationForm.username} onChange={(event) => setDestinationForm((current) => ({ ...current, username: event.target.value }))} placeholder="Nextcloud username" className="input-premium text-xs" /><input aria-label="Nextcloud remote path" value={destinationForm.remotePath} onChange={(event) => setDestinationForm((current) => ({ ...current, remotePath: event.target.value }))} placeholder="/RISpro-backups" className="input-premium text-xs" /><input aria-label="Nextcloud app password" type="password" value={destinationForm.appPassword} onChange={(event) => setDestinationForm((current) => ({ ...current, appPassword: event.target.value }))} placeholder="App password" className="input-premium text-xs" /></>}
            {destinationForm.type === "sftp" && <><input aria-label="SFTP host" value={destinationForm.host} onChange={(event) => setDestinationForm((current) => ({ ...current, host: event.target.value }))} placeholder="SFTP host" className="input-premium text-xs" /><input aria-label="SFTP port" value={destinationForm.port} onChange={(event) => setDestinationForm((current) => ({ ...current, port: event.target.value }))} placeholder="22" className="input-premium text-xs" /><input aria-label="SFTP username" value={destinationForm.username} onChange={(event) => setDestinationForm((current) => ({ ...current, username: event.target.value }))} placeholder="SFTP username" className="input-premium text-xs" /><input aria-label="SFTP remote path" value={destinationForm.remotePath} onChange={(event) => setDestinationForm((current) => ({ ...current, remotePath: event.target.value }))} placeholder="/backups" className="input-premium text-xs" /><input aria-label="SFTP SHA256 host fingerprint" value={destinationForm.hostFingerprint} onChange={(event) => setDestinationForm((current) => ({ ...current, hostFingerprint: event.target.value }))} placeholder="SHA256 host fingerprint" className="input-premium text-xs" /><input aria-label="SFTP password" type="password" value={destinationForm.password} onChange={(event) => setDestinationForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password (or private key below)" className="input-premium text-xs" /><textarea aria-label="SFTP private key" value={destinationForm.privateKey} onChange={(event) => setDestinationForm((current) => ({ ...current, privateKey: event.target.value }))} placeholder="Private key (optional; never shown after save)" className="input-premium min-h-16 text-xs sm:col-span-2" /></>}
            {destinationForm.type === "smb" && <><input aria-label="SMB server" value={destinationForm.server} onChange={(event) => setDestinationForm((current) => ({ ...current, server: event.target.value }))} placeholder="SMB server" className="input-premium text-xs" /><input aria-label="SMB share" value={destinationForm.share} onChange={(event) => setDestinationForm((current) => ({ ...current, share: event.target.value }))} placeholder="Share" className="input-premium text-xs" /><input aria-label="SMB subfolder" value={destinationForm.subfolder} onChange={(event) => setDestinationForm((current) => ({ ...current, subfolder: event.target.value }))} placeholder="Subfolder" className="input-premium text-xs" /><input aria-label="SMB domain" value={destinationForm.domain} onChange={(event) => setDestinationForm((current) => ({ ...current, domain: event.target.value }))} placeholder="Domain (optional)" className="input-premium text-xs" /><input aria-label="SMB username" value={destinationForm.username} onChange={(event) => setDestinationForm((current) => ({ ...current, username: event.target.value }))} placeholder="Username" className="input-premium text-xs" /><input aria-label="SMB password" type="password" value={destinationForm.password} onChange={(event) => setDestinationForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password" className="input-premium text-xs" /></>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => void createAutomatedDestination()} disabled={backupControlBusy || !backupControlSummary?.encryption?.encryptionReady || !user?.recentSupervisorReauth || destinationForm.type === "onedrive"} className="btn-primary text-xs disabled:opacity-50">{editingDestinationId ? "Update destination" : "Save destination"}</button>{editingDestinationId && <button type="button" onClick={() => { setEditingDestinationId(null); setDestinationForm({ name: "", type: "local", rootPath: "", baseUrl: "", username: "", remotePath: "", host: "", port: "22", hostFingerprint: "", server: "", share: "", subfolder: "", domain: "", password: "", appPassword: "", privateKey: "" }); }} className="btn-secondary text-xs">Cancel edit</button>}<input aria-label="Automated archive passphrase" type="password" value={automatedPassphrase} onChange={(event) => setAutomatedPassphrase(event.target.value)} placeholder="Automated archive passphrase" className="input-premium text-xs" /><button type="button" onClick={() => void saveAutomatedPassphrase()} disabled={backupControlBusy || !backupControlSummary?.encryption?.encryptionReady || automatedPassphrase.length < 8 || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Store encrypted passphrase</button></div>
          <p className="mt-3 text-xs text-stone-600 dark:text-stone-300">OneDrive is deliberately isolated as the final destination milestone. It will require a Microsoft Entra app registration and delegated Files.ReadWrite.AppFolder consent; RISpro will provide the browser authorization flow and never ask for a Microsoft password. Local, SMB, SFTP, and Nextcloud do not require this portal step.</p>
          {!user?.recentSupervisorReauth && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Recent supervisor re-authentication is required before these settings can be saved or tested.</p>}
        </details>}

        <details className="rounded border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
          <summary className="cursor-pointer text-xs font-medium text-stone-900 dark:text-white">Schedules, retention, and isolated restore verification</summary>
          <p className="mt-2 text-xs text-stone-600 dark:text-stone-300">Schedules use Africa/Tripoli time, retain 7 daily / 4 weekly / 12 monthly copies by default, and queue a weekly disposable restore verification after successful scheduled archives.</p>
          {isSuperAdmin && <div className="mt-3 flex flex-wrap gap-2"><input aria-label="Automated schedule name" value={scheduleForm.name} onChange={(event) => setScheduleForm((current) => ({ ...current, name: event.target.value }))} placeholder="Schedule name" className="input-premium text-xs" /><select aria-label="Automated schedule frequency" value={scheduleForm.frequency} onChange={(event) => setScheduleForm((current) => ({ ...current, frequency: event.target.value as BackupControlSchedule["frequency"] }))} className="input-premium text-xs"><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>{scheduleForm.frequency === "weekly" && <select aria-label="Automated schedule weekday" value={scheduleForm.weekday} onChange={(event) => setScheduleForm((current) => ({ ...current, weekday: event.target.value }))} className="input-premium text-xs"><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select>}{scheduleForm.frequency === "monthly" && <input aria-label="Automated schedule day of month" type="number" min="1" max="31" value={scheduleForm.dayOfMonth} onChange={(event) => setScheduleForm((current) => ({ ...current, dayOfMonth: event.target.value }))} className="input-premium w-20 text-xs" />}<input aria-label="Automated schedule time" type="time" value={scheduleForm.timeOfDay} onChange={(event) => setScheduleForm((current) => ({ ...current, timeOfDay: event.target.value }))} className="input-premium text-xs" /><select aria-label="Automated retention policy" value={scheduleForm.retentionPreset} onChange={(event) => setScheduleForm((current) => ({ ...current, retentionPreset: event.target.value }))} className="input-premium text-xs"><option value="7_daily_4_weekly_12_monthly">7 daily / 4 weekly / 12 monthly</option><option value="14_daily_12_monthly">14 daily / 12 monthly</option><option value="30_daily">30 daily</option><option value="custom">Custom retention</option></select>{scheduleForm.retentionPreset === "custom" && <><input aria-label="Custom daily retention" type="number" min="0" max="3650" value={scheduleForm.retentionDaily} onChange={(event) => setScheduleForm((current) => ({ ...current, retentionDaily: event.target.value }))} placeholder="Daily" className="input-premium w-20 text-xs" /><input aria-label="Custom weekly retention" type="number" min="0" max="3650" value={scheduleForm.retentionWeekly} onChange={(event) => setScheduleForm((current) => ({ ...current, retentionWeekly: event.target.value }))} placeholder="Weekly" className="input-premium w-20 text-xs" /><input aria-label="Custom monthly retention" type="number" min="0" max="3650" value={scheduleForm.retentionMonthly} onChange={(event) => setScheduleForm((current) => ({ ...current, retentionMonthly: event.target.value }))} placeholder="Monthly" className="input-premium w-20 text-xs" /></>}<select aria-label="Automated restore verification frequency" value={scheduleForm.restoreVerificationFrequency} onChange={(event) => setScheduleForm((current) => ({ ...current, restoreVerificationFrequency: event.target.value as BackupControlSchedule["restore_verification_frequency"] }))} className="input-premium text-xs"><option value="weekly">Verify weekly</option><option value="monthly">Verify monthly</option><option value="disabled">Verification disabled</option></select><button type="button" onClick={() => void createAutomatedSchedule()} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-primary text-xs disabled:opacity-50">{editingScheduleId ? "Update schedule" : "Save schedule for selected destinations"}</button>{editingScheduleId && <button type="button" onClick={() => { setEditingScheduleId(null); setScheduleForm({ name: "", frequency: "daily", timeOfDay: "02:00", weekday: "1", dayOfMonth: "1", retentionPreset: "7_daily_4_weekly_12_monthly", retentionDaily: "7", retentionWeekly: "4", retentionMonthly: "12", restoreVerificationFrequency: "weekly" }); }} className="btn-secondary text-xs">Cancel edit</button>}</div>}
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-stone-500"><tr><th className="p-1">Schedule</th><th className="p-1">Next run</th><th className="p-1">Destinations</th><th className="p-1">State</th></tr></thead><tbody>{backupSchedules.map((schedule) => <tr key={schedule.schedule_id} className="border-t border-stone-200 dark:border-stone-700"><td className="p-1">{schedule.name}<p className="text-stone-500">{schedule.frequency} · {schedule.time_of_day} {schedule.timezone}</p></td><td className="p-1">{schedule.next_run_at ? formatDateTimeLy(schedule.next_run_at) : "Paused"}</td><td className="p-1">{schedule.destination_ids.length}</td><td className="flex flex-wrap gap-1 p-1">{isSuperAdmin ? <><button type="button" onClick={() => editAutomatedSchedule(schedule)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Edit</button><button type="button" onClick={() => void toggleAutomatedSchedule(schedule)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">{schedule.enabled ? "Pause" : "Resume"}</button><button type="button" onClick={() => void deleteAutomatedSchedule(schedule)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Delete</button></> : (schedule.enabled ? "Enabled" : "Paused")}</td></tr>)}{!backupSchedules.length && <tr><td colSpan={4} className="p-2 text-stone-500">No schedules configured.</td></tr>}</tbody></table></div>
        </details>

        <div className="overflow-x-auto rounded border border-stone-200 dark:border-stone-700"><table className="w-full text-left text-xs"><thead className="bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"><tr><th className="p-2">Recent job</th><th className="p-2">Status</th><th className="p-2">Archive</th><th className="p-2">Destination copies</th><th className="p-2">Completed</th><th className="p-2">Actions</th></tr></thead><tbody>{backupJobs.slice(0, 8).map((job) => <tr key={job.job_id} className="border-t border-stone-200 dark:border-stone-700"><td className="p-2">{formatDateTimeLy(job.created_at)}{job.source_schedule_id ? <p className="text-stone-500">Scheduled</p> : <p className="text-stone-500">Manual</p>}</td><td className="p-2">{job.status}{job.failure_message ? <p className="mt-1 text-red-700 dark:text-red-300">{job.failure_message}</p> : null}</td><td className="p-2">{job.archive_name || "-"}</td><td className="p-2">{job.destination_copies?.length ? job.destination_copies.map((copy) => <p key={copy.destinationId} className={copy.status === "failed" ? "text-red-700 dark:text-red-300" : ""}>{backupDestinations.find((destination) => destination.destination_id === copy.destinationId)?.name || copy.destinationId.slice(0, 8)}: {copy.status}{copy.failureMessage ? ` · ${copy.failureMessage}` : ""}</p>) : "No copy attempts yet"}</td><td className="p-2">{job.completed_at ? formatDateTimeLy(job.completed_at) : "-"}</td><td className="flex flex-wrap gap-1 p-2">{job.archive_name && <a href={`/api/backup-control/jobs/${job.job_id}/download`} className="btn-secondary text-xs">Download</a>}{(job.status === "failed" || job.status === "cancelled") && job.archive_name && <button type="button" onClick={() => void retryAutomatedJob(job)} disabled={backupControlBusy} className="btn-secondary text-xs disabled:opacity-50">Retry destination copy</button>}{job.status === "queued" && <button type="button" onClick={() => void cancelAutomatedJob(job)} disabled={backupControlBusy} className="btn-secondary text-xs disabled:opacity-50">Cancel</button>}{job.status === "completed" && isSuperAdmin && <button type="button" onClick={() => void queueManualRestoreVerification(job)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Run restore verification</button>}</td></tr>)}{!backupJobs.length && <tr><td colSpan={6} className="p-3 text-stone-500">No automated backup jobs yet.</td></tr>}</tbody></table></div>
        {backupJobs.filter((job) => job.status === "completed").slice(0, 4).map((job) => <div key={`verify-${job.job_id}`} className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span>Verify copy:</span><select aria-label={`Restore verification copy for ${job.job_id}`} value={verificationCopyIds[job.job_id] || job.destination_copies?.find((copy) => copy.status === "verified")?.copyAttemptId || ""} onChange={(event) => setVerificationCopyIds((current) => ({ ...current, [job.job_id]: event.target.value }))} className="input-premium text-xs"><option value="">Select verified copy</option>{job.destination_copies?.filter((copy) => copy.status === "verified" && copy.copyAttemptId).map((copy) => <option key={copy.copyAttemptId} value={copy.copyAttemptId}>{backupDestinations.find((destination) => destination.destination_id === copy.destinationId)?.name || copy.destinationId.slice(0, 8)} · {copy.remotePath || "copy"}</option>)}</select>{isSuperAdmin && <button type="button" onClick={() => void queueManualRestoreVerification(job)} className="btn-secondary text-xs">Run selected verification</button>}</div>)}
        {backupRestoreVerifications.length > 0 && <div className="mt-2 space-y-1 text-xs text-stone-600 dark:text-stone-300">{backupRestoreVerifications.slice(0, 4).map((verification) => <p key={verification.restore_verification_job_id}>Restore verification: <span className="font-medium">{verification.status}</span> · {verification.destination_name || verification.destination_type || "destination"}{verification.remote_path ? ` · ${verification.remote_path}` : ""}{verification.retrieval?.fallbackToLocal ? " · scheduled local fallback" : ""}{verification.retrieval?.retrievedSha256 ? ` · checksum ${verification.retrieval.retrievedSha256.slice(0, 12)}…` : ""}{verification.retrieval?.retrievedByteSize != null ? ` · ${verification.retrieval.retrievedByteSize} bytes` : ""}{verification.retrieval?.cleanupStatus ? ` · cleanup ${verification.retrieval.cleanupStatus}` : ""}{verification.retrieval?.restoreDrillStatus ? ` · restore drill ${verification.retrieval.restoreDrillStatus}` : ""}{verification.failure_message ? ` · ${verification.failure_message}` : ""}</p>)}</div>}
      </section>

      {restoreMessage && (
        <div className={`p-3 rounded-lg border text-sm ${
          restoreMessage.type === "success"
            ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400"
        }`}>
          {restoreMessage.text}
        </div>
      )}

      {restoreComplete && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          <p className="font-semibold">Restore completed successfully.</p>
          <p className="mt-1">Patients, appointments, documents, settings, and encrypted runtime variables were restored. Restart RISpro to apply restored environment variables.</p>
          <button
            type="button"
            onClick={handleSystemRestart}
            disabled={restartBusy || restartRequested}
            className="btn-primary text-sm mt-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {restartRequested ? "Restart requested" : restartBusy ? "Requesting restart..." : "Restart RISpro safely"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {/* Download backup */}
        <div>
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">V3 full app-stack backup</h4>
          <p className="mb-3 text-xs text-stone-600 dark:text-stone-300">
            Downloads a ZIP64 <strong>.rispro.zip</strong> archive containing the database, app-owned storage, selected document files, and passphrase-protected managed configuration. Other archive entries are not currently encrypted.
          </p>
          <div className="mb-3">
            <div className="h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${exportV3Progress}%` }}
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              aria-label="V3 backup passphrase"
              type="password"
              value={backupV3Passphrase}
              onChange={(event) => setBackupV3Passphrase(event.target.value)}
              placeholder="V3 backup passphrase"
              className="input-premium text-sm flex-1"
              disabled={backupV3Busy}
            />
            <button
              type="button"
              onClick={downloadV3Backup}
              disabled={backupV3Busy || backupV3Passphrase.length < 8}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {backupV3Busy ? "Preparing..." : "Download v3 full app-stack backup"}
            </button>
          </div>
        </div>

        {showDeprecatedV2Controls && <div>
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">Legacy v2 JSON backup</h4>
          <div className="mb-3">
            <div className="h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
              <span>Passphrase</span>
              <span>{backupBusy ? "Preparing backup" : "Download"}</span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              value={backupPassphrase}
              onChange={(event) => setBackupPassphrase(event.target.value)}
              placeholder="Legacy v2 backup passphrase"
              className="input-premium text-sm flex-1"
              disabled={backupBusy}
            />
            <button
              type="button"
              onClick={downloadBackup}
              disabled={backupBusy || backupPassphrase.length < 8}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {backupBusy ? "Preparing..." : "Download legacy v2 backup"}
            </button>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
            Existing v2 JSON backup remains available for compatibility. Prefer v3 for full app-stack coverage.
          </p>
        </div>}

        <hr className="border-stone-200 dark:border-stone-700" />

        {/* Restore from backup */}
        <div>
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">V3 restore preview and gated execution</h4>
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <p className="font-semibold">Destructive restore warning</p>
            <p className="mt-1">This replaces the database, mirrors app-owned storage and removes extra local files under app-owned roots, restores selected external documents, updates RISpro-managed .env keys, creates safety backups first, and requires restart. Do not run during active clinical workflow.</p>
          </div>
          <div className={`mb-3 rounded-lg border p-3 text-xs ${
            canExecuteV3Restore
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200"
              : "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
          }`}>
            {fullRestoreStatus}
          </div>
          <div className="space-y-3 rounded-lg border border-stone-200 dark:border-stone-700 p-3">
            <select aria-label="V3 restore source" value={restoreV3SourceType} onChange={(event) => { setRestoreV3SourceType(event.target.value as typeof restoreV3SourceType); setRestoreV3Preview(null); setRestoreV3PreviewJob(null); setRestoreV3Result(null); setRestoreV3Confirmation(""); }} className="input-premium text-sm" disabled={restoreV3Busy || previewV3Busy}>
              <option value="upload_session">External archive upload</option>
              <option value="artifact">Existing local Backup V3 artifact</option>
              <option value="destination_copy">Verified destination copy</option>
            </select>
            {restoreV3SourceType === "artifact" && <select aria-label="Existing Backup V3 artifact" value={restoreV3ArtifactId} onChange={(event) => setRestoreV3ArtifactId(event.target.value)} className="input-premium text-sm"><option value="">Select completed local artifact</option>{backupJobs.filter((job) => job.status === "completed" && job.artifact_id).map((job) => <option key={job.artifact_id} value={job.artifact_id || ""}>{job.archive_name || job.job_id}</option>)}</select>}
            {restoreV3SourceType === "destination_copy" && <select aria-label="Verified Backup V3 destination copy" value={restoreV3CopyAttemptId} onChange={(event) => setRestoreV3CopyAttemptId(event.target.value)} className="input-premium text-sm"><option value="">Select verified destination copy</option>{backupJobs.flatMap((job) => (job.destination_copies || []).filter((copy) => copy.status === "verified" && copy.copyAttemptId).map((copy) => <option key={copy.copyAttemptId} value={copy.copyAttemptId}>{job.archive_name || job.job_id} · {copy.remotePath || copy.copyAttemptId}</option>))}</select>}
            {restoreV3SourceType === "upload_session" && <input
              aria-label="V3 restore archive"
              type="file"
              accept=".rispro.zip,application/zip"
              onChange={(e) => {
                setRestoreV3File(e.target.files?.[0] || null);
                setRestoreV3Upload(null);
                setRestoreV3Preview(null);
                setRestoreV3PreviewJob(null);
                setRestoreV3Result(null);
                setRestoreV3Confirmation("");
              }}
              className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-stone-100 dark:file:bg-stone-700 file:text-stone-700 dark:file:text-stone-300"
              disabled={restoreV3Busy || previewV3Busy}
            />}
            {restoreV3Upload && <p className="text-xs text-stone-600 dark:text-stone-300">External upload: {restoreV3Upload.status} · {restoreV3Upload.receivedOffset.toLocaleString()} / {restoreV3Upload.expectedSizeBytes.toLocaleString()} bytes{restoreV3Upload.failureMessage ? ` · ${restoreV3Upload.failureMessage}` : ""}</p>}
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                aria-label="V3 restore passphrase"
                type="password"
                value={restoreV3Passphrase}
                onChange={(event) => {
                  setRestoreV3Passphrase(event.target.value);
                  setRestoreV3Preview(null);
                  setRestoreV3Result(null);
                  setRestoreV3Confirmation("");
                }}
                placeholder="V3 backup passphrase"
                className="input-premium text-sm flex-1"
                disabled={restoreV3Busy || previewV3Busy}
              />
              <button
                type="button"
                onClick={handleV3Preview}
                disabled={previewV3Busy || restoreV3Busy || !restoreV3File || restoreV3Passphrase.length < 8}
                className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {previewV3Busy ? "Previewing..." : "Preview v3 restore"}
              </button>
            </div>

            {restoreV3PreviewJob && (restoreV3PreviewJob.status === "queued" || restoreV3PreviewJob.status === "running") && <p className="text-xs text-stone-600 dark:text-stone-300">Preview job {restoreV3PreviewJob.status}: {restoreV3PreviewJob.progress}%</p>}
            {restoreV3PreviewJob?.compatibilityClassification && <div className="rounded border p-2 text-xs"><p>Compatibility: <strong>{restoreV3PreviewJob.compatibilityClassification}</strong> — {restoreV3PreviewJob.compatibilityMessage}</p>{restoreV3PreviewJob.compatibilityClassification === "older_supported" && <button type="button" className="btn-secondary mt-2 text-xs" onClick={() => void startMigrationRehearsal()}>Run isolated migration rehearsal</button>}</div>}
            {migrationRehearsal && <div className="rounded border p-2 text-xs">Migration rehearsal: {migrationRehearsal.status} · {migrationRehearsal.progress}% · {migrationRehearsal.promotion_ready ? "promotion-ready (not restored to production)" : "not promotion-ready"}{migrationRehearsal.errors?.length ? <p className="text-red-700">{migrationRehearsal.errors.join("; ")}</p> : null}</div>}

            {restoreV3Preview && (
              <div className="space-y-3 rounded-lg border border-stone-200 dark:border-stone-700 p-3 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div><p className="text-xs text-stone-500">Format</p><p className="font-medium">v{restoreV3Preview.manifest.formatVersion}</p></div>
                  <div><p className="text-xs text-stone-500">Created</p><p className="font-medium">{formatDateTimeLy(restoreV3Preview.manifest.createdAt)}</p></div>
                  <div><p className="text-xs text-stone-500">App</p><p className="font-medium">{restoreV3Preview.manifest.appName} {restoreV3Preview.manifest.packageVersion || ""}</p></div>
                  <div><p className="text-xs text-stone-500">Git</p><p className="font-medium">{restoreV3Preview.manifest.gitCommit || "not recorded"}</p></div>
                  <div><p className="text-xs text-stone-500">Migration</p><p className="font-medium">{restoreV3Preview.manifest.migrationVersion || "not recorded"}</p></div>
                  <div><p className="text-xs text-stone-500">Tables / rows</p><p className="font-medium">{restoreV3Preview.counts.tables} / {restoreV3Preview.counts.rows}</p></div>
                  <div><p className="text-xs text-stone-500">Archive entries</p><p className="font-medium">{restoreV3Preview.counts.archiveEntries}</p></div>
                  <div><p className="text-xs text-stone-500">Storage and document files</p><p className="font-medium">{restoreV3Preview.counts.storageFiles}</p></div>
                  <div><p className="text-xs text-stone-500">RISpro config vars</p><p className="font-medium">{restoreV3Preview.counts.envVars} names, values hidden</p></div>
                </div>
                {restoreV3Preview.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    <p className="font-semibold">Warnings</p>
                    <ul className="list-disc pl-5">{restoreV3Preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </div>
                )}
                {restoreV3Preview.errors.length > 0 && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                    <p className="font-semibold">Errors block restore</p>
                    <ul className="list-disc pl-5">{restoreV3Preview.errors.map((error) => <li key={error}>{error}</li>)}</ul>
                  </div>
                )}
                <p className="text-xs text-stone-500 dark:text-stone-400">Secret config values are never displayed. Current preview API returns env variable counts only, not names.</p>

                {canExecuteV3Restore && !v3PreviewHasErrors ? (
                  <div className="space-y-2">
                    <input
                      aria-label="V3 restore confirmation"
                      value={restoreV3Confirmation}
                      onChange={(event) => setRestoreV3Confirmation(event.target.value)}
                      placeholder="Type RESTORE RISPRO"
                      className="input-premium text-sm w-full"
                      disabled={restoreV3Busy}
                    />
                    <button
                      type="button"
                      onClick={handleV3Restore}
                      disabled={restoreV3Busy || restoreV3Confirmation !== RESTORE_CONFIRMATION_TEXT}
                      className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {restoreV3Busy ? "Restoring..." : "Execute v3 full restore"}
                    </button>
                  </div>
                ) : (
                  <p className="rounded-md border border-stone-200 bg-stone-50 p-2 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                    Restore execution is unavailable until backend full restore is enabled, the user is super_admin, recent reauth is satisfied, and preview has no errors.
                  </p>
                )}
              </div>
            )}

            {restoreV3Result && (
              <div className={`rounded-lg border p-3 text-sm ${
                restoreV3Result.ok && !restoreV3Result.restoreIncomplete
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200"
                  : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"
              }`}>
                <p className="font-semibold">{restoreV3Result.ok && !restoreV3Result.restoreIncomplete ? "V3 restore completed" : "V3 restore partial failure"}</p>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <span>DB: {String(restoreV3Result.dbRestored)}</span>
                  <span>Storage: {String(restoreV3Result.storageRestored)}</span>
                  <span>External docs: {String(restoreV3Result.externalDocumentsRestored)}</span>
                  <span>Env: {String(restoreV3Result.envRestored)}</span>
                  <span>Incomplete: {String(restoreV3Result.restoreIncomplete)}</span>
                  <span>Restart required: {String(restoreV3Result.restartRequired)}</span>
                </div>
                {restoreV3Result.restartRequired && <p className="mt-2 font-semibold">Restart required. Do not auto-restart from this screen.</p>}
                {restoreV3Result.partialFailure && (
                  <p className="mt-2">Partial failure in {restoreV3Result.partialFailure.component || "restore"}: {restoreV3Result.partialFailure.message || "Review server logs."} Do not retry blindly; review logs and safety backups.</p>
                )}
                {restoreV3Result.safetyBackupsCreated && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-white/70 p-2 text-xs dark:bg-black/20">
                    {safeDisplayValue(restoreV3Result.safetyBackupsCreated)}
                  </pre>
                )}
                {restoreV3Result.restoredCounts && <p className="mt-2 text-xs">Restored counts: {safeDisplayValue(restoreV3Result.restoredCounts)}</p>}
                {(restoreV3Result.warnings || []).length > 0 && <p className="mt-2 text-xs">Warnings: {restoreV3Result.warnings!.join(" ")}</p>}
              </div>
            )}
          </div>

          {showDeprecatedV2Controls && <>
          <hr className="my-4 border-stone-200 dark:border-stone-700" />
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">Legacy v2 JSON restore</h4>
          <div className="space-y-3">
            <input
              aria-label="Legacy v2 restore file"
              type="file"
              accept=".json"
              onChange={(e) => {
                setRestoreFile(e.target.files?.[0] || null);
                setRestorePreview(null);
                setRestoreConfirmation("");
                setRestoreComplete(false);
              }}
              className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-stone-100 dark:file:bg-stone-700 file:text-stone-700 dark:file:text-stone-300 file:hover:bg-stone-200 dark:file:hover:bg-stone-600 file:cursor-pointer file:transition-colors"
              disabled={restoreBusy || previewBusy}
            />
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                aria-label="Legacy v2 restore passphrase"
                type="password"
                value={restorePassphrase}
                onChange={(event) => {
                  setRestorePassphrase(event.target.value);
                  setRestorePreview(null);
                  setRestoreConfirmation("");
                  setRestoreComplete(false);
                }}
                placeholder="Backup passphrase"
                className="input-premium text-sm flex-1"
                disabled={restoreBusy || previewBusy}
              />
              <button
                type="button"
                onClick={handlePreview}
                disabled={previewBusy || restoreBusy || !restoreFile || restorePassphrase.length < 8}
                className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {previewBusy ? "Validating..." : "Validate backup"}
              </button>
            </div>

            <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-3">
              <div className="h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${restoreProgress}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-6 gap-2">
                {restoreSteps.map((step, index) => (
                  <div
                    key={step.label}
                    className={`rounded-md border px-2 py-2 text-xs ${
                      step.done
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
                        : step.active
                          ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                          : "border-stone-200 bg-white text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
                    }`}
                  >
                    <span className="font-semibold">{index + 1}. </span>
                    {step.label}
                  </div>
                ))}
              </div>
            </div>

            {restorePreview && (
              <div className="space-y-3 rounded-lg border border-stone-200 dark:border-stone-700 p-3 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-stone-500 dark:text-stone-400">Created</p>
                    <p className="font-medium text-stone-900 dark:text-white">{formatDateTimeLy(restorePreview.manifest.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 dark:text-stone-400">Tables</p>
                    <p className="font-medium text-stone-900 dark:text-white">{restorePreview.tables.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 dark:text-stone-400">Document files</p>
                    <p className="font-medium text-stone-900 dark:text-white">
                      {restorePreview.documents.filesIncluded} included, {restorePreview.documents.filesMissing} missing
                    </p>
                  </div>
                </div>

                {restorePreview.warnings.length > 0 && (
                  <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2 text-amber-700 dark:text-amber-300">
                    {restorePreview.warnings.join(" ")}
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium text-stone-600 dark:text-stone-300 mb-2">Runtime variables restored after review</p>
                  <div className="max-h-44 overflow-auto rounded border border-stone-200 dark:border-stone-700">
                    <table className="min-w-full text-xs">
                      <tbody>
                        {restorePreview.env.map((item) => (
                          <tr key={item.name} className="border-b border-stone-100 dark:border-stone-800 last:border-0">
                            <td className="px-2 py-1 font-mono text-stone-700 dark:text-stone-200">{item.name}</td>
                            <td className="px-2 py-1 font-mono text-stone-500 dark:text-stone-400">{item.value}</td>
                            <td className="px-2 py-1 text-stone-500 dark:text-stone-400">
                              {item.requiresReview ? "Review" : item.isSecret ? "Secret" : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <input
                  value={restoreConfirmation}
                  onChange={(event) => setRestoreConfirmation(event.target.value)}
                  placeholder="Type RESTORE RISPRO"
                  className="input-premium text-sm w-full"
                  disabled={restoreBusy}
                />
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={restoreBusy || restoreConfirmation !== "RESTORE RISPRO"}
                  className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {restoreBusy ? "Restoring..." : "Restore full system"}
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
            Restoring deletes current data and replaces database rows, documents, and .env variables from the backup. Restart RISpro after restore.
          </p>
          </>}
        </div>
      </div>
    </div>
  );
  });
