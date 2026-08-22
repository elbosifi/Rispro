import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SonicDicomReportsSection from "./sonicdicom-reports-section";

const mocks = vi.hoisted(() => ({
  fetchSonicDicomSettings: vi.fn(),
  saveSettings: vi.fn(),
  testSonicDicomSqlReadiness: vi.fn(),
}));

vi.mock("@/lib/api-hooks", () => ({
  fetchSonicDicomSettings: mocks.fetchSonicDicomSettings,
  saveSettings: mocks.saveSettings,
  testSonicDicomSqlReadiness: mocks.testSonicDicomSqlReadiness,
}));

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SonicDicomReportsSection onReAuthRequired={vi.fn()} />
    </QueryClientProvider>
  );
}

describe("SonicDICOM report settings browser URLs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchSonicDicomSettings.mockResolvedValue({
      sonicDicomPublicBaseUrl: "https://public.example/viewer",
      sonicDicomLocalBaseUrl: "http://192.168.1.30/viewer",
    });
    mocks.saveSettings.mockResolvedValue({ settings: [] });
  });

  it("loads and saves separate public and local browser URLs", async () => {
    renderSection();
    const publicInput = await screen.findByLabelText("Public SonicDICOM browser URL") as HTMLInputElement;
    const localInput = screen.getByLabelText("Local SonicDICOM browser URL") as HTMLInputElement;
    expect(publicInput.value).toBe("https://public.example/viewer");
    expect(localInput.value).toBe("http://192.168.1.30/viewer");
    expect(screen.getByText("Used when RISpro is accessed through its public/domain address.")).toBeTruthy();
    expect(screen.getByText("Used when RISpro is accessed through a local IP address. If empty, the public URL is used.")).toBeTruthy();
    expect(screen.getByText("SQL Server is the active readiness authority in production mode. Patient report and image links use the SonicDICOM browser URL selected according to how RISpro was accessed.")).toBeTruthy();

    fireEvent.change(localInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(1));
    const payload = mocks.saveSettings.mock.calls[0]?.[1] as { entries: Array<{ value: Record<string, unknown> }> };
    expect(payload.entries[0]?.value.sonicDicomLocalBaseUrl).toBe("");
    expect(payload.entries[0]?.value.sonicDicomPublicBaseUrl).toBe("https://public.example/viewer");
  });

  it("defaults and saves SQL no-report status codes", async () => {
    renderSection();
    const noReportInput = await screen.findByLabelText("No-report status codes") as HTMLInputElement;
    expect(noReportInput.value).toBe("7");

    fireEvent.change(noReportInput, { target: { value: "7, 17" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(1));
    const payload = mocks.saveSettings.mock.calls[0]?.[1] as { entries: Array<{ value: Record<string, unknown> }> };
    expect(payload.entries[0]?.value.sonicDicomSqlNoReportStatusCodes).toEqual([7, 17]);
  });
});
