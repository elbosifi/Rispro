import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { EnglishLanguageScope } from "@/providers/language-provider-component";
import { ApiError } from "@/lib/api-client";
import * as api from "@/lib/medical-dictation-api";
import MedicalDictationSection from "./medical-dictation-section";

vi.mock("@/lib/medical-dictation-api");
const settings = { enabled: true, baseUrl: "https://medasr.example.org", timeoutSeconds: 180, allowInsecureHttp: false, apiKeyConfigured: true, encryptionReady: true };
const reauth = vi.fn();
function mount() { return render(<MemoryRouter><EnglishLanguageScope><MedicalDictationSection onReAuthRequired={reauth} /></EnglishLanguageScope></MemoryRouter>); }
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(api.getDictationSettings).mockResolvedValue({ settings }); vi.mocked(api.saveDictationSettings).mockResolvedValue({ settings });
  vi.mocked(api.testDictationConnection).mockResolvedValue({ status: "connected", model: "google/medasr", credentialsValidated: false });
});
it("loads non-secret settings, retains a blank key and tests the saved connection", async () => {
  mount(); await screen.findByLabelText("MedASR Server Address");
  expect(screen.getByLabelText("API Key")).toHaveProperty("value", "");
  expect(screen.getByText("API key: Configured")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await waitFor(() => expect(api.saveDictationSettings).toHaveBeenCalledWith(settings, "", false));
  fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
  expect(await screen.findByText("Model: google/medasr")).toBeTruthy();
  expect(screen.getByText(/API key is validated only by a transcription/)).toBeTruthy();
  expect(screen.getByRole("link")).toHaveProperty("href", expect.stringContaining("/doctor/dictation-test"));
});
it("supports replacement and explicit key removal", async () => {
  mount(); const key = await screen.findByLabelText("API Key"); fireEvent.change(key, { target: { value: "replacement" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await waitFor(() => expect(api.saveDictationSettings).toHaveBeenCalledWith(settings, "replacement", false));
  fireEvent.click(screen.getByLabelText("Remove saved API key on Save"));
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await waitFor(() => expect(api.saveDictationSettings).toHaveBeenLastCalledWith(settings, "", true));
});
it("requires explicit HTTP acknowledgement for the configured hospital destination", async () => {
  mount(); const address = await screen.findByLabelText("MedASR Server Address");
  fireEvent.change(address, { target: { value: "http://192.9.101.244:8000" } });
  const acknowledgement = screen.getByLabelText(/Allow unencrypted HTTP to the configured MedASR server/);
  expect(acknowledgement).toHaveProperty("checked", false);
  fireEvent.click(acknowledgement);
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await waitFor(() => expect(api.saveDictationSettings).toHaveBeenCalledWith({ ...settings, baseUrl: "http://192.9.101.244:8000", allowInsecureHttp: true }, "", false));
});
it("preserves unsaved edits while requesting sensitive-settings re-authentication", async () => {
  vi.mocked(api.saveDictationSettings).mockRejectedValue(new ApiError("Recent supervisor re-authentication is required.", 403));
  mount(); const address = await screen.findByLabelText("MedASR Server Address"); fireEvent.change(address, { target: { value: "https://replacement.example.org" } });
  expect(screen.getByRole("button", { name: "Test Connection" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await waitFor(() => expect(reauth).toHaveBeenCalled()); expect(address).toHaveProperty("value", "https://replacement.example.org");
});
it("permits disabling an enabled integration when platform encryption is unavailable", async () => {
  vi.mocked(api.getDictationSettings).mockResolvedValue({ settings: { ...settings, encryptionReady: false } });
  mount(); const toggle = await screen.findByLabelText("Enable Medical Dictation");
  expect(toggle).toHaveProperty("disabled", false);
  fireEvent.click(toggle); fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await waitFor(() => expect(api.saveDictationSettings).toHaveBeenCalledWith({ ...settings, encryptionReady: false, enabled: false }, "", false));
});
it("shows unavailable service and encryption prerequisites clearly", async () => {
  vi.mocked(api.getDictationSettings).mockResolvedValue({ settings: { ...settings, enabled: false, encryptionReady: false } });
  vi.mocked(api.testDictationConnection).mockResolvedValue({ status: "unavailable", message: "MedASR server is unreachable.", credentialsValidated: false });
  mount(); await screen.findByLabelText("MedASR Server Address");
  expect(screen.getByLabelText("Enable Medical Dictation")).toHaveProperty("disabled", true);
  expect(screen.getByRole("alert")).toHaveProperty("textContent", expect.stringContaining("encryption is unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
  expect(await screen.findByText("MedASR server is unreachable.")).toBeTruthy();
});
