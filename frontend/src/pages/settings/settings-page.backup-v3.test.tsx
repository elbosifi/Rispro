import { render, screen, waitFor } from "@testing-library/react";
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

  it("downloads a v3 full app-stack backup without changing legacy v2 backup", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3") return jsonResponse({ error: { message: "A backup archive file is required." } }, 400);
      if (url === "/api/admin/backup/v3") {
        return new Response(new Blob(["zip"]), {
          status: 200,
          headers: { "Content-Disposition": 'attachment; filename="backup.rispro.zip"' },
        });
      }
      if (url === "/api/admin/backup") {
        return new Response(new Blob(["json"]), {
          status: 200,
          headers: { "Content-Disposition": 'attachment; filename="backup.json"' },
        });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();
    await userEvent.type(screen.getByLabelText("V3 backup passphrase"), "valid-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /download v3 full app-stack backup/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/backup/v3", expect.any(Object)));

    await userEvent.type(screen.getByPlaceholderText("Legacy v2 backup passphrase"), "legacy-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /download legacy v2 backup/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/backup", expect.any(Object)));
  });

  it("requires preview before restore execution and blocks preview errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3") return jsonResponse({ error: { message: "A backup archive file is required." } }, 400);
      if (url === "/api/admin/restore/v3/preview") {
        return jsonResponse({ ...okPreview, ok: false, errors: ["Schema mismatch"] });
      }
      return jsonResponse({}, 404);
    }));

    renderSection();
    expect(screen.queryByRole("button", { name: /execute v3 full restore/i })).toBeNull();
    await uploadV3AndPreview();
    expect(await screen.findByText("Schema mismatch")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /execute v3 full restore/i })).toBeNull();
  });

  it("keeps restore unavailable when backend flag is off or user is not super_admin", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3") {
        return jsonResponse({ error: { message: "V3 full restore is disabled by configuration." } }, 403);
      }
      if (url === "/api/admin/restore/v3/preview") return jsonResponse(okPreview);
      return jsonResponse({}, 404);
    }));
    renderSection();
    await uploadV3AndPreview();
    expect(await screen.findByText(/disabled by backend configuration/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /execute v3 full restore/i })).toBeNull();

    useAuthMock.mockReturnValue({
      user: { id: 3, username: "sup", fullName: "Supervisor", role: "supervisor", recentSupervisorReauth: true },
    });
    renderSection();
    expect(await screen.findByText(/available only to super_admin/i)).toBeTruthy();
  });

  it("requires exact confirmation before executing restore", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3") return jsonResponse({ error: { message: "A backup archive file is required." } }, 400);
      if (url === "/api/admin/restore/v3/preview") return jsonResponse(okPreview);
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
      if (url === "/api/admin/restore/v3/preview") return jsonResponse(okPreview);
      if (url === "/api/admin/restore/v3") {
        const callCount = fetchMock.mock.calls.filter(([calledUrl]) => calledUrl === "/api/admin/restore/v3").length;
        if (callCount === 1) return jsonResponse({ error: { message: "A backup archive file is required." } }, 400);
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
    await userEvent.type(await screen.findByLabelText("V3 restore confirmation"), "RESTORE RISPRO");
    await userEvent.click(screen.getByRole("button", { name: /execute v3 full restore/i }));

    expect(await screen.findByText(/V3 restore partial failure/i)).toBeTruthy();
    expect(screen.getAllByText(/Restart required/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/metadata.json/i)).toBeTruthy();
    expect(screen.queryByText(/postgresql:\/\/secret/i)).toBeNull();
  });

  it("keeps legacy v2 restore preview and execution on JSON endpoints", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/admin/restore/v3") return jsonResponse({ error: { message: "V3 full restore is disabled by configuration." } }, 403);
      if (url === "/api/admin/restore/preview") {
        return jsonResponse({
          manifest: {
            createdAt: "2026-05-27T12:00:00.000Z",
            schemas: ["public"],
            tableCounts: { users: 1 },
            documents: { rows: 0, filesIncluded: 0, filesMissing: 0 },
          },
          tables: [{ name: "users", rows: 1 }],
          documents: { rows: 0, filesIncluded: 0, filesMissing: 0 },
          env: [],
          warnings: [],
        });
      }
      if (url === "/api/admin/restore") return jsonResponse({ envVarsRestored: 2 });
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();
    await userEvent.upload(screen.getByLabelText("Legacy v2 restore file"), new File(['{"tables":{}}'], "backup.json", { type: "application/json" }));
    await userEvent.type(screen.getByLabelText("Legacy v2 restore passphrase"), "legacy-passphrase");
    await userEvent.click(screen.getByRole("button", { name: /validate backup/i }));
    expect(await screen.findByText(/Backup validated/i)).toBeTruthy();
    await userEvent.type(screen.getByPlaceholderText("Type RESTORE RISPRO"), "RESTORE RISPRO");
    await userEvent.click(screen.getByRole("button", { name: /restore full system/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/restore", expect.any(Object)));
  });
});
