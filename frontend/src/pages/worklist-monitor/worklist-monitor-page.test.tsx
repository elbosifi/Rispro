import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t as translate, type TranslationKey } from "@/lib/i18n";
import WorklistMonitorPage from "./worklist-monitor-page";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ api, ApiError: class ApiError extends Error { status = 500; } }));
vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ user: { role: "supervisor" } }) }));
vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en", t: (key: TranslationKey) => translate("en", key) }),
}));
vi.mock("@/components/auth/supervisor-reauth-modal", () => ({ SupervisorReAuthModal: () => null }));

function LocationProbe() {
  const [searchParams] = useSearchParams();
  return <output data-testid="worklist-location">{searchParams.toString()}</output>;
}

function renderPage(initialEntry = "/worklist-monitor") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <WorklistMonitorPage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("Worklist Monitor protocol hold", () => {
  beforeEach(() => {
    api.mockReset();
    window.sessionStorage.clear();
    api.mockImplementation(async (url: string) => {
      if (url.startsWith("/dicom/worklist-monitor/entries")) return {
        ok: true,
        settings: {
          orthanc: { enabled: true, shadowMode: true, sendOnlyWhenPatientEntersQueue: true, worklistTarget: "RISPRO_MWL", compatibility: {} },
          sante: { enabled: true, mode: "shadow", deliveryMethod: "file_drop", sendOnlyWhenPatientEntersQueue: true, expectAck: true, compatibility: {} },
        },
        entries: [{
          bookingId: 1,
          accessionNumber: "V2-000001",
          patientId: "P1",
          patientName: "Protocol Patient",
          modality: "CT",
          modalityName: "CT",
          procedure: "CT Brain",
          bookingDate: "2042-08-12",
          bookingTime: "09:00",
          queueStatus: "scheduled",
          orthanc: { status: "waiting_for_protocol", outboxStatus: null, outboxId: null, operation: null, lastAttemptAt: null, lastError: null, history: [], preview: {}, previewError: null },
          sante: { status: "waiting_for_protocol", outboxStatus: null, outboxId: null, lastAttemptAt: null, lastError: null, history: [], preview: "", previewError: null },
        }],
      };
      if (url === "/dicom/orthanc-sync/summary") return { ok: true, summary: { syncStatus: [], outboxStatus: [] } };
      if (url === "/dicom/sante-hl7/summary") return { ok: true, summary: { outboxStatus: [], settings: { enabled: true, mode: "shadow", deliveryMethod: "file_drop", sendOnlyWhenPatientEntersQueue: true, mllp: { expectAck: true } } } };
      if (url === "/v2/lookups/modalities") return { items: [] };
      throw new Error(`Unexpected URL ${url}`);
    });
  });

  it("offers the workflow-hold filter and renders the localized hold separately from failures", async () => {
    renderPage();
    expect(await screen.findByRole("option", { name: "Waiting for protocol" })).toBeTruthy();
    expect(await screen.findByText("V2-000001")).toBeTruthy();
    expect((await screen.findAllByText("Waiting for protocol")).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("Failed")).toBeTruthy();
  });

  it("restores validated URL state and keeps monitor search private", async () => {
    renderPage("/worklist-monitor?tab=sante&dateFrom=2042-08-12&dateTo=2042-08-15&modalityId=7&status=waiting_for_queue&q=private");

    expect(await screen.findByText("V2-000001")).toBeTruthy();
    expect((screen.getByText("Sante HL7 Worklist").closest("button") as HTMLButtonElement).className).toContain("border-b-2");
    expect(screen.getByTestId("worklist-location").textContent)
      .toBe("tab=sante&dateFrom=2042-08-12&dateTo=2042-08-15&modalityId=7&status=waiting_for_queue");
  });

  it("writes search to session storage without placing it in the URL", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    renderPage();
    const search = await screen.findByPlaceholderText("Accession, ID, name");
    await user.type(search, "Patient Name MRN-1");
    expect(window.sessionStorage.getItem("rispro:worklist-monitor:search")).toBe("Patient Name MRN-1");
    expect(screen.getByTestId("worklist-location").textContent).toBe("");
  });
});
