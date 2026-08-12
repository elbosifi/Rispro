import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DocumentsStorageSection from "./documents-storage-section";
import { t as translate, type TranslationKey } from "@/lib/i18n";

const { fetchSettings, saveSettings } = vi.hoisted(() => ({ fetchSettings: vi.fn(), saveSettings: vi.fn() }));

vi.mock("@/lib/api-hooks", () => ({
  adminBulkDeleteDocuments: vi.fn(),
  adminMoveDocumentsToStorage: vi.fn(),
  adminTestDocumentStorageConnectivity: vi.fn(),
  fetchSettings,
  saveSettings,
}));
vi.mock("@/lib/naps2-webscan", () => ({ scanAppointmentRequest: vi.fn() }));
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
      ]),
    }));
  });
});
