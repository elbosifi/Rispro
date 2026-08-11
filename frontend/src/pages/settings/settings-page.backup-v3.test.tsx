import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackupRestoreSection } from "./settings-page";

const useAuthMock = vi.fn();

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const okPreview = {
  ok: true,
  manifest: {
    formatVersion: 3,
    createdAt: "2026-05-27T12:00:00.000Z",
    appName: "rispro-reception",
    packageVersion: "0.1.0",
    gitCommit: "abc123",
    migrationVersion: "085_orthanc_mwl_queue_gate.sql",
  },
  counts: { tables: 80, rows: 189, archiveEntries: 85, storageFiles: 3, envVars: 57 },
  warnings: [],
  errors: [],
};

const completedUpload = { uploadSessionId: "upload-1", status: "completed", receivedOffset: 3, expectedSizeBytes: 3, expiresAt: "2026-07-20T12:00:00.000Z" };
function previewJob(preview: { ok: boolean; manifest: typeof okPreview.manifest; counts: typeof okPreview.counts; warnings: string[]; errors: string[] } = okPreview) {
  return { previewJobId: "preview-1", status: preview.ok ? "succeeded" : "failed", progress: 100, manifest: preview.manifest, counts: preview.counts, warnings: preview.warnings, errors: preview.errors, failureDiagnostics: preview.ok ? null : preview.errors.join("; ") };
}

const enabledStatus = {
  enabled: true,
  dbOnlyEnabled: false,
  requiresSuperAdmin: true,
  userCanExecute: true,
  recentReauthRequired: true,
  recentReauthSatisfied: true,
  confirmationText: "RESTORE RISPRO",
  acceptedArchiveExtensions: [".rispro.zip"],
};

const disabledStatus = {
  ...enabledStatus,
  enabled: false,
  disabledReason: "V3 full restore is disabled by backend configuration.",
};

