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
vi.mock("@/lib/naps2-webscan", () => ({
  normalizeNaps2Source: (value: unknown) => ["auto", "feeder", "flatbed", "duplex"].includes(String(value)) ? value : "feeder",
  scanAppointmentRequest: scan,
  getNaps2WebScanStatus: connection,
}));
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

function selectForLabel(label: string): HTMLSelectElement {
  return screen.getByText(label, { exact: true }).parentElement?.querySelector("select") as HTMLSelectElement;
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

  it("saves the approved RISpro address and optional shared-scanner settings through the protected settings API", async () => {
    renderSection();
    await userEvent.type(await screen.findByLabelText("RISpro HTTP address"), "http://192.9.101.30:8080");
    const advanced = screen.getByText("Advanced shared scanner settings").closest("details")!;
    expect(advanced.open).toBe(false);
    await userEvent.click(screen.getByText("Advanced shared scanner settings"));
    await userEvent.type(screen.getByLabelText("Additional approved scanner endpoints"), "http://192.9.101.40:9828");
    await userEvent.type(screen.getByLabelText("Approved scanner client addresses"), "192.9.101.12,192.9.102.0/24");
    await userEvent.click(screen.getByRole("button", { name: "Save document settings" }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith("documents_and_uploads", expect.objectContaining({ entries: expect.arrayContaining([
      { key: "naps2_setup_rispro_origin", value: { value: "http://192.9.101.30:8080" } },
      { key: "naps2_webscan_allowed_origins", value: { value: "http://192.9.101.40:9828" } },
      { key: "naps2_setup_firewall_sources", value: { value: "192.9.101.12,192.9.102.0/24" } },
    ]) })));
    expect(document.body.textContent).not.toContain("NAPS2_SETUP_");
  });
  it("displays the saved approved origin without substituting the current page address", async () => {
    fetchSettings.mockResolvedValue({ naps2_setup_rispro_origin: "http://192.9.101.30:8080" });
    renderSection();
    expect((await screen.findByLabelText("RISpro HTTP address") as HTMLInputElement).value).toBe("http://192.9.101.30:8080");
  });

  it.each(["150", "200", "300", "400", "600"])("shows and persists the %s DPI preset", async (dpi) => {
    fetchSettings.mockResolvedValue({ scan_dpi: dpi, scanner_source: "auto" });
    renderSection();

    await screen.findByText("Scan DPI");
    const dpiSelect = selectForLabel("Scan DPI");
    await waitFor(() => expect(dpiSelect.value).toBe(dpi));
    expect(Array.from(dpiSelect.options).map((option) => option.textContent)).toEqual([
      "150 DPI", "200 DPI", "300 DPI", "400 DPI", "600 DPI",
    ]);
    expect(selectForLabel("Scanner source").value).toBe("auto");

    await userEvent.click(screen.getByRole("button", { name: "Save document settings" }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith("documents_and_uploads", expect.objectContaining({
      entries: expect.arrayContaining([
        { key: "scan_dpi", value: { value: dpi } },
        { key: "scanner_source", value: { value: "auto" } },
      ]),
    })));
  });

  it("defaults invalid saved DPI and source values while exposing Auto above Feeder", async () => {
    fetchSettings.mockResolvedValue({ scan_dpi: "125", scanner_source: "unknown" });
    renderSection();

    expect(await screen.findByDisplayValue("200 DPI")).toBeTruthy();
    const sourceSelect = selectForLabel("Scanner source");
    expect(sourceSelect.value).toBe("feeder");
    expect(Array.from(sourceSelect.options).map((option) => option.value)).toEqual([
      "auto", "feeder", "flatbed", "duplex",
    ]);
    expect(screen.getByText("Auto tries the feeder first and switches to the flatbed only when NAPS2 explicitly reports an empty feeder.")).toBeTruthy();
  });

  it("persists an explicitly selected Auto scanner source", async () => {
    fetchSettings.mockResolvedValue({ scan_dpi: "300", scanner_source: "feeder" });
    renderSection();
    await screen.findByText("Scanner source");
    const sourceSelect = selectForLabel("Scanner source");
    await userEvent.selectOptions(sourceSelect, "auto");
    await userEvent.click(screen.getByRole("button", { name: "Save document settings" }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith("documents_and_uploads", expect.objectContaining({
      entries: expect.arrayContaining([{ key: "scanner_source", value: { value: "auto" } }]),
    })));
  });

});
