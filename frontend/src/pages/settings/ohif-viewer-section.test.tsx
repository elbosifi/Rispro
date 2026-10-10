import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import OhifViewerSection from "./ohif-viewer-section";

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, api: vi.fn() };
});

const response = {
  configuration: {
    settings: {
      enabled: false, ohifPublicBaseUrl: "/ohif", selectedPacsNodeId: 5, accessStrategy: "native_dicomweb",
      orthancGatewayEnabled: false, orthancModalityKey: null, openMode: "new_tab", allowPriorStudies: true,
      maxPriorStudies: 5, launchTokenTtlSeconds: 600, cacheRetentionHours: 24, retrievalTimeoutSeconds: 300,
    },
    webEndpoint: {
      enabled: true, dicomwebBaseUrl: "https://pacs.test/dicom-web", qidoRoot: "https://pacs.test/dicom-web",
      wadoRsRoot: "https://pacs.test/dicom-web", wadoUriRoot: null, stowRoot: null, authType: "basic",
      usernameEnvKey: "OHIF_DICOMWEB_USERNAME", passwordEnvKey: "OHIF_DICOMWEB_PASSWORD", bearerTokenEnvKey: null,
      verifyTls: true, timeoutSeconds: 30, osirixVersion: "14.0", dicomwebServerEnabled: true,
      lastTestedAt: null, lastTestStatus: null, lastTestMessage: null, qidoLastStatus: null,
      wadoMetadataLastStatus: null, wadoFrameLastStatus: null,
    },
    authoritativeOrthanc: { enabled: true, configured: true, displayName: "Primary archive" },
    environmentCredentialStatus: { usernameConfigured: true, passwordConfigured: true, bearerTokenConfigured: false },
  },
  pacsNodes: [{ id: 5, name: "OsiriX MD", host: "10.0.0.5", port: 104, called_ae_title: "OSIRIX", calling_ae_title: "RISPRO", timeout_seconds: 10, is_active: true, is_default: false }],
};

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><OhifViewerSection onReAuthRequired={vi.fn()} /></QueryClientProvider>);
}

describe("OhifViewerSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/ohif/admin/configuration" && !options?.method) return response;
      if (path === "/ohif/admin/configuration" && options?.method === "PUT") return response;
      if (path === "/ohif/admin/diagnostics") return { message: "QIDO study search succeeded." };
      throw new Error(`Unexpected API call ${path}`);
    });
  });

  it("labels the independent PACS source, stores only environment references, and saves bounded settings", async () => {
    const user = userEvent.setup();
    renderSection();

    expect(await screen.findByText("OHIF image source")).toBeTruthy();
    expect(screen.getByText(/Independent of the general RISpro default PACS/)).toBeTruthy();
    expect(screen.getByDisplayValue("OHIF_DICOMWEB_PASSWORD")).toBeTruthy();
    expect(screen.queryByDisplayValue("secret")).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Enable OHIF Viewer" }));
    await user.click(screen.getByRole("button", { name: "Save OHIF Viewer settings" }));

    await waitFor(() => expect(api).toHaveBeenCalledWith("/ohif/admin/configuration", expect.objectContaining({ method: "PUT" })));
    const call = vi.mocked(api).mock.calls.find(([path, options]) => path === "/ohif/admin/configuration" && options?.method === "PUT");
    const payload = JSON.parse(String(call?.[1]?.body || "{}"));
    expect(payload.settings.enabled).toBe(true);
    expect(payload.settings.selectedPacsNodeId).toBe(5);
    expect(payload.webEndpoint.passwordEnvKey).toBe("OHIF_DICOMWEB_PASSWORD");
    expect(JSON.stringify(payload)).not.toContain("actual-password");
  });

  it("renders QIDO and WADO diagnostics as separate actions", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Diagnostics");
    expect(screen.getByRole("button", { name: "Test QIDO study search" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test WADO metadata" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test authorized full launch" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Test QIDO study search" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/ohif/admin/diagnostics", expect.objectContaining({ method: "POST" })));
  });
  it("uses Authoritative Orthanc without a PACS node or duplicate credentials and retains automatic priors", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("OHIF image source");
    await user.selectOptions(screen.getByRole("combobox", { name: "Access strategy" }), "authoritative_orthanc");
    expect(screen.getByText("Primary archive")).toBeTruthy();
    expect(screen.getByText(/Connection configured/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Manage Authoritative Orthanc settings" }).getAttribute("href")).toBe("/settings?section=authoritative_orthanc");
    expect(screen.queryByRole("combobox", { name: "Active PACS node" })).toBeNull();
    expect(screen.queryByText("Orthanc modality key")).toBeNull();
    expect(screen.queryByText("Retrieval timeout (seconds)")).toBeNull();
    expect(screen.queryByText("Cache retention (hours)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Test PACS C-ECHO" })).toBeNull();
    expect(screen.queryByText("Password environment key")).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Allow prior studies" }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save OHIF Viewer settings" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/ohif/admin/configuration", expect.objectContaining({ method: "PUT" })));
    const call = vi.mocked(api).mock.calls.find(([, options]) => options?.method === "PUT");
    const payload = JSON.parse(String(call?.[1]?.body));
    expect(payload.settings.accessStrategy).toBe("authoritative_orthanc");
    expect(payload.settings.selectedPacsNodeId).toBeNull();
    expect(payload.webEndpoint).toBeNull();
    expect(payload.settings.allowPriorStudies).toBe(true);
  });

  it("reloads authoritative mode and shows missing configuration without gateway controls", async () => {
    vi.mocked(api).mockResolvedValue({ ...response, configuration: {
      ...response.configuration,
      settings: { ...response.configuration.settings, selectedPacsNodeId: null, accessStrategy: "authoritative_orthanc" },
      webEndpoint: null,
      authoritativeOrthanc: { enabled: false, configured: false, displayName: "" },
    } });
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(/Enable and configure Authoritative Orthanc before enabling/);
    expect((screen.getByRole("combobox", { name: "Access strategy" }) as HTMLSelectElement).value).toBe("authoritative_orthanc");
    await user.selectOptions(screen.getByRole("combobox", { name: "Access strategy" }), "orthanc_gateway");
    expect(screen.getByText("Orthanc modality key")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Active PACS node" })).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Access strategy" }), "native_dicomweb");
    expect(screen.getByText("QIDO-RS root")).toBeTruthy();
  });

});
