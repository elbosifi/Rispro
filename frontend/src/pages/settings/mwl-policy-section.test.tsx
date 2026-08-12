import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t as translate, type TranslationKey } from "@/lib/i18n";
import MwlPolicySection from "./mwl-policy-section";

const { fetchSettings, saveSettings } = vi.hoisted(() => ({ fetchSettings: vi.fn(), saveSettings: vi.fn() }));

vi.mock("@/lib/api-hooks", () => ({ fetchSettings, saveSettings }));
vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en", t: (key: TranslationKey) => translate("en", key) }),
}));

function renderSection(onReAuthRequired = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MwlPolicySection onReAuthRequired={onReAuthRequired} />
    </QueryClientProvider>
  );
}

describe("shared MWL protocol policy setting", () => {
  beforeEach(() => {
    fetchSettings.mockReset();
    saveSettings.mockReset();
    fetchSettings.mockResolvedValue({ require_protocol_before_mwl_for_protocoling_modalities: "disabled" });
    saveSettings.mockResolvedValue({});
  });

  it("renders disabled by default and persists the neutral shared policy key", async () => {
    renderSection();
    const toggle = await screen.findByRole("checkbox", { name: "Require protocol before modality worklist" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/modalities that do not use protocoling are unaffected/i)).toBeTruthy();

    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith("mwl_policy", {
      entries: [{
        key: "require_protocol_before_mwl_for_protocoling_modalities",
        value: { value: "enabled" },
      }],
    }));
  });

  it("reopens supervisor re-authentication when a save session has expired", async () => {
    const onReAuthRequired = vi.fn();
    saveSettings.mockRejectedValue(new Error("Recent supervisor re-authentication is required. (403)"));
    renderSection(onReAuthRequired);

    await userEvent.click(await screen.findByRole("checkbox", { name: "Require protocol before modality worklist" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onReAuthRequired).toHaveBeenCalledWith(["settings", "mwl_policy"]));
  });
});
