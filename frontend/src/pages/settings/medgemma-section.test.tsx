import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { EnglishLanguageScope } from "@/providers/language-provider-component";
import { ApiError } from "@/lib/api-client";
import * as api from "@/lib/medgemma-api";
import MedGemmaSection from "./medgemma-section";

vi.mock("@/lib/medgemma-api");
const settings: api.MedGemmaSettings = { enabled: false, baseUrl: "", timeoutSeconds: 180, allowInsecureHttp: false, apiKeyConfigured: true, encryptionReady: true };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getMedGemmaSettings).mockResolvedValue({ settings });
  vi.mocked(api.saveMedGemmaSettings).mockImplementation(async (value) => ({ settings: value }));
  vi.mocked(api.testMedGemmaConnection).mockResolvedValue({ status: "connected", model: "google/medgemma" });
});
function mount(onReAuthRequired = vi.fn()) { render(<MemoryRouter><EnglishLanguageScope><MedGemmaSection onReAuthRequired={onReAuthRequired} /></EnglishLanguageScope></MemoryRouter>); }
it("loads no plaintext key, saves blank for retention, tests only saved settings and links to console", async () => {
  mount(); const url = await screen.findByLabelText("MedGemma Server URL");
  expect(screen.getByLabelText("API Key")).toHaveProperty("value", "");
  fireEvent.change(url, { target: { value: "http://192.9.101.55:8000" } });
  expect(screen.getByRole("button", { name: "Test Connection" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await screen.findByText("Settings saved. Changes are active immediately.");
  expect(api.saveMedGemmaSettings).toHaveBeenCalledWith({ ...settings, baseUrl: "http://192.9.101.55:8000" }, "", false);
  fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
  await screen.findByText("Model: google/medgemma");
  expect(screen.getByRole("link", { name: /Open Test Console/ }).getAttribute("href")).toBe("/doctor/medgemma-test");
});
it("requests existing re-auth without discarding unsaved edits", async () => {
  const onReauth = vi.fn();
  vi.mocked(api.saveMedGemmaSettings).mockRejectedValue(new ApiError("Recent supervisor re-authentication is required.", 403));
  mount(onReauth); const url = await screen.findByLabelText("MedGemma Server URL");
  fireEvent.change(url, { target: { value: "https://model.hospital:8000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await waitFor(() => expect(onReauth).toHaveBeenCalled());
  expect(url).toHaveProperty("value", "https://model.hospital:8000");
});
