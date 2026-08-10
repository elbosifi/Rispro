import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthoritativeOrthancSection from "./authoritative-orthanc-section";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));
const settings = { enabled: true, autoExportClinicalDocuments: true, autoRouteEnabled: false, autoRouteDestinationKey: "", baseUrl: "http://orthanc:8042", username: "rispro", timeoutSeconds: 10, verifyTls: true, displayName: "Primary", passwordConfigured: true };
const modalities = [{ key: "PACS_A", aet: "PACS_AE", host: "10.0.0.10", port: 104, isDefault: true }, { key: "PACS_B", aet: "PACS_B", host: "10.0.0.11", port: 11112, isDefault: false }];
function renderSection() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthoritativeOrthancSection onReAuthRequired={vi.fn()} /></QueryClientProvider>); }

describe("AuthoritativeOrthancSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.endsWith("/settings") && !options?.method) return { settings };
      if (path.endsWith("/settings") && options?.method === "PUT") return { settings };
      if (path.endsWith("/pacs/orthanc-modalities")) return { modalities };
      if (path.endsWith("/test")) return { connected: true, system: { name: "Authoritative", version: "1.12.4", apiVersion: "19" }, testedAt: "2026-07-27T10:00:00.000Z" };
      throw new Error(`Unexpected ${path}`);
    });
  });

  it("saves the automatic PACS export setting and retains it while the connection is disabled", async () => {
    const user = userEvent.setup(); renderSection();
    const autoExport = await screen.findByRole("checkbox", { name: "Automatically send approved scanned documents to PACS" });
    expect((autoExport as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Enable Orthanc connection" }));
    expect((autoExport as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saveCall = await waitFor(() => vi.mocked(api).mock.calls.find(([path, options]) => path.endsWith("/settings") && options?.method === "PUT"));
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual(expect.objectContaining({ enabled: false, autoExportClinicalDocuments: true }));
  });

  it("renders safe settings, retains an empty password field, and shows compact connection details", async () => {
    const user = userEvent.setup(); renderSection();
    expect(await screen.findByText("Authoritative Orthanc")).toBeTruthy();
    expect(screen.getByText(/export approved scanned clinical documents as DICOM Secondary Capture series/i)).toBeTruthy();
    expect(screen.getByText(/does not upload original modality images or create a replacement study/i)).toBeTruthy();
    expect(screen.queryByText(/Read-only connection foundation/i)).toBeNull();
    expect((screen.getByPlaceholderText("Configured - leave empty to retain") as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("/integrations/authoritative-orthanc/settings", expect.objectContaining({ method: "PUT" })));
    expect(JSON.stringify(vi.mocked(api).mock.calls)).not.toContain("secret");
    await user.click(screen.getByRole("button", { name: "Test Connection" }));
    expect((await screen.findByRole("status")).textContent).toContain("Authoritative");
    expect(screen.getByRole("status").textContent).toContain("1.12.4");
  });

  it("enables stable-series routing and selects an existing PACS destination", async () => {
    const user = userEvent.setup(); renderSection();
    const destination = await screen.findByRole("combobox", { name: "Auto-routing destination" });
    expect((destination as HTMLSelectElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Enable stable-series auto-routing" }));
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    await user.selectOptions(destination, "PACS_B");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const saveCall = await waitFor(() => vi.mocked(api).mock.calls.find(([path, options]) => path.endsWith("/settings") && options?.method === "PUT"));
    expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual(expect.objectContaining({ autoRouteEnabled: true, autoRouteDestinationKey: "PACS_B" }));
  });
});
