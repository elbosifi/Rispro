import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PacsSettingsSection from "./pacs-settings-section";
import { LanguageProvider } from "@/providers/language-provider";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    api: vi.fn(),
  };
});

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <PacsSettingsSection onReAuthRequired={vi.fn()} />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

describe("PacsSettingsSection auto-completion controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/pacs/nodes") {
        return { nodes: [] };
      }
      if (path === "/pacs/orthanc-verification-targets") {
        return {
          targets: [
            { type: "local", key: "local", label: "Local Orthanc index" },
            { type: "remote_modality", key: "CT_REMOTE", label: "CT_REMOTE" },
          ],
        };
      }
      if (path === "/pacs/auto-completion-settings") {
        return {
          settings: [
            {
              id: 0,
              modality_id: 7,
              enabled: false,
              orthanc_target_type: "local",
              orthanc_target_key: null,
              matching_strategy: "study_uid_preferred_accession_fallback",
              completion_threshold: "study_exists",
              poll_interval_minutes: 15,
              lookback_hours: 24,
              stop_after_hours: 72,
              last_check_status: "not_found",
              last_check_result_json: {},
              last_error: "No matching study",
              last_checked_at: "2026-05-04T08:00:00.000Z",
              modality_code: "CT",
              modality_name_ar: "CT",
              modality_name_en: "CT",
              modality_is_active: true,
            },
          ],
        };
      }
      if (path === "/pacs/auto-completion-settings/7" && options?.method === "PUT") {
        return { setting: {} };
      }
      if (path === "/pacs/auto-completion-settings/7/test" && options?.method === "POST") {
        return { result: { status: "matched", lastError: null }, bookingId: 42 };
      }
      throw new Error(`Unexpected API call ${path}`);
    });
  });

  it("renders and saves per-modality auto-completion settings", async () => {
    const user = userEvent.setup();
    renderComponent();

    expect(await screen.findByText("Orthanc PACS auto-completion")).toBeTruthy();
    expect(screen.getAllByText("CT").length).toBeGreaterThan(0);
    expect(screen.getByText(/Last result: not_found/)).toBeTruthy();
    expect(screen.getByText(/No matching study/)).toBeTruthy();

    await user.click(screen.getByRole("checkbox", { name: "Enable" }));
    await user.selectOptions(screen.getByLabelText("Orthanc target"), "CT_REMOTE");
    await user.selectOptions(screen.getByLabelText("Completion threshold"), "series_exists");
    await user.clear(screen.getByLabelText("Poll interval minutes"));
    await user.type(screen.getByLabelText("Poll interval minutes"), "5");
    await user.clear(screen.getByLabelText("Lookback hours"));
    await user.type(screen.getByLabelText("Lookback hours"), "12");
    await user.clear(screen.getByLabelText("Stop after hours"));
    await user.type(screen.getByLabelText("Stop after hours"), "36");

    await user.click(screen.getByRole("button", { name: "Save auto-completion" }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/pacs/auto-completion-settings/7",
        expect.objectContaining({ method: "PUT" })
      );
    });
    const saveCall = vi.mocked(api).mock.calls.find((call) => call[0] === "/pacs/auto-completion-settings/7");
    const payload = JSON.parse(String(saveCall?.[1]?.body || "{}"));
    expect(payload.enabled).toBe(true);
    expect(payload.orthancTargetType).toBe("remote_modality");
    expect(payload.orthancTargetKey).toBe("CT_REMOTE");
    expect(payload.matchingStrategy).toBe("study_uid_preferred_accession_fallback");
    expect(payload.completionThreshold).toBe("series_exists");
    expect(payload.pollIntervalMinutes).toBe(5);
    expect(payload.lookbackHours).toBe(12);
    expect(payload.stopAfterHours).toBe(36);
  });

  it("calls the test endpoint without completing a booking", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("Orthanc PACS auto-completion");
    await user.click(screen.getByRole("button", { name: "Test verification" }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/pacs/auto-completion-settings/7/test",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(await screen.findByText(/Test for modality 7: matched/)).toBeTruthy();
  });
});
