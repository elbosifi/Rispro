import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <WorklistMonitorPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("Worklist Monitor protocol hold", () => {
  beforeEach(() => {
    api.mockReset();
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
});
