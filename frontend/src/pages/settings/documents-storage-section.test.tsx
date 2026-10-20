import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DocumentsStorageSection from "./documents-storage-section";
import { t as translate, type TranslationKey } from "@/lib/i18n";

const { fetchSettings, saveSettings, fetchIntegrationStatus, connection, scan } = vi.hoisted(() => ({ fetchSettings: vi.fn(), saveSettings: vi.fn(), fetchIntegrationStatus: vi.fn(), connection: vi.fn(), scan: vi.fn() }));

vi.mock("@/lib/api-hooks", () => ({
  adminBulkDeleteDocuments: vi.fn(),
  adminMoveDocumentsToStorage: vi.fn(),
  adminTestDocumentStorageConnectivity: vi.fn(),
  fetchSettings,
  fetchIntegrationStatus,
  saveSettings,
}));
vi.mock("@/lib/naps2-webscan", () => ({ scanAppointmentRequest: scan, getNaps2WebScanStatus: connection }));
vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en", t: (key: TranslationKey) => translate("en", key) }),
}));

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DocumentsStorageSection onReAuthRequired={vi.fn()} />
    </QueryClientProvider>
  );
}

describe("Documents & Uploads protocol queue setting", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchIntegrationStatus.mockResolvedValue({ scanner: { naps2WebScanEndpoint: "http://saved:9803" } });
    connection.mockResolvedValue({ available: true, endpoint: "http://saved:9803" });
    scan.mockClear();
    fetchSettings.mockReset();
    saveSettings.mockReset();
    fetchSettings.mockResolvedValue({ require_request_document_for_protocol_queue: "disabled" });
    saveSettings.mockResolvedValue({});
  });

  it("exposes the disabled-default toggle with the required explanation and persists enabled", async () => {
    renderSection();
    const toggle = await screen.findByRole("checkbox", { name: /Require request document before protocol queue/i });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/appointments without an attached request\/referral document remain booked but are withheld/i)).toBeTruthy();

    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Save document settings" }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect(saveSettings).toHaveBeenCalledWith("documents_and_uploads", expect.objectContaining({
      entries: expect.arrayContaining([
        { key: "require_request_document_for_protocol_queue", value: { value: "enabled" } },
        { key: "storage_path", value: { value: "" } },
        { key: "ha_hot_storage_enabled", value: { value: "true" } },
        { key: "ha_hot_storage_retention_hours", value: { value: "48" } },
      ]),
    }));
  });

  it("renders saved HA recovery settings", async () => {
    fetchSettings.mockResolvedValue({
      ha_hot_storage_enabled: "true",
      ha_hot_storage_retention_hours: "72",
    });

    renderSection();

    const toggle = await screen.findByRole("checkbox", { name: /Enable PostgreSQL HA recovery copy/i });
    const retention = screen.getByLabelText("HA recovery retention") as HTMLSelectElement;
    expect(toggle).toBeTruthy();
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(retention.value).toBe("72");
  });

  it("defaults HA recovery to enabled with 48 hours when settings are missing", async () => {
    fetchSettings.mockResolvedValue({});

    renderSection();

    const toggle = await screen.findByRole("checkbox", { name: /Enable PostgreSQL HA recovery copy/i });
    const retention = screen.getByLabelText("HA recovery retention") as HTMLSelectElement;
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(retention.value).toBe("48");
  });

  it("disables retention without clearing it when HA recovery is turned off", async () => {
    fetchSettings.mockResolvedValue({
      ha_hot_storage_enabled: "true",
      ha_hot_storage_retention_hours: "72",
    });

    renderSection();

    const toggle = await screen.findByRole("checkbox", { name: /Enable PostgreSQL HA recovery copy/i });
    const retention = screen.getByLabelText("HA recovery retention") as HTMLSelectElement;
    await userEvent.click(toggle);

    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(retention.disabled).toBe(true);
    expect(retention.value).toBe("72");
  });

  it("allows HA recovery to be enabled and a different retention selected", async () => {
    fetchSettings.mockResolvedValue({
      ha_hot_storage_enabled: "false",
      ha_hot_storage_retention_hours: "48",
    });

    renderSection();

    const toggle = await screen.findByRole("checkbox", { name: /Enable PostgreSQL HA recovery copy/i });
    const retention = screen.getByLabelText("HA recovery retention") as HTMLSelectElement;
    expect(retention.disabled).toBe(true);

    await userEvent.click(toggle);
    await userEvent.selectOptions(retention, "168");

    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(retention.disabled).toBe(false);
    expect(retention.value).toBe("168");
  });
  it("tests saved effective workstation connectivity without scanning or exposing companion settings", async () => {
    localStorage.setItem("rispro.naps2WebScanWorkstation.v1", JSON.stringify({ version: 1, endpoint: "http://override:9812", updatedAt: new Date().toISOString() }));
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Test scanner connection" }));
    await waitFor(() => expect(connection).toHaveBeenCalledWith("http://override:9812", undefined));
    expect(scan).not.toHaveBeenCalled();
    expect(screen.queryByText(/Scanner App download/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save document settings" }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith("documents_and_uploads", expect.objectContaining({ entries: expect.arrayContaining([{ key: "scanner_app_enabled", value: { value: "disabled" } }, { key: "naps2_webscan_endpoint", value: { value: "" } }]) })));
  });

});
