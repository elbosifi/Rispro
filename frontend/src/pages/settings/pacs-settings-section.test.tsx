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
      if (path === "/pacs/orthanc-modalities") {
        return { modalities: [{ key: "CT_REMOTE", aet: "CTPACS", host: "10.0.0.5", port: 104 }] };
      }
      if (path === "/pacs/orthanc-modalities/MR_REMOTE" && options?.method === "PUT") {
        return { modality: { key: "MR_REMOTE", aet: "MRPACS", host: "10.0.0.6", port: 104 } };
      }
      if (path === "/pacs/orthanc-modalities/CT_REMOTE" && options?.method === "PUT") {
        return { modality: { key: "CT_REMOTE", aet: "CTPACS", host: "10.0.0.5", port: 11112 } };
      }
      if (path === "/pacs/orthanc-modalities/CT_REMOTE" && options?.method === "DELETE") {
        return { ok: true };
      }
      if (path === "/pacs/test" && options?.method === "POST") {
        return { ok: true, target: { key: "CT_REMOTE", name: "CT_REMOTE" } };
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
        const body = JSON.parse(String(options.body || "{}"));
        if (body.bookingId) {
          return {
            result: { status: "not_found", lastError: "No matching study" },
            history: { id: 9 },
            bookingId: 123,
            diagnostics: {
              bookingId: 123,
              bookingStatus: "scheduled",
              expectedAccession: "V2-123",
              studyInstanceUid: null,
              modalityId: 7,
              modalityCode: "CT",
              orthancTargetType: "local",
              orthancTargetKey: null,
              orthancTargetLabel: "Local Orthanc index",
              matchKey: "accession_number",
              matchValue: "V2-123",
              candidateCount: 3,
              completionThreshold: "study_exists",
              lastError: "No matching study",
            },
          };
        }
        return {
          result: { status: "matched", lastError: null },
          history: { id: 8 },
          bookingId: 42,
          diagnostics: {
            bookingId: 42,
            bookingStatus: "waiting",
            expectedAccession: "V2-42",
            studyInstanceUid: "1.2.3",
            modalityId: 7,
            modalityCode: "CT",
            orthancTargetType: "local",
            orthancTargetKey: null,
            orthancTargetLabel: "Local Orthanc index",
            matchKey: "study_instance_uid",
            matchValue: "1.2.3",
            candidateCount: null,
            completionThreshold: "study_exists",
            lastError: null,
          },
        };
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

  it("manages Orthanc remote modalities", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderComponent();

    expect(await screen.findByText("Orthanc remote modalities")).toBeTruthy();
    expect(screen.getAllByText("CT_REMOTE").length).toBeGreaterThan(0);
    expect(screen.getByText(/10\.0\.0\.5:104/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add Orthanc modality" }));
    await user.type(screen.getByPlaceholderText("Orthanc key (e.g. CT_REMOTE)"), "MR_REMOTE");
    await user.type(screen.getByPlaceholderText("Host (IP or hostname)"), "10.0.0.6");
    await user.clear(screen.getByPlaceholderText("Port"));
    await user.type(screen.getByPlaceholderText("Port"), "104");
    await user.type(screen.getByPlaceholderText("Remote AET"), "MRPACS");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/pacs/orthanc-modalities/MR_REMOTE",
        expect.objectContaining({ method: "PUT" })
      );
    });

    await user.click(screen.getByRole("button", { name: "Test CT_REMOTE" }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/pacs/test",
        expect.objectContaining({ method: "POST" })
      );
    });

    await user.click(screen.getByRole("button", { name: "Delete CT_REMOTE" }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        "/pacs/orthanc-modalities/CT_REMOTE",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  it("posts no bookingId when the test booking field is empty", async () => {
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
    const testCall = vi.mocked(api).mock.calls.find((call) => call[0] === "/pacs/auto-completion-settings/7/test");
    expect(JSON.parse(String(testCall?.[1]?.body || "{}"))).toEqual({});
    expect(await screen.findByText(/Test for modality 7: matched/)).toBeTruthy();
    expect(screen.getByText("Tested booking ID")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("Expected accession")).toBeTruthy();
    expect(screen.getByText("V2-42")).toBeTruthy();
  });

  it("posts entered bookingId and renders backend diagnostics for not_found", async () => {
    const user = userEvent.setup();
    renderComponent();

    await screen.findByText("Orthanc PACS auto-completion");
    await user.type(screen.getByLabelText("Booking ID to test"), "123");
    await user.click(screen.getByRole("button", { name: "Test verification" }));

    await waitFor(() => {
      const testCall = vi.mocked(api).mock.calls.find((call) => call[0] === "/pacs/auto-completion-settings/7/test");
      expect(JSON.parse(String(testCall?.[1]?.body || "{}"))).toEqual({ bookingId: "123" });
    });

    expect(await screen.findByText(/Test for modality 7: not_found/)).toBeTruthy();
    expect(screen.getByText("Booking status")).toBeTruthy();
    expect(screen.getByText("scheduled")).toBeTruthy();
    expect(screen.getByText("Expected accession")).toBeTruthy();
    expect(screen.getAllByText("V2-123").length).toBeGreaterThan(0);
    expect(screen.getByText("Target")).toBeTruthy();
    expect(screen.getAllByText("Local Orthanc index").length).toBeGreaterThan(0);
    expect(screen.getByText("Match key")).toBeTruthy();
    expect(screen.getByText("accession_number")).toBeTruthy();
    expect(screen.getByText("Match value")).toBeTruthy();
    expect(screen.getByText("Candidate count")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("Threshold")).toBeTruthy();
    expect(screen.getAllByText("study_exists").length).toBeGreaterThan(0);
    expect(screen.getByText("Result status")).toBeTruthy();
    expect(screen.getByText("not_found")).toBeTruthy();
    expect(screen.getAllByText("No matching study").length).toBeGreaterThan(0);
  });
});
