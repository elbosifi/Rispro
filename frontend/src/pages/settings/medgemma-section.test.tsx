import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { EnglishLanguageScope } from "@/providers/language-provider-component";
import { ApiError } from "@/lib/api-client";
import * as api from "@/lib/medgemma-api";
import MedGemmaSection from "./medgemma-section";

vi.mock("@/lib/medgemma-api", async (importOriginal) => ({
  ...await importOriginal<typeof api>(),
  getMedGemmaSettings: vi.fn(), saveMedGemmaSettings: vi.fn(), testMedGemmaConnection: vi.fn(), getMedGemmaHealth: vi.fn(), generateMedGemmaText: vi.fn(),
}));
const settings: api.MedGemmaSettings = { provider: "standalone", ollamaBaseUrl: "", ollamaModel: "medgemma1.5:4b", enabled: false, baseUrl: "", timeoutSeconds: 180, allowInsecureHttp: false, apiKeyConfigured: true, encryptionReady: true, temperature: 0.1, maxGeneratedTokens: 2048, instructions: { cleanup_dictation: "Default cleanup", correct_terminology: "Default terminology", format_radiology_report: "Default formatting", review_radiology_report: "Default review" }, instructionDefaults: { cleanup_dictation: "Default cleanup", correct_terminology: "Default terminology", format_radiology_report: "Default formatting", review_radiology_report: "Default review" } };
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
it("edits all presets, retains edits while switching, restores one default and saves generation controls", async () => {
  mount(); await screen.findByLabelText("Instruction Preset");
  fireEvent.change(screen.getByLabelText("System Instructions"), { target: { value: "Custom cleanup instructions" } });
  fireEvent.change(screen.getByLabelText("Instruction Preset"), { target: { value: "correct_terminology" } });
  fireEvent.change(screen.getByLabelText("System Instructions"), { target: { value: "Custom terminology instructions" } });
  fireEvent.change(screen.getByLabelText("Instruction Preset"), { target: { value: "cleanup_dictation" } });
  expect(screen.getByLabelText("System Instructions")).toHaveProperty("value", "Custom cleanup instructions");
  fireEvent.click(screen.getByRole("button", { name: "Restore Default" }));
  expect(screen.getByLabelText("System Instructions")).toHaveProperty("value", "Default cleanup");
  fireEvent.change(screen.getByLabelText("Temperature (0–1)"), { target: { value: "0.2" } });
  fireEvent.change(screen.getByLabelText("Maximum Generated Tokens (128–8192)"), { target: { value: "1024" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await screen.findByText("Settings saved. Changes are active immediately.");
  expect(api.saveMedGemmaSettings).toHaveBeenCalledWith({ ...settings, instructions: { ...settings.instructions, correct_terminology: "Custom terminology instructions" }, temperature: 0.2, maxGeneratedTokens: 1024 }, "", false);
});
it("switches providers while retaining standalone connection settings and shared instruction edits", async () => {
  vi.mocked(api.getMedGemmaSettings).mockResolvedValue({ settings: { ...settings, baseUrl: "https://standalone.hospital:8000" } });
  mount(); await screen.findByLabelText("Provider");
  fireEvent.change(screen.getByLabelText("System Instructions"), { target: { value: "Shared saved instructions" } });
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "ollama" } });
  expect(screen.queryByLabelText("API Key")).toBeNull(); expect(screen.queryByLabelText("MedGemma Server URL")).toBeNull();
  expect(screen.getByLabelText("Model Name")).toHaveProperty("value", "medgemma1.5:4b");
  fireEvent.change(screen.getByLabelText("Ollama Server URL"), { target: { value: "http://192.168.1.50:11434" } });
  fireEvent.change(screen.getByLabelText("Model Name"), { target: { value: "local-medgemma:4b" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await screen.findByText("Settings saved. Changes are active immediately.");
  expect(api.saveMedGemmaSettings).toHaveBeenCalledWith(expect.objectContaining({ provider: "ollama", baseUrl: "https://standalone.hospital:8000", ollamaBaseUrl: "http://192.168.1.50:11434", ollamaModel: "local-medgemma:4b", apiKeyConfigured: true, instructions: { ...settings.instructions, cleanup_dictation: "Shared saved instructions" } }), "", false);
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "standalone" } });
  expect(screen.getByLabelText("MedGemma Server URL")).toHaveProperty("value", "https://standalone.hospital:8000");
  expect(screen.getByText("API key: Configured")).toBeTruthy();
  expect(screen.getByLabelText("System Instructions")).toHaveProperty("value", "Shared saved instructions");
});
it("allows enabling Ollama without encryption while keeping standalone encryption gating", async () => {
  vi.mocked(api.getMedGemmaSettings).mockResolvedValue({ settings: { ...settings, encryptionReady: false } });
  mount(); await screen.findByLabelText("Provider");
  expect(screen.getByLabelText("Enable MedGemma")).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "ollama" } });
  expect(screen.getByLabelText("Enable MedGemma")).toHaveProperty("disabled", false);
  expect(screen.queryByRole("alert")).toBeNull();
});