const disabledFlag = {
  enabledInEnvFile: false,
  enabledInRuntime: false,
  restartRequired: false,
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function renderSection() {
  return render(<BackupRestoreSection onReAuthRequired={vi.fn()} />);
}

async function uploadV3AndPreview() {
  const file = new File(["zip"], "backup.rispro.zip", { type: "application/zip" });
  await userEvent.upload(screen.getByLabelText("V3 restore archive"), file);
  await userEvent.type(screen.getByLabelText("V3 restore passphrase"), "valid-passphrase");
  await userEvent.click(screen.getByRole("button", { name: /preview v3 restore/i }));
}

describe("BackupRestoreSection v3 UI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthMock.mockReturnValue({
      user: { id: 2, username: "superadmin", fullName: "Super Admin", role: "super_admin", recentSupervisorReauth: true },
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:backup"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("downloads a v3 full app-stack backup without rendering legacy v2 controls", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/backup/v3") {
        return new Response(new Blob(["zip"]), {
          status: 200,
          headers: { "Content-Disposition": 'attachment; filename="backup.rispro.zip"' },
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();
    await userEvent.type(screen.getByLabelText("V3 backup passphrase"), "valid-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /download v3 full app-stack backup/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/backup/v3", expect.any(Object)));

    expect(screen.queryByText(/Legacy v2 JSON backup/i)).toBeNull();
    expect(screen.queryByText(/Legacy v2 JSON restore/i)).toBeNull();
  });

  it("requires preview before restore execution and blocks preview errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/upload-sessions") return jsonResponse(completedUpload, 201);
      if (url.includes("/chunks") || url.endsWith("/complete")) return jsonResponse(completedUpload);
      if (url === "/api/admin/restore/v3/preview") return jsonResponse(previewJob({ ...okPreview, ok: false, errors: ["Schema mismatch"] }), 202);
      return jsonResponse({}, 404);
    }));

    renderSection();
    expect(screen.queryByRole("button", { name: /execute v3 full restore/i })).toBeNull();
    await uploadV3AndPreview();
    expect(await screen.findByText("Schema mismatch")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /execute v3 full restore/i })).toBeNull();
  });

  it("keeps restore unavailable when backend flag is off or user is not super_admin", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3/status") {
        const role = useAuthMock().user.role;
        return jsonResponse(role === "super_admin" ? disabledStatus : {
          ...enabledStatus,
          userCanExecute: false,
          disabledReason: "V3 full restore requires super_admin.",
        });
      }
      if (url === "/api/admin/restore/v3/upload-sessions") return jsonResponse(completedUpload, 201);
      if (url.includes("/chunks") || url.endsWith("/complete")) return jsonResponse(completedUpload);
      if (url === "/api/admin/restore/v3/preview") return jsonResponse(previewJob(), 202);
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    await uploadV3AndPreview();
    expect(await screen.findByText(/disabled by backend configuration/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /execute v3 full restore/i })).toBeNull();

    useAuthMock.mockReturnValue({
      user: { id: 3, username: "sup", fullName: "Supervisor", role: "supervisor", recentSupervisorReauth: true },
    });
    cleanup();
    renderSection();
    expect(await screen.findByText(/requires super_admin/i)).toBeTruthy();
  });

  it("uses the status endpoint and never probes restore execution for capability", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/flag") return jsonResponse(disabledFlag);
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/restore/v3/status", expect.objectContaining({ method: "GET" })));
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/restore/v3")).toBe(false);
  });


  it("runs the automated destination controls through the guarded control-center API", async () => {
    const destination = { destination_id: "destination-1", name: "Primary local", destination_type: "local", enabled: true, credentialsConfigured: false, last_connection_status: null, last_failure_message: null };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/flag") return jsonResponse(disabledFlag);
      if (url === "/api/backup-control/summary") return jsonResponse({ health: "healthy", destinations: 1, enabled_destinations: 1, recent_failures: 0 });
      if (url === "/api/backup-control/destinations") return jsonResponse({ destinations: [destination] });
      if (url === "/api/backup-control/jobs") return jsonResponse({ jobs: [] });
      if (url === "/api/backup-control/schedules") return jsonResponse({ schedules: [] });
      if (url === "/api/backup-control/restore-verifications") return jsonResponse({ verifications: [] });
      if (url === "/api/backup-control/run-now" && init?.method === "POST") return jsonResponse({});
      if (url === "/api/backup-control/destinations/destination-1/test") return jsonResponse({});
      if (url === "/api/backup-control/destinations/destination-1/retention/preview") return jsonResponse({ plan: { keep: ["recent"], delete: ["expired"] } });
      if (url === "/api/backup-control/destinations/destination-1/retention/execute") return jsonResponse({});
      if (url === "/api/backup-control/destinations/destination-1" && init?.method === "PATCH") return jsonResponse({});
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderSection();
    await screen.findByText("Primary local");
    await userEvent.click(screen.getByRole("checkbox", { name: /primary local/i }));
    await userEvent.click(screen.getByRole("button", { name: "Run now" }));
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await userEvent.click(screen.getByRole("button", { name: "Retention preview" }));
    expect(await screen.findByText(/Retention preview: 1 copies retained and 1 eligible for safe deletion/i)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Apply retention" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/backup-control/run-now", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/backup-control/destinations/destination-1/test", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/backup-control/destinations/destination-1", expect.objectContaining({ method: "PATCH" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/backup-control/destinations/destination-1/retention/execute", expect.objectContaining({ method: "POST" }));
  });

  it("labels a failed archived job as a destination-copy retry and keeps Run now distinct", async () => {
    const job = { job_id: "job-1", status: "failed", archive_name: "backup.rispro.zip", created_at: "2026-05-27T12:00:00.000Z", completed_at: "2026-05-27T12:05:00.000Z", destination_copies: [], failure_message: "SMB archive transfer timed out." };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/flag") return jsonResponse(disabledFlag);
      if (url === "/api/backup-control/summary") return jsonResponse({ health: "warning", destinations: 1, enabled_destinations: 1, recent_failures: 1 });
      if (url === "/api/backup-control/destinations") return jsonResponse({ destinations: [] });
      if (url === "/api/backup-control/jobs") return jsonResponse({ jobs: [job] });
      if (url === "/api/backup-control/schedules") return jsonResponse({ schedules: [] });
      if (url === "/api/backup-control/restore-verifications") return jsonResponse({ verifications: [] });
      if (url === "/api/backup-control/jobs/job-1/retry" && init?.method === "POST") return jsonResponse({ job: {} }, 202);
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Retry destination copy" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/backup-control/jobs/job-1/retry", expect.objectContaining({ method: "POST" }));
    expect(screen.getByText("Run now")).toBeTruthy();
    expect(screen.getByText("SMB archive transfer timed out.")).toBeTruthy();
  });

  it("covers protected destination, passphrase, schedule, and verification controls when encryption is ready", async () => {
    const destination = { destination_id: "destination-1", name: "Primary local", destination_type: "local", enabled: true, credentialsConfigured: false, config: { rootPath: "storage/backups" }, last_connection_status: null, last_failure_message: null };
    const schedule = { schedule_id: "schedule-1", name: "Nightly", frequency: "daily", time_of_day: "02:00", timezone: "Africa/Tripoli", next_run_at: null, destination_ids: ["destination-1"], enabled: true, selected_weekdays: [], selected_day_of_month: null, retention_policy: { preset: "7_daily_4_weekly_12_monthly" }, restore_verification_frequency: "weekly" };
    const job = { job_id: "job-1", status: "completed", archive_name: "backup.rispro.zip", created_at: "2026-05-27T12:00:00.000Z", completed_at: "2026-05-27T12:05:00.000Z", source_schedule_id: "schedule-1", destination_copies: [{ destinationId: "destination-1", status: "verified", copyAttemptId: "copy-1", remotePath: "backup.rispro.zip" }], failure_message: null };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/flag") return jsonResponse(disabledFlag);
      if (url === "/api/backup-control/summary") return jsonResponse({ health: "healthy", destinations: 1, enabled_destinations: 1, recent_failures: 0, encryption: { encryptionReady: true, setupRequired: false, restartRequired: false, setupAvailable: false } });
      if (url === "/api/backup-control/destinations") return jsonResponse({ destinations: [destination] });
      if (url === "/api/backup-control/schedules") return jsonResponse({ schedules: [schedule] });
      if (url === "/api/backup-control/jobs") return jsonResponse({ jobs: [job] });
      if (url === "/api/backup-control/restore-verifications") return jsonResponse({ verifications: [] });
      if (url === "/api/backup-control/destinations" && init?.method === "POST") return jsonResponse({ destination }, 201);
      if (url === "/api/backup-control/encryption-passphrase" && init?.method === "POST") return jsonResponse({});
      if (url === "/api/backup-control/schedules" && init?.method === "POST") return jsonResponse({ schedule }, 201);
      if (url.includes("/destinations/destination-1") || url.includes("/schedules/schedule-1") || url.includes("/jobs/job-1/verify")) return jsonResponse({});
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderSection();
    await screen.findByText("Primary local");
    await userEvent.click(screen.getByRole("checkbox", { name: /primary local/i }));
    await userEvent.click(screen.getByText("Protected destination and encryption settings"));
    await userEvent.type(screen.getByLabelText("Automated destination name"), "New local");
    await userEvent.type(screen.getByLabelText("Automated local root"), "storage/new-backups");
    await userEvent.click(screen.getByRole("button", { name: "Save destination" }));
    await screen.findByText(/Destination saved/i);
    await userEvent.type(screen.getByLabelText("Automated archive passphrase"), "valid-passphrase");
    await userEvent.click(screen.getByRole("button", { name: "Store encrypted passphrase" }));
    await userEvent.click(screen.getByText("Schedules, retention, and isolated restore verification"));
    await userEvent.clear(screen.getByLabelText("Automated schedule name"));
    await userEvent.type(screen.getByLabelText("Automated schedule name"), "Nightly updated");
    await userEvent.click(screen.getByRole("button", { name: "Save schedule for selected destinations" }));
    await screen.findByText(/Backup schedule saved/i);
    await userEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]);
    await userEvent.click(screen.getByRole("button", { name: "Update schedule" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Pause" })[1]);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Run restore verification" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/backup-control/encryption-passphrase", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/backup-control/jobs/job-1/verify", expect.objectContaining({ method: "POST" }));
  }, 15_000);

  it("shows the Backup security setup card, permits one recovery download, and requires restart after secure save", async () => {
    let saved = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/flag") return jsonResponse(disabledFlag);
      if (url === "/api/backup-control/summary") return jsonResponse({
        health: "critical", destinations: 0, enabled_destinations: 0, recent_failures: 0,
        encryption: saved
          ? { encryptionReady: false, setupRequired: false, restartRequired: true, setupAvailable: false }
          : { encryptionReady: false, setupRequired: true, restartRequired: false, setupAvailable: true },
      });
      if (["/api/backup-control/destinations", "/api/backup-control/jobs", "/api/backup-control/schedules", "/api/backup-control/restore-verifications"].includes(url)) return jsonResponse({});
      if (url === "/api/backup-control/encryption-setup" && init?.method === "POST") return jsonResponse({ setupId: "setup-1", createdAt: "2026-07-18T00:00:00.000Z", recoveryAvailable: true }, 201);
      if (url === "/api/backup-control/encryption-setup/setup-1/recovery") return new Response("BACKUP_V3_MASTER_KEY=test", { status: 200, headers: { "Content-Type": "text/plain" } });
      if (url === "/api/backup-control/encryption-setup/setup-1/confirm" && init?.method === "POST") { saved = true; return jsonResponse({ restartRequired: true }); }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();
    expect(await screen.findByText("Backup security setup required")).toBeTruthy();
    expect((screen.getByRole("button", { name: /save destination/i }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /generate secure encryption key/i }));
    await userEvent.click(await screen.findByRole("button", { name: /download one-time recovery copy/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /i saved the recovery copy/i }));
    await userEvent.click(screen.getByRole("button", { name: /save securely/i }));
    expect(await screen.findByText(/restart required/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/backup-control/encryption-setup/setup-1/confirm", expect.objectContaining({ method: "POST" }));
  });

  it("shows Backup credential encryption as ready without offering replacement", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/flag") return jsonResponse(disabledFlag);
      if (url === "/api/backup-control/summary") return jsonResponse({ health: "critical", destinations: 0, enabled_destinations: 0, recent_failures: 0, encryption: { encryptionReady: true, setupRequired: false, restartRequired: false, setupAvailable: false } });
      if (["/api/backup-control/destinations", "/api/backup-control/jobs", "/api/backup-control/schedules", "/api/backup-control/restore-verifications"].includes(url)) return jsonResponse({});
      return jsonResponse({}, 404);
    }));
    renderSection();
    expect(await screen.findByText("Backup credential encryption: Ready")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /generate secure encryption key/i })).toBeNull();
  });

  it("requires exact confirmation before executing restore", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/flag") return jsonResponse(disabledFlag);
      if (url === "/api/admin/restore/v3/upload-sessions") return jsonResponse(completedUpload, 201);
      if (url.includes("/chunks") || url.endsWith("/complete")) return jsonResponse(completedUpload);
      if (url === "/api/admin/restore/v3/preview") return jsonResponse(previewJob(), 202);
      return jsonResponse({}, 404);
    }));

    renderSection();
    await uploadV3AndPreview();
    const execute = await screen.findByRole("button", { name: /execute v3 full restore/i });
    expect((execute as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("V3 restore confirmation"), "RESTORE RISPRO");
    expect((execute as HTMLButtonElement).disabled).toBe(false);
  });

  it("displays partial failure, restartRequired, safety paths, and masks secrets", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/upload-sessions") return jsonResponse(completedUpload, 201);
      if (url.includes("/chunks") || url.endsWith("/complete")) return jsonResponse(completedUpload);
      if (url === "/api/admin/restore/v3/preview") return jsonResponse(previewJob(), 202);
      if (url === "/api/admin/restore/v3") {
        return jsonResponse({
          ok: false,
          dbRestored: true,
          storageRestored: true,
          externalDocumentsRestored: "partial",
          envRestored: false,
          restoreIncomplete: true,
          restartRequired: true,
          safetyBackupsCreated: { metadataPath: "/safe/metadata.json", dbSafetyPath: "/safe/db.dump" },
          restoredCounts: { tables: 80 },
          partialFailure: { component: "external_documents", message: "write failed" },
          env: { envVarsRestored: [{ name: "DATABASE_URL", value: "postgresql://secret", isSecret: true }] },
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();
    await uploadV3AndPreview();
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/restore/v3")).toBe(false);
    await userEvent.type(await screen.findByLabelText("V3 restore confirmation"), "RESTORE RISPRO");
    await userEvent.click(screen.getByRole("button", { name: /execute v3 full restore/i }));

    expect(await screen.findByText(/V3 restore partial failure/i)).toBeTruthy();
    expect(screen.getAllByText(/Restart required/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/metadata.json/i)).toBeTruthy();
    expect(screen.queryByText(/postgresql:\/\/secret/i)).toBeNull();
  });

  it("runs an isolated migration rehearsal for an older supported preview", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/upload-sessions") return jsonResponse(completedUpload, 201);
      if (url.includes("/chunks") || url.endsWith("/complete")) return jsonResponse(completedUpload);
      if (url === "/api/admin/restore/v3/preview") {
        return jsonResponse({
          ...previewJob(),
          compatibilityClassification: "older_supported",
          compatibilityMessage: "Older supported backup.",
        }, 202);
      }
      if (url.endsWith("/migration-rehearsals") && init?.method === "POST") {
        return jsonResponse({ rehearsal_id: "rehearsal-1", status: "succeeded", progress: 100, promotion_ready: true, errors: [], validation_results: {} }, 201);
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();
    await uploadV3AndPreview();
    await userEvent.click(await screen.findByRole("button", { name: /run isolated migration rehearsal/i }));

    expect(await screen.findByText(/Migration rehearsal: succeeded · 100% · promotion-ready/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/restore/v3/preview/preview-1/migration-rehearsals",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("polls a queued migration rehearsal and renders a failed result", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/upload-sessions") return jsonResponse(completedUpload, 201);
      if (url.includes("/chunks") || url.endsWith("/complete")) return jsonResponse(completedUpload);
      if (url === "/api/admin/restore/v3/preview") return jsonResponse({ ...previewJob(), compatibilityClassification: "older_supported", compatibilityMessage: "Older supported backup." }, 202);
      if (url.endsWith("/migration-rehearsals") && init?.method === "POST") return jsonResponse({ rehearsal_id: "rehearsal-1", status: "queued", progress: 0, promotion_ready: false, errors: [], validation_results: {} }, 201);
      if (url.endsWith("/migration-rehearsals/rehearsal-1")) return jsonResponse({ rehearsal_id: "rehearsal-1", status: "failed", progress: 100, promotion_ready: false, errors: ["Migration failed"], validation_results: {} });
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();
    await uploadV3AndPreview();
    await userEvent.click(await screen.findByRole("button", { name: /run isolated migration rehearsal/i }));

    expect(await screen.findByText(/Migration rehearsal: failed · 100% · not promotion-ready/i, {}, { timeout: 2_500 })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/restore/v3/migration-rehearsals/rehearsal-1", { credentials: "include" });
    expect(screen.getByText("Migration failed")).toBeTruthy();
  });

  it("surfaces migration rehearsal start errors", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/restore/v3/status") return jsonResponse(enabledStatus);
      if (url === "/api/admin/restore/v3/upload-sessions") return jsonResponse(completedUpload, 201);
      if (url.includes("/chunks") || url.endsWith("/complete")) return jsonResponse(completedUpload);
      if (url === "/api/admin/restore/v3/preview") return jsonResponse({ ...previewJob(), compatibilityClassification: "older_supported", compatibilityMessage: "Older supported backup." }, 202);
      if (url.endsWith("/migration-rehearsals") && init?.method === "POST") return jsonResponse({ message: "Rehearsal unavailable" }, 500);
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();
    await uploadV3AndPreview();
    await userEvent.click(await screen.findByRole("button", { name: /run isolated migration rehearsal/i }));

    expect(await screen.findByText("Rehearsal unavailable")).toBeTruthy();
  });

});
